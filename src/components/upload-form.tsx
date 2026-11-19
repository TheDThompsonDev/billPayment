"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  FileText,
  ArrowRight,
  ShieldCheck,
  LoaderCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { sampleCards } from "@/ai/samples";
import { money } from "@/lib/utils";
export function UploadForm({
  aiEnabled,
  offlineMode,
}: {
  aiEnabled: boolean;
  offlineMode: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState("samples");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  async function submit(body: FormData | object, key: string) {
    setBusy(key);
    setError("");
    try {
      const r = await fetch("/api/bills", {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      router.push(`/bills/${data.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }
  return (
    <>
      <div className="upload-tabs" role="tablist" aria-label="Invoice source">
        {[
          ["samples", "Try a demo invoice"],
          ["upload", "Upload a document"],
          ["manual", "Enter manually"],
        ].map(([key, name]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setError("");
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}
      {tab === "samples" ? (
        <>
          <div className="sample-intro">
            <span className="tiny-label green">NO API KEY NEEDED</span>
            <h2>Real situations. A safe place to explore.</h2>
            <p>
              Choose a scenario and watch each check happen. Open the timeline
              to see why the workflow continues—or stops.
            </p>
          </div>
          <div className="sample-grid">
            {sampleCards.map((s) => (
              <article className="sample-card" key={s.key}>
                <div className="sample-top">
                  <span className="sample-number">{s.number}</span>
                  <span className={`scenario-tag tag-${s.key}`}>{s.tag}</span>
                </div>
                <FileText size={29} strokeWidth={1.4} />
                <h3>{s.title}</h3>
                <p>{s.description}</p>
                <div className="sample-invoice">
                  <span>{s.vendor}</span>
                  <strong>{money(s.amount)}</strong>
                </div>
                <div className="sample-actions">
                  <Button
                    disabled={!!busy}
                    onClick={() => submit({ sample: s.key }, s.key)}
                  >
                    {busy === s.key ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : null}
                    Run scenario <ArrowRight size={14} />
                  </Button>
                  {s.key !== "duplicate" && s.key !== "portal" ? (
                    <a
                      href={`/samples/${s.key}.pdf`}
                      download
                      aria-label={`Download ${s.title} sample PDF`}
                    >
                      Sample PDF ↓
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <div className="info-banner">
            <ShieldCheck size={20} />
            <div>
              <strong>Start with scenario 01, then try the duplicate.</strong>
              <p>
                Scenario 02 reuses the same invoice identity. If the original
                hasn’t been run yet, it is prepared automatically. Other
                scenarios create a fresh invoice each time.
              </p>
            </div>
          </div>
        </>
      ) : null}
      {tab === "upload" ? (
        <div className="upload-layout">
          <section className="panel upload-panel">
            <div className="info-banner" role="status">
              <div>
                <strong>
                  {aiEnabled
                    ? "Document AI reader connected"
                    : offlineMode
                      ? "Limited offline reader selected"
                      : "Document AI reader is not connected"}
                </strong>
                <p>
                  {aiEnabled
                    ? "The original PDF pages or image are interpreted together. Field evidence is retained for review."
                    : offlineMode
                      ? "This mode recognizes only supported text patterns. It is not general document interpretation."
                      : "Files can be saved, but automatic interpretation requires a model connection. Demo scenarios and manual entry remain available."}
                </p>
              </div>
            </div>
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                setFile(e.dataTransfer.files[0] ?? null);
              }}
            >
              <span className="upload-icon">
                {file ? <CheckCircle2 size={32} /> : <UploadCloud size={32} />}
              </span>
              <h2>{file ? file.name : "Drop your invoice here"}</h2>
              <p>
                {file
                  ? `${(file.size / 1024).toFixed(0)} KB · Ready to process`
                  : "PDF, PNG or JPG · up to 10 MB"}
              </p>
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                {file ? "Choose another file" : "Browse files"}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="sr-only"
                aria-label="Invoice file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button
              disabled={!file || !!busy}
              onClick={() => {
                const form = new FormData();
                form.set("file", file!);
                submit(form, "file");
              }}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : null}Upload
              and process <ArrowRight size={16} />
            </Button>
          </section>
          <aside className="upload-explainer">
            <h3>What happens next?</h3>
            {[
              "Read the document",
              "Validate and match the account",
              "Check duplicates and unusual amounts",
              "Apply approval and payment policies",
            ].map((s, i) => (
              <div key={s}>
                <span>{i + 1}</span>
                {s}
              </div>
            ))}
            <p>
              {aiEnabled
                ? "Structured AI extraction is enabled. Uploaded documents that are not sample fixtures are sent to OpenAI for interpretation."
                : offlineMode
                  ? "Limited offline extraction is explicitly enabled. Unsupported layouts may require manual entry."
                  : "Connect the document reader before expecting automatic extraction. Unconnected files are held for setup, not marked as missing invoice information."}
            </p>
          </aside>
        </div>
      ) : null}
      {tab === "manual" ? (
        <form
          className="panel manual-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            submit(
              {
                fields: {
                  vendorName: f.get("vendorName"),
                  accountNumber: f.get("accountNumber"),
                  invoiceNumber: f.get("invoiceNumber"),
                  amount: Number(f.get("amount")),
                  dueDate: f.get("dueDate"),
                  serviceAddress: f.get("serviceAddress"),
                },
                paymentUrl: f.get("paymentUrl") || undefined,
              },
              "manual",
            );
          }}
        >
          <div className="section-header">
            <div>
              <h2>Enter the invoice details</h2>
              <p>
                Manual entries pass through the same matching, risk and approval
                checks.
              </p>
            </div>
          </div>
          <div className="form-grid">
            {[
              {
                name: "vendorName",
                label: "Vendor name",
                placeholder: "Dallas Water Utilities",
              },
              {
                name: "accountNumber",
                label: "Vendor account number",
                placeholder: "DW-1001",
              },
              {
                name: "invoiceNumber",
                label: "Invoice number",
                placeholder: "DW-2026-1001",
              },
              {
                name: "amount",
                label: "Amount (USD)",
                placeholder: "1842.17",
                type: "number",
              },
              { name: "dueDate", label: "Due date", type: "date" },
              {
                name: "serviceAddress",
                label: "Service address",
                placeholder: "123 Main Street, Dallas, TX",
              },
            ].map((f) => (
              <label key={f.name}>
                {f.label}
                <Input
                  name={f.name}
                  placeholder={f.placeholder}
                  type={f.type ?? "text"}
                  required
                  step={f.type === "number" ? ".01" : undefined}
                  min={f.type === "number" ? ".01" : undefined}
                />
              </label>
            ))}
            <label className="full-width">
              Payment website (optional)
              <Input
                name="paymentUrl"
                type="url"
                placeholder="https://vendor.example/pay"
              />
            </label>
          </div>
          <Button disabled={!!busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : null}Create
            and process bill <ArrowRight size={16} />
          </Button>
        </form>
      ) : null}
    </>
  );
}
