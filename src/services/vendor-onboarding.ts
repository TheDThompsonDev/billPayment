import { createHash } from "node:crypto";
import type { BillExtraction } from "../domain/bills/types";
import {
  confidenceDecision,
  normalizeAddress,
  normalize,
  normalizeVendor as vendorIdentity,
} from "../domain/matching/bill-matcher";
import { audit, type Tx } from "./audit";

const usable = (field: { value: string; confidence: number } | null) =>
  !!field &&
  confidenceDecision(field.confidence) === "ACCEPT" &&
  !!normalize(field.value) &&
  !["unknown", "unclear", "na", "none"].includes(normalize(field.value));
const stableId = (kind: string, key: string) =>
  `${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;

/** Creates master data only. Never approves a bill, changes policy or submits payment. */
export async function onboardVendor(
  tx: Tx,
  billId: string,
  fields: BillExtraction,
  actor = "Workflow engine",
) {
  if (
    !usable(fields.vendorName) ||
    fields.vendorName!.value.trim().length > 200
  )
    return;
  const name = fields.vendorName!.value.trim();
  const identity = vendorIdentity(name);
  if (!identity) return;
  const vendors = (await tx.vendor.findMany()).filter(
    (v) => vendorIdentity(v.name) === identity,
  );
  if (vendors.length > 1) return; // Ambiguous existing identities must not be silently merged.
  let vendor = vendors[0];
  if (!vendor) {
    vendor = await tx.vendor.create({
      data: {
        id: stableId("vendor", identity),
        name,
        category: "OTHER",
        paymentMethod: "CHECK",
      },
    });
    await audit(
      tx,
      billId,
      "VENDOR_CREATED",
      `New vendor created: ${name}`,
      "Validated vendor identity added to the directory. Category defaults to Other; simulated check is the default payment method. Normal approval policy still applies.",
      actor,
      { vendorId: vendor.id, identity },
    );
  }
  if (
    !usable(fields.accountNumber) ||
    fields.accountNumber!.value.trim().length > 100 ||
    !usable(fields.serviceAddress)
  )
    return;
  const existing = await tx.vendorAccount.findMany({
    where: { vendorId: vendor.id },
  });
  // An existing account's property, active flag and payment method remain authoritative.
  if (
    existing.some(
      (a) => normalize(a.number) === normalize(fields.accountNumber!.value),
    )
  )
    return;
  const properties = (await tx.property.findMany()).filter(
    (p) =>
      p.status === "ACTIVE" &&
      normalizeAddress(p.address) ===
        normalizeAddress(fields.serviceAddress!.value),
  );
  if (properties.length !== 1) return;
  const property = properties[0];
  const account = await tx.vendorAccount.create({
    data: {
      id: stableId(
        "account",
        `${vendor.id}:${normalize(fields.accountNumber!.value)}`,
      ),
      vendorId: vendor.id,
      propertyId: property.id,
      number: fields.accountNumber!.value.trim(),
      paymentMethod: vendor.paymentMethod,
    },
  });
  await audit(
    tx,
    billId,
    "VENDOR_ACCOUNT_CREATED",
    `Account linked to ${property.name}`,
    "Validated account number and an exact service-address match established the vendor/property relationship.",
    actor,
    {
      vendorId: vendor.id,
      accountId: account.id,
      propertyId: property.id,
      paymentMethod: account.paymentMethod,
    },
  );
}
