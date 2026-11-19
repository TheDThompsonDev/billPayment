"use client";
import { useState } from "react";
import { Input } from "./ui/input";
import { normalizeVendor } from "@/domain/matching/bill-matcher";
import type { BillExtraction } from "@/domain/bills/types";
export function ReviewAccountFields({
  accounts,
  properties,
  fields,
}: {
  accounts: {
    id: string;
    vendor: string;
    property: string;
    number: string;
    active: boolean;
  }[];
  properties: { id: string; name: string; address: string }[];
  fields: BillExtraction | null;
}) {
  const [mode, setMode] = useState(
    accounts.some(
      (a) =>
        normalizeVendor(a.vendor) ===
        normalizeVendor(fields?.vendorName?.value ?? ""),
    )
      ? "existing"
      : "invoice",
  );
  return (
    <>
      <label className="full-width">
        Vendor account setup
        <select
          aria-label="Vendor account setup"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="existing">Select an existing account</option>
          <option value="invoice">
            Use invoice vendor / create an account
          </option>
        </select>
      </label>
      {mode === "existing" ? (
        <label className="full-width">
          Confirmed vendor / property account
          <select name="accountId" required defaultValue="">
            <option value="" disabled>
              Select the correct account…
            </option>
            {accounts
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.vendor} · {a.property} · {a.number}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <>
          <label>
            Vendor name
            <Input
              name="vendorName"
              required
              maxLength={200}
              defaultValue={fields?.vendorName?.value ?? ""}
            />
          </label>
          <label>
            Account number
            <Input
              name="accountNumber"
              required
              maxLength={100}
              defaultValue={fields?.accountNumber?.value ?? ""}
            />
          </label>
          <label className="full-width">
            Confirmed property
            <select name="propertyId" required defaultValue="">
              <option value="" disabled>
                Choose the service property…
              </option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.address}
                </option>
              ))}
            </select>
          </label>
          <p className="full-width evidence-note">
            New vendors and accounts are created when you save. Existing vendor
            payment preferences are preserved. A new vendor defaults to Other /
            simulated check and follows normal approval policy.
          </p>
        </>
      )}
    </>
  );
}
