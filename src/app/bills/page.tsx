import { PageHeading } from "@/components/page-heading";
import { BillsTable } from "@/components/bills-table";
import { billRows } from "@/services/queries";
export default async function Bills({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [bills, query] = await Promise.all([billRows(), searchParams]);
  return (
    <>
      <PageHeading
        eyebrow="BILL OPERATIONS"
        title="All bills"
        description="One place for every invoice, every property, and every decision."
      />
      <BillsTable
        bills={bills}
        initialStatus={query.status ?? "ALL"}
        key={query.status ?? "ALL"}
      />
    </>
  );
}
