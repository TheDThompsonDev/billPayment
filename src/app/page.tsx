import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Files,
  CircleCheck,
  Clock3,
  ShieldCheck,
  CircleAlert,
  CalendarDays,
  Check,
  Activity,
  ChevronRight,
} from "lucide-react";
import { db } from "@/database/client";
import { billRows } from "@/services/queries";
import { PageHeading } from "@/components/page-heading";
import { BillsTable, VendorMark } from "@/components/bills-table";
import { money, label } from "@/lib/utils";
export default async function Dashboard() {
  const [bills, events, propertyCount] = await Promise.all([
    billRows(),
    db.auditEvent.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { bill: { include: { vendor: true } } },
    }),
    db.property.count({ where: { status: "ACTIVE" } }),
  ]);
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthly = bills.filter((b) => new Date(b.received) >= month);
  const count = (status: string) =>
    bills.filter((b) => b.status === status).length;
  const paid = monthly.filter((b) => b.status === "PAID");
  const total = paid.reduce((a, b) => a + (b.amount ?? 0), 0);
  const attention = bills.filter((b) =>
    ["NEEDS_REVIEW", "AWAITING_APPROVAL", "FAILED"].includes(b.status),
  );
  const groups = [
    { status: "PROCESSING", name: "Processing", color: "blue" },
    { status: "NEEDS_REVIEW", name: "Needs review", color: "amber" },
    { status: "AWAITING_APPROVAL", name: "Awaiting approval", color: "violet" },
    { status: "APPROVED", name: "Ready to pay", color: "teal" },
    { status: "PAID", name: "Paid", color: "green" },
  ];
  return (
    <>
      <PageHeading
        eyebrow="YOUR OPERATIONS, AT A GLANCE"
        title="A clearer view of every bill."
        description="Keep your properties running. We’ll keep the paperwork moving."
      />
      <div className="overview-meta">
        <div>
          <span className="live-dot" /> Portfolio overview{" "}
          <span className="meta-divider">/</span> {propertyCount} active
          properties
        </div>
        <span>
          <CalendarDays size={14} />
          {now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
      </div>
      <section className="metric-grid" aria-label="Operational metrics">
        <div className="metric">
          <div className="metric-label">
            Bills received <Files size={17} />
          </div>
          <div className="metric-value">
            {monthly.length}
            <span>this month</span>
          </div>
          <div className="metric-note">
            <span className="mini-dot blue" /> Across your North Texas portfolio
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">
            Successfully paid <CircleCheck size={17} />
          </div>
          <div className="metric-value">
            {paid.length}
            <span>bills</span>
          </div>
          <div className="metric-note">
            <span className="mini-dot green" /> Every payment has an audit trail
          </div>
        </div>
        <Link className="metric attention-metric" href="/review">
          <div className="metric-label">
            Needs your attention <CircleAlert size={17} />
          </div>
          <div className="metric-value">
            {attention.length}
            <ArrowUpRight size={23} />
          </div>
          <div className="metric-note">
            {count("NEEDS_REVIEW")} in review <span>·</span>{" "}
            {count("AWAITING_APPROVAL")} awaiting approval <span>·</span>{" "}
            {count("FAILED")} failed
          </div>
        </Link>
        <div className="metric">
          <div className="metric-label">
            Total processed <span className="currency-icon">$</span>
          </div>
          <div className="metric-value money-value">{money(total)}</div>
          <div className="metric-note">
            <span className="mini-dot green" /> Simulated payments this month
          </div>
        </div>
      </section>
      <section className="pipeline-panel">
        <div className="section-header">
          <div>
            <h2>From inbox to paid</h2>
            <p>A controlled workflow. A clear next step.</p>
          </div>
          <Link className="text-link" href="/bills">
            View all bills <ArrowRight size={15} />
          </Link>
        </div>
        <div className="pipeline">
          {groups.map((g, i) => (
            <Link
              href={`/bills?status=${g.status}`}
              className="pipeline-stage"
              key={g.status}
            >
              <span className={`stage-icon ${g.color}`}>
                {g.status === "PAID" ? (
                  <Check size={16} />
                ) : g.status === "NEEDS_REVIEW" ? (
                  <CircleAlert size={16} />
                ) : (
                  <Clock3 size={16} />
                )}
              </span>
              <div>
                <span>{g.name}</span>
                <strong>{count(g.status)}</strong>
              </div>
              {i < groups.length - 1 ? (
                <ChevronRight className="stage-chevron" size={16} />
              ) : null}
            </Link>
          ))}
        </div>
      </section>
      <div className="dashboard-columns">
        <section className="attention-panel">
          <div className="section-header">
            <div>
              <h2>
                Let’s move these forward{" "}
                <span className="count-pill">{attention.length}</span>
              </h2>
              <p>A little human judgment goes a long way.</p>
            </div>
            <Link
              className="icon-link"
              href="/review"
              aria-label="View review queue"
            >
              <ArrowUpRight size={19} />
            </Link>
          </div>
          <div className="attention-list">
            {attention.slice(0, 4).map((b) => (
              <Link
                href={`/bills/${b.id}`}
                key={b.id}
                className="attention-row"
              >
                <VendorMark name={b.vendor} />
                <div className="attention-info">
                  <strong>{b.vendor}</strong>
                  <span>
                    {b.status === "AWAITING_APPROVAL"
                      ? (b.reason ?? "Authorized approval required")
                      : b.status === "FAILED"
                        ? "Payment failed · safe to retry"
                        : b.reason?.startsWith("83%")
                          ? "Property match and amount need confirmation"
                          : (b.reason ??
                            "Invoice information needs confirmation")}
                  </span>
                  <small>{b.property}</small>
                </div>
                <div className="attention-amount">
                  <strong>{money(b.amount)}</strong>
                  <span
                    className={`tiny-label ${b.status === "FAILED" ? "red" : "amber"}`}
                  >
                    {label(b.status)}
                  </span>
                </div>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </section>
        <section className="activity-panel">
          <div className="section-header">
            <div>
              <h2>Recent activity</h2>
              <p>The latest across your portfolio.</p>
            </div>
            <Activity size={18} />
          </div>
          <div className="activity-list">
            {events.map((e, i) => (
              <Link
                href={`/bills/${e.billId}`}
                className="activity-item"
                key={e.id}
              >
                <span className={`activity-dot ${i === 0 ? "filled" : ""}`} />
                <div>
                  <strong>
                    {e.title
                      .toLowerCase()
                      .replaceAll("_", " ")
                      .replace(/^./, (s) => s.toUpperCase())}
                  </strong>
                  <p>{e.bill.vendor?.name ?? e.actor}</p>
                  <time>
                    {e.createdAt.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "America/Chicago",
                    })}{" "}
                    CT
                  </time>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <section className="recent-bills">
        <div className="section-header">
          <div>
            <h2>Latest bills</h2>
            <p>Every invoice, in one place.</p>
          </div>
          <Link className="text-link" href="/bills">
            View all bills <ArrowRight size={15} />
          </Link>
        </div>
        <BillsTable bills={bills} compact />
      </section>
      <div className="principle-strip">
        <ShieldCheck size={21} />
        <strong>Built on clear boundaries.</strong>
        <span>AI interprets. Rules enforce. People resolve uncertainty.</span>
        <Link href="/policies">
          Explore the policies <ArrowUpRight size={14} />
        </Link>
      </div>
    </>
  );
}
