import test from "node:test";
import assert from "node:assert/strict";
import {
  duplicateKey,
  findDuplicate,
} from "../src/domain/bills/duplicate-check";
import { assertTransition } from "../src/domain/bills/state-machine";
import {
  confidenceDecision,
  matchBill,
} from "../src/domain/matching/bill-matcher";
import {
  determineApproval,
  policyDefinitions,
  canApprove,
} from "../src/domain/approvals/approval-policy";
import { evaluateRisk } from "../src/domain/risk/risk-evaluator";
import { assertPaymentSafe } from "../src/domain/payments/payment-guards";
import { confirmedSchema, extractionSchema } from "../src/domain/bills/types";
test("duplicate identity ignores case and punctuation but preserves account scope", () => {
  const key = duplicateKey("water", "a", " dw-1028-26 ");
  assert.equal(key, duplicateKey("water", "a", "DW102826"));
  assert.notEqual(key, duplicateKey("water", "b", "DW102826"));
  assert.equal(
    findDuplicate([{ id: "original", dedupeKey: key }], key, "new")?.id,
    "original",
  );
  assert.equal(
    findDuplicate([{ id: "original", dedupeKey: key }], key, "original"),
    undefined,
  );
  assert.throws(() => duplicateKey("v", "a", "---"));
});
test("confidence boundaries are deterministic and invalid confidence fails closed", () => {
  for (const [score, result] of [
    [0.95, "ACCEPT"],
    [1, "ACCEPT"],
    [0.9499, "REVIEW"],
    [0.8, "REVIEW"],
    [0.7999, "REJECT"],
    [NaN, "REJECT"],
    [1.1, "REJECT"],
    [-1, "REJECT"],
  ] as const)
    assert.equal(confidenceDecision(score), result);
});
test("exact account cannot hide a conflicting service address", () => {
  const match = matchBill(
    {
      vendorName: "Dallas Water Utilities",
      accountNumber: "DW-1",
      invoiceNumber: "X",
      amount: 10,
      dueDate: "2026-12-01",
      serviceAddress: "999 Wrong Street",
    },
    [
      {
        id: "a",
        number: "DW-1",
        vendorId: "v",
        propertyId: "p",
        active: true,
        paymentMethod: "ACH",
        vendor: { name: "Dallas Water Utilities" },
        property: { name: "Main", address: "123 Main Street" },
      },
    ],
  );
  assert.equal(match.conflict, true);
  assert.equal(match.account?.id, "a");
});
test("approval boundaries include exact $2,000, $5,000 and $20,000", () => {
  const rule = (amountCents: number, category = "UTILITY") =>
    determineApproval({ amountCents, category }, policyDefinitions);
  assert.equal(rule(199999).type, "AUTO_APPROVED");
  assert.equal(rule(200000).role, "PROPERTY_MANAGER");
  assert.equal(rule(499999).role, "PROPERTY_MANAGER");
  assert.equal(rule(500000).role, "REGIONAL_MANAGER");
  assert.equal(rule(2000000).role, "REGIONAL_MANAGER");
  assert.equal(rule(2000001).role, "DIRECTOR");
  assert.equal(rule(750000, "MAINTENANCE").role, "REGIONAL_MANAGER");
  assert.equal(rule(100, "PROPERTY_TAX").role, "DIRECTOR");
  assert.equal(rule(100, "MAINTENANCE").role, "PROPERTY_MANAGER");
  assert.throws(() => rule(0));
  assert.throws(() => rule(-1));
});
test("approval permissions reject lower and unknown roles", () => {
  assert.equal(canApprove("ANALYST", "REGIONAL_MANAGER"), false);
  assert.equal(canApprove("PROPERTY_MANAGER", "REGIONAL_MANAGER"), false);
  assert.equal(canApprove("REGIONAL_MANAGER", "REGIONAL_MANAGER"), true);
  assert.equal(canApprove("DIRECTOR", "REGIONAL_MANAGER"), true);
  assert.equal(canApprove("INVENTED", "DIRECTOR"), false);
  assert.equal(canApprove("DIRECTOR", "INVENTED"), false);
});
test("state machine rejects skipped and terminal transitions", () => {
  assert.doesNotThrow(() => assertTransition("RECEIVED", "PROCESSING"));
  for (const from of [
    "RECEIVED",
    "PROCESSING",
    "NEEDS_REVIEW",
    "AWAITING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "PAID",
  ])
    assert.throws(() => assertTransition(from, "PAID"));
  assert.doesNotThrow(() => assertTransition("PAYMENT_PENDING", "PAID"));
  assert.throws(() => assertTransition("PAID", "APPROVED"));
  assert.throws(() => assertTransition("REJECTED", "PROCESSING"));
});
test("risk compares historical average, checks dates, relationships and account status", () => {
  const base = {
    amountCents: 30000,
    historicalAmounts: [10000, 10000],
    dueDate: new Date("2026-11-01"),
    active: true,
    knownRelationship: true,
  };
  const now = new Date("2026-10-01");
  assert.equal(evaluateRisk(base, now).length, 0);
  assert.equal(
    evaluateRisk({ ...base, amountCents: 30001 }, now)[0].code,
    "AMOUNT_OUTLIER",
  );
  assert.equal(
    evaluateRisk({ ...base, amountCents: 30001, acknowledged: true }, now)[0]
      .severity,
    "info",
  );
  assert.deepEqual(
    evaluateRisk(
      {
        ...base,
        amountCents: -1,
        active: false,
        knownRelationship: false,
        dueDate: new Date("2026-09-01"),
      },
      now,
    ).map((f) => f.code),
    ["INVALID_AMOUNT", "OVERDUE", "INACTIVE_ACCOUNT", "UNKNOWN_RELATIONSHIP"],
  );
});
test("payment safeguards independently reject every unsafe precondition", () => {
  const safe = {
    status: "APPROVED",
    completed: false,
    duplicate: false,
    method: "ACH",
    amountCents: 184217,
    accountActive: true,
    requiredFields: true,
    approvalSatisfied: true,
    openReview: false,
  };
  assert.doesNotThrow(() => assertPaymentSafe(safe));
  for (const patch of [
    { status: "RECEIVED" },
    { completed: true },
    { duplicate: true },
    { method: "WIRE" },
    { method: null },
    { amountCents: 0 },
    { amountCents: -1 },
    { amountCents: 1.5 },
    { accountActive: false },
    { requiredFields: false },
    { approvalSatisfied: false },
    { openReview: true },
  ])
    assert.throws(() => assertPaymentSafe({ ...safe, ...patch }));
});
test("schema rejects impossible dates, fractional cents and malformed AI output", () => {
  const values = {
    vendorName: "Vendor",
    accountNumber: "A",
    invoiceNumber: "I",
    amount: 100,
    dueDate: "2026-10-20",
    serviceAddress: "123 Main",
  };
  assert.equal(confirmedSchema.safeParse(values).success, true);
  assert.equal(
    confirmedSchema.safeParse({ ...values, dueDate: "2026-02-31" }).success,
    false,
  );
  assert.equal(
    confirmedSchema.safeParse({ ...values, amount: 1.001 }).success,
    false,
  );
  assert.equal(
    extractionSchema.safeParse({
      vendorName: { value: "Vendor", confidence: 2 },
    }).success,
    false,
  );
});
