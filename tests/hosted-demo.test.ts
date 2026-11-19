import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationURL } from "../src/domain/payments/payment-destination";
import {
  hostedDemoPlan,
  localPlan,
  verifyHostedAccount,
  verifyHostedSummary,
  type BrowserEvidence,
} from "../src/services/browser-payment-agent";
const invoice = {
  billId: "test",
  vendorName: "Example Services",
  accountNumber: "2000456702",
  accountId: "acct",
  invoiceNumber: "BILL-1001",
  amountCents: 51870,
};
const control = (
  id: string,
  label: string,
  props: Partial<BrowserEvidence["controls"][number]> = {},
) => ({
  id,
  label,
  tag: "button",
  type: "button",
  value: "",
  href: "",
  ...props,
});
const view = (controls: BrowserEvidence["controls"], text = "") => ({
  url: "https://demo.example",
  text,
  controls,
});

test("hosted demo access is exact-origin configuration and remains separate from local ledger protocol", () => {
  const old = process.env.PAYMENT_BROWSER_DEMO_ORIGINS;
  try {
    process.env.PAYMENT_BROWSER_DEMO_ORIGINS = "https://demo.example";
    assert.equal(destinationURL("https://demo.example/pay").isHostedDemo, true);
    assert.equal(destinationURL("https://demo.example/pay").isDemo, false);
    for (const url of [
      "https://demo.example.evil.test",
      "https://other-demo.example",
      "https://sub.demo.example",
    ])
      assert.equal(destinationURL(url).isHostedDemo, false);
    assert.throws(() => destinationURL("http://demo.example"));
  } finally {
    if (old === undefined) delete process.env.PAYMENT_BROWSER_DEMO_ORIGINS;
    else process.env.PAYMENT_BROWSER_DEMO_ORIGINS = old;
  }
});

test("registered demo login uses configured fields; ordinary login and interactive challenges still stop", () => {
  const email = process.env.PAYMENT_BROWSER_DEMO_EMAIL,
    password = process.env.PAYMENT_BROWSER_DEMO_PASSWORD;
  try {
    process.env.PAYMENT_BROWSER_DEMO_EMAIL = "demo@example.test";
    process.env.PAYMENT_BROWSER_DEMO_PASSWORD = "test-only";
    const login = view([
      control("email", "Email", { tag: "input", type: "email", filled: false }),
      control("password", "Password", {
        tag: "input",
        type: "password",
        filled: false,
      }),
      control("sign-in", "Sign in"),
    ]);
    assert.equal(hostedDemoPlan(login, invoice, false)?.field, "demoEmail");
    login.controls[0].filled = true;
    assert.equal(hostedDemoPlan(login, invoice, false)?.field, "demoPassword");
    login.controls[1].filled = true;
    assert.equal(hostedDemoPlan(login, invoice, false)?.target, "sign-in");
    assert.equal(localPlan(login)?.action, "handoff");
    assert.equal(
      hostedDemoPlan(
        { ...login, text: "Enter verification code" },
        invoice,
        false,
      )?.action,
      "handoff",
    );
    delete process.env.PAYMENT_BROWSER_DEMO_PASSWORD;
    assert.equal(hostedDemoPlan(login, invoice, false)?.action, "handoff");
  } finally {
    if (email === undefined) delete process.env.PAYMENT_BROWSER_DEMO_EMAIL;
    else process.env.PAYMENT_BROWSER_DEMO_EMAIL = email;
    if (password === undefined)
      delete process.env.PAYMENT_BROWSER_DEMO_PASSWORD;
    else process.env.PAYMENT_BROWSER_DEMO_PASSWORD = password;
  }
});

test("demo actions select the requested invoice, sample data and one-time authorization only", () => {
  assert.equal(
    localPlan(
      view([
        control("self", "Pay a bill", {
          tag: "a",
          href: "https://demo.example",
        }),
      ]),
    ),
    null,
  );
  assert.equal(
    hostedDemoPlan(
      view([
        control("wrong", "Pay bill BILL-10010"),
        control("right", "Pay bill BILL-1001"),
      ]),
      invoice,
      true,
    )?.target,
    "right",
  );
  const form = view([
    control("sample", "Use sample details"),
    control("bank", "Bank account number", {
      tag: "input",
      type: "text",
      filled: false,
    }),
    control("once", "I authorize this simulated one-time ACH payment", {
      tag: "input",
      type: "checkbox",
      checked: false,
    }),
    control("recurring", "Enroll in autopay", {
      tag: "input",
      type: "checkbox",
      checked: false,
    }),
  ]);
  assert.equal(hostedDemoPlan(form, invoice, true)?.target, "sample");
  form.controls[1].filled = true;
  assert.equal(hostedDemoPlan(form, invoice, true)?.target, "once");
  form.controls[2].checked = true;
  assert.equal(hostedDemoPlan(form, invoice, true), null);
});

test("cross-page account proof and exact invoice/amount are required, zero fees are accepted", () => {
  assert.equal(
    verifyHostedAccount("Example Services Account number 2000456702", invoice),
    true,
  );
  assert.equal(
    verifyHostedAccount(
      "Unrelated Services Account number 2000456702",
      invoice,
    ),
    false,
  );
  assert.throws(() =>
    verifyHostedAccount("Example Services Account number 2000456703", invoice),
  );
  assert.doesNotThrow(() =>
    verifyHostedSummary(
      "Bill number BILL-1001 Fee $0.00 Total $518.70",
      invoice,
      true,
    ),
  );
  for (const text of [
    "Bill BILL-10010 Total $518.70",
    "Bill BILL-1001 Total $518.71",
    "Bill BILL-1001 Fee $2.00 Total $518.70",
  ])
    assert.throws(() => verifyHostedSummary(text, invoice, true));
  assert.throws(() =>
    verifyHostedSummary("Bill BILL-1001 Total $518.70", invoice, false),
  );
  assert.equal(
    localPlan(
      view(
        [],
        "Payment complete. Confirmation number\nPAY-123456\nBill number BILL-1001 Amount $518.70",
      ),
    )?.receipt,
    "PAY-123456",
  );
});
