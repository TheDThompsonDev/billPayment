import { chromium } from "playwright";
import { createInterface } from "node:readline/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/database/client";
import { destinationURL } from "../src/domain/payments/payment-destination";

async function main() {
  const accountId = process.argv[2];
  if (!accountId)
    throw new Error(
      "Usage: node --env-file=.env --import tsx scripts/connect-payment-session.ts <vendor-account-id>",
    );
  const account = await db.vendorAccount.findUniqueOrThrow({
    where: { id: accountId },
    include: { vendor: true },
  });
  if (!account.vendor.portalUrl)
    throw new Error("Verify this vendor’s payment website on a bill first.");
  const { url, isDemo } = destinationURL(account.vendor.portalUrl);
  if (isDemo) throw new Error("The local simulator needs no sign-in.");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(url);
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await terminal.question(
      `Sign in to ${account.vendor.name} in the opened browser. Do not make a payment. Press Enter here after sign-in to save the session locally. `,
    );
    terminal.close();
    const directory = path.resolve(
      process.env.PAYMENT_BROWSER_STATE_DIR || "storage/browser-sessions",
    );
    await mkdir(directory, { recursive: true });
    await context.storageState({
      path: path.join(directory, `${account.id}.json`),
    });
    console.log(
      "Session saved. Treat browser state as a credential; it stays in ignored local storage.",
    );
  } finally {
    await browser.close();
  }
}
main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
