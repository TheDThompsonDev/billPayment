import { db } from "@/database/client";
import { PageHeading } from "@/components/page-heading";
import { Building2, MapPin, ArrowUpRight } from "lucide-react";
import Link from "next/link";
export default async function Properties() {
  const properties = await db.property.findMany({
    include: {
      accounts: { include: { vendor: true } },
      _count: { select: { bills: true } },
      proposedBills: {
        where: { status: "NEEDS_REVIEW" },
        select: { id: true },
        take: 1,
      },
    },
  });
  return (
    <>
      <PageHeading
        eyebrow="PROPERTY DIRECTORY"
        title="Your properties"
        description={`${properties.length} properties. Connected accounts. A single source of truth.`}
      />
      <div className="property-grid">
        {properties.map((p, i) => (
          <article className="property-card" key={p.id}>
            <div className={`property-illustration building-${i % 4}`}>
              <div className="building-block block-back" />
              <div className="building-block block-front">
                {Array.from({ length: 12 }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
              <span className="property-city">
                <MapPin size={12} />
                {p.city}
              </span>
            </div>
            <div className="property-body">
              <div className="property-title">
                <h3>{p.name}</h3>
                {p.status === "ACTIVE" ? (
                  <span className="active-dot" title="Active" />
                ) : (
                  <span className="eyebrow">
                    {p.status === "PENDING_ACCEPTANCE"
                      ? "Pending acceptance"
                      : p.status}
                  </span>
                )}
              </div>
              <p>{p.address}</p>
              <div className="property-stats">
                <span>
                  <Building2 size={14} />
                  {p.units ? `${p.units} units` : "Units not set"}
                </span>
                <span>{p.accounts.length} vendor accounts</span>
              </div>
              <details>
                <summary>
                  View connected accounts <ArrowUpRight size={14} />
                </summary>
                <div className="account-list">
                  {p.accounts.map((a) => (
                    <div key={a.id}>
                      <span>
                        {a.vendor.name}
                        <small>{a.number}</small>
                      </span>
                      <b>{a.paymentMethod.replace("_", " ")}</b>
                    </div>
                  ))}
                </div>
              </details>
              {p.status === "PENDING_ACCEPTANCE" && p.proposedBills[0] ? (
                <Link
                  className="text-link"
                  href={`/bills/${p.proposedBills[0].id}`}
                >
                  Review & accept property →
                </Link>
              ) : (
                <Link className="subtle-link" href="/bills">
                  {p._count.bills} recorded bills · Browse ledger →
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
