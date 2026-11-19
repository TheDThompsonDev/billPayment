import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  parseInvoiceText,
  extractPDFText,
} from "../src/ai/pdf-text-understanding";

const text = `Vendor: Willow & Brook Services
Account number: WB-723
Invoice number: INV-42
Total amount due: $2,418.73
Due date: October 20, 2099
Service address:
Oak Avenue Apartments
875 Oak Avenue
Plano, TX 75074`;

test("Brightwater PDF reads statement headings, payable totals and compound service location", async () => {
  const result = await extractPDFText(
    await readFile("tests/fixtures/brightwater-bill.pdf"),
  );
  assert.equal(result.fields.vendorName?.value, "Brightwater Water & Sewer");
  assert.equal(result.propertyName, "Brightwater Print Studio");
  assert.equal(result.fields.accountNumber?.value, "2000456701");
  assert.equal(result.fields.invoiceNumber?.value, "BILL-1001");
  assert.equal(result.fields.amount?.value, 324.16);
  assert.equal(result.fields.dueDate?.value, "2026-10-16");
  assert.equal(
    result.fields.serviceAddress?.value,
    "125 Industrial Way, Springfield, IL 62701",
  );
  assert.deepEqual(result.paymentUrls, [
    "https://brightwater-utility-demo.vercel.app",
  ]);
});

test("statement label families support separate lines and compare repeated typed values", () => {
  for (const label of [
    "Net amount payable",
    "Amount to pay",
    "Total payment due",
    "Payment due",
    "Pay this amount",
  ]) {
    for (const separator of [": ", "\n"]) {
      const result = parseInvoiceText(
        `ACCOUNT\nQ-900\n${label}${separator}$1,234.00\nTotal amount due: USD 1234.00\nPayable by: October 16, 2026\nDUE: 10/16/2026\nPROPERTY / SERVICE LOCATION\n44 New Street, Springfield, IL 62701`,
      );
      assert.equal(result.fields.amount?.value, 1234, label);
      assert.equal(result.fields.accountNumber?.value, "Q-900");
      assert.equal(result.fields.dueDate?.value, "2026-10-16");
      assert.equal(
        result.fields.serviceAddress?.value,
        "44 New Street, Springfield, IL 62701",
      );
    }
  }
  for (const label of [
    "PROPERTY / SERVICE LOCATION",
    "Service & property address",
    "Supply location",
  ]) {
    assert.equal(
      parseInvoiceText(`${label}: 44 New Street, Springfield, IL`).fields
        .serviceAddress?.value,
      "44 New Street, Springfield, IL",
    );
  }
});

test("standalone headings and payable aliases cannot hide invalid or conflicting evidence", () => {
  assert.equal(
    parseInvoiceText("ACCOUNT\nSTATEMENT\nBILL-1001").fields.accountNumber,
    null,
  );
  assert.equal(
    parseInvoiceText("ACCOUNT\n1234\nAccount number: 9876").fields
      .accountNumber,
    null,
  );
  assert.equal(
    parseInvoiceText("Net amount payable: $324.16\nAMOUNT TO PAY: $325.16")
      .fields.amount,
    null,
  );
  assert.equal(
    parseInvoiceText("Net amount payable: $324.16\nAMOUNT TO PAY: $3,24.16")
      .fields.amount,
    null,
  );
  assert.equal(
    parseInvoiceText("Payable by: October 16, 2026\nDue: October 17, 2026")
      .fields.dueDate,
    null,
  );
  assert.equal(
    parseInvoiceText("Payable by: February 30, 2026\nDue: February 28, 2026")
      .fields.dueDate,
    null,
  );
  assert.equal(
    parseInvoiceText(
      "Monthly usage $324.16\nPayments applied $0.00\nAccount status: UNPAID",
    ).fields.amount,
    null,
  );
});

test("Alder Creek PDF retains all printed fields and its separate-line payment URL", async () => {
  const result = await extractPDFText(
    await readFile("tests/fixtures/alder-creek-bill.pdf"),
  );
  assert.equal(result.fields.vendorName?.value, "Alder Creek Landscaping");
  assert.equal(result.propertyName, "Alder Creek Workshop");
  assert.equal(result.fields.accountNumber?.value, "2000456700");
  assert.equal(result.fields.invoiceNumber?.value, "BILL-1001");
  assert.equal(result.fields.amount?.value, 186.42);
  assert.equal(result.fields.dueDate?.value, "2026-10-16");
  assert.equal(
    result.fields.serviceAddress?.value,
    "125 Industrial Way, Springfield, IL 62701",
  );
  assert.equal(result.fields.serviceAddress?.confidence, 0.88);
  assert.deepEqual(result.paymentUrls, [
    "https://alder-creek-utility-demo.vercel.app",
  ]);
});

