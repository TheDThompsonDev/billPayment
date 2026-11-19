import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { extractionSchema, type BillExtraction } from "../domain/bills/types";

// A conservative offline reader for text PDFs, not OCR or a claim to understand every layout.
// Labeled fields are accepted only when unambiguous. Guessed headings remain low confidence.
export function parseInvoiceText(text: string): {
  fields: BillExtraction;
  provider: string;
  paymentUrls: string[];
  propertyName?: string;
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const labeled = (
    label: string,
    normalizeValue: (value: string) => string | null = (value) => value,
  ) => {
    const pattern = new RegExp(
      `^(?:${label})(?=\\s|:|$)\\s*(?::|#)?\\s*(.*)$`,
      "i",
    );
    const values = lines
      .flatMap((line, index) => {
        const match = line.match(pattern);
        return match ? [match[1] || lines[index + 1] || ""] : [];
      })
      .filter(Boolean)
      .map(normalizeValue);
    if (values.includes(null)) return null;
    const distinct = [...new Set(values)];
    return distinct.length === 1 ? distinct[0] : null;
  };
  const name = labeled("vendor name|vendor|supplier name|supplier|biller");
  const header = lines
    .slice(0, 8)
    .find(
      (line) =>
        /[a-z]/i.test(line) &&
        !/demo|fictional|statement|invoice|bill\b|account|date|document|^\d/i.test(
          line,
        ),
    );
  const remit = lines
    .find((line) => /^mail payments to:/i.test(line))
    ?.replace(/^mail payments to:\s*/i, "")
    .split(",")[0]
    .trim();
  const hasVendorLabel = lines.some((line) =>
    /^(?:vendor(?: name)?|supplier(?: name)?|biller)(?=\s|:|$)/i.test(line),
  );
  const vendorName = name ?? (hasVendorLabel ? null : header) ?? null;
  const vendorConfidence =
    name || (header && remit?.toLowerCase() === header.toLowerCase())
      ? 0.99
      : 0.88;
  const account = labeled(
    "(?:vendor |customer )?account (?:number|no\\.?|id)|account #|customer (?:number|id)|account(?=\\s*:?\\s*(?:[A-Z0-9/-]*\\d[A-Z0-9/-]*)?$)",
    (value) =>
      /^[A-Z0-9][A-Z0-9 /.-]*$/i.test(value) && /\d/.test(value) ? value : null,
  );
  const invoiceLabel =
    "invoice (?:number|no\\.?|#)|statement (?:number|no\\.?)";
  const labeledInvoice = labeled(invoiceLabel);
  // A standalone INVOICE heading can have its reference beside the issue date.
  // Only accept an identifier in that heading block, never a number in payment prose.
  const headerInvoices = lines.flatMap((line, index) => {
    if (!/^(?:invoice|bill|statement)\s*:?$/i.test(line)) return [];
    const reference = (lines[index + 1] ?? "").split(
      /\s+(?:issued|(?:invoice |bill )?date)\b/i,
    )[0];
    return /^[A-Z0-9][A-Z0-9/-]*$/i.test(reference) && /\d/.test(reference)
      ? [reference]
      : [];
  });
  const hasInvoiceLabel = lines.some((line) =>
    new RegExp(`^(?:${invoiceLabel})(?=\\s|:|$)`, "i").test(line),
  );
  const invoiceCandidates = [
    ...new Set(
      [labeledInvoice, ...headerInvoices].filter(
        (value): value is string => !!value,
      ),
    ),
  ];
  const explicitInvoice =
    (hasInvoiceLabel && !labeledInvoice) || invoiceCandidates.length !== 1
      ? null
      : invoiceCandidates[0];
  const due = labeled(
    "(?:payment )?due date|pay(?:able)? by|please pay by|due",
    parseDate,
  );
  const statementDate = labeled(
    "statement date|invoice date|bill date|issued",
    parseDate,
  );
  const amountText = labeled(
    "(?:net |total )?amount (?:due|payable|to pay)|total (?:due|payment due)|balance due|payment due|pay this amount",
    (value) => {
      if (
        !/^(?:USD\s*)?\$?\s*-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?(?:\s*USD)?$/i.test(
          value,
        )
      )
        return null;
      return String(Number(value.replace(/[$,\s]|USD/gi, "")));
    },
  );
  const amount = amountText === null ? null : Number(amountText);
  const addressLabel =
    "(?:service|supply|property)(?:\\s*[/&-]\\s*(?:service|supply|property))?\\s+(?:address|location)";
  const addressPattern = new RegExp(
    `^(?:${addressLabel})(?=\\s|:|$)\\s*:?\\s*`,
    "i",
  );
  const serviceIndices = lines.flatMap((line, index) =>
    addressPattern.test(line) ? [index] : [],
  );
  const recipientIndices = lines.flatMap((line, index) =>
    /^(?:prepared for|bill to)\s*:?$/i.test(line) ? [index] : [],
  );
  const addressIndices = serviceIndices.length
    ? serviceIndices
    : recipientIndices;
  const addressIndex = addressIndices.length === 1 ? addressIndices[0] : -1;
  let address: string | null = null;
  if (addressIndex >= 0) {
    const first = lines[addressIndex].replace(addressPattern, "");
    const block = [
      first,
      ...lines.slice(addressIndex + 1, addressIndex + 5),
    ].filter(Boolean);
    const streetIndex = block.findIndex((line) => /^\d+\s+/.test(line));
    if (streetIndex >= 0) {
      address = block[streetIndex];
      if (
        !/\b[A-Z]{2}\b/.test(address) &&
        /^[A-Za-z .'-]+,?\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/.test(
          block[streetIndex + 1] ?? "",
        )
      )
        address += `, ${block[streetIndex + 1]}`;
    }
  }
  // Utility statements may legitimately have no invoice number. This reproducible reference
  // is clearly identified in provenance and is never substituted for an existing explicit number.
  const hasInvoiceHeading = lines.some((line) =>
    /^(?:invoice|bill|statement)\s*:?$/i.test(line),
  );
  const derived =
    !hasInvoiceLabel && !hasInvoiceHeading && account && statementDate;
  const invoice =
    explicitInvoice ?? (derived ? `STMT-${account}-${statementDate}` : null);
  const field = <T>(value: T | null, confidence = 0.99) =>
    value === null ? null : { value, confidence };
  return {
    propertyName:
      labeled("property name|customer name|customer(?=\\s*:)") ??
      (addressIndex >= 0 &&
      lines[addressIndex + 1] &&
      !/^\d|account\b|https?:/i.test(lines[addressIndex + 1]) &&
      lines[addressIndex + 2]?.startsWith(address?.split(",")[0] ?? "\u0000")
        ? lines[addressIndex + 1]
        : undefined),
    paymentUrls: [
      ...new Set(
        lines
          .filter(
            (line, index) =>
              /pay|payment|billing|portal/i.test(line) ||
              (/^https?:\/\//i.test(line) &&
                /pay|payment|billing|portal/i.test(lines[index - 1] ?? "")),
          )
          .flatMap((line) => line.match(/https?:\/\/[^\s<>"')]+/gi) ?? [])
          .map((url) => url.replace(/[.,;]+$/, "")),
      ),
    ],
    fields: extractionSchema.parse({
      vendorName: field(vendorName, vendorConfidence),
      accountNumber: field(account),
      invoiceNumber: field(invoice),
      amount: field(amount),
      dueDate: field(due),
      // A recipient address is useful evidence, but may differ from the service location.
      serviceAddress: field(address, serviceIndices.length ? 0.99 : 0.88),
    }),
    provider: derived
      ? "Local PDF text · statement reference derived from account and statement date"
      : "Local PDF text · labeled-field extraction",
  };
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  if (z.iso.date().safeParse(raw).success) return raw;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const named = raw.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i,
  );
  let value: string | null = null;
  if (us)
    value = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  if (named) {
    const month =
      [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
      ].indexOf(named[1].toLowerCase()) + 1;
    value = `${named[3]}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
  }
  return value && z.iso.date().safeParse(value).success ? value : null;
}
export async function extractPDFText(bytes: Uint8Array) {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return parseInvoiceText(result.text);
  } finally {
    await parser.destroy();
  }
}
