import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

test("new property notice survives reload and acceptance resumes normal invoice approval", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/upload");
  await page.getByRole("tab", { name: "Upload a document" }).click();
  await page
    .getByLabel("Invoice file")
    .setInputFiles(path.resolve("tests/fixtures/alder-creek-bill.pdf"));
  await page.getByRole("button", { name: "Upload and process" }).click();
  const notice = page.getByRole("heading", {
    name: "We've created a new property from this invoice.",
  });
  await expect(notice).toBeVisible({ timeout: 20000 });
  const billUrl = page.url();
  const billId = billUrl.split("/").pop()!;
  const before = await (await page.request.get(`/api/bills/${billId}`)).json();
  expect(before.hasDocument).toBe(true);
  expect(before.documentPath).toBeUndefined();
  expect(before.documentHash).toBeUndefined();
  expect(before.proposedProperty.name).toBe("Alder Creek Workshop");
  expect(before.proposedProperty.status).toBe("PENDING_ACCEPTANCE");
  expect(before.payment).toBeNull();
  await page.reload();
  await expect(notice).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("property-notice-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/properties");
  const property = page
    .locator(".property-card")
    .filter({ hasText: "Alder Creek Workshop" });
  await expect(property).toContainText("Pending acceptance");
  await property
    .getByRole("link", { name: "Review & accept property" })
    .click();
  await expect(page).toHaveURL(billUrl);
  await page.screenshot({
    path: test.info().outputPath("property-notice-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Accept property", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Property manager sign-off" }),
  ).toBeVisible({ timeout: 20000 });
  const after = await (await page.request.get(`/api/bills/${billId}`)).json();
  expect(after.property.name).toBe("Alder Creek Workshop");
  expect(after.property.status).toBe("ACTIVE");
  expect(after.account.number).toBe("2000456700");
  expect(after.vendor.name).toBe("Alder Creek Landscaping");
  expect(after.payment).toBeNull();
  expect(
    after.events.some(
      (event: { type: string }) => event.type === "PROPERTY_ACCEPTED",
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(".accepted-panel")).toContainText(
    "Alder Creek Workshop",
  );
  expect(errors).toEqual([]);
});

test("JSON request limits reject large bodies before any bill mutation", async ({
  request,
}) => {
  const response = await request.post("/api/bills", {
    headers: { Origin: "http://127.0.0.1:3001" },
    data: { sample: "happy", padding: "x".repeat(65 * 1024) },
  });
  expect(response.status()).toBe(413);
  expect(await response.json()).toEqual({ error: "Request body is too large" });
});

async function textPDF(lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) =>
    page.drawText(line, { x: 40, y: 750 - i * 22, font, size: 12 }),
  );
  return Buffer.from(await doc.save());
}
async function scenario(page: Page, name: string) {
  await page.goto("/upload");
  await page
    .locator(".sample-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "Run scenario" })
    .click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
}
test("all five scenarios, review, approval authority, reload and failure recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await scenario(page, "A routine utility bill");
  await expect(
    page.getByText("Payment completed. Every decision accounted for."),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".accepted-panel")).toContainText("DW-1001");
  const happy = page.url();
  await page.reload();
  await expect(
    page.getByText("Payment completed. Every decision accounted for."),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("happy-path.png"),
    fullPage: true,
  });
  await scenario(page, "The same invoice, twice");
  await expect(
    page
      .locator(".red-banner")
      .getByText("Duplicate invoice blocked", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".red-banner a")).toHaveAttribute(
    "href",
    new URL(happy).pathname,
  );
  await scenario(page, "A repair that needs a sign-off");
  await expect(
    page.getByRole("heading", { name: "Regional manager sign-off" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText("Your AP persona does not have the required authority.", {
      exact: false,
    }),
  ).toBeVisible();
  const id = page.url().split("/").pop()!;
  const forbidden = await page.request.post(`/api/bills/${id}`, {
    headers: { Origin: "http://127.0.0.1:3001" },
    data: { action: "approve", note: "Attempt unauthorized approval" },
  });
  expect(forbidden.status()).toBe(400);
  await page.getByLabel("Demo persona").selectOption("regional");
  await expect(
    page.getByRole("button", { name: "Approve & continue" }),
  ).toBeVisible();
  await page
    .getByLabel("Decision note")
    .fill("Confirmed completed plumbing repair with property team.");
  await page.getByRole("button", { name: "Approve & continue" }).click();
  await expect(
    page.getByText("Payment completed. Every decision accounted for."),
  ).toBeVisible({ timeout: 15000 });
  await scenario(page, "Something doesn’t add up");
  await expect(
    page.getByRole("heading", { name: "A little human judgment is needed." }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".review-reasons")).toContainText(
    "historical average",
  );
  await expect(page.locator(".suggestions")).toContainText("87%");
  await page.screenshot({
    path: test.info().outputPath("review-workflow.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Confirmed vendor / property account")
    .selectOption("water-main");
  await page
    .getByLabel("Resolution note")
    .fill("Verified meter and a repaired leak; original amount is correct.");
  await page.getByLabel("I verified the amount").check();
  await page
    .getByRole("button", { name: "Save correction & rerun checks" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Regional manager sign-off" }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByLabel("Decision note")
    .fill("Verified leak repair and approved the unusual usage.");
  await page.getByRole("button", { name: "Approve & continue" }).click();
  await expect(
    page.getByText("Payment completed. Every decision accounted for."),
  ).toBeVisible({ timeout: 15000 });
  await scenario(page, "When a payment fails");
  await expect(page.getByRole("button", { name: "Retry payment" })).toBeVisible(
    { timeout: 20000 },
  );
  await page.getByRole("button", { name: "Retry payment" }).click();
  await expect(
    page.getByText("Payment completed. Every decision accounted for."),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".payment-attempt")).toHaveCount(2);
  expect(errors).toEqual([]);
});
test("navigation, search, filters, original PDF upload and manual entry", async ({
  page,
}) => {
  for (const route of [
    "/",
    "/bills",
    "/review",
    "/approvals",
    "/properties",
    "/vendors",
    "/policies",
    "/upload",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  }
  await page.goto("/bills");
  await page
    .getByRole("textbox", { name: "Search bills", exact: true })
    .fill("NO-SUCH-INVOICE");
  await expect(
    page.getByRole("heading", { name: "No bills here" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search bills", exact: true })
    .fill("");
  await page.getByLabel("Filter by status").selectOption("NEEDS_REVIEW");
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
  await expect(page.locator("tbody")).not.toContainText("Paid");
  await page.goto("/upload");
  await page.getByRole("tab", { name: "Upload a document" }).click();
  await page
    .getByLabel("Invoice file")
    .setInputFiles(path.resolve("public/samples/approval.pdf"));
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  await expect(
    page.locator('iframe[title="Original uploaded invoice"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Regional manager sign-off" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".evidence-panel")).toContainText("SHA-256");
  const doc = await page.request.get(
    `/api/documents/${page.url().split("/").pop()}`,
  );
  expect(doc.status()).toBe(200);
  expect(
    (await doc.body()).equals(readFileSync("public/samples/approval.pdf")),
  ).toBe(true);
  await page.goto("/upload");
  await page.getByRole("tab", { name: "Enter manually" }).click();
  await page.getByLabel("Vendor name", { exact: true }).fill("Oncor");
  await page.getByLabel("Vendor account number").fill("ON-1001");
  await page
    .getByLabel("Invoice number", { exact: true })
    .fill(`E2E-${Date.now()}`);
  await page.getByLabel("Amount (USD)").fill("642.15");
  await page.getByLabel("Due date", { exact: true }).fill("2099-10-20");
  await page.getByLabel("Service address").fill("123 Main Street, Dallas, TX");
  await page.getByRole("button", { name: "Create and process bill" }).click();
  await expect(page.locator(".browser-payment-panel")).toContainText(
    "NEEDS DESTINATION",
    { timeout: 20000 },
  );
  await page.getByLabel("Demo persona").selectOption("manager");
  await page
    .getByRole("button", { name: "Use local payment simulator" })
    .click();
  await page.getByRole("button", { name: "Verify destination & save" }).click();
  await expect(
    page.getByText("Payment completed. Every decision accounted for."),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".payment-panel")).toContainText("Attempt 1");
});
test("unreadable fields stop for review, new vendor correction works, invalid file and cross-origin mutation rejected", async ({
  page,
}) => {
  await page.goto("/upload");
  await page.getByRole("tab", { name: "Upload a document" }).click();
  // Missing evidence must remain in review even though arbitrary text PDFs are now supported.
  const unknown = await textPDF([
    "Unstructured invoice needing human confirmation",
  ]);
  await page.getByLabel("Invoice file").setInputFiles({
    name: "unknown.pdf",
    mimeType: "application/pdf",
    buffer: unknown,
  });
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(
    page.getByRole("heading", { name: "A little human judgment is needed." }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".review-reasons")).toContainText(
    "Missing information",
  );
  await page.getByRole("button", { name: "Re-read document" }).click();
  await expect(
    page.getByRole("button", { name: "Re-read document" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "A little human judgment is needed." }),
  ).toBeVisible();
  await page.getByLabel("Vendor account setup").selectOption("invoice");
  await page
    .getByLabel("Vendor name", { exact: true })
    .fill("Orchard Window Cleaning");
  await page.getByLabel("Account number", { exact: true }).fill("OWC-899");
  await page.getByLabel("Confirmed property").selectOption("oak");
  await page.getByLabel("Invoice number", { exact: true }).fill("OWC-2026-1");
  await page.getByLabel("Confirmed amount (USD)").fill("675");
  await page.getByLabel("Confirmed due date").fill("2099-10-20");
  await page
    .getByLabel("Resolution note")
    .fill("Confirmed supplier and property from original document");
  await page
    .getByRole("button", { name: "Save correction & rerun checks" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Property manager sign-off" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".accepted-panel")).toContainText("OWC-899");
  const rejected = await page.request.post("/api/bills", {
    headers: { Origin: "https://untrusted.example" },
    data: { sample: "happy" },
  });
  expect(rejected.status()).toBe(400);
  const invalid = await page.request.post("/api/bills", {
    headers: { Origin: "http://127.0.0.1:3001" },
    multipart: {
      file: {
        name: "fake.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not an invoice"),
      },
    },
  });
  expect(invalid.status()).toBe(400);
});

test("novel vendor PDF automatically creates account, awaits approval, pays and blocks duplicate", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const bytes = await textPDF([
    "Vendor: Blue Horizon Electric",
    "Account number: BHE-875",
    "Invoice number: BHE-OCT-2099",
    "Amount due: $2,418.73",
    "Due date: October 20, 2099",
    "Service address:",
    "Oak Avenue Apartments",
    "875 Oak Avenue",
    "Plano, TX 75074",
  ]);
  async function upload() {
    await page.goto("/upload");
    await page.getByRole("tab", { name: "Upload a document" }).click();
    await page.getByLabel("Invoice file").setInputFiles({
      name: "novel-electric.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
    await page.getByRole("button", { name: "Upload and process" }).click();
    await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  }
  await upload();
  await expect(
    page.getByRole("heading", { name: "Property manager sign-off" }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".accepted-panel")).toContainText("BHE-875");
  await expect(page.locator(".evidence-panel")).toContainText("Local PDF text");
  await expect(
    page.getByText("New vendor created: Blue Horizon Electric", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("new-vendor-onboarding.png"),
    fullPage: true,
  });
  const billURL = page.url();
  await page.goto("/vendors");
  await expect(
    page.getByText("Blue Horizon Electric", { exact: true }),
  ).toBeVisible();
  await page.goto(billURL);
  await page.getByLabel("Demo persona").selectOption("manager");
  await page
    .getByRole("button", { name: "Use local payment simulator" })
    .click();
  await page.getByRole("button", { name: "Verify destination & save" }).click();
  const paymentPanel = page.getByRole("region", {
    name: "Payment website navigation",
  });
  await expect(paymentPanel).toHaveCount(1);
  await expect(paymentPanel).toContainText("READY");
  await page
    .getByLabel("Decision note")
    .fill("Confirmed invoice and newly established supplier account");
  await page.getByRole("button", { name: "Approve & continue" }).click();
  await expect(
    page.getByText("Payment completed. Every decision accounted for."),
  ).toBeVisible({ timeout: 20000 });
  await upload();
  await expect(
    page
      .locator(".red-banner")
      .getByText("Duplicate invoice blocked", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
});

test("browser payment follows a second portal layout and records a durable receipt", async ({
  page,
}) => {
  await scenario(page, "Follow the vendor’s payment website");
  await expect(
    page.getByRole("heading", { name: "Property manager sign-off" }),
  ).toBeVisible({ timeout: 20000 });
  const id = page.url().split("/").pop()!;
  const denied = await page.request.post(`/api/bills/${id}`, {
    headers: { Origin: "http://127.0.0.1:3001" },
    data: {
      action: "destination",
      data: { url: "http://127.0.0.1:3001/payment-demo/compact" },
    },
  });
  expect(denied.status()).toBe(400);
  await page.getByLabel("Demo persona").selectOption("manager");
  await page
    .getByLabel("Verified vendor payment URL")
    .fill("http://127.0.0.1:3001/payment-demo/compact");
  await page.getByRole("button", { name: "Verify destination & save" }).click();
  await expect(page.locator(".browser-payment-panel")).toContainText("READY");
  const unreserved = await page.request.post("/api/payment-demo/pay", {
    data: {
      billId: id,
      account: "CV-875",
      invoice: "anything",
      amountCents: 38742,
    },
  });
  expect(unreserved.status()).toBe(400);
  await page
    .getByLabel("Decision note")
    .fill("Verified service and vendor payment destination.");
  await page.getByRole("button", { name: "Approve & continue" }).click();
  await expect(
    page.getByText("Payment completed. Every decision accounted for."),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".browser-receipt")).toContainText("DEMO-");
  await expect(page.locator(".browser-steps")).toContainText("Make a payment");
  await expect(page.locator(".browser-steps")).toContainText(
    "Fill Customer account number",
  );
  const response = await page.request.get(`/api/bills/${id}`);
  const bill = await response.json();
  expect(bill.navigation.status).toBe("SUCCEEDED");
  expect(bill.navigation.runToken).toBeUndefined();
  expect(bill.payment.externalId).toBe(bill.navigation.receipt);
  expect(bill.payment.attempts).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".browser-receipt")).toContainText(
    bill.navigation.receipt,
  );
  await page.screenshot({
    path: test.info().outputPath("browser-payment-receipt.png"),
    fullPage: true,
  });
  const image = await page.request.get(`/api/bills/${id}/browser-evidence`);
  expect(image.status()).toBe(200);
});
test("mobile navigation and layouts have no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/",
    "/upload",
    "/bills",
    "/properties",
    "/vendors",
    "/policies",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      route,
    ).toBe(true);
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("combobox", { name: "Demo persona" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Vendors", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Vendors & accounts" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: test.info().outputPath("mobile-review.png"),
    fullPage: true,
  });
});

test("Brightwater upload retains every field through the real extraction and review pipeline", async ({
  page,
}) => {
  await page.goto("/upload");
  await page.getByRole("tab", { name: "Upload a document" }).click();
  await page
    .getByLabel("Invoice file")
    .setInputFiles(path.resolve("tests/fixtures/brightwater-bill.pdf"));
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  await expect(
    page.getByText("Required fields present", { exact: false }),
  ).toBeVisible({ timeout: 20000 });
  const id = page.url().split("/").pop()!;
  const bill = await (await page.request.get(`/api/bills/${id}`)).json();
  const fields = JSON.parse(bill.extraction.fields);
  expect(fields.accountNumber.value).toBe("2000456701");
  expect(fields.amount.value).toBe(324.16);
  expect(fields.serviceAddress.value).toBe(
    "125 Industrial Way, Springfield, IL 62701",
  );
  expect(fields.invoiceNumber.value).toBe("BILL-1001");
  expect(fields.dueDate.value).toBe("2026-10-16");
  expect(bill.extraction.propertyName).toBe("Brightwater Print Studio");
  expect(bill.findings).not.toContain("MISSING_INFORMATION");
  expect(bill.payment).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Brightwater Water & Sewer",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".evidence-panel")).toContainText("2000456701");
  await expect(page.locator(".evidence-panel")).toContainText("324.16");
});
