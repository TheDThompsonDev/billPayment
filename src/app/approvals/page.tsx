import Link from "next/link";
import { db } from "@/database/client";
import { PageHeading } from "@/components/page-heading";
import { Status } from "@/components/status";
import { VendorMark } from "@/components/bills-table";
import { money, date, label } from "@/lib/utils";
import { ClipboardCheck, ArrowRight, ShieldCheck } from "lucide-react";
export default async function Approvals() {
  const approvals = await db.approval.findMany({
    where: { status: "PENDING" },
    include: { bill: { include: { vendor: true, property: true } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <>
      <PageHeading
        eyebrow="DECISIONS WITH ACCOUNTABILITY"
        title="Awaiting approval"
        description="The checks are complete. These bills need an authorized person’s sign-off."
      />
      <div className="info-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>Authority is checked on the server.</strong>
          <p>
            Use the demo persona selector to act as a Property Manager, Regional
            Manager, or Director. Every decision records the person and their
            explanation.
          </p>
        </div>
      </div>
      <div className="approval-grid">
        {approvals.map((a) => (
          <article className="approval-card" key={a.id}>
            <div className="approval-card-top">
              <VendorMark name={a.bill.vendor!.name} />
              <div>
                <h3>{a.bill.vendor!.name}</h3>
                <p>{a.bill.property!.name}</p>
              </div>
              <Status value="AWAITING_APPROVAL" />
            </div>
            <div className="approval-sum">
              {money(a.bill.amountCents)}
              <small>
                {a.bill.invoiceNumber} · Due {date(a.bill.dueDate)}
              </small>
            </div>
            <div className="policy-explanation">
              <ShieldCheck size={17} />
              <div>
                <strong>{label(a.requiredRole)} approval</strong>
                <p>{a.reason}</p>
              </div>
            </div>
            <Link className="text-link" href={`/bills/${a.billId}`}>
              Review and decide <ArrowRight size={15} />
            </Link>
          </article>
        ))}
      </div>
      {!approvals.length ? (
        <div className="empty-state">
          <ClipboardCheck size={32} />
          <h3>All caught up</h3>
          <p>No bills are waiting for approval.</p>
        </div>
      ) : null}
    </>
  );
}
