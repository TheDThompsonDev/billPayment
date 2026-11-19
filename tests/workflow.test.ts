import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { sampleExtraction } from "../src/ai/samples";
import { policyDefinitions } from "../src/domain/approvals/approval-policy";
import {
  confirmedExtraction,
  type BillExtraction,
} from "../src/domain/bills/types";
import { PDFDocument, StandardFonts } from "pdf-lib";
let db: PrismaClient;
let advance: typeof import("../src/workflows/bill-workflow").advanceBill;
let submit: typeof import("../src/services/payment-service").submitPayment;
let human: typeof import("../src/services/human-actions");
let testDirectory: string;
before(async () => {
  process.env.BILL_EXTRACTION_MODE = "offline";
  process.env.OPENAI_API_KEY = "";
  process.env.PAYMENT_BROWSER_LIVE_ENABLED = "false";
  process.env.PAYMENT_BROWSER_DEMO_ORIGINS = "";
  process.env.PAYMENT_DEMO_ORIGIN = "http://127.0.0.1:3002";
  mkdirSync("storage", { recursive: true });
  testDirectory = mkdtempSync(path.resolve("storage", "workflow-test-"));
  const target = path.join(testDirectory, "test.db");
  writeFileSync(target, "");
  process.env.DATABASE_URL = `file:${target.replaceAll("\\", "/")}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { env: process.env, stdio: "pipe" },
  );
  db = (await import("../src/database/client")).db;
  advance = (await import("../src/workflows/bill-workflow")).advanceBill;
  submit = (await import("../src/services/payment-service")).submitPayment;
  human = await import("../src/services/human-actions");
  for (const policy of policyDefinitions)
    await db.approvalPolicy.create({ data: policy });
  await db.user.createMany({
    data: [
      { id: "analyst", name: "Analyst", role: "ANALYST" },
      { id: "regional", name: "Regional", role: "REGIONAL_MANAGER" },
    ],
  });
  await db.property.createMany({
    data: [
      {
        id: "main",
        name: "Main",
        address: "123 Main Street, Dallas, TX",
        city: "Dallas",
        units: 10,
      },
      {
        id: "north",
        name: "North",
        address: "125 Main Street, Dallas, TX",
        city: "Dallas",
        units: 10,
      },
      {
        id: "preston",
        name: "Preston",
        address: "4100 Preston Road, Frisco, TX",
        city: "Frisco",
        units: 10,
      },
      {
        id: "oak",
        name: "Oak",
        address: "875 Oak Avenue, Plano, TX",
        city: "Plano",
        units: 10,
      },
    ],
  });
  await db.vendor.createMany({
    data: [
      {
        id: "water",
        name: "Dallas Water Utilities",
        category: "UTILITY",
        paymentMethod: "ACH",
      },
      {
        id: "plumbing",
        name: "Reliable Plumbing",
        category: "MAINTENANCE",
        paymentMethod: "CHECK",
      },
      {
        id: "atmos",
        name: "Atmos Energy",
        category: "UTILITY",
        paymentMethod: "CREDIT_CARD",
      },
    ],
  });
  await db.vendorAccount.createMany({
    data: [
      {
        id: "water-main",
        vendorId: "water",
        propertyId: "main",
        number: "DW-1001",
        paymentMethod: "ACH",
      },
      {
        id: "water-north",
        vendorId: "water",
        propertyId: "north",
        number: "DW-1005",
        paymentMethod: "ACH",
      },
      {
        id: "plumbing-preston",
        vendorId: "plumbing",
        propertyId: "preston",
        number: "RP-1003",
        paymentMethod: "CHECK",
      },
      {
        id: "atmos-oak",
        vendorId: "atmos",
        propertyId: "oak",
        number: "AE-1002",
        paymentMethod: "CREDIT_CARD",
      },
    ],
  });
  await db.bill.create({
    data: {
      id: "history",
      status: "PAID",
      source: "TEST",
      documentName: "history",
      accountId: "water-main",
      amountCents: 170000,
    },
  });
});
after(async () => {
  await db?.$disconnect();
  const root = path.resolve("storage") + path.sep;
  if (testDirectory?.startsWith(root))
    rmSync(testDirectory, { recursive: true, force: true });
});

test("reader setup failures are separate from missing data, and rereading persists sources without approving the property", async () => {
  const key = process.env.OPENAI_API_KEY,
    mode = process.env.BILL_EXTRACTION_MODE,
    originalFetch = globalThis.fetch;
  try {
    process.env.OPENAI_API_KEY = "";
    delete process.env.BILL_EXTRACTION_MODE;
    const bill = await db.bill.create({
      data: {
        source: "UPLOAD",
        documentName: "unseen.pdf",
        documentPath: path.resolve("tests/fixtures/cedar-valley-bill.pdf"),
        documentType: "application/pdf",
      },
    });
    await advance(bill.id);
    await advance(bill.id);
    const held = await db.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: { extraction: true },
    });
    assert.equal(held.status, "NEEDS_REVIEW");
    assert.match(held.findings, /EXTRACTION_NOT_CONFIGURED/);
    assert.doesNotMatch(held.findings, /MISSING_INFORMATION/);
    assert.equal(held.extraction, null);
    assert.equal(held.amountCents, null);
    process.env.OPENAI_API_KEY = "mock-test-key";
    const evidence = Object.fromEntries(
      Object.entries({
        vendorName: "Evidence Maintenance",
        accountNumber: "EM-42",
        invoiceNumber: "EM-100",
        amount: 152.3,
        dueDate: "2099-12-10",
        serviceAddress: "789 Evidence Lane, Austin, TX 78701",
      }).map(([field, value]) => [
        field,
        { value, confidence: 0.99, source: { page: 1, quote: String(value) } },
      ]),
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    documentKind: "INVOICE",
                    fields: evidence,
                    propertyName: "Evidence House",
                    paymentUrls: [],
                    issues: [],
                  }),
                },
              ],
            },
          ],
        }),
      );
    await human.rereadDocument(bill.id, { name: "Analyst" });
    await advance(bill.id);
    const read = await db.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: { extraction: true, proposedProperty: true, payment: true },
    });
    assert.equal(read.status, "NEEDS_REVIEW");
    assert.equal(read.proposedProperty?.status, "PENDING_ACCEPTANCE");
    assert.equal(
      JSON.parse(read.extraction!.evidence).report.fields.accountNumber.source
        .quote,
      "EM-42",
    );
    assert.equal(read.payment, null);
    await human.rereadDocument(bill.id, { name: "Analyst" });
    const events = await db.auditEvent.findMany({
      where: { billId: bill.id, type: "EXTRACTION_COMPLETED" },
    });
    assert.ok(
      events.some((event) =>
        JSON.parse(event.metadata).previousSourceEvidence?.includes("EM-42"),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (mode === undefined) delete process.env.BILL_EXTRACTION_MODE;
    else process.env.BILL_EXTRACTION_MODE = mode;
  }
});

test("browser routing keeps invoice authority, locks one run and pauses unavailable live access before payment", async () => {
  process.env.PAYMENT_BROWSER_LIVE_ENABLED = "false";
  const nav = await import("../src/services/payment-navigation");
  const bill = await newVendorBill({
    vendorName: { value: "Browser Guard Vendor", confidence: 1 },
    accountNumber: { value: "BG-42", confidence: 1 },
    invoiceNumber: { value: "BG-OCT-1", confidence: 1 },
  });
  await processToPolicy(bill.id);
  await assert.rejects(
    () =>
      nav.confirmPaymentDestination(bill.id, "https://billing.example/pay", {
        name: "Analyst",
        role: "ANALYST",
      }),
    /manager/,
  );
  await nav.confirmPaymentDestination(bill.id, "https://billing.example/pay", {
    name: "Regional",
    role: "REGIONAL_MANAGER",
  });
  await assert.rejects(() => nav.runPaymentNavigation(bill.id), /APPROVED/);
  assert.equal(
    await db.auditEvent.count({
      where: { billId: bill.id, type: "BROWSER_STARTED" },
    }),
    0,
  );
  await human.decideApproval(bill.id, true, "Approved validated services", {
    id: "regional",
    name: "Regional",
    role: "REGIONAL_MANAGER",
  });
  await Promise.allSettled([
    nav.runPaymentNavigation(bill.id),
    nav.runPaymentNavigation(bill.id),
  ]);
  assert.equal(
    await db.auditEvent.count({
      where: { billId: bill.id, type: "BROWSER_STARTED" },
    }),
    1,
  );
  assert.equal(await db.payment.count({ where: { billId: bill.id } }), 0);
  const state = await db.paymentNavigation.findUniqueOrThrow({
    where: { billId: bill.id },
  });
  assert.equal(state.status, "BLOCKED");
  assert.match(state.message!, /not registered as a demo portal/);
});

test("uncertain browser submission never retries; a matching durable receipt reconciles exactly once", async () => {
  const nav = await import("../src/services/payment-navigation");
  const bill = await newVendorBill({
    vendorName: { value: "Receipt Guard Vendor", confidence: 1 },
    accountNumber: { value: "RG-42", confidence: 1 },
    invoiceNumber: { value: "RG-OCT-1", confidence: 1 },
  });
  await processToPolicy(bill.id);
  await nav.confirmPaymentDestination(
    bill.id,
    "http://127.0.0.1:3002/payment-demo/classic",
    { name: "Regional", role: "REGIONAL_MANAGER" },
  );
  await human.decideApproval(bill.id, true, "Approved validated services", {
    id: "regional",
    name: "Regional",
    role: "REGIONAL_MANAGER",
  });
  await db.bill.update({
    where: { id: bill.id },
    data: { status: "PAYMENT_PENDING" },
  });
  await db.payment.create({
    data: {
      billId: bill.id,
      status: "PENDING",
      method: "PORTAL",
      amountCents: 241873,
      idempotencyKey: bill.id,
      attempts: { create: { number: 1, status: "PENDING" } },
    },
  });
  await db.paymentNavigation.update({
    where: { billId: bill.id },
    data: { status: "UNKNOWN" },
  });
  await assert.rejects(
    () =>
      nav.resumePaymentNavigation(bill.id, {
        name: "Regional",
        role: "REGIONAL_MANAGER",
      }),
    /before submission/,
  );
  await advance(bill.id);
  assert.equal(
    (await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).status,
    "PAYMENT_PENDING",
  );
  await db.portalReceipt.create({
    data: {
      billId: bill.id,
      vendorName: "Receipt Guard Vendor",
      accountNumber: "WRONG",
      invoiceNumber: "RG-OCT-1",
      amountCents: 241873,
    },
  });
  await nav.reconcilePaymentNavigation(bill.id);
  assert.equal(
    (await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).status,
    "PAYMENT_PENDING",
  );
  await db.portalReceipt.update({
    where: { billId: bill.id },
    data: { accountNumber: "RG-42" },
  });
  await nav.reconcilePaymentNavigation(bill.id);
  await nav.reconcilePaymentNavigation(bill.id);
  assert.equal(
    (await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).status,
    "PAID",
  );
  assert.equal(
    await db.paymentAttempt.count({ where: { payment: { billId: bill.id } } }),
    1,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { billId: bill.id, type: "PAYMENT_COMPLETED" },
    }),
    1,
  );
});
async function create(key: string) {
  const fields = JSON.stringify(sampleExtraction(key));
  return db.bill.create({
    data: {
      source: "TEST",
      sampleKey: key,
      documentName: "fixture",
      extraction: {
        create: { fields, originalFields: fields, provider: "test" },
      },
    },
  });
}

test("expired browser workers cannot overwrite a resumed run or a completed payment", async () => {
  const nav = await import("../src/services/payment-navigation");
  const bill = await newVendorBill({
    vendorName: { value: "Recovery Test Vendor", confidence: 1 },
    accountNumber: { value: "REC-42", confidence: 1 },
    invoiceNumber: { value: "REC-1", confidence: 1 },
  });
  await processToPolicy(bill.id);
  const user = { id: "regional", name: "Regional", role: "REGIONAL_MANAGER" };
  await nav.confirmPaymentDestination(
    bill.id,
    "https://billing.example/pay",
    user,
  );
  await human.decideApproval(bill.id, true, "Reviewed recovery test", user);
  await db.paymentNavigation.update({
    where: { billId: bill.id },
    data: {
      status: "RUNNING",
      runToken: "old-worker",
      startedAt: new Date(Date.now() - 300000),
    },
  });
  await nav.reconcilePaymentNavigation(bill.id);
  const expired = await db.paymentNavigation.findUniqueOrThrow({
    where: { billId: bill.id },
  });
  assert.equal(expired.status, "BLOCKED");
  assert.equal(expired.runToken, null);
  await nav.resumePaymentNavigation(bill.id, user);
  await db.paymentNavigation.update({
    where: { billId: bill.id },
    data: { status: "RUNNING", runToken: "new-worker", startedAt: new Date() },
  });
  await nav.recordBrowserHandoff(
    bill.id,
    "old-worker",
    new Error("Late failure"),
  );
  assert.equal(
    (
      await db.paymentNavigation.findUniqueOrThrow({
        where: { billId: bill.id },
      })
    ).status,
    "RUNNING",
  );
  assert.equal(
    await db.auditEvent.count({
      where: { billId: bill.id, type: "BROWSER_HANDOFF" },
    }),
    0,
  );
  await nav.recordBrowserHandoff(
    bill.id,
    "new-worker",
    new Error("Current failure"),
  );
  assert.equal(
    (
      await db.paymentNavigation.findUniqueOrThrow({
        where: { billId: bill.id },
      })
    ).status,
    "BLOCKED",
  );
  assert.equal(
    await db.auditEvent.count({
      where: { billId: bill.id, type: "BROWSER_HANDOFF" },
    }),
    1,
  );
  await db.bill.update({ where: { id: bill.id }, data: { status: "PAID" } });
  await db.paymentNavigation.update({
    where: { billId: bill.id },
    data: { status: "SUCCEEDED", runToken: null },
  });
  await nav.recordBrowserHandoff(
    bill.id,
    "new-worker",
    new Error("Failure after reconciliation"),
  );
  assert.equal(
    (
      await db.paymentNavigation.findUniqueOrThrow({
        where: { billId: bill.id },
      })
    ).status,
    "SUCCEEDED",
  );
});
async function processToPolicy(id: string) {
  for (let i = 0; i < 4; i++) await advance(id);
  return db.bill.findUniqueOrThrow({ where: { id } });
}
async function settle(id: string) {
  await db.paymentAttempt.updateMany({
    where: { payment: { billId: id } },
    data: { createdAt: new Date(Date.now() - 3000) },
  });
  await advance(id);
  return db.bill.findUniqueOrThrow({
    where: { id },
    include: { payment: { include: { attempts: true } }, events: true },
  });
}
test("happy path, concurrent submission and repeated invoice produce one payment", async () => {
  const bill = await create("happy");
  assert.equal((await processToPolicy(bill.id)).status, "APPROVED");
  const results = await Promise.allSettled([submit(bill.id), submit(bill.id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await db.payment.count({ where: { billId: bill.id } }), 1);
  const paid = await settle(bill.id);
  assert.equal(paid.status, "PAID");
  assert.equal(paid.payment?.attempts.length, 1);
  assert.ok(paid.events.some((e) => e.type === "DUPLICATE_CHECK_PASSED"));
  assert.ok(paid.events.some((e) => e.type === "PAYMENT_COMPLETED"));
  await assert.rejects(() => submit(bill.id));
  const duplicate = await create("duplicate");
  assert.equal((await processToPolicy(duplicate.id)).status, "REJECTED");
  assert.equal(await db.payment.count({ where: { billId: duplicate.id } }), 0);
  await assert.rejects(() =>
    human.correctBill(
      duplicate.id,
      {
        accountId: "water-main",
        invoiceNumber: "NEW",
        amount: 100,
        dueDate: "2099-10-01",
        note: "Attempt to bypass",
        acknowledgeRisk: true,
      },
      { id: "regional", name: "Regional", role: "REGIONAL_MANAGER" },
    ),
  );
});
test("maintenance waits for authority; analyst cannot approve; manager resumes to check payment", async () => {
  const bill = await create("approval");
  assert.equal((await processToPolicy(bill.id)).status, "AWAITING_APPROVAL");
  await assert.rejects(() => submit(bill.id));
  await assert.rejects(() =>
    human.decideApproval(bill.id, true, "Verified repair", {
      id: "analyst",
      name: "Analyst",
      role: "ANALYST",
    }),
  );
  await human.decideApproval(bill.id, true, "Verified repair", {
    id: "regional",
    name: "Regional",
    role: "REGIONAL_MANAGER",
  });
  await submit(bill.id);
  assert.equal((await settle(bill.id)).status, "PAID");
});
test("ambiguous unusual invoice holds both findings, preserves original, reruns policy after correction", async () => {
  const bill = await create("ambiguous");
  const held = await processToPolicy(bill.id);
  assert.equal(held.status, "NEEDS_REVIEW");
  assert.equal(held.amountCents, null);
  assert.ok(held.findings.includes("UNCERTAIN_MATCH"));
  assert.ok(held.findings.includes("AMOUNT_OUTLIER"));
  assert.equal(await db.payment.count({ where: { billId: bill.id } }), 0);
  await human.correctBill(
    bill.id,
    {
      accountId: "water-main",
      invoiceNumber: "DW-REVIEW",
      amount: 6842,
      dueDate: "2099-10-01",
      note: "Verified a repaired water leak and meter reading",
      acknowledgeRisk: true,
    },
    { id: "analyst", name: "Analyst", role: "ANALYST" },
  );
  await advance(bill.id);
  await advance(bill.id);
  assert.equal(
    (await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).status,
    "AWAITING_APPROVAL",
  );
  const extraction = await db.billExtraction.findUniqueOrThrow({
    where: { billId: bill.id },
  });
  assert.ok(extraction.originalFields.includes("Main St, Dallas"));
  assert.ok(extraction.fields.includes("123 Main Street"));
  assert.equal(
    await db.reviewItem.count({ where: { billId: bill.id, status: "OPEN" } }),
    0,
  );
});
test("explicit mock failure retries on same payment with a second attempt", async () => {
  const bill = await create("failure");
  await processToPolicy(bill.id);
  await submit(bill.id);
  assert.equal((await settle(bill.id)).status, "FAILED");
  await human.retryPayment(bill.id, { name: "Analyst" });
  await submit(bill.id);
  const paid = await settle(bill.id);
  assert.equal(paid.status, "PAID");
  assert.equal(paid.payment?.attempts.length, 2);
  assert.equal(await db.payment.count({ where: { billId: bill.id } }), 1);
});
test("server payment service rejects tampered approved state without approval record", async () => {
  const bill = await db.bill.create({
    data: {
      status: "APPROVED",
      source: "TEST",
      documentName: "tampered",
      vendorId: "plumbing",
      propertyId: "preston",
      accountId: "plumbing-preston",
      invoiceNumber: "TAMPER",
      amountCents: 750000,
      dueDate: new Date("2099-10-01"),
      paymentMethod: "CHECK",
      dedupeKey: "plumbing:plumbing-preston:TAMPER",
    },
  });
  await assert.rejects(() => submit(bill.id), /Approval authority/);
  assert.equal(await db.payment.count({ where: { billId: bill.id } }), 0);
});

async function newVendorBill(overrides: Partial<BillExtraction> = {}) {
  const fields = JSON.stringify({
    ...confirmedExtraction({
      vendorName: "Willow & Brook Services",
      accountNumber: "WB-723",
      invoiceNumber: "NOVEL-1",
      amount: 2418.73,
      dueDate: "2099-10-20",
      serviceAddress: "875 Oak Avenue, Plano, TX 75074",
    }),
    ...overrides,
  });
  return db.bill.create({
    data: {
      source: "TEST",
      documentName: "New vendor",
      extraction: {
        create: { fields, originalFields: fields, provider: "test" },
      },
    },
  });
}

test("new property is created pending, reused, explicitly accepted and still requires invoice approval", async () => {
  const { acceptProperty } =
    await import("../src/services/property-onboarding");
  const overrides = {
    vendorName: { value: "Alder Creek Landscaping", confidence: 0.88 },
    serviceAddress: {
      value: "125 Industrial Way, Springfield, IL 62701",
      confidence: 0.88,
    },
    accountNumber: { value: "2000456700", confidence: 0.99 },
    invoiceNumber: { value: "BILL-1001", confidence: 0.99 },
    amount: { value: 186.42, confidence: 0.99 },
  };
  const bill = await newVendorBill(overrides);
  await db.billExtraction.update({
    where: { billId: bill.id },
    data: { propertyName: "Alder Creek Workshop" },
  });
  const pending = await processToPolicy(bill.id);
  assert.equal(pending.status, "NEEDS_REVIEW");
  assert.equal(pending.propertyId, null);
  assert.ok(pending.proposedPropertyId);
  const property = await db.property.findUniqueOrThrow({
    where: { id: pending.proposedPropertyId! },
  });
  assert.equal(property.name, "Alder Creek Workshop");
  assert.equal(property.status, "PENDING_ACCEPTANCE");
  assert.match(pending.findings, /PROPERTY_ACCEPTANCE_REQUIRED/);
  await assert.rejects(() => submit(bill.id));
  const same = await newVendorBill({
    ...overrides,
    invoiceNumber: { value: "BILL-1002", confidence: 0.99 },
  });
  assert.equal(
    (await processToPolicy(same.id)).proposedPropertyId,
    property.id,
  );
  assert.equal(await db.property.count({ where: { city: "Springfield" } }), 1);
  const analyst = { name: "Analyst", role: "ANALYST" };
  await assert.rejects(
    () => acceptProperty(bill.id, "oak", analyst),
    /no matching property/,
  );
  await assert.rejects(
    () =>
      acceptProperty(bill.id, property.id, {
        name: "Visitor",
        role: "VISITOR",
      }),
    /authorized/,
  );
  // A stale browser cannot accept a proposal after the source address changes.
  const extraction = await db.billExtraction.findUniqueOrThrow({
    where: { billId: bill.id },
  });
  const changed = JSON.parse(extraction.fields);
  changed.serviceAddress.value = "44 Other Road, Plano, TX";
  await db.billExtraction.update({
    where: { billId: bill.id },
    data: { fields: JSON.stringify(changed) },
  });
  await assert.rejects(
    () => acceptProperty(bill.id, property.id, analyst),
    /address has changed/,
  );
  await db.billExtraction.update({
    where: { billId: bill.id },
    data: { fields: extraction.fields },
  });
  await acceptProperty(bill.id, property.id, analyst);
  await assert.rejects(
    () => acceptProperty(bill.id, property.id, analyst),
    /no matching property/,
  );
  const accepted = await processToPolicy(bill.id);
  assert.equal(accepted.status, "AWAITING_APPROVAL");
  assert.equal(accepted.propertyId, property.id);
  assert.equal(
    (await db.property.findUniqueOrThrow({ where: { id: property.id } }))
      .status,
    "ACTIVE",
  );
  assert.equal(
    (await db.billExtraction.findUniqueOrThrow({ where: { billId: bill.id } }))
      .originalFields,
    extraction.originalFields,
  );
  await assert.rejects(() => submit(bill.id));
  assert.equal(await db.payment.count({ where: { billId: bill.id } }), 0);
  assert.equal(
    await db.auditEvent.count({
      where: { billId: bill.id, type: "PROPERTY_ACCEPTED" },
    }),
    1,
  );
  await acceptProperty(same.id, property.id, analyst);
  assert.equal((await processToPolicy(same.id)).propertyId, property.id);
});

test("inactive properties and ambiguous or incomplete addresses never create a new active relationship", async () => {
  await db.property.create({
    data: {
      id: "inactive-new",
      name: "Inactive",
      address: "90 Closed Road, Plano, TX",
      city: "Plano",
      units: 0,
      status: "INACTIVE",
    },
  });
  for (const address of ["90 Closed Road, Plano, TX", "Somewhere in Plano"]) {
    const bill = await newVendorBill({
      vendorName: { value: "Draft Guard Vendor", confidence: 1 },
      serviceAddress: { value: address, confidence: 1 },
    });
    const result = await processToPolicy(bill.id);
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.equal(result.proposedPropertyId, null);
  }
  await db.property.createMany({
    data: [
      {
        id: "ambiguous-a",
        name: "A",
        address: "92 Conflict Road, Plano, TX",
        city: "Plano",
        units: 0,
      },
      {
        id: "ambiguous-b",
        name: "B",
        address: "92 Conflict Rd, Plano, TX 75074",
        city: "Plano",
        units: 0,
      },
    ],
  });
  const conflict = await newVendorBill({
    vendorName: { value: "Ambiguous Property Vendor", confidence: 1 },
    serviceAddress: {
      value: "92 Conflict Road, Plano, TX 75074",
      confidence: 1,
    },
  });
  assert.equal((await processToPolicy(conflict.id)).proposedPropertyId, null);
});
test("new vendor and account are created, reused, audited, and follow normal approval/payment checks", async () => {
  const bill = await newVendorBill();
  const result = await processToPolicy(bill.id);
  assert.equal(result.status, "AWAITING_APPROVAL");
  assert.equal(result.propertyId, "oak");
  const vendor = await db.vendor.findUniqueOrThrow({
    where: { id: result.vendorId! },
  });
  assert.equal(vendor.category, "OTHER");
  assert.equal(vendor.paymentMethod, "CHECK");
  const approval = await db.approval.findFirstOrThrow({
    where: { billId: bill.id },
  });
  assert.equal(approval.requiredRole, "PROPERTY_MANAGER");
  await assert.rejects(() => submit(bill.id));
  const events = await db.auditEvent.findMany({ where: { billId: bill.id } });
  assert.ok(events.some((e) => e.type === "VENDOR_CREATED"));
  assert.ok(events.some((e) => e.type === "VENDOR_ACCOUNT_CREATED"));
  const duplicate = await newVendorBill({
    vendorName: { value: "WILLOW AND BROOK SERVICES", confidence: 1 },
  });
  assert.equal((await processToPolicy(duplicate.id)).status, "REJECTED");
  assert.equal(
    await db.vendor.count({ where: { name: { contains: "Willow" } } }),
    1,
  );
  assert.equal(
    await db.vendorAccount.count({ where: { vendorId: vendor.id } }),
    1,
  );
  await human.decideApproval(bill.id, true, "Verified new supplier invoice", {
    id: "regional",
    name: "Regional",
    role: "REGIONAL_MANAGER",
  });
  await assert.rejects(() => submit(bill.id), /Browser payment/);
  assert.equal(await db.payment.count({ where: { billId: bill.id } }), 0);
});
test("uncertain vendor and conflicting or inactive account cannot bypass review", async () => {
  const uncertain = await newVendorBill({
    vendorName: { value: "Uncertain Supplier", confidence: 0.88 },
  });
  assert.equal((await processToPolicy(uncertain.id)).status, "NEEDS_REVIEW");
  assert.equal(
    await db.vendor.count({ where: { name: "Uncertain Supplier" } }),
    0,
  );
  const conflict = await newVendorBill({
    serviceAddress: { value: "123 Main Street, Dallas, TX", confidence: 1 },
    invoiceNumber: { value: "CONFLICT-1", confidence: 1 },
  });
  assert.equal((await processToPolicy(conflict.id)).status, "NEEDS_REVIEW");
  const account = await db.vendorAccount.findFirstOrThrow({
    where: { number: "WB-723" },
  });
  assert.equal(account.propertyId, "oak");
  await db.vendorAccount.update({
    where: { id: account.id },
    data: { active: false },
  });
  const inactive = await newVendorBill({
    invoiceNumber: { value: "INACTIVE-1", confidence: 1 },
  });
  assert.equal((await processToPolicy(inactive.id)).status, "NEEDS_REVIEW");
  assert.equal(
    (await db.vendorAccount.findUniqueOrThrow({ where: { id: account.id } }))
      .active,
    false,
  );
});
test("unknown service location pauses; human can create vendor/account using a confirmed property", async () => {
  const bill = await newVendorBill({
    vendorName: { value: "New Landscaping Company", confidence: 1 },
    serviceAddress: { value: "Somewhere in Plano", confidence: 1 },
  });
  assert.equal((await processToPolicy(bill.id)).status, "NEEDS_REVIEW");
  const vendor = await db.vendor.findUniqueOrThrow({
    where: { name: "New Landscaping Company" },
  });
  assert.equal(
    await db.vendorAccount.count({ where: { vendorId: vendor.id } }),
    0,
  );
  await human.correctBill(
    bill.id,
    {
      vendorName: vendor.name,
      accountNumber: "LAND-42",
      propertyId: "oak",
      invoiceNumber: "LAND-1",
      amount: 200,
      dueDate: "2099-10-20",
      note: "Confirmed property with original invoice",
      acknowledgeRisk: false,
    },
    { id: "analyst", name: "Analyst", role: "ANALYST" },
  );
  assert.equal((await processToPolicy(bill.id)).status, "AWAITING_APPROVAL");
  assert.equal(
    await db.vendorAccount.count({
      where: { vendorId: vendor.id, propertyId: "oak" },
    }),
    1,
  );
});
test("re-reading a previously unsupported PDF preserves original evidence and resumes onboarding", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  [
    "Vendor: Meadow Cleaning",
    "Account number: MC-24",
    "Invoice number: MC-OCT",
    "Amount due: $650.00",
    "Due date: 2099-10-20",
    "Service address: 875 Oak Avenue, Plano, TX 75074",
  ].forEach((line, i) =>
    page.drawText(line, { x: 40, y: 750 - i * 22, font, size: 12 }),
  );
  const file = path.join(testDirectory, "reread.pdf");
  writeFileSync(file, await doc.save());
  const original = JSON.stringify({
    vendorName: null,
    accountNumber: null,
    invoiceNumber: null,
    amount: null,
    dueDate: null,
    serviceAddress: null,
  });
  const bill = await db.bill.create({
    data: {
      source: "UPLOAD",
      status: "NEEDS_REVIEW",
      stage: 2,
      documentName: "unsupported.pdf",
      documentPath: file,
      documentType: "application/pdf",
      extraction: {
        create: {
          fields: original,
          originalFields: original,
          provider: "Old manual reader",
        },
      },
      reviews: { create: { reasons: "[]" } },
    },
  });
  await human.rereadDocument(bill.id, { name: "Analyst" });
  await advance(bill.id);
  await advance(bill.id);
  assert.equal(
    (await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).status,
    "AWAITING_APPROVAL",
  );
  const extraction = await db.billExtraction.findUniqueOrThrow({
    where: { billId: bill.id },
  });
  assert.equal(extraction.originalFields, original);
  assert.match(extraction.fields, /Meadow Cleaning/);
  assert.equal(
    await db.reviewItem.count({ where: { billId: bill.id, status: "OPEN" } }),
    0,
  );
  await assert.rejects(() =>
    human.rereadDocument(bill.id, { name: "Analyst" }),
  );
});
