import { randomUUID } from "node:crypto";
import { db } from "../database/client";
import {
  destinationURL,
  chooseDestination,
} from "../domain/payments/payment-destination";
import { canApprove } from "../domain/approvals/approval-policy";
import { executeBrowserPayment } from "./browser-payment-agent";
import { loadPayableBill } from "./payment-service";
import { audit, transition } from "./audit";
import { discoverPaymentWebsite } from "../ai/payment-website-discovery";

export async function ensurePaymentNavigation(id: string, force = false) {
  const bill = await db.bill.findUniqueOrThrow({
    where: { id },
    include: { navigation: true, extraction: true, vendor: true },
  });
  if (bill.navigation) return bill.navigation;
  const links: string[] = JSON.parse(bill.extraction?.paymentUrls || "[]");
  if (
    !force &&
    !links.length &&
    !bill.vendor?.portalUrl &&
    bill.paymentMethod !== "PORTAL" &&
    !bill.vendorId?.startsWith("vendor-")
  )
    return null;
  const choice = chooseDestination(links, bill.vendor?.portalUrl ?? null);
  const created = await db.paymentNavigation.upsert({
    where: { billId: id },
    update: {},
    create: { billId: id, ...choice },
  });
  if (
    !links.length &&
    !bill.vendor?.portalUrl &&
    bill.vendor &&
    process.env.OPENAI_API_KEY
  ) {
    const startedAt = new Date();
    const lock = await db.paymentNavigation.updateMany({
      where: { billId: id, status: "NEEDS_DESTINATION", source: choice.source },
      data: { status: "DISCOVERING", startedAt },
    });
    if (lock.count) {
      try {
        const result = await discoverPaymentWebsite(bill.vendor.name);
        await db.paymentNavigation.updateMany({
          where: { billId: id, status: "DISCOVERING", startedAt },
          data: {
            status: "NEEDS_DESTINATION",
            destination: result.destination,
            source: result.destination
              ? "Web search candidate — verify the vendor identity before use"
              : "Website search could not establish an unambiguous vendor payment page",
            steps: JSON.stringify([
              {
                at: new Date().toISOString(),
                message: "Payment website lookup sources",
                sources: result.sources,
              },
            ]),
          },
        });
      } catch (error) {
        await db.paymentNavigation.updateMany({
          where: { billId: id, status: "DISCOVERING", startedAt },
          data: {
            status: "NEEDS_DESTINATION",
            message:
              error instanceof Error ? error.message : "Website lookup failed",
          },
        });
      }
      return db.paymentNavigation.findUniqueOrThrow({ where: { billId: id } });
    }
  }
  return created;
}
export async function confirmPaymentDestination(
  id: string,
  raw: string,
  user: { name: string; role: string },
) {
  if (!canApprove(user.role, "PROPERTY_MANAGER"))
    throw new Error(
      "A property manager or higher must verify a payment destination",
    );
  const { url } = destinationURL(raw);
  await db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({
      where: { id },
      include: { navigation: true, payment: true },
    });
    if (
      !["APPROVED", "AWAITING_APPROVAL"].includes(bill.status) ||
      !bill.vendorId ||
      bill.payment ||
      ["RUNNING", "DISCOVERING"].includes(bill.navigation?.status || "")
    )
      throw new Error(
        "Destination can only be changed before payment starts, after invoice checks",
      );
    await tx.paymentNavigation.upsert({
      where: { billId: id },
      create: {
        billId: id,
        destination: url,
        source: "Verified payment website",
        status: "READY",
        verifiedBy: user.name,
      },
      update: {
        destination: url,
        source: "Verified payment website",
        status: "READY",
        verifiedBy: user.name,
        message: null,
        receipt: null,
        steps: "[]",
        runToken: null,
      },
    });
    await tx.vendor.update({
      where: { id: bill.vendorId },
      data: { portalUrl: url },
    });
    await tx.bill.update({ where: { id }, data: { paymentMethod: "PORTAL" } });
    await audit(
      tx,
      id,
      "PAYMENT_DESTINATION_VERIFIED",
      "Payment website verified",
      `${url} — saved for this vendor. Invoice approval is still required.`,
      user.name,
    );
  });
}
async function finish(id: string, receipt: string, runToken?: string) {
  await db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({
      where: { id },
      include: { payment: true, navigation: true },
    });
    if (bill.status === "PAID") return;
    if (runToken && bill.navigation?.runToken !== runToken)
      throw new Error("Browser reservation expired");
    if (bill.status !== "PAYMENT_PENDING" || !bill.payment || !bill.navigation)
      throw new Error("Payment is not awaiting a portal receipt");
    await tx.payment.update({
      where: { id: bill.payment.id },
      data: {
        status: "COMPLETED",
        externalId: receipt,
        completedAt: new Date(),
      },
    });
    await tx.paymentAttempt.updateMany({
      where: { paymentId: bill.payment.id, status: "PENDING" },
      data: {
        status: "COMPLETED",
        externalId: receipt,
        reason: "Browser receipt verified against the approved invoice.",
      },
    });
    await tx.paymentNavigation.update({
      where: { billId: id },
      data: {
        status: "SUCCEEDED",
        receipt,
        message: "Payment website returned a verified receipt.",
        runToken: null,
      },
    });
    await transition(
      tx,
      id,
      "PAYMENT_PENDING",
      "PAID",
      "Payment website receipt verified.",
    );
    await audit(
      tx,
      id,
      "PAYMENT_COMPLETED",
      "Payment completed",
      `Browser payment confirmed by receipt ${receipt}.`,
    );
  });
}
export async function reconcilePaymentNavigation(id: string) {
  const bill = await db.bill.findUniqueOrThrow({
    where: { id },
    include: { navigation: true, account: true, vendor: true },
  });
  const nav = bill.navigation;
  if (!nav) return false;
  if (
    nav.status === "DISCOVERING" &&
    nav.startedAt &&
    Date.now() - nav.startedAt.getTime() > 45000
  ) {
    await db.paymentNavigation.updateMany({
      where: { billId: id, status: "DISCOVERING", startedAt: nav.startedAt },
      data: {
        status: "NEEDS_DESTINATION",
        message:
          "Website lookup was interrupted. Enter a verified destination to continue.",
      },
    });
    return true;
  }
  const receipt = await db.portalReceipt.findUnique({ where: { billId: id } });
  if (
    receipt &&
    bill.status === "PAYMENT_PENDING" &&
    nav.destination &&
    destinationURL(nav.destination).isDemo &&
    receipt.accountNumber === bill.account?.number &&
    receipt.invoiceNumber === bill.invoiceNumber &&
    receipt.vendorName === bill.vendor?.name &&
    receipt.amountCents === bill.amountCents
  ) {
    await finish(id, `DEMO-${receipt.id}`);
    return true;
  }
  if (
    nav.status === "RUNNING" &&
    nav.startedAt &&
    Date.now() - nav.startedAt.getTime() > 240000
  ) {
    await db.paymentNavigation.updateMany({
      where: {
        billId: id,
        status: "RUNNING",
        runToken: nav.runToken,
        startedAt: nav.startedAt,
        bill: { status: bill.status },
      },
      data: {
        status: bill.status === "PAYMENT_PENDING" ? "UNKNOWN" : "BLOCKED",
        runToken: bill.status === "PAYMENT_PENDING" ? nav.runToken : null,
        message:
          bill.status === "PAYMENT_PENDING"
            ? "Browser interrupted after submission was reserved. Reconcile the vendor receipt; automatic resubmission is disabled."
            : "Browser interrupted before submission. Resume after checking the portal.",
      },
    });
  }
  return true;
}
export async function resumePaymentNavigation(
  id: string,
  user: { name: string; role: string },
) {
  if (!canApprove(user.role, "PROPERTY_MANAGER"))
    throw new Error("A property manager or higher must resume browser payment");
  const resumed = await db.paymentNavigation.updateMany({
    where: {
      billId: id,
      status: "BLOCKED",
      bill: { status: "APPROVED", payment: { is: null } },
    },
    data: { status: "READY", message: null, runToken: null },
  });
  if (!resumed.count)
    throw new Error(
      "Only a browser run stopped before submission can be resumed",
    );
}
export async function runPaymentNavigation(id: string) {
  const nav = await ensurePaymentNavigation(id);
  if (!nav) return;
  if (nav.status !== "READY") {
    await reconcilePaymentNavigation(id);
    return;
  }
  if (!nav.destination || !nav.verifiedBy) return;
  const token = randomUUID();
  const claimed = await db.$transaction(async (tx) => {
    const bill = await loadPayableBill(tx, id);
    const result = await tx.paymentNavigation.updateMany({
      where: {
        billId: id,
        status: "READY",
        destination: nav.destination,
        verifiedBy: nav.verifiedBy,
        updatedAt: nav.updatedAt,
      },
      data: {
        status: "RUNNING",
        runToken: token,
        startedAt: new Date(),
        message: null,
      },
    });
    if (!result.count) return null;
    await tx.bill.update({ where: { id }, data: { paymentMethod: "PORTAL" } });
    await audit(
      tx,
      id,
      "BROWSER_STARTED",
      "Browser payment started",
      `Following the verified destination ${nav.destination}`,
    );
    return bill;
  });
  if (!claimed) return;
  const step = async (message: string) => {
    await db.$transaction(async (tx) => {
      const latest = await tx.paymentNavigation.findUniqueOrThrow({
        where: { billId: id },
      });
      if (latest.runToken !== token || latest.status !== "RUNNING")
        throw new Error("Browser run is no longer active");
      const steps = JSON.parse(latest.steps) as {
        at: string;
        message: string;
      }[];
      steps.push({ at: new Date().toISOString(), message });
      await tx.paymentNavigation.update({
        where: { billId: id },
        data: { steps: JSON.stringify(steps) },
      });
      await audit(tx, id, "BROWSER_STEP", "Browser action", message);
    });
  };
  try {
    const result = await executeBrowserPayment({
      destination: nav.destination,
      runToken: token,
      invoice: {
        billId: id,
        vendorName: claimed.vendor!.name,
        accountNumber: claimed.account!.number,
        accountId: claimed.accountId!,
        invoiceNumber: claimed.invoiceNumber!,
        amountCents: claimed.amountCents!,
      },
      step,
      beforeSubmit: async () => {
        await db.$transaction(async (tx) => {
          const bill = await loadPayableBill(tx, id);
          if (
            bill.navigation?.runToken !== token ||
            bill.navigation.status !== "RUNNING"
          )
            throw new Error("Browser reservation expired");
          await tx.payment.create({
            data: {
              billId: id,
              status: "PENDING",
              method: "PORTAL",
              amountCents: bill.amountCents!,
              idempotencyKey: id,
              attempts: { create: { number: 1, status: "PENDING" } },
            },
          });
          await transition(
            tx,
            id,
            "APPROVED",
            "PAYMENT_PENDING",
            "Browser submission reserved; never automatically resubmit an uncertain payment.",
          );
          await audit(
            tx,
            id,
            "PAYMENT_SUBMITTED",
            "Submitting on payment website",
            "Invoice checks passed again immediately before clicking the final payment action.",
          );
        });
      },
    });
    if (destinationURL(nav.destination).isDemo) {
      const receipt = await db.portalReceipt.findUnique({
        where: { billId: id },
      });
      if (
        !receipt ||
        `DEMO-${receipt.id}` !== result.receipt ||
        receipt.amountCents !== claimed.amountCents ||
        receipt.accountNumber !== claimed.account!.number ||
        receipt.invoiceNumber !== claimed.invoiceNumber
      )
        throw new Error("Browser receipt did not match the portal ledger");
    }
    await finish(id, result.receipt, token);
  } catch (error) {
    await recordBrowserHandoff(id, token, error);
  }
}

export async function recordBrowserHandoff(
  id: string,
  token: string,
  error: unknown,
) {
  const message =
    error instanceof Error ? error.message : "Browser navigation failed";
  await db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({ where: { id } });
    if (bill.status === "PAID") return;
    const uncertain = bill.status === "PAYMENT_PENDING";
    const changed = await tx.paymentNavigation.updateMany({
      where: { billId: id, runToken: token, status: "RUNNING" },
      data: {
        status: uncertain ? "UNKNOWN" : "BLOCKED",
        message,
        runToken: uncertain ? token : null,
      },
    });
    // A timed-out worker must not overwrite a resumed or reconciled run.
    if (!changed.count) return;
    await audit(
      tx,
      id,
      "BROWSER_HANDOFF",
      uncertain
        ? "Payment outcome needs reconciliation"
        : "Browser needs assistance",
      message,
    );
  });
}
