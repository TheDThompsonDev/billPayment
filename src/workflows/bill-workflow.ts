import { db } from "../database/client";
import { understand } from "../ai/bill-understanding";
import { DocumentReadError } from "../ai/document-reader";
import {
  confirmedSchema,
  extractionSchema,
  fieldValues,
  type Finding,
} from "../domain/bills/types";
import { matchBill, confidenceDecision } from "../domain/matching/bill-matcher";
import { duplicateKey } from "../domain/bills/duplicate-check";
import { evaluateRisk } from "../domain/risk/risk-evaluator";
import { determineApproval } from "../domain/approvals/approval-policy";
import { audit, transition, type Tx } from "../services/audit";
import { submitPayment, settlePayment } from "../services/payment-service";
import { onboardVendor } from "../services/vendor-onboarding";
import { proposeProperty } from "../services/property-onboarding";
import {
  ensurePaymentNavigation,
  runPaymentNavigation,
  reconcilePaymentNavigation,
} from "../services/payment-navigation";

async function review(tx: Tx, id: string, findings: Finding[]) {
  for (const finding of findings.filter((f) => f.code === "AMOUNT_OUTLIER"))
    await audit(
      tx,
      id,
      "ANOMALY_DETECTED",
      "Unusual invoice amount detected",
      finding.message,
    );
  await tx.bill.update({
    where: { id },
    data: { findings: JSON.stringify(findings) },
  });
  await tx.reviewItem.create({
    data: { billId: id, reasons: JSON.stringify(findings) },
  });
  await transition(
    tx,
    id,
    "PROCESSING",
    "NEEDS_REVIEW",
    "The workflow stopped safely for human resolution.",
  );
  await audit(
    tx,
    id,
    "MATCH_REQUIRES_REVIEW",
    "Human review required",
    findings.map((f) => f.message).join(" "),
  );
}
export async function advanceBill(id: string) {
  const current = await db.bill.findUniqueOrThrow({
    where: { id },
    include: { extraction: true },
  });
  if (current.status === "APPROVED") {
    const navigation = await ensurePaymentNavigation(id);
    if (navigation) return runPaymentNavigation(id);
    return submitPayment(id);
  }
  if (current.status === "PAYMENT_PENDING") {
    if (await reconcilePaymentNavigation(id)) return;
    return settlePayment(id);
  }
  if (current.stage === 3 && current.status === "PROCESSING")
    await ensurePaymentNavigation(id);
  if (!["RECEIVED", "PROCESSING"].includes(current.status)) return;
  // External interpretation occurs outside the transaction and has no write capability.
  let interpretation: Awaited<ReturnType<typeof understand>> | undefined;
  let extractionError = "";
  let extractionErrorCode = "EXTRACTION_FAILED";
  if (current.stage === 1 && !current.extraction) {
    try {
      interpretation = await understand(current);
    } catch (error) {
      if (error instanceof DocumentReadError) extractionErrorCode = error.code;
      extractionError =
        error instanceof Error ? error.message : "Extraction failed";
    }
  }
  await db.$transaction(
    async (tx) => {
      const bill = await tx.bill.findUniqueOrThrow({
        where: { id },
        include: { extraction: true, vendor: true },
      });
      if (bill.status !== current.status || bill.stage !== current.stage)
        return;
      if (bill.status === "RECEIVED") {
        await transition(
          tx,
          id,
          "RECEIVED",
          "PROCESSING",
          "Document queued for interpretation.",
        );
        await tx.bill.update({ where: { id }, data: { stage: 1 } });
        return;
      }
      if (bill.stage === 1) {
        if (extractionError) {
          await review(tx, id, [
            {
              code: extractionErrorCode,
              message: extractionError,
              severity: "review",
            },
          ]);
          return;
        }
        if (interpretation) {
          const fields = JSON.stringify(
            extractionSchema.parse(interpretation.fields),
          );
          await tx.billExtraction.create({
            data: {
              billId: id,
              fields,
              originalFields: fields,
              provider: interpretation.provider,
              paymentUrls: JSON.stringify(interpretation.paymentUrls ?? []),
              propertyName: interpretation.propertyName,
              evidence: JSON.stringify(interpretation.evidence ?? {}),
            },
          });
          await audit(
            tx,
            id,
            "EXTRACTION_COMPLETED",
            "Invoice fields extracted",
            `${interpretation.provider}. Extracted evidence is separate from accepted bill data.`,
          );
        } else if (bill.extraction) {
          await audit(
            tx,
            id,
            "EXTRACTION_COMPLETED",
            "Invoice fields extracted",
            `${bill.extraction.provider}. Evidence retained separately; deterministic validation follows.`,
          );
        }
        await tx.bill.update({ where: { id }, data: { stage: 2 } });
        return;
      }
      if (bill.stage === 2) {
        const extraction = extractionSchema.parse(
          JSON.parse(bill.extraction!.fields),
        );
        await onboardVendor(tx, id, extraction);
        const parsed = confirmedSchema.safeParse(fieldValues(extraction));
        const validation = parsed.success
          ? [
              "Required fields present",
              "Positive amount with exact cents",
              "Valid due date",
            ]
          : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        await tx.bill.update({
          where: { id },
          data: { validation: JSON.stringify(validation) },
        });
        if (!parsed.success) {
          await review(tx, id, [
            {
              code: "MISSING_INFORMATION",
              message: validation.join("; "),
              severity: "review",
            },
          ]);
          return;
        }
        const proposed = await proposeProperty(
          tx,
          id,
          extraction,
          bill.extraction?.propertyName,
        );
        if (proposed) {
          await tx.bill.update({
            where: { id },
            data: {
              matching: JSON.stringify({
                method: "New property",
                reasoning:
                  "Invoice details recovered. The new property needs your acceptance.",
              }),
              confidence: null,
            },
          });
          await review(tx, id, [
            {
              code: "PROPERTY_ACCEPTANCE_REQUIRED",
              message: `${proposed.name} at this invoice's address is awaiting acceptance. Review the address and accept the property to continue.`,
              severity: "review",
            },
          ]);
          return;
        }
        const accounts = await tx.vendorAccount.findMany({
          include: { vendor: true, property: true },
        });
        const match = matchBill(parsed.data, accounts);
        const confidence = Math.min(
          ...Object.values(extraction).map((f) => f?.confidence ?? 0),
          match.confidence,
        );
        await tx.bill.update({
          where: { id },
          data: {
            confidence,
            matching: JSON.stringify({
              method: match.method,
              reasoning: match.reasoning,
              confidence: match.confidence,
              suggestions: match.suggestions.map((a) => ({
                accountId: a.id,
                property: a.property.name,
                address: a.property.address,
                number: a.number,
              })),
            }),
          },
        });
        const findings: Finding[] = [];
        if (
          confidenceDecision(confidence) !== "ACCEPT" ||
          !match.account ||
          match.conflict
        )
          findings.push({
            code: "UNCERTAIN_MATCH",
            message: `${Math.round(confidence * 100)}% confidence. ${match.reasoning}`,
            severity: "review",
          });
        const relatedIds = match.account
          ? [match.account.id]
          : match.suggestions.map((a) => a.id);
        const history = await tx.bill.findMany({
          where: {
            accountId: { in: relatedIds },
            status: "PAID",
            id: { not: id },
          },
          orderBy: { createdAt: "desc" },
          take: 6,
        });
        findings.push(
          ...evaluateRisk({
            amountCents: Math.round(parsed.data.amount * 100),
            historicalAmounts: history.map((b) => b.amountCents!),
            dueDate: new Date(parsed.data.dueDate),
            active: match.account?.active ?? true,
            knownRelationship: !!match.account || match.suggestions.length > 0,
            acknowledged: bill.riskAcknowledged,
          }),
        );
        // Duplicate check runs as soon as an exact relationship is known, before approval.
        if (match.account) {
          const key = duplicateKey(
            match.account.vendorId,
            match.account.id,
            parsed.data.invoiceNumber,
          );
          const previous = await tx.bill.findUnique({
            where: { dedupeKey: key },
            include: { payment: true },
          });
          if (previous && previous.id !== id) {
            await tx.bill.update({
              where: { id },
              data: {
                duplicateOfId: previous.id,
                findings: JSON.stringify([
                  {
                    code: "DUPLICATE",
                    message: `Invoice ${previous.invoiceNumber} already exists. ${previous.payment?.externalId ?? "The original is reserved for processing."}`,
                    severity: "review",
                  },
                ]),
              },
            });
            await transition(
              tx,
              id,
              "PROCESSING",
              "REJECTED",
              "Duplicate invoices never proceed to payment.",
            );
            await audit(
              tx,
              id,
              "DUPLICATE_DETECTED",
              "Duplicate invoice blocked",
              `Invoice ${previous.invoiceNumber} is already recorded.`,
              undefined,
              {
                previousBillId: previous.id,
                transaction: previous.payment?.externalId,
              },
            );
            return;
          }
        }
        if (findings.some((f) => f.severity === "review")) {
          await review(tx, id, findings);
          return;
        }
        const account = match.account!;
        await tx.bill.update({
          where: { id },
          data: {
            vendorId: account.vendorId,
            propertyId: account.propertyId,
            accountId: account.id,
            invoiceNumber: parsed.data.invoiceNumber,
            amountCents: Math.round(parsed.data.amount * 100),
            dueDate: new Date(parsed.data.dueDate),
            paymentMethod: account.paymentMethod,
            dedupeKey: duplicateKey(
              account.vendorId,
              account.id,
              parsed.data.invoiceNumber,
            ),
            findings: JSON.stringify(findings),
            stage: 3,
          },
        });
        await audit(
          tx,
          id,
          "VENDOR_MATCHED",
          `Vendor matched to ${account.vendor.name}`,
          "Exact normalized vendor and account number.",
        );
        await audit(
          tx,
          id,
          "PROPERTY_MATCHED",
          `Property matched to ${account.property.address}`,
          match.reasoning,
        );
        await audit(
          tx,
          id,
          "DUPLICATE_CHECK_PASSED",
          "Duplicate check passed",
          "Unique vendor/account/invoice identity reserved in SQLite.",
        );
        await audit(
          tx,
          id,
          "RISK_CHECK_PASSED",
          "Amount and account checks passed",
          findings.length
            ? findings.map((f) => f.message).join(" ")
            : "No blocking anomalies. Account is active; amount is within expected range.",
        );
        return;
      }
      if (bill.stage === 3) {
        const decision = determineApproval(
          { amountCents: bill.amountCents!, category: bill.vendor!.category },
          await tx.approvalPolicy.findMany(),
        );
        await audit(
          tx,
          id,
          "POLICY_EVALUATED",
          "Approval policy evaluated",
          decision.reason,
          undefined,
          decision,
        );
        if (decision.type === "AUTO_APPROVED") {
          await transition(tx, id, "PROCESSING", "APPROVED", decision.reason);
          await audit(
            tx,
            id,
            "BILL_APPROVED",
            "Bill automatically approved",
            decision.reason,
          );
        } else {
          await tx.approval.create({
            data: {
              billId: id,
              policyId: decision.policyId,
              requiredRole: decision.role!,
              reason: decision.reason,
            },
          });
          await transition(
            tx,
            id,
            "PROCESSING",
            "AWAITING_APPROVAL",
            decision.reason,
          );
          await audit(
            tx,
            id,
            "APPROVAL_REQUIRED",
            "Approval requested",
            decision.reason,
          );
        }
        await tx.bill.update({ where: { id }, data: { stage: 4 } });
      }
    },
    { timeout: 15000 },
  );
}
