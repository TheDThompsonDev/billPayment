import { notFound } from "next/navigation";
import { db } from "@/database/client";
import { currentUser } from "@/services/session";
import { BillDetail } from "@/components/bill-detail";
import { demoOrigin } from "@/domain/payments/payment-destination";
import { presentBill } from "@/services/bill-presentation";
export default async function BillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bill, accounts, user, properties] = await Promise.all([
    db.bill.findUnique({
      where: { id },
      include: {
        vendor: true,
        property: true,
        proposedProperty: true,
        account: true,
        extraction: true,
        navigation: true,
        payment: { include: { attempts: { orderBy: { number: "asc" } } } },
        approvals: { include: { user: true } },
        reviews: true,
        events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    }),
    db.vendorAccount.findMany({ include: { vendor: true, property: true } }),
    currentUser(),
    db.property.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, address: true },
    }),
  ]);
  if (!bill) notFound();
  const duplicate = bill.duplicateOfId
    ? await db.bill.findUnique({
        where: { id: bill.duplicateOfId },
        include: { payment: true },
      })
    : null;
  return (
    <BillDetail
      initialBill={JSON.parse(JSON.stringify(presentBill(bill)))}
      demoPaymentUrl={`${demoOrigin()}/payment-demo/classic`}
      accounts={accounts.map((a) => ({
        id: a.id,
        number: a.number,
        vendor: a.vendor.name,
        property: a.property.name,
        address: a.property.address,
        active: a.active && a.property.status === "ACTIVE",
      }))}
      user={user}
      properties={properties}
      duplicate={
        duplicate
          ? {
              id: duplicate.id,
              invoice: duplicate.invoiceNumber,
              amount: duplicate.amountCents,
              transaction: duplicate.payment?.externalId ?? null,
            }
          : null
      }
    />
  );
}