test("alternate invoice layouts preserve conflicts and do not read account balances as identifiers", () => {
  const alternate = `Vendor: Other Grounds Company
INVOICE
INV-902 Issued October 2, 2026
Account: AB-123
Due October 16, 2026
Prepared for
Workshop
125 Industrial Way, Springfield, IL 62701`;
  const result = parseInvoiceText(alternate);
  assert.equal(result.fields.accountNumber?.value, "AB-123");
  assert.equal(
    parseInvoiceText("Account number: 123 / 456").fields.accountNumber?.value,
    "123 / 456",
  );
  assert.equal(result.fields.invoiceNumber?.value, "INV-902");
  assert.equal(result.fields.dueDate?.value, "2026-10-16");
  assert.equal(
    parseInvoiceText(alternate + "\nInvoice number: INV-903").fields
      .invoiceNumber,
    null,
  );
  assert.equal(
    parseInvoiceText(alternate + "\nAccount number: AB-456").fields
      .accountNumber,
    null,
  );
  assert.equal(
    parseInvoiceText("Account balance $123.00\nAccount summary 123").fields
      .accountNumber,
    null,
  );
  assert.equal(
    parseInvoiceText(alternate.replace("October 16, 2026", "February 30, 2026"))
      .fields.dueDate,
    null,
  );
  assert.equal(
    parseInvoiceText(alternate + "\nPrepared for\nElsewhere\n44 Other Street")
      .fields.serviceAddress,
    null,
  );
  const service = parseInvoiceText(
    alternate + "\nService address: 123 Main Street, Dallas, TX",
  );
  assert.equal(
    service.fields.serviceAddress?.value,
    "123 Main Street, Dallas, TX",
  );
  assert.equal(service.fields.serviceAddress?.confidence, 0.99);
  assert.deepEqual(
    parseInvoiceText("Company website\nhttps://example.com").paymentUrls,
    [],
  );
  assert.deepEqual(
    parseInvoiceText("Pay online\nhttps://example.com/pay").paymentUrls,
    ["https://example.com/pay"],
  );
});

test("arbitrary text PDF reads vendor and fields without a fixture or API", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  text
    .split("\n")
    .forEach((line, i) =>
      page.drawText(line, { x: 40, y: 750 - i * 22, font, size: 12 }),
    );
  const result = await extractPDFText(await doc.save());
  assert.equal(result.fields.vendorName?.value, "Willow & Brook Services");
  assert.equal(result.fields.amount?.value, 2418.73);
  assert.equal(result.fields.accountNumber?.value, "WB-723");
  assert.equal(result.fields.invoiceNumber?.value, "INV-42");
  assert.equal(result.fields.dueDate?.value, "2099-10-20");
  assert.equal(
    result.fields.serviceAddress?.value,
    "875 Oak Avenue, Plano, TX 75074",
  );
});

test("unlabeled statement header needs corroboration and references are reproducible", () => {
  const statement = text
    .replace("Vendor: Willow & Brook Services", "Willow & Brook Services")
    .replace("Invoice number: INV-42", "Statement date: October 1, 2099");
  assert.equal(parseInvoiceText(statement).fields.vendorName?.confidence, 0.88);
  const result = parseInvoiceText(
    statement +
      "\nMail payments to: Willow & Brook Services, Processing Center",
  );
  assert.equal(result.fields.vendorName?.confidence, 0.99);
  assert.equal(result.fields.invoiceNumber?.value, "STMT-WB-723-2099-10-01");
  assert.match(result.provider, /derived/);
  assert.deepEqual(parseInvoiceText(statement), parseInvoiceText(statement));
});

test("conflicting fields, invalid dates and malformed money remain unresolved", () => {
  const result = parseInvoiceText(
    text +
      "\nVendor: Another Company\nInvoice number: INV-43\nStatement date: October 1, 2099\nTotal amount due: $7,000.00\nService address: 125 Main Street, Dallas, TX",
  );
  assert.equal(result.fields.vendorName, null);
  assert.equal(result.fields.invoiceNumber, null);
  assert.equal(result.fields.amount, null);
  assert.equal(result.fields.serviceAddress, null);
  assert.equal(
    parseInvoiceText(text.replace("October 20, 2099", "02/30/2099")).fields
      .dueDate,
    null,
  );
  assert.equal(
    parseInvoiceText(text.replace("2,418.73", "24,18.73")).fields.amount,
    null,
  );
  assert.equal(
    parseInvoiceText("Scanned document without readable fields").fields
      .accountNumber,
    null,
  );
});
