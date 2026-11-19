import {
  confirmedExtraction,
  type BillExtraction,
} from "../domain/bills/types";
export const sampleCards = [
  {
    key: "portal",
    number: "06",
    title: "Follow the vendor’s payment website",
    vendor: "Cedar Valley Services",
    amount: 38742,
    description:
      "Discover the destination, navigate its forms and capture a real demo receipt.",
    tag: "Browser payment",
  },
  {
    key: "happy",
    number: "01",
    title: "A routine utility bill",
    vendor: "Dallas Water Utilities",
    amount: 184217,
    description: "Exact match. Automatic approval. Simulated ACH payment.",
    tag: "Happy path",
  },
  {
    key: "duplicate",
    number: "02",
    title: "The same invoice, twice",
    vendor: "Dallas Water Utilities",
    amount: 184217,
    description: "An existing invoice is caught before a second payment.",
    tag: "Duplicate protection",
  },
  {
    key: "approval",
    number: "03",
    title: "A repair that needs a sign-off",
    vendor: "Reliable Plumbing",
    amount: 750000,
    description: "A valid maintenance bill waits for a Regional Manager.",
    tag: "Human approval",
  },
  {
    key: "ambiguous",
    number: "04",
    title: "Something doesn’t add up",
    vendor: "Dallas Water Utilities",
    amount: 684200,
    description:
      "An incomplete address and a bill well above its usual amount.",
    tag: "Human review",
  },
  {
    key: "failure",
    number: "05",
    title: "When a payment fails",
    vendor: "Atmos Energy",
    amount: 48265,
    description: "A mock provider declines the first attempt. Retry safely.",
    tag: "Payment recovery",
  },
];
export function sampleExtraction(key: string, suffix = ""): BillExtraction {
  const dueDate = new Date(Date.now() + 21 * 86400000)
    .toISOString()
    .slice(0, 10);
  const data = {
    vendorName: "Dallas Water Utilities",
    accountNumber: "DW-1001",
    invoiceNumber: "DW-102826-823491",
    amount: 1842.17,
    dueDate,
    serviceAddress: "123 Main Street, Dallas, TX",
  };
  if (key === "approval")
    Object.assign(data, {
      vendorName: "Reliable Plumbing",
      accountNumber: "RP-1003",
      invoiceNumber: `RP-7500${suffix}`,
      amount: 7500,
      serviceAddress: "4100 Preston Road, Frisco, TX",
    });
  if (key === "ambiguous")
    Object.assign(data, {
      accountNumber: "Unclear",
      invoiceNumber: `DW-6842${suffix}`,
      amount: 6842,
      serviceAddress: "Main St, Dallas",
    });
  if (key === "failure")
    Object.assign(data, {
      vendorName: "Atmos Energy",
      accountNumber: "AE-1002",
      invoiceNumber: `AE-482${suffix}`,
      amount: 482.65,
      serviceAddress: "875 Oak Avenue, Plano, TX",
    });
  if (key === "portal")
    Object.assign(data, {
      vendorName: "Cedar Valley Services",
      accountNumber: "CV-875",
      invoiceNumber: `CV-387${suffix}`,
      amount: 387.42,
      serviceAddress: "875 Oak Avenue, Plano, TX",
    });
  const result = confirmedExtraction(data);
  for (const field of Object.values(result)) if (field) field.confidence = 0.99;
  if (key === "ambiguous") {
    result.serviceAddress!.confidence = 0.87;
    result.accountNumber!.confidence = 0.83;
  }
  return result;
}
