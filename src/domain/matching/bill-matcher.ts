import type { ConfirmedFields } from "../bills/types";
export const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\broad\b/g, "rd")
    .replace(/[^a-z0-9]/g, "");
export const normalizeVendor = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]/gu, "");
// ZIP codes are optional on the directory address; unit numbers remain significant.
export const normalizeAddress = (address: string) =>
  normalize(address.trim().replace(/\s+\d{5}(?:-\d{4})?$/, ""));
export function confidenceDecision(
  confidence: number,
): "ACCEPT" | "REVIEW" | "REJECT" {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    return "REJECT";
  return confidence >= 0.95
    ? "ACCEPT"
    : confidence >= 0.8
      ? "REVIEW"
      : "REJECT";
}
export type MatchAccount = {
  id: string;
  number: string;
  active: boolean;
  vendorId: string;
  propertyId: string;
  paymentMethod: string;
  vendor: { name: string };
  property: { name: string; address: string };
};
export function matchBill(fields: ConfirmedFields, accounts: MatchAccount[]) {
  const vendorAccounts = accounts.filter(
    (a) =>
      normalizeVendor(a.vendor.name) === normalizeVendor(fields.vendorName),
  );
  const exact = vendorAccounts.find(
    (a) => normalize(a.number) === normalize(fields.accountNumber),
  );
  if (exact) {
    const addressMatches =
      normalizeAddress(exact.property.address) ===
      normalizeAddress(fields.serviceAddress);
    return {
      account: exact,
      confidence: 1,
      method: "Exact vendor + account",
      conflict: !addressMatches,
      suggestions: [exact],
      reasoning: addressMatches
        ? "Vendor, account and service address agree."
        : "Account identifies one property, but the document service address conflicts. Human confirmation is required.",
    };
  }
  const address = vendorAccounts.filter(
    (a) =>
      normalizeAddress(a.property.address) ===
      normalizeAddress(fields.serviceAddress),
  );
  // Address is evidence, never permission to silently replace an unknown account number.
  if (address.length === 1)
    return {
      account: null,
      confidence: 0.94,
      method: "Service address candidate",
      conflict: false,
      suggestions: address,
      reasoning: "Address matches, but the account number must be confirmed.",
    };
  const candidates = vendorAccounts
    .filter((a) => {
      const words = fields.serviceAddress
        .toLowerCase()
        .split(/\W+/)
        .filter(
          (w) =>
            w.length > 2 && !["street", "road", "texas", "dallas"].includes(w),
        );
      return words.some((w) => a.property.address.toLowerCase().includes(w));
    })
    .slice(0, 3);
  return {
    account: null,
    confidence: candidates.length ? 0.87 : 0,
    method: "Demo similarity suggestion",
    conflict: false,
    suggestions: candidates,
    reasoning: candidates.length
      ? "Incomplete address resembles multiple known service locations. This is a simulated probabilistic recommendation; a person must select the account."
      : "No reliable vendor/account/property relationship found.",
  };
}
