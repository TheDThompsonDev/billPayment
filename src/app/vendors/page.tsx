import { db } from "@/database/client";
import { PageHeading } from "@/components/page-heading";
import { VendorMark } from "@/components/bills-table";
import { label } from "@/lib/utils";
export default async function Vendors() {
  const vendors = await db.vendor.findMany({
    include: { accounts: { include: { property: true } } },
  });
  return (
    <>
      <PageHeading
        eyebrow="TRUSTED SERVICE RELATIONSHIPS"
        title="Vendors & accounts"
        description="Payment methods come from confirmed vendor accounts, never from an invoice’s instructions."
      />
      <div className="vendor-grid">
        {vendors.map((v) => (
          <article className="vendor-card" key={v.id}>
            <div className="vendor-card-heading">
              <VendorMark name={v.name} />
              <div>
                <h3>{v.name}</h3>
                <p>{label(v.category)}</p>
              </div>
            </div>
            <div className="vendor-summary">
              <span>
                Preferred payment
                <strong>{v.paymentMethod.replace("_", " ")}</strong>
              </span>
              <span>
                Properties served<strong>{v.accounts.length}</strong>
              </span>
            </div>
            <details>
              <summary>View vendor accounts</summary>
              {v.portalUrl ? (
                <p className="evidence-note">
                  Verified payment website:{" "}
                  <a href={v.portalUrl} target="_blank" rel="noreferrer">
                    {new URL(v.portalUrl).hostname}
                  </a>
                </p>
              ) : null}
              <div className="account-list">
                {v.accounts.map((a) => (
                  <div key={a.id}>
                    <span>
                      {a.property.name}
                      <small>{a.number}</small>
                    </span>
                    <span className="tiny-label green">
                      {a.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
