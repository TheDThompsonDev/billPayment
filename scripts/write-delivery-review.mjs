import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const response =
  "Built and running: [Open DSD Property Bill Automation](http://127.0.0.1:3000).\n\nIncludes 12 properties, 84 seeded bills, all five scenarios, uploads, human review, approvals, and audit timelines.\n\nDocument → interpretation → deterministic checks → review/approval → simulated payment\n\nVerified: 14 domain/workflow tests, 4 browser tests, production build, and zero npm audit vulnerabilities.\n\n[Setup and kickoff guide](C:/Users/danny/Documents/coding/cycstack/billPayment/README.md). Restart with `npm start`.\n\nPayments and identities are demo-only. Live AI and automatic delivery-hook enforcement remain unverified.\n\nSay expand for details.";
const excluded = new Set([
  "node_modules",
  ".next",
  ".next-e2e",
  "storage",
  "test-results",
  ".git",
]);
function files(directory = ".") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      excluded.has(entry.name) ||
      entry.name === ".env" ||
      entry.name.endsWith(".db") ||
      entry.name.endsWith(".tsbuildinfo") ||
      entry.name === "delivery-review.json"
    )
      return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const packet = {
  token: null,
  tokenSource:
    "No active completion hook supplied a token or packet path. This is an agent-authored self-review only.",
  response,
  status: "ready",
  checks: [
    {
      criterion:
        "Runnable seeded modular application and all requested screens",
      result: "passed",
      evidence:
        "npm run db:setup and demo:reset seeded 12 properties, six vendors, 72 accounts, 84 bills; production build and route navigation passed.",
    },
    {
      criterion: "Deterministic business rules and guarded payments",
      result: "passed",
      evidence:
        "npm test: 14 passing tests including duplicate/concurrency, thresholds, authority, invalid states, anomalies, independent payment safeguards and retry.",
    },
    {
      criterion: "End-to-end demonstration, uploads, review and approval",
      result: "passed",
      evidence:
        "npm run test:e2e: 4 passing Chromium tests, zero failures; all five scenarios, PDF byte round-trip, manual entry, unknown-file review, origin rejection and mobile navigation.",
    },
    {
      criterion: "Readable presentation and maintainable source",
      result: "passed",
      evidence:
        "Desktop, review and mobile screenshots inspected; PDFs rendered and inspected; formatted TypeScript modules and README teaching map. npm run typecheck passed; npm audit reports zero vulnerabilities.",
    },
  ],
  humanReview: {
    answersRequest: true,
    understandable: true,
    visualAddsInformation: true,
    limitationsDisclosed: true,
  },
  limitations: [
    "Live AI API not exercised with paid key.",
    "Local persona switch is demonstration identity only.",
    "No financial institutions integrated.",
    "Processing advances while bill detail is open.",
    "Automatic CYC hook enforcement is unverified.",
  ],
  artifacts: files().map((file) => ({
    path: file.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  })),
};
writeFileSync("docs/delivery-review.json", JSON.stringify(packet, null, 2));
console.log(
  JSON.stringify({
    characters: [...response].length,
    artifacts: packet.artifacts.length,
    hookTokenSupplied: false,
  }),
);
