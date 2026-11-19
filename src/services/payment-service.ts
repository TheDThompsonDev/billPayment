import { db } from "../database/client";
import { assertPaymentSafe } from "../domain/payments/payment-guards";
import { providerFor } from "../domain/payments/payment-provider";
import {
  canApprove,
  determineApproval,
} from "../domain/approvals/approval-policy";
import type { PaymentMethod } from "../domain/bills/types";
import { duplicateKey } from "../domain/bills/duplicate-check";
import { audit, transition, type Tx } from "./audit";
export async function loadPayableBill(tx: Tx, id: string) {
  const bill = await tx.bill.findUniqueOrThrow({
    where: { id },
    include: {
      account: true,
      vendor: true,
      property: true,
      payment: { include: { attempts: true } },
      approvals: { include: { user: true } },
      reviews: true,
      navigation: true,
    },
  });
  const policies = await tx.approvalPolicy.findMany();
  const decision = determineApproval(
    {
      amountCents: bill.amountCents ?? 0,
      category: bill.vendor?.category ?? "",
    },
    policies,
  );
  const approvalSatisfied =
    decision.type === "AUTO_APPROVED" ||
    bill.approvals.some(
      (a) =>
        a.status === "APPROVED" &&
        a.policyId === decision.policyId &&
        a.user &&
        canApprove(a.user.role, decision.role!),
    );
  const key =
    bill.vendorId && bill.accountId && bill.invoiceNumber
      ? duplicateKey(bill.vendorId, bill.accountId, bill.invoiceNumber)
      : null;
  const duplicate = key
    ? await tx.bill.findFirst({ where: { dedupeKey: key, id: { not: id } } })
    : null;
  assertPaymentSafe({
    status: bill.status,
    completed: bill.payment?.status === "COMPLETED",
    duplicate: !!duplicate || !!bill.duplicateOfId,
    method: bill.paymentMethod,
    amountCents: bill.amountCents,
    accountActive: !!bill.account?.active && bill.property?.status === "ACTIVE",
    requiredFields:
      !!key &&
      bill.dedupeKey === key &&
      !!bill.dueDate &&
      bill.account?.vendorId === bill.vendorId &&
      bill.account?.propertyId === bill.propertyId &&
      (bill.paymentMethod === bill.account?.paymentMethod ||
        (bill.paymentMethod === "PORTAL" && !!bill.navigation?.verifiedBy)),
    approvalSatisfied,
    openReview: bill.reviews.some((r) => r.status === "OPEN"),
  });
  return bill;
}
export async function submitPayment(id: string) {
  return db.$transaction(async (tx) => {
    const bill = await loadPayableBill(tx, id);
    if (bill.navigation || bill.paymentMethod === "PORTAL")
      throw new Error(
        "Browser payment requires a verified destination and portal receipt",
      );
    const attempt = (bill.payment?.attempts.length ?? 0) + 1;
    // Only mock providers are registered. Failure is explicit and repeatable for a live presentation.
    const result = await providerFor(
      bill.paymentMethod as PaymentMethod,
    ).submit({
      idempotencyKey: `${id}-${attempt}`,
      amountCents: bill.amountCents!,
      fail: bill.sampleKey === "failure" && attempt === 1,
    });
    const payment = await tx.payment.upsert({
      where: { billId: id },
      create: {
        billId: id,
        status: "PENDING",
        method: bill.paymentMethod!,
        amountCents: bill.amountCents!,
        externalId: result.externalId,
        idempotencyKey: id,
      },
      update: { status: "PENDING", externalId: result.externalId },
    });
    await tx.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        number: attempt,
        status: "PENDING",
        externalId: result.externalId,
      },
    });
    await transition(
      tx,
      id,
      "APPROVED",
      "PAYMENT_PENDING",
      "All server-side payment safeguards passed.",
    );
    await audit(
      tx,
      id,
      "PAYMENT_SUBMITTED",
      `Payment submitted · ${bill.paymentMethod}`,
      `Mock provider accepted attempt ${attempt}. No real money moves.`,
      undefined,
      { externalId: result.externalId },
    );
  });
}
export async function settlePayment(id: string) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({
      where: { id },
      include: {
        payment: { include: { attempts: { orderBy: { number: "desc" } } } },
      },
    });
    if (bill.status !== "PAYMENT_PENDING" || !bill.payment?.externalId) return;
    const latest = bill.payment.attempts[0];
    if (Date.now() - latest.createdAt.getTime() < 1100) return;
    const result = await providerFor(
      bill.payment.method as PaymentMethod,
    ).getStatus(bill.payment.externalId);
    const ok = result === "COMPLETED";
    await tx.payment.update({
      where: { id: bill.payment.id },
      data: { status: result, completedAt: ok ? new Date() : null },
    });
    await tx.paymentAttempt.update({
      where: { id: latest.id },
      data: {
        status: result,
        reason: ok
          ? "Mock settlement confirmed."
          : "Simulated provider timeout. No funds transferred; retry is safe.",
      },
    });
    await transition(
      tx,
      id,
      "PAYMENT_PENDING",
      ok ? "PAID" : "FAILED",
      ok ? "Mock settlement confirmed." : "Mock provider failed this attempt.",
    );
    await audit(
      tx,
      id,
      ok ? "PAYMENT_COMPLETED" : "PAYMENT_FAILED",
      ok ? "Payment completed" : "Payment failed",
      ok
        ? `Simulated transaction ${bill.payment.externalId}.`
        : "Mock provider timeout. No funds transferred. A retry creates a new attempt on the same payment.",
    );
  });
}
