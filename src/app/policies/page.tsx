import { db } from "@/database/client";
import { PageHeading } from "@/components/page-heading";
import {
  ShieldCheck,
  ScanLine,
  UserCheck,
  LockKeyhole,
  ArrowRight,
} from "lucide-react";
import { label } from "@/lib/utils";
export default async function Policies() {
  const policies = await db.approvalPolicy.findMany({
    orderBy: { priority: "desc" },
  });
  return (
    <>
      <PageHeading
        eyebrow="DETERMINISTIC BY DESIGN"
        title="Clear rules. Consistent decisions."
        description="Readable business policies, enforced in TypeScript. This policy library is read-only."
        action={false}
      />
      <div className="architecture-banner">
        <div>
          <ScanLine size={25} />
          <strong>Probabilistic systems interpret.</strong>
          <span>Extract fields. Suggest matches.</span>
        </div>
        <ArrowRight size={20} />
        <div>
          <ShieldCheck size={25} />
          <strong>Deterministic systems enforce.</strong>
          <span>Validate. Check. Authorize.</span>
        </div>
        <ArrowRight size={20} />
        <div>
          <UserCheck size={25} />
          <strong>Humans resolve uncertainty.</strong>
          <span>Review evidence. Record decisions.</span>
        </div>
      </div>
      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Approval policies</h2>
            <p>
              Higher-priority rules run first. Amounts are evaluated in integer
              cents.
            </p>
          </div>
          <span className="read-only">
            <LockKeyhole size={13} /> Read-only
          </span>
        </div>
        <div className="table-scroll">
          <table className="policy-table">
            <thead>
              <tr>
                <th>Policy</th>
                <th>When it applies</th>
                <th>Required authority</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <small>{p.id}</small>
                  </td>
                  <td>{p.description}</td>
                  <td>
                    <span className={`policy-role ${p.role ? "" : "auto"}`}>
                      {p.role ? label(p.role) : "Automatic approval"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="guardrail-grid">
        {[
          {
            title: "Duplicate invoices never proceed",
            text: "The vendor, account and normalized invoice number form a unique database identity. A duplicate is rejected before payment.",
          },
          {
            title: "Confidence is a gate",
            text: "95% or higher: eligible for acceptance. 80–94%: human review. Below 80%: suggestion rejected and manual resolution required.",
          },
          {
            title: "Missing information means a pause",
            text: "Validated new vendors are created automatically. Incomplete fields, uncertain properties, inactive accounts and conflicting addresses require human review. New vendors default to Other / simulated check and follow normal approval policy.",
          },
          {
            title: "Unusual amounts get a second look",
            text: "An amount above 3× its historical average requires a documented human confirmation. Approval policy still applies.",
          },
        ].map((p) => (
          <article className="guardrail" key={p.title}>
            <ShieldCheck size={20} />
            <h3>{p.title}</h3>
            <p>{p.text}</p>
          </article>
        ))}
      </div>
      <div className="principle-strip">
        <LockKeyhole size={18} />
        <strong>
          No probabilistic component can directly cause a financial state
          change.
        </strong>
      </div>
    </>
  );
}
