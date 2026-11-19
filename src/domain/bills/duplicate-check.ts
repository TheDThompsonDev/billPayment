export function normalizeInvoice(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
export function duplicateKey(
  vendorId: string,
  accountId: string,
  invoice: string,
) {
  const normalized = normalizeInvoice(invoice);
  if (!normalized)
    throw new Error("Invoice number must contain letters or digits");
  return `${vendorId}:${accountId}:${normalized}`;
}
export function findDuplicate<
  T extends { id: string; dedupeKey: string | null },
>(bills: T[], key: string, id: string) {
  return bills.find((bill) => bill.id !== id && bill.dedupeKey === key);
}
