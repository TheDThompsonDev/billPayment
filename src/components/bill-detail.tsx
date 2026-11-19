"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ShieldCheck,
  ScanLine,
  FileText,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  CreditCard,
  Clock3,
  CheckCircle2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Status } from "./status";
import { ReviewAccountFields } from "./review-account-fields";
import {
  PaymentNavigationPanel,
  type NavigationRecord,
} from "./payment-navigation-panel";
import { money, date, label } from "@/lib/utils";
import { canApprove } from "@/domain/approvals/approval-policy";
import type { BillExtraction, Finding } from "@/domain/bills/types";

type Detail = {
  id: string;
  status: string;
  stage: number;
  source: string;
  documentName: string;
  hasDocument: boolean;
  documentType: string | null;
  invoiceNumber: string | null;
  amountCents: number | null;
  dueDate: string | null;
  confidence: number | null;
  paymentMethod: string | null;
  findings: string;
  matching: string;
  validation: string;
  navigation: NavigationRecord | null;
  createdAt: string;
  vendor: { name: string } | null;
  property: { name: string; address: string } | null;
  proposedProperty: {
    id: string;
    name: string;
    address: string;
    status: string;
  } | null;
  account: { number: string } | null;
  extraction: {
    fields: string;
    originalFields: string;
    provider: string;
    propertyName: string | null;
    evidence?: string;
  } | null;
  events: {
    id: string;
    type: string;
    title: string;
    detail: string;
    actor: string;
    metadata: string;
    createdAt: string;
  }[];
  approvals: {
    id: string;
    status: string;
    requiredRole: string;
    reason: string;
    note: string | null;
  }[];
  payment: {
    status: string;
    externalId: string | null;
    method: string;
    attempts: {
      id: string;
      number: number;
      status: string;
      reason: string | null;
    }[];
  } | null;
};
type Account = {
  id: string;
  number: string;
  vendor: string;
  property: string;
  address: string;
  active: boolean;
};
const runningStatuses = [
  "RECEIVED",
  "PROCESSING",
  "APPROVED",
  "PAYMENT_PENDING",
];
export function BillDetail({
  initialBill,
  accounts,
  user,
  duplicate,
  properties,
  demoPaymentUrl,
}: {
  initialBill: Detail;
  demoPaymentUrl: string;
  accounts: Account[];
  properties: { id: string; name: string; address: string }[];
  user: { id: string; name: string; role: string };
  duplicate: {
    id: string;
    invoice: string | null;
    amount: number | null;
    transaction: string | null;
  } | null;
}) {
  const [bill, setBill] = useState(initialBill);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [paused, setPaused] = useState(false);
  const [showPropertyCorrection, setShowPropertyCorrection] = useState(false);
  const router = useRouter();
  const inFlight = useRef(false);
  useEffect(() => {
    setBill(initialBill);
  }, [initialBill]);
  const refresh = useCallback(async () => {
    const r = await fetch(`/api/bills/${bill.id}`);
    if (!r.ok) throw new Error("Could not refresh bill");
    const updated = await r.json();
    setBill(updated);
    return updated as Detail;
  }, [bill.id]);
  async function action(action: string, data?: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/bills/${bill.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data, note }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await refresh();
      setPaused(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const isRunning =
    runningStatuses.includes(bill.status) &&
    !["NEEDS_DESTINATION", "BLOCKED", "UNKNOWN", "SUCCEEDED"].includes(
      bill.navigation?.status || "",
    );
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
    // Read-only polling shows browser actions while the advance request is running.
  }, [refresh, isRunning]);
  useEffect(() => {
    if (!isRunning || paused) return;
    const timer = setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const r = await fetch(`/api/bills/${bill.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "advance" }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        const next = await refresh();
        if (!runningStatuses.includes(next.status)) router.refresh();
      } catch (e) {
        setError((e as Error).message);
        setPaused(true);
      } finally {
        inFlight.current = false;
      }
    }, 850);
    return () => clearTimeout(timer);
    // Each persisted bill snapshot schedules exactly one next stage.
  }, [bill, isRunning, paused, refresh, router]);
  const fields: BillExtraction | null = bill.extraction
    ? JSON.parse(bill.extraction.fields)
    : null;
  const original: BillExtraction | null = bill.extraction
    ? JSON.parse(bill.extraction.originalFields)
    : null;
  const findings: Finding[] = JSON.parse(bill.findings);
  const readerProblem = findings.some(
    (f) =>
      f.code.startsWith("EXTRACTION_") ||
      f.code === "OFFLINE_READER_UNSUPPORTED",
  );
  const sourceEvidence: {
    report?: {
      fields: Record<
        string,
        { source: { page: number; quote: string } } | null
      >;
      issues: { field: string; reason: string }[];
    };
  } = JSON.parse(bill.extraction?.evidence || "{}");
  const match: {
    method?: string;
    reasoning?: string;
    confidence?: number;
    suggestions?: {
      accountId: string;
      property: string;
      address: string;
      number: string;
    }[];
  } = JSON.parse(bill.matching);
  const validation: string[] = JSON.parse(bill.validation);
  const approval = bill.approvals.find((a) => a.status === "PENDING");
  const amount =
    bill.amountCents ??
    (fields?.amount ? Math.round(fields.amount.value * 100) : null);
  const invoice =
    bill.invoiceNumber ?? fields?.invoiceNumber?.value ?? "New invoice";
  const steps = [
    "Received",
    "Interpret",
    "Validate & match",
    "Apply policy",
    "Payment",
  ];
  const step =
    bill.status === "PAID"
      ? 5
      : bill.status === "PAYMENT_PENDING"
        ? 4
        : bill.stage;
  return (
    <>
      <Link href="/bills" className="back-link">
        <ArrowLeft size={15} /> All bills
      </Link>
      <div className="detail-heading">
        <div className="detail-icon">
          <FileText size={25} />
        </div>
        <div>
          <p className="eyebrow">INVOICE {invoice}</p>
          <h1>
            {bill.vendor?.name ??
              fields?.vendorName?.value ??
              "Document processing"}
          </h1>
          <p>
            {bill.property?.name ??
              fields?.serviceAddress?.value ??
              "Waiting for document interpretation"}
          </p>
        </div>
        <div className="detail-heading-right">
          <strong>{money(amount)}</strong>
          <Status value={bill.status} />
        </div>
      </div>
      <div className="workflow-tracker" aria-label="Processing stages">
        {steps.map((s, i) => (
          <div
            key={s}
            className={`${i < step ? "complete" : ""} ${i === step ? "current" : ""}`}
          >
            <span>
              {i < step ? (
                <Check size={14} />
              ) : i === step && isRunning && !paused ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                i + 1
              )}
            </span>
            <strong>{s}</strong>
          </div>
        ))}
      </div>
      {error ? (
        <div className="error-banner" role="alert">
          {error}{" "}
          {paused ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPaused(false);
                setError("");
              }}
            >
              Resume processing
            </Button>
          ) : null}
        </div>
      ) : null}
      {bill.status === "REJECTED" ? (
        <div className="info-banner red-banner">
          <ShieldCheck size={23} />
          <div>
            <strong>
              {bill.events.some((e) => e.type === "DUPLICATE_DETECTED")
                ? "Duplicate invoice blocked"
                : "Bill rejected"}
            </strong>
            <p>
              {findings.map((f) => f.message).join(" ") ||
                "An authorized manager rejected this invoice."}
            </p>
            {duplicate ? (
              <Link href={`/bills/${duplicate.id}`} className="text-link">
                Original invoice {duplicate.invoice} · {money(duplicate.amount)}{" "}
                · {duplicate.transaction ?? "Reserved for processing"}{" "}
                <ArrowUpRight size={14} />
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      {bill.status === "PAID" ? (
        <div className="info-banner success-banner">
          <CheckCircle2 size={23} />
          <div>
            <strong>Payment completed. Every decision accounted for.</strong>
            <p>
              {bill.payment?.method.replace("_", " ")} ·{" "}
              {bill.payment?.externalId} ·{" "}
              {bill.navigation && !bill.navigation.receipt?.startsWith("DEMO-")
                ? "Payment website receipt verified."
                : "Simulated transaction, no real funds transferred."}
            </p>
          </div>
        </div>
      ) : null}
      {bill.status === "FAILED" ? (
        <div className="info-banner red-banner">
          <CircleAlert size={23} />
          <div>
            <strong>
              The mock payment provider could not complete this payment.
            </strong>
            <p>
              No money moved. Retry creates a new attempt and independently
              reruns all payment safeguards.
            </p>
          </div>
          <Button onClick={() => action("retry")} disabled={busy}>
            <RefreshCw size={15} /> Retry payment
          </Button>
        </div>
      ) : null}
      {bill.status === "NEEDS_REVIEW" && bill.proposedProperty ? (
        <section
          className="review-workspace property-notice"
          aria-labelledby="new-property-heading"
        >
          <div className="section-header">
            <div>
              <p className="eyebrow">PROPERTY · ACCEPTANCE NEEDED</p>
              <h2 id="new-property-heading">
                {bill.events.some(
                  (event) =>
                    event.type === "PROPERTY_CREATED" &&
                    JSON.parse(event.metadata).propertyId ===
                      bill.proposedProperty?.id,
                )
                  ? "We've created a new property from this invoice."
                  : "This address matches a property awaiting acceptance."}
              </h2>
            </div>
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <p className="property-notice-intro">
            Review the details below and accept this property to continue
            processing the bill.
          </p>
          <div className="review-reasons">
            <div>
              <CheckCircle2 size={20} aria-hidden="true" />
              <p>
                <strong>{bill.proposedProperty.name}</strong>
                {bill.proposedProperty.address}
                {bill.extraction?.propertyName &&
                bill.extraction.propertyName !== bill.proposedProperty.name ? (
                  <span className="block">
                    Invoice recipient: {bill.extraction.propertyName}
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <FileText size={20} aria-hidden="true" />
              <p>
                <strong>{fields?.vendorName?.value}</strong>
                Account {fields?.accountNumber?.value}
              </p>
            </div>
          </div>
          <p className="property-notice-note">
            Accepting confirms that this is the service property for the vendor
            and account shown above. Invoice approval and payment checks follow
            separately.
          </p>
          <div className="property-notice-actions">
            <Button
              disabled={busy}
              onClick={() =>
                action("accept-property", {
                  propertyId: bill.proposedProperty!.id,
                })
              }
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Accept property
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setShowPropertyCorrection(!showPropertyCorrection)}
            >
              {showPropertyCorrection
                ? "Hide corrections"
                : "Use an existing property instead"}
            </Button>
          </div>
        </section>
      ) : null}
      {bill.status === "NEEDS_REVIEW" &&
      (!bill.proposedProperty || showPropertyCorrection) ? (
        <section className="review-workspace">
          <div className="section-header">
            <div>
              <p className="eyebrow">THE WORKFLOW PAUSED SAFELY</p>
              <h2>
                {readerProblem
                  ? "Document interpretation needs attention."
                  : findings.some((f) => f.code === "NOT_AN_INVOICE")
                    ? "Check the uploaded document."
                    : "A little human judgment is needed."}
              </h2>
            </div>
            {bill.hasDocument ? (
              <Button
                variant="outline"
                onClick={() => action("reread")}
                disabled={busy}
              >
                <RefreshCw size={15} /> Re-read document
              </Button>
            ) : (
              <ScanLine size={24} />
            )}
          </div>
          <div className="review-reasons">
            {findings.map((f) => (
              <div key={f.code}>
                <CircleAlert size={17} />
                <p>
                  <strong>{label(f.code)}</strong>
                  {f.message}
                </p>
              </div>
            ))}
          </div>
          {match.suggestions?.length ? (
            <div className="suggestions">
              <strong>
                Suggested account matches{" "}
                <span>
                  {Math.round((match.confidence ?? 0) * 100)}% similarity
                </span>
              </strong>
              {match.suggestions.map((s) => (
                <div key={s.accountId}>
                  <span>
                    {s.property}
                    <small>{s.address}</small>
                  </span>
                  <code>{s.number}</code>
                </div>
              ))}
            </div>
          ) : null}
          <form
            key={bill.extraction?.fields}
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              action("correct", {
                accountId: form.get("accountId") || undefined,
                vendorName: form.get("vendorName") || undefined,
                accountNumber: form.get("accountNumber") || undefined,
                propertyId: form.get("propertyId") || undefined,
                invoiceNumber: form.get("invoiceNumber"),
                amount: Number(form.get("amount")),
                dueDate: form.get("dueDate"),
                note: form.get("note"),
                acknowledgeRisk: form.get("acknowledgeRisk") === "on",
              });
            }}
          >
            <div className="form-grid">
              <ReviewAccountFields
                key={bill.extraction?.fields}
                accounts={accounts}
                properties={properties}
                fields={fields}
              />
              <label>
                Invoice number
                <Input
                  name="invoiceNumber"
                  required
                  defaultValue={fields?.invoiceNumber?.value ?? ""}
                />
              </label>
              <label>
                Confirmed amount (USD)
                <Input
                  name="amount"
                  type="number"
                  step=".01"
                  min=".01"
                  required
                  defaultValue={fields?.amount?.value ?? ""}
                />
              </label>
              <label>
                Confirmed due date
                <Input
                  name="dueDate"
                  type="date"
                  required
                  defaultValue={fields?.dueDate?.value ?? ""}
                />
              </label>
              <label>
                Resolution note
                <Input
                  name="note"
                  required
                  minLength={5}
                  placeholder="Explain what you checked or corrected"
                />
              </label>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" name="acknowledgeRisk" /> I verified the
              amount against the original invoice and confirm any historical
              variance.
            </label>
            <Button disabled={busy}>
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Save correction & rerun checks
            </Button>
          </form>
        </section>
      ) : null}
      {bill.status === "AWAITING_APPROVAL" && approval ? (
        <section className="approval-workspace">
          <ShieldCheck size={25} />
          <div>
            <p className="eyebrow">APPROVAL REQUIRED</p>
            <h2>{label(approval.requiredRole)} sign-off</h2>
            <p>{approval.reason}</p>
            <label>
              Decision note
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Explain your approval or rejection…"
                minLength={5}
              />
            </label>
            {canApprove(user.role, approval.requiredRole) ? (
              <div className="button-row">
                <Button
                  disabled={busy || note.trim().length < 5}
                  onClick={() => action("approve")}
                >
                  <Check size={16} /> Approve & continue
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || note.trim().length < 5}
                  onClick={() => action("reject")}
                >
                  Reject bill
                </Button>
                <span>Acting as {user.name}</span>
              </div>
            ) : (
              <p className="authority-message">
                Your AP persona does not have the required authority. Select a{" "}
                {label(approval.requiredRole)} or higher role in the sidebar to
                decide.
              </p>
            )}
          </div>
        </section>
      ) : null}
      <PaymentNavigationPanel
        key={`${bill.navigation?.destination}-${bill.navigation?.verifiedBy}`}
        navigation={bill.navigation}
        billStatus={bill.status}
        billId={bill.id}
        canVerify={canApprove(user.role, "PROPERTY_MANAGER")}
        busy={busy}
        action={action}
        demoUrl={demoPaymentUrl}
      />
      <div className="bill-detail-grid">
        <div>
          <section className="panel document-panel">
            <div className="section-header">
              <div>
                <h2>Original document</h2>
                <p>{bill.documentName}</p>
              </div>
              {bill.hasDocument ? (
                <a
                  href={`/api/documents/${bill.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-link"
                  aria-label="Open original document"
                >
                  <ArrowUpRight size={18} />
                </a>
              ) : (
                <span className="tiny-label neutral">
                  {bill.source === "MANUAL" ? "MANUAL ENTRY" : "DEMO INVOICE"}
                </span>
              )}
            </div>
            {bill.hasDocument ? (
              <iframe
                title="Original uploaded invoice"
                className="document-preview"
                src={`/api/documents/${bill.id}`}
              />
            ) : (
              <div className="invoice-paper">
                <div className="invoice-brand">
                  {original?.vendorName?.value ?? "Invoice"}
                  <span>ACCOUNT STATEMENT</span>
                </div>
                <div className="invoice-rule" />
                <div className="invoice-columns">
                  <div>
                    <small>SERVICE LOCATION</small>
                    <strong>
                      {original?.serviceAddress?.value ?? "Not yet extracted"}
                    </strong>
                    <span>DSD Property Group</span>
                  </div>
                  <div>
                    <small>INVOICE NUMBER</small>
                    <strong>{original?.invoiceNumber?.value ?? "—"}</strong>
                    <small>ACCOUNT NUMBER</small>
                    <strong>{original?.accountNumber?.value ?? "—"}</strong>
                  </div>
                </div>
                <div className="invoice-line">
                  <span>Description</span>
                  <span>Amount</span>
                </div>
                <div className="invoice-line invoice-item">
                  <span>Property services · current billing period</span>
                  <strong>
                    {money(
                      original?.amount
                        ? Math.round(original.amount.value * 100)
                        : null,
                    )}
                  </strong>
                </div>
                <div className="invoice-total">
                  <span>
                    Amount due
                    <strong>
                      {money(
                        original?.amount
                          ? Math.round(original.amount.value * 100)
                          : null,
                      )}
                    </strong>
                  </span>
                  <small>Please pay by {date(original?.dueDate?.value)}</small>
                </div>
                <div className="invoice-stamp">
                  SAMPLE DOCUMENT · FOR DEMONSTRATION ONLY
                </div>
              </div>
            )}
          </section>
          <section className="panel evidence-panel">
            <div className="section-header">
              <div>
                <h2>Extracted evidence</h2>
                <p>
                  {bill.extraction?.provider ?? "Waiting for interpretation"}
                </p>
              </div>
              <span className="tiny-label neutral">INTERPRETATION</span>
            </div>
            <div className="extraction-list">
              {fields ? (
                Object.entries(fields).map(([key, field]) => (
                  <div key={key}>
                    <span>
                      {key
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, (s) => s.toUpperCase())}
                    </span>
                    <strong>{field?.value ?? "Missing"}</strong>
                    <span
                      className={`confidence ${(field?.confidence ?? 0) < 0.95 ? "low" : ""}`}
                    >
                      {field ? `${Math.round(field.confidence * 100)}%` : "—"}
                    </span>
                  </div>
                ))
              ) : (
                <p>Interpretation has not finished yet.</p>
              )}
            </div>
            {sourceEvidence.report ? (
              <details className="document-sources">
                <summary>View document sources</summary>
                <p>
                  Supporting passages reported by the AI reader. Compare with
                  the original document when reviewing.
                </p>
                <dl>
                  {Object.entries(sourceEvidence.report.fields).map(
                    ([key, field]) =>
                      field ? (
                        <div key={key}>
                          <dt>
                            {label(key.replace(/([A-Z])/g, "_$1"))} · Page{" "}
                            {field.source.page}
                          </dt>
                          <dd>{field.source.quote}</dd>
                        </div>
                      ) : null,
                  )}
                </dl>
                {sourceEvidence.report.issues.map((issue, index) => (
                  <p key={index}>{issue.reason}</p>
                ))}
              </details>
            ) : null}
            <p className="evidence-note">
              Original evidence is retained when a person makes a correction.
              Only validated fields become accepted bill data.
            </p>
          </section>
        </div>
        <div>
          <section className="panel accepted-panel">
            <div className="section-header">
              <h2>Accepted bill information</h2>
              <ShieldCheck size={18} />
            </div>
            <dl className="detail-fields">
              {[
                ["Vendor", bill.vendor?.name],
                ["Property", bill.property?.name],
                ["Vendor account", bill.account?.number],
                ["Invoice number", bill.invoiceNumber],
                ["Amount", bill.amountCents ? money(bill.amountCents) : null],
                ["Due date", bill.dueDate ? date(bill.dueDate) : null],
                ["Payment method", bill.paymentMethod?.replace("_", " ")],
                [
                  "Extraction / match confidence",
                  bill.confidence !== null
                    ? `${Math.round(bill.confidence * 100)}%`
                    : null,
                ],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value ?? "Not confirmed"}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel checks-panel">
            <div className="section-header">
              <h2>Checks & decisions</h2>
            </div>
            <div className="checks-list">
              <CheckRow
                title="Schema validation"
                text={
                  validation.length
                    ? validation.join(" · ")
                    : "Pending document understanding"
                }
                ok={validation.includes("Required fields present")}
              />
              <CheckRow
                title="Account & property match"
                text={match.reasoning ?? "Pending matching"}
                ok={!!bill.account}
              />
              <CheckRow
                title="Duplicate protection"
                text={
                  bill.events.some((e) => e.type === "DUPLICATE_DETECTED")
                    ? "Duplicate blocked — cannot be overridden"
                    : bill.events.some(
                          (e) => e.type === "DUPLICATE_CHECK_PASSED",
                        )
                      ? "Unique invoice identity verified"
                      : "Pending verification"
                }
                ok={bill.events.some(
                  (e) => e.type === "DUPLICATE_CHECK_PASSED",
                )}
              />
              <CheckRow
                title="Risk evaluation"
                text={
                  findings.length
                    ? findings.map((f) => f.message).join(" ")
                    : bill.stage >= 3
                      ? "No blocking anomalies detected"
                      : "Pending risk checks"
                }
                ok={
                  bill.stage >= 3 &&
                  !findings.some((f) => f.severity === "review")
                }
              />
              <CheckRow
                title="Approval decision"
                text={
                  bill.approvals[0]?.reason ??
                  (bill.stage >= 4
                    ? "Routine utility policy: automatically approved."
                    : "Pending policy evaluation")
                }
                ok={["APPROVED", "PAYMENT_PENDING", "PAID", "FAILED"].includes(
                  bill.status,
                )}
              />
            </div>
          </section>
          {bill.payment ? (
            <section className="panel payment-panel">
              <div className="section-header">
                <h2>Payment attempts</h2>
                <CreditCard size={18} />
              </div>
              {bill.payment.attempts.map((a) => (
                <div className="payment-attempt" key={a.id}>
                  <div>
                    <strong>Attempt {a.number}</strong>
                    <small>{a.reason ?? "Awaiting mock settlement"}</small>
                  </div>
                  <Status
                    value={
                      a.status === "COMPLETED"
                        ? "PAID"
                        : a.status === "PENDING"
                          ? "PAYMENT_PENDING"
                          : "FAILED"
                    }
                  />
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </div>
      <section className="panel timeline-panel">
        <div className="section-header">
          <div>
            <h2>A complete record, from start to finish</h2>
            <p>
              What happened, who acted, and why. All timestamps shown in Central
              Time.
            </p>
          </div>
          <span className="count-pill">{bill.events.length} events</span>
        </div>
        <ol className="audit-timeline">
          {bill.events.map((e) => (
            <li key={e.id}>
              <span
                className={`timeline-dot ${e.type.includes("FAILED") || e.type.includes("DUPLICATE") ? "danger" : ""}`}
              >
                {e.type.includes("REVIEW") ? (
                  <ScanLine size={14} />
                ) : (
                  <Check size={14} />
                )}
              </span>
              <time>
                {new Date(e.createdAt).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "America/Chicago",
                })}
                <small>
                  {new Date(e.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "America/Chicago",
                  })}
                </small>
              </time>
              <div>
                <strong>{e.title}</strong>
                <p>{e.detail}</p>
                <span className="event-actor">{e.actor}</span>
                {e.type === "HUMAN_CORRECTION" ? (
                  <details>
                    <summary>View recorded changes</summary>
                    <pre>{JSON.stringify(JSON.parse(e.metadata), null, 2)}</pre>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
function CheckRow({
  title,
  text,
  ok,
}: {
  title: string;
  text: string;
  ok: boolean;
}) {
  return (
    <div className="check-row">
      <span className={ok ? "check-ok" : "check-wait"}>
        {ok ? <Check size={14} /> : <Clock3 size={14} />}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
