import { PageHeading } from "@/components/page-heading";
import { BillsTable } from "@/components/bills-table";
import { billRows } from "@/services/queries";
import { ScanLine } from "lucide-react";
export default async function Review() {
  const bills = (await billRows()).filter((b) => b.status === "NEEDS_REVIEW");
  return (
    <>
      <PageHeading
        eyebrow="HUMAN JUDGMENT"
        title="Review queue"
        description="When the evidence is unclear, the workflow pauses here."
      />
      <div className="info-banner amber-banner">
        <ScanLine size={20} />
        <div>
          <strong>These bills are safely on hold.</strong>
          <p>
            Open a bill to inspect its original document, compare suggested
            matches, and confirm the correct information. All checks run again
            after a correction.
          </p>
        </div>
      </div>
      <BillsTable bills={bills} />
    </>
  );
}
