import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseDestination,
  destinationURL,
} from "../src/domain/payments/payment-destination";
import {
  localPlan,
  verifyPaymentSummary,
} from "../src/services/browser-payment-agent";
import { parseInvoiceText } from "../src/ai/pdf-text-understanding";
import { readWebsiteCandidate } from "../src/ai/payment-website-discovery";
test("website lookup requires a cited exact URL and rejects unsupported or ambiguous suggestions", () => {
  const content = (text: string, annotations: object[] = []) => ({
    output: [{ content: [{ type: "output_text", text, annotations }] }],
  });
  assert.equal(
    readWebsiteCandidate(content("PAYMENT_URL: https://vendor.example/pay"))
      .destination,
    null,
  );
  assert.equal(
    readWebsiteCandidate(
      content("PAYMENT_URL: https://vendor.example/pay", [
        { type: "url_citation", url: "https://vendor.example/" },
      ]),
    ).destination,
    null,
  );
  assert.equal(
    readWebsiteCandidate(
      content("PAYMENT_URL: https://vendor.example/pay", [
        {
          type: "url_citation",
          url: "https://vendor.example/pay",
          title: "Vendor payments",
        },
      ]),
    ).destination,
    "https://vendor.example/pay",
  );
  assert.equal(readWebsiteCandidate(content("NOT_FOUND")).destination, null);
});
test("payment link evidence is separate from financial fields and never invents a website", () => {
  assert.deepEqual(
    parseInvoiceText(
      "Pay online at https://electric.example/billing.\nHelp https://support.example/",
    ).paymentUrls,
    ["https://electric.example/billing"],
  );
  assert.deepEqual(parseInvoiceText("Please mail a check").paymentUrls, []);
});
test("destination discovery reuses verified sites but changed or multiple links require verification", () => {
  assert.equal(
    chooseDestination(["https://a.example/pay"], null).status,
    "NEEDS_DESTINATION",
  );
  assert.equal(
    chooseDestination(["https://a.example/pay"], "https://a.example/pay")
      .status,
    "READY",
  );
  assert.equal(
    chooseDestination(["https://b.example/pay"], "https://a.example/pay")
      .status,
    "NEEDS_DESTINATION",
  );
  assert.equal(
    chooseDestination(["https://a.example/pay", "https://b.example/pay"], null)
      .destination,
    null,
  );
  assert.equal(chooseDestination([], null).destination, null);
  assert.equal(
    chooseDestination(["http://127.0.0.1/private"], "https://a.example/pay")
      .status,
    "NEEDS_DESTINATION",
  );
});
test("unsafe schemes, credentials and local network destinations are rejected", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://example.com/pay",
    "https://name:password@example.com/pay",
    "https://127.0.0.1/pay",
    "https://localhost/pay",
    "https://[::1]/pay",
    "https://example.com:8443/pay",
    "http://127.0.0.1:3002/api/bills",
  ])
    assert.throws(() => destinationURL(url));
  assert.equal(
    destinationURL("http://127.0.0.1:3002/payment-demo/classic").isDemo,
    true,
  );
});
test("browser requires matching account and exact amount, refuses fees and conflicting totals", () => {
  const invoice = { accountNumber: "CV-875", amountCents: 38742 };
  assert.doesNotThrow(() =>
    verifyPaymentSummary("Account CV-875 Total $387.42", invoice),
  );
  for (const text of [
    "Account OTHER Total $387.42",
    "Account CV-875 Total $387.43",
    "Account CV-875 Total $387.42 Fee $2.00",
  ])
    assert.throws(() => verifyPaymentSummary(text, invoice));
});
test("browser stops for login and recognizes a receipt only from visible page evidence", () => {
  assert.equal(
    localPlan({
      url: "https://example.com",
      text: "Sign in",
      controls: [
        {
          id: "p",
          tag: "input",
          type: "password",
          label: "Password",
          value: "",
          href: "",
        },
      ],
    })?.action,
    "handoff",
  );
  assert.equal(
    localPlan({
      url: "https://example.com",
      text: "Payment complete Receipt reference: DEMO-123456",
      controls: [],
    })?.receipt,
    "DEMO-123456",
  );
  assert.equal(
    localPlan({
      url: "https://example.com",
      text: "Payment complete",
      controls: [],
    }),
    null,
  );
});
