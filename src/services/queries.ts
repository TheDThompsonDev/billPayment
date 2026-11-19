import { db } from "@/database/client";
import type { BillRow } from "@/components/bills-table";
export async function billRows(): Promise<BillRow[]> {
  const bills = await db.bill.findMany({
    include: {
      vendor: true,
      property: true,
      extraction: true,
      approvals: { where: { status: "PENDING" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return bills.map((b) => {
    const fields = b.extraction ? JSON.parse(b.extraction.fields) : {};
    return {
      id: b.id,
      vendor: b.vendor?.name ?? fields.vendorName?.value ?? "Unknown vendor",
      property:
        b.property?.name ??
        fields.serviceAddress?.value ??
        "Unmatched property",
      invoice:
        b.invoiceNumber ?? fields.invoiceNumber?.value ?? "Awaiting extraction",
      amount:
        b.amountCents ??
        (fields.amount ? Math.round(fields.amount.value * 100) : null),
      due: b.dueDate?.toISOString() ?? fields.dueDate?.value ?? null,
      status: b.status,
      method: b.paymentMethod,
      received: b.createdAt.toISOString(),
      reason: b.approvals[0]?.reason ?? JSON.parse(b.findings)[0]?.message,
    };
  });
}
