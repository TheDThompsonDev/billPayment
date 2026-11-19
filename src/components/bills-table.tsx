"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Search,
  ArrowUpRight,
  SlidersHorizontal,
  FileText,
} from "lucide-react";
import { Status } from "./status";
import { date, money, label } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { statuses } from "@/domain/bills/types";
export type BillRow = {
  id: string;
  vendor: string;
  property: string;
  invoice: string;
  amount: number | null;
  due: string | null;
  status: string;
  method: string | null;
  received: string;
  reason?: string;
};
export function VendorMark({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((v) => v[0])
    .join("");
  return (
    <span
      className={`vendor-mark mark-${name.startsWith("Dallas") ? "water" : name.startsWith("Oncor") ? "power" : name.startsWith("Atmos") ? "gas" : name.startsWith("Reliable") ? "repair" : "other"}`}
    >
      {initials || "?"}
    </span>
  );
}
export function BillsTable({
  bills,
  compact = false,
  initialStatus = "ALL",
}: {
  bills: BillRow[];
  compact?: boolean;
  initialStatus?: string;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const filtered = bills.filter(
    (b) =>
      (status === "ALL" || b.status === status) &&
      `${b.vendor} ${b.property} ${b.invoice}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="table-panel">
      {!compact ? (
        <div className="table-toolbar">
          <div className="table-search">
            <Search size={16} />
            <Input
              aria-label="Search bills"
              placeholder="Search vendor, property or invoice…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="filter-select">
            <SlidersHorizontal size={15} />
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <div className="table-scroll">
        <table className="bills-table">
          <thead>
            <tr>
              <th>Vendor / invoice</th>
              <th>Property</th>
              <th className="amount">Amount</th>
              <th>Due date</th>
              <th>Status</th>
              {!compact ? (
                <>
                  <th>Method</th>
                  <th>Received</th>
                </>
              ) : null}
              <th>
                <span className="sr-only">Open bill</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, compact ? 6 : undefined).map((b) => (
              <tr key={b.id}>
                <td>
                  <Link className="vendor-cell" href={`/bills/${b.id}`}>
                    <VendorMark name={b.vendor} />
                    <div>
                      <strong>{b.vendor}</strong>
                      <small>{b.invoice}</small>
                    </div>
                  </Link>
                </td>
                <td>
                  <span className="property-cell">{b.property}</span>
                </td>
                <td className="amount">{money(b.amount)}</td>
                <td className="date-cell">{date(b.due)}</td>
                <td>
                  <Status value={b.status} />
                </td>
                {!compact ? (
                  <>
                    <td>
                      <span className="method">
                        {b.method?.replace("_", " ") ?? "—"}
                      </span>
                    </td>
                    <td className="date-cell">{date(b.received)}</td>
                  </>
                ) : null}
                <td>
                  <Link
                    href={`/bills/${b.id}`}
                    className="row-open"
                    aria-label={`Open ${b.invoice}`}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <FileText size={30} />
          <h3>No bills here</h3>
          <p>
            {query
              ? "Try a different vendor, property or invoice number."
              : "This queue is clear. New bills will appear here when they need attention."}
          </p>
        </div>
      ) : null}
      {!compact ? (
        <div className="table-footer">
          <span>
            {filtered.length} of {bills.length} bills
          </span>
          <span>Amounts in USD · Payments simulated</span>
        </div>
      ) : null}
    </div>
  );
}
