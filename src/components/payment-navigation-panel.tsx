"use client";
import { useState } from "react";
import { Globe, ArrowUpRight, CheckCircle2, Navigation } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export type NavigationRecord = {
  destination: string | null;
  status: string;
  source: string;
  verifiedBy: string | null;
  message: string | null;
  receipt: string | null;
  steps: string;
};
export function PaymentNavigationPanel({
  navigation,
  billStatus,
  billId,
  canVerify,
  busy,
  action,
  demoUrl,
}: {
  navigation: NavigationRecord | null;
  billStatus: string;
  billId: string;
  canVerify: boolean;
  busy: boolean;
  action: (action: string, data?: unknown) => Promise<void>;
  demoUrl: string;
}) {
  const [url, setUrl] = useState(navigation?.destination ?? "");
  const steps = JSON.parse(navigation?.steps || "[]") as {
    at: string;
    message: string;
    sources?: { url: string; title: string }[];
  }[];
  const editable =
    ["AWAITING_APPROVAL", "APPROVED"].includes(billStatus) &&
    !["RUNNING", "DISCOVERING", "SUCCEEDED", "UNKNOWN"].includes(
      navigation?.status || "",
    );
  if (!navigation && !editable) return null;
  return (
    <section
      className="panel browser-payment-panel"
      aria-label="Payment website navigation"
    >
      <div className="section-header">
        <div>
          <p className="eyebrow">
            <Globe size={14} /> PAYMENT WEBSITE
          </p>
          <h2>
            {navigation?.status === "SUCCEEDED"
              ? "Receipt captured"
              : navigation?.status === "RUNNING"
                ? "Following the vendor’s payment flow"
                : "Where this invoice gets paid"}
          </h2>
        </div>
        <span className="tiny-label">
          {navigation?.status.replaceAll("_", " ") || "NOT CONNECTED"}
        </span>
      </div>
      <div className="browser-payment-body">
        <p>
          {navigation?.source ||
            "Use the payment link on the invoice or a verified vendor website. Future invoices can reuse this destination."}
        </p>
        <div className="browser-flow">
          <span>Find website</span>
          <i>→</i>
          <span>Navigate & fill</span>
          <i>→</i>
          <span>Review & submit</span>
          <i>→</i>
          <span>Verify receipt</span>
        </div>
        {navigation?.destination ? (
          <p className="destination-url">
            <Globe size={16} />
            <a href={navigation.destination} target="_blank" rel="noreferrer">
              {navigation.destination}
              <ArrowUpRight size={14} />
            </a>
          </p>
        ) : null}
        {editable ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action("destination", { url });
            }}
          >
            <label>
              Verified vendor payment URL
              <Input
                type="url"
                required
                value={url}
                placeholder="https://vendor.example/pay"
                onChange={(e) => setUrl(e.target.value)}
                disabled={!canVerify || busy}
              />
            </label>
            <div className="button-row">
              <Button disabled={!canVerify || busy}>
                Verify destination & save
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canVerify || busy}
                onClick={() => setUrl(demoUrl)}
              >
                Use local payment simulator
              </Button>
            </div>
            <p className="muted">
              A manager verifies a new destination. Invoice approval is
              separate. Registered demo portals use fictional sign-in and
              payment details. Real vendor sites require live browser access.
            </p>
            {!canVerify ? (
              <p className="authority-message">
                Select a property-manager or higher persona to verify this
                website.
              </p>
            ) : null}
          </form>
        ) : null}
        {navigation?.message ? (
          <p className="browser-handoff" role="status">
            {navigation.message}
          </p>
        ) : null}
        {navigation?.status === "BLOCKED" && canVerify ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => action("resume-browser")}
          >
            Resume browser payment
          </Button>
        ) : null}
        {navigation?.status === "UNKNOWN" ? (
          <>
            <p>
              Submission may have reached the vendor. Automatic retries are
              disabled until the receipt is reconciled.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => action("reconcile-browser")}
            >
              Check for receipt
            </Button>
          </>
        ) : null}
        {steps.length ? (
          <ol className="browser-steps">
            {steps.map((s, i) => (
              <li key={`${s.at}-${i}`}>
                <CheckCircle2 size={15} />
                <span>
                  {s.message}
                  {s.sources?.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "block", marginTop: 6 }}
                    >
                      {source.title} ↗
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {navigation?.receipt ? (
          <p className="browser-receipt">
            <CheckCircle2 size={18} />
            <strong>Receipt {navigation.receipt}</strong>
          </p>
        ) : null}
        {steps.length || navigation?.message ? (
          <a
            href={`/api/bills/${billId}/browser-evidence`}
            target="_blank"
            rel="noreferrer"
          >
            <Navigation size={14} /> View browser evidence{" "}
            <ArrowUpRight size={14} />
          </a>
        ) : null}
      </div>
    </section>
  );
}
