// Opt-in live evaluation: sends only this fixture corpus to the configured model.
// Run: node --env-file=.env --import tsx scripts/evaluate-document-reader.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import {
  readDocumentWithAI,
  DocumentReadError,
} from "../src/ai/document-reader";

async function main() {
  if (!process.env.OPENAI_API_KEY)
    throw new Error(
      "Set OPENAI_API_KEY locally before running the live evaluation.",
    );
  await mkdir("storage/reader-evaluation", { recursive: true });
  async function pdf(name: string, pages: string[][]) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const lines of pages) {
      const page = doc.addPage();
      lines.forEach((text, i) =>
        page.drawText(text, { x: 50, y: 780 - i * 28, size: 12, font }),
      );
    }
    const path = `storage/reader-evaluation/${name}.pdf`;
    await writeFile(path, await doc.save());
    return path;
  }
  const multi = await pdf("multipage", [
    [
      "INVOICE",
      "Juniper Lift Services",
      "Supplier office: 9 Elm Road, Reno, NV 89501",
      "Sold to: Harbor Lofts",
      "Work location: 20 Lake Street, Madison, WI 53703",
      "Client ID: 000792",
      "Document reference: JL-840",
      "Issued: October 1, 2026",
      "Maintenance visit  $450.00",
      "Replacement part   $125.00",
      "Continued on page 2",
    ],
    [
      "Juniper Lift Services / JL-840 continued",
      "Subtotal: $575.00",
      "Tax: $46.00",
      "Already paid: $200.00",
      "Please remit the remainder: $421.00",
      "Settlement deadline: November 12, 2026",
      "Pay online: https://juniper.example/pay",
    ],
  ]);
  const missing = await pdf("missing-deadline", [
    [
      "Invoice from Maple Window Care",
      "Customer: Birch House",
      "Service location: 40 Birch Lane, Salem, OR 97301",
      "Account: MC-002",
      "Invoice: MC-88",
      "Issued: October 3, 2026",
      "Amount remaining: $93.00",
      "No payment deadline has been agreed.",
    ],
  ]);
  const resume = await pdf("resume", [
    [
      "Jordan Example",
      "Resume",
      "Professional experience",
      "Account manager, 2022 - 2026",
      "Managed 300 customer accounts and a $250,000 budget.",
      "Education: Business Administration",
    ],
  ]);
  const parser = new PDFParse({
    data: await readFile("tests/fixtures/brightwater-bill.pdf"),
  });
  const shot = await parser.getScreenshot({ desiredWidth: 1400 });
  const image = "storage/reader-evaluation/brightwater-image.png";
  await writeFile(
    image,
    Buffer.from(shot.pages[0].dataUrl.split(",")[1], "base64"),
  );
  await parser.destroy();
  const address = "125 Industrial Way, Springfield, IL 62701";
  type Case = {
    name: string;
    path: string;
    type?: string;
    expected?: Record<string, string | number | null>;
    property?: string;
    url?: string;
    error?: string;
    sourcePage?: number;
  };
  const brightwater = {
    vendorName: "Brightwater Water & Sewer",
    accountNumber: "2000456701",
    invoiceNumber: "BILL-1001",
    amount: 324.16,
    dueDate: "2026-10-16",
    serviceAddress: address,
  };
  const cases: Case[] = [
    {
      name: "Alder PDF",
      path: "tests/fixtures/alder-creek-bill.pdf",
      expected: {
        vendorName: "Alder Creek Landscaping",
        accountNumber: "2000456700",
        invoiceNumber: "BILL-1001",
        amount: 186.42,
        dueDate: "2026-10-16",
        serviceAddress: address,
      },
      property: "Alder Creek Workshop",
      url: "https://alder-creek-utility-demo.vercel.app",
    },
    {
      name: "Brightwater PDF",
      path: "tests/fixtures/brightwater-bill.pdf",
      expected: brightwater,
      property: "Brightwater Print Studio",
      url: "https://brightwater-utility-demo.vercel.app",
    },
    {
      name: "Cedar PDF",
      path: "tests/fixtures/cedar-valley-bill.pdf",
      expected: {
        vendorName: "Cedar Valley Pest Control",
        accountNumber: "2000456705",
        invoiceNumber: "BILL-1001",
        amount: 206.54,
        dueDate: "2026-10-16",
        serviceAddress: address,
      },
      property: "Cedar Valley Market",
      url: "https://cedar-valley-utility-demo.vercel.app",
    },
    {
      name: "Brightwater image",
      path: image,
      type: "image/png",
      expected: brightwater,
    },
    {
      name: "Unseen two-page invoice",
      path: multi,
      expected: {
        vendorName: "Juniper Lift Services",
        accountNumber: "000792",
        invoiceNumber: "JL-840",
        amount: 421,
        dueDate: "2026-11-12",
        serviceAddress: "20 Lake Street, Madison, WI 53703",
      },
      url: "https://juniper.example/pay",
      sourcePage: 2,
    },
    {
      name: "Missing deadline",
      path: missing,
      expected: {
        vendorName: "Maple Window Care",
        accountNumber: "MC-002",
        invoiceNumber: "MC-88",
        amount: 93,
        dueDate: null,
        serviceAddress: "40 Birch Lane, Salem, OR 97301",
      },
    },
    { name: "Resume rejection", path: resume, error: "NOT_AN_INVOICE" },
  ];
  const results = [];
  for (const item of cases) {
    try {
      const result = await readDocumentWithAI({
        documentPath: item.path,
        documentName: item.path.split("/").pop()!,
        documentType: item.type ?? "application/pdf",
      });
      const values = Object.fromEntries(
        Object.entries(result.fields).map(([key, field]) => [
          key,
          field?.value ?? null,
        ]),
      );
      const mismatches = Object.entries(item.expected ?? {})
        .filter(([key, value]) => values[key] !== value)
        .map(
          ([key, value]) =>
            `${key}: expected ${JSON.stringify(value)}, received ${JSON.stringify(values[key])}`,
        );
      if (item.error) mismatches.push(`Expected rejection ${item.error}`);
      if (item.property && result.propertyName !== item.property)
        mismatches.push("Property name mismatch");
      if (item.url && !result.paymentUrls.includes(item.url))
        mismatches.push("Payment URL missing");
      if (
        item.sourcePage &&
        result.evidence.report.fields.amount?.source.page !== item.sourcePage
      )
        mismatches.push("Amount evidence on wrong page");
      results.push({
        name: item.name,
        passed: mismatches.length === 0,
        mismatches,
        result,
      });
    } catch (error) {
      const code = error instanceof DocumentReadError ? error.code : "ERROR";
      results.push({
        name: item.name,
        passed: code === item.error,
        error: code,
        message: (error as Error).message,
      });
    }
    console.log(`${results.at(-1)!.passed ? "PASS" : "FAIL"}: ${item.name}`);
  }
  await writeFile(
    "storage/reader-evaluation/results.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
