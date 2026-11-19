// Read-only payment previews: signs into configured fictional portals, then
// throws at the beforeSubmit boundary. No final payment is sent or data reset.
import { writeFile, mkdir } from "node:fs/promises";
import { executeBrowserPayment } from "../src/services/browser-payment-agent";

async function main() {
  const cases = [
    {
      id: "brightwater",
      vendorName: "Brightwater Water & Sewer",
      accountNumber: "2000456701",
      amountCents: 32416,
    },
    {
      id: "northline",
      vendorName: "Northline Business Internet",
      accountNumber: "2000456703",
      amountCents: 27995,
    },
  ];
  const results = [];
  for (const item of cases) {
    const steps: string[] = [];
    let reachedReview = false;
    let error = "";
    try {
      await executeBrowserPayment({
        destination: `https://${item.id}-utility-demo.vercel.app/`,
        runToken: "preview-only",
        invoice: {
          billId: `hosted-preview-${item.id}`,
          accountId: `hosted-preview-${item.id}`,
          invoiceNumber: "BILL-1001",
          ...item,
        },
        step: async (message) => {
          steps.push(message);
          console.log(`${item.id}: ${message}`);
        },
        beforeSubmit: async () => {
          reachedReview = true;
          throw new Error(
            "Preview complete; final submission intentionally not sent.",
          );
        },
      });
    } catch (e) {
      error = (e as Error).message;
    }
    results.push({ site: item.id, reachedReview, error, steps });
  }
  await mkdir("storage", { recursive: true });
  await writeFile(
    "storage/hosted-demo-previews.json",
    JSON.stringify(results, null, 2),
  );
  if (results.some((result) => !result.reachedReview)) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
