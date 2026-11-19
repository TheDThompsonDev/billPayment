import { createHash } from "node:crypto";
import { db } from "../database/client";
import {
  extractionSchema,
  confirmedSchema,
  fieldValues,
  type BillExtraction,
} from "../domain/bills/types";
import {
  normalizeAddress,
  normalize,
  normalizeVendor,
} from "../domain/matching/bill-matcher";
import { audit, transition, type Tx } from "./audit";

export async function proposeProperty(
  tx: Tx,
  billId: string,
  fields: BillExtraction,
  propertyName?: string | null,
) {
  const address = fields.serviceAddress?.value.trim();
  if (!address || (fields.serviceAddress?.confidence ?? 0) < 0.8) return null;
  // Only create a draft from a complete street/city/state address. Incomplete evidence stays in review.
  const location = address.match(
    /^\d+\s+.+,\s*([^,]+),\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/i,
  );
  if (!location) return null;
  const existingAccounts = await tx.vendorAccount.findMany({
    include: { vendor: true },
  });
  if (
    existingAccounts.some(
      (a) =>
        normalizeVendor(a.vendor.name) ===
          normalizeVendor(fields.vendorName?.value ?? "") &&
        normalize(a.number) === normalize(fields.accountNumber?.value ?? ""),
    )
  )
    return null;
  const key = normalizeAddress(address);
  const matches = (await tx.property.findMany()).filter(
    (p) => normalizeAddress(p.address) === key,
  );
  if (
    matches.length > 1 ||
    matches.some((p) => p.status !== "PENDING_ACCEPTANCE")
  )
    return null;
  let property = matches[0];
  if (!property) {
    property = await tx.property.create({
      data: {
        id: `property-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`,
        name: propertyName?.trim().slice(0, 200) || address,
        address,
        city: location[1].trim(),
        units: 0,
        status: "PENDING_ACCEPTANCE",
      },
    });
    await audit(
      tx,
      billId,
      "PROPERTY_CREATED",
      "New property created — acceptance needed",
      `${property.name} at ${property.address} was created from invoice evidence. It cannot be used until accepted.`,
      undefined,
      { propertyId: property.id },
    );
  }
  await tx.bill.update({
    where: { id: billId },
    data: { proposedPropertyId: property.id },
  });
  return property;
}

export async function acceptProperty(
  billId: string,
  propertyId: string,
  user: { name: string; role: string },
) {
  if (
    !["ANALYST", "PROPERTY_MANAGER", "REGIONAL_MANAGER", "DIRECTOR"].includes(
      user.role,
    )
  )
    throw new Error("An authorized workspace user must accept the property");
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({
      where: { id: billId },
      include: { proposedProperty: true, extraction: true },
    });
    if (
      bill.status !== "NEEDS_REVIEW" ||
      bill.proposedPropertyId !== propertyId ||
      !bill.proposedProperty ||
      !bill.extraction
    )
      throw new Error(
        "This bill has no matching property awaiting acceptance. Refresh and try again.",
      );
    const property = bill.proposedProperty;
    if (!["PENDING_ACCEPTANCE", "ACTIVE"].includes(property.status))
      throw new Error("This property is not available for acceptance");
    const fields = extractionSchema.parse(JSON.parse(bill.extraction.fields));
    const values = confirmedSchema.parse(fieldValues(fields));
    if (
      normalizeAddress(values.serviceAddress) !==
      normalizeAddress(property.address)
    )
      throw new Error(
        "The invoice address has changed. Re-read the document before accepting.",
      );
    // Accept only the displayed relationship; keep financial field confidence and risk checks intact.
    const confirmed = {
      ...fields,
      vendorName: { value: values.vendorName, confidence: 1 },
      accountNumber: { value: values.accountNumber, confidence: 1 },
      serviceAddress: { value: property.address, confidence: 1 },
    };
    await tx.property.update({
      where: { id: property.id },
      data: { status: "ACTIVE" },
    });
    await tx.billExtraction.update({
      where: { billId },
      data: { fields: JSON.stringify(confirmed) },
    });
    await tx.reviewItem.updateMany({
      where: { billId, status: "OPEN" },
      data: {
        status: "RESOLVED",
        resolution: "Property and invoice relationship accepted; checks rerun.",
        resolvedBy: user.name,
        resolvedAt: new Date(),
      },
    });
    await tx.bill.update({
      where: { id: billId },
      data: {
        proposedPropertyId: null,
        stage: 2,
        findings: "[]",
        riskAcknowledged: false,
      },
    });
    await audit(
      tx,
      billId,
      "PROPERTY_ACCEPTED",
      "New property accepted",
      `${user.name} accepted ${property.name} and confirmed ${values.vendorName}, account ${values.accountNumber}, for this service address. Invoice approval remains separate.`,
      user.name,
      { propertyId, before: fields, after: confirmed },
    );
    await transition(
      tx,
      billId,
      "NEEDS_REVIEW",
      "PROCESSING",
      "Property accepted. Matching, duplicate, risk and approval checks resume.",
      user.name,
    );
  });
}
