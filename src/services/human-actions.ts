import { z } from "zod";
import { db } from "../database/client";
import { canApprove } from "../domain/approvals/approval-policy";
import { confirmedExtraction, confirmedSchema } from "../domain/bills/types";
import { audit, transition } from "./audit";
import { onboardVendor } from "./vendor-onboarding";
import { understand } from "../ai/bill-understanding";
import { extractionSchema } from "../domain/bills/types";
export const correctionSchema = z.object({
  accountId: z.string().min(1).optional(),
  vendorName: z.string().trim().min(1).max(200).optional(),
  accountNumber: z.string().trim().min(1).max(100).optional(),
  propertyId: z.string().min(1).optional(),
  invoiceNumber: z.string().trim().min(1),
  amount: z.number().positive(),
  dueDate: z.iso.date(),
  note: z.string().trim().min(5).max(2000),
  acknowledgeRisk: z.boolean(),
});
export async function correctBill(
  id: string,
  input: unknown,
  user: { id: string; name: string; role: string },
) {
  const correction = correctionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({
      where: { id },
      include: { extraction: true },
    });
    if (bill.status !== "NEEDS_REVIEW")
      throw new Error("Only bills in review can be corrected");
    const account = correction.accountId
      ? await tx.vendorAccount.findUniqueOrThrow({
          where: { id: correction.accountId },
          include: { vendor: true, property: true },
        })
      : null;
    const property =
      account?.property ??
      (correction.propertyId
        ? await tx.property.findUniqueOrThrow({
            where: { id: correction.propertyId },
          })
        : null);
    if (
      !property ||
      property.status !== "ACTIVE" ||
      (account && !account.active)
    )
      throw new Error("Choose an active property and vendor account");
    const values = confirmedSchema.parse({
      vendorName: account?.vendor.name ?? correction.vendorName,
      accountNumber: account?.number ?? correction.accountNumber,
      invoiceNumber: correction.invoiceNumber,
      amount: correction.amount,
      dueDate: correction.dueDate,
      serviceAddress: property.address,
    });
    const fields = JSON.stringify(confirmedExtraction(values));
    await onboardVendor(tx, id, confirmedExtraction(values), user.name);
    await tx.billExtraction.upsert({
      where: { billId: id },
      create: {
        billId: id,
        fields,
        originalFields: "{}",
        provider: "Human-entered evidence",
      },
      update: { fields },
    });
    await tx.reviewItem.updateMany({
      where: { billId: id, status: "OPEN" },
      data: {
        status: "RESOLVED",
        resolution: correction.note,
        resolvedBy: user.name,
        resolvedAt: new Date(),
      },
    });
    await tx.bill.update({
      where: { id },
      data: {
        stage: 2,
        riskAcknowledged: correction.acknowledgeRisk,
        proposedPropertyId: null,
      },
    });
    await audit(
      tx,
      id,
      "HUMAN_CORRECTION",
      "Invoice information confirmed",
      correction.note,
      user.name,
      {
        before: bill.extraction ? JSON.parse(bill.extraction.fields) : null,
        after: values,
        acknowledgedAmountVariance: correction.acknowledgeRisk,
      },
    );
    await transition(
      tx,
      id,
      "NEEDS_REVIEW",
      "PROCESSING",
      "Human correction recorded. All deterministic checks will run again.",
      user.name,
    );
  });
}
export async function decideApproval(
  id: string,
  approve: boolean,
  note: string,
  user: { id: string; name: string; role: string },
) {
  if (note.trim().length < 5)
    throw new Error("Add a decision note of at least five characters");
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({
      where: { id },
      include: { approvals: true },
    });
    if (bill.status !== "AWAITING_APPROVAL")
      throw new Error("Bill is not awaiting approval");
    const approval = bill.approvals.find((a) => a.status === "PENDING");
    if (!approval || !canApprove(user.role, approval.requiredRole))
      throw new Error(
        `Requires ${approval?.requiredRole.replaceAll("_", " ") ?? "authorized"} authority`,
      );
    await tx.approval.update({
      where: { id: approval.id },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        userId: user.id,
        note,
        decidedAt: new Date(),
      },
    });
    await transition(
      tx,
      id,
      "AWAITING_APPROVAL",
      approve ? "APPROVED" : "REJECTED",
      note,
      user.name,
    );
    await audit(
      tx,
      id,
      approve ? "BILL_APPROVED" : "BILL_REJECTED",
      approve ? "Bill approved by a manager" : "Bill rejected by a manager",
      `${note} (${user.role.replaceAll("_", " ")})`,
      user.name,
    );
  });
}
export async function retryPayment(id: string, user: { name: string }) {
  return db.$transaction(async (tx) => {
    await transition(
      tx,
      id,
      "FAILED",
      "APPROVED",
      "Retry requested. Payment safeguards will run again.",
      user.name,
    );
    await audit(
      tx,
      id,
      "PAYMENT_RETRY",
      "Payment retry requested",
      "A new attempt will reuse the existing payment record.",
      user.name,
    );
  });
}

export async function rereadDocument(id: string, user: { name: string }) {
  const snapshot = await db.bill.findUniqueOrThrow({ where: { id } });
  if (snapshot.status !== "NEEDS_REVIEW" || !snapshot.documentPath)
    throw new Error("Only uploaded documents in review can be re-read");
  const result = await understand(snapshot);
  const fields = JSON.stringify(extractionSchema.parse(result.fields));
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({
      where: { id },
      include: { extraction: true },
    });
    if (
      bill.status !== "NEEDS_REVIEW" ||
      bill.updatedAt.getTime() !== snapshot.updatedAt.getTime()
    )
      throw new Error("Bill changed while reading. Refresh before retrying.");
    await tx.billExtraction.upsert({
      where: { billId: id },
      create: {
        billId: id,
        fields,
        originalFields: fields,
        provider: result.provider,
        propertyName: result.propertyName,
        evidence: JSON.stringify(result.evidence ?? {}),
        paymentUrls: JSON.stringify(result.paymentUrls ?? []),
      },
      update: {
        fields,
        provider: result.provider,
        propertyName: result.propertyName ?? null,
        evidence: JSON.stringify(result.evidence ?? {}),
        paymentUrls: JSON.stringify(result.paymentUrls ?? []),
      },
    });
    await audit(
      tx,
      id,
      "EXTRACTION_COMPLETED",
      "Document re-read",
      `${result.provider}. Previous evidence is retained in this audit event.`,
      user.name,
      {
        before: bill.extraction?.fields ?? null,
        after: result.fields,
        previousSourceEvidence: bill.extraction?.evidence ?? null,
        sourceEvidence: result.evidence ?? null,
      },
    );
    await tx.reviewItem.updateMany({
      where: { billId: id, status: "OPEN" },
      data: {
        status: "RESOLVED",
        resolution: "Document re-read; all checks run again.",
        resolvedBy: user.name,
        resolvedAt: new Date(),
      },
    });
    await tx.bill.update({
      where: { id },
      data: { stage: 2, riskAcknowledged: false, proposedPropertyId: null },
    });
    await transition(
      tx,
      id,
      "NEEDS_REVIEW",
      "PROCESSING",
      "Document interpretation refreshed; validation and policy checks resume.",
      user.name,
    );
  });
}
