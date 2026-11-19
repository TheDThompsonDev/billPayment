# DSD Property Bill Automation

A complete local demonstration for a six-week software development cohort. Property teams can manage hundreds of buildings, utility accounts, approval limits and payment methods. This application turns a bill into an inspectable sequence of decisions, with a normal human-review path whenever evidence is unclear.

**Probabilistic systems interpret. Deterministic systems enforce. Humans resolve uncertainty.**

**No probabilistic component can directly cause a financial state change.**

## Run locally

Use Node.js 22.13 or newer in the 22 LTS line, or Node.js 24+, and npm. From this directory:

```sh
npm ci
npm run db:setup
npm run dev
```

Open **http://127.0.0.1:3000**. Setup creates `.env` when missing, initializes SQLite, and seeds 12 properties, six vendors, 72 vendor accounts and 84 bills. The seed is repeatable and preserves existing bills. The app starts with the least-privileged AP analyst persona. All fonts are bundled locally; sample scenarios require no API key or external service.

For a presentation without development tooling:

```sh
npm run build
npm start
```

Use `npm run demo:fixtures` to regenerate the four downloadable sample PDFs and their extraction sidecars with fresh due dates. The checked-in PDFs already work for the original demo date. Scenario buttons always use a due date 21 days ahead; old uploaded PDFs correctly stop if overdue.

To rehearse again from the original ledger, **stop the server**, run `npm run demo:reset`, and restart it. Reset backs up the existing demo database to `storage/backups/` before replacing it. Uploaded documents are retained. It only targets this project's default `prisma/demo.db`; it does not reset a custom `DATABASE_URL`.

## Kickoff walkthrough

Start on **Overview**: monthly totals, current queues, recent decisions and latest bills are immediately populated. **Upload bill → Try a demo invoice** offers:

| Scenario                   | What to demonstrate                      | Expected stop/outcome                                                     |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| 01 · Routine utility       | Dallas Water, 123 Main Street, $1,842.17 | Exact account and address match, auto approval, simulated ACH, PAID       |
| 02 · Duplicate             | The same water invoice again             | REJECTED, linked original bill and transaction; no new payment            |
| 03 · Maintenance           | Reliable Plumbing, $7,500                | AWAITING_APPROVAL; Regional Manager or Director must decide               |
| 04 · Ambiguous and unusual | Incomplete Main St address, $6,842       | NEEDS_REVIEW; 87% match suggestion plus an amount above 3× history        |
| 05 · Provider failure      | Atmos Energy, $482.65                    | First attempt FAILED; Retry produces a second attempt on the same payment |

For 03, first show that Alex cannot approve. Select **Sarah · Regional manager** in the sidebar, add a decision note and click **Approve & continue**. Rejection is also available and terminal.

For 04, inspect both candidate Main Street properties and the original evidence. Choose **Dallas Water Utilities · Main Street Residences · DW-1001**, confirm/correct the amount, add a resolution note and acknowledge the verified variance if keeping $6,842. Save the correction. All checks run again; $6,842 still requires regional approval. Human review never replaces approval policy.

01 and 02 deliberately share an invoice identity; rerunning 01 becomes a duplicate until the demo is reset. 02 prepares an original through the real workflow when no original exists yet. The remaining scenario buttons generate fresh invoice numbers each run. The downloaded PDF itself keeps a fixed invoice identity, so repeated uploads are duplicates as expected.

The details page drives one server-controlled workflow step approximately every 850 ms. It shows real persisted progress, not a prerecorded animation. Leaving the page pauses further requests; opening the bill again resumes. Pending mock payments reconcile on reopening. No hidden worker, scheduler or real bank connection is needed.

## Architecture: a modular monolith

```text
Next.js UI / API routes
       |
       v
BillUnderstandingService --> BillExtraction (untrusted evidence)
       |
       v
Zod schema + confidence + exact account/address matching
       |
       v
Duplicate reservation + risk checks --> ReviewItem --> human correction
       |
       v
Confirmed Bill --> approval-policy.ts --> authorized human if required
       |
       v
Independent payment safeguards --> mock provider --> audit events
```

The app uses Next.js App Router, TypeScript, React, Tailwind CSS, shadcn/ui source components, Prisma 6 and SQLite. Important logic lives outside React:

| File                                      | Responsibility                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `src/ai/bill-understanding.ts`            | Interchangeable fixture/manual/structured AI understanding                 |
| `src/ai/samples.ts`                       | Reliable demo invoice evidence, including deliberate ambiguity             |
| `src/domain/bills/types.ts`               | Zod schemas; interpreted fields have value and confidence                  |
| `src/domain/matching/bill-matcher.ts`     | Exact matching, simulated similarity fallback, confidence gates            |
| `src/domain/bills/duplicate-check.ts`     | Normalized vendor/account/invoice identity                                 |
| `src/domain/risk/risk-evaluator.ts`       | Historical variance, overdue date, amount, account and relationship checks |
| `src/domain/approvals/approval-policy.ts` | Priority-ordered rules and authority hierarchy                             |
| `src/domain/bills/state-machine.ts`       | Allowed transitions; terminal states cannot be revived                     |
| `src/workflows/bill-workflow.ts`          | Explicit interpretation, validation, matching, risk and approval stages    |
| `src/services/human-actions.ts`           | Validated corrections, approval/rejection and retry                        |
| `src/domain/payments/payment-provider.ts` | Four mock provider implementations behind one interface                    |
| `src/services/payment-service.ts`         | Independent payment checks, one payment per bill, attempt records          |
| `src/services/audit.ts`                   | Transactional transitions and explainable audit records                    |
| `prisma/schema.prisma`                    | Data relationships and unique constraints                                  |

## What is enforced

- Extracted fields and immutable original evidence live in `BillExtraction`. Canonical `Bill` fields are written only after validation, confidence, matching, duplicate and risk checks pass. Corrections retain before/after metadata.
- Validated invoice evidence creates previously unknown vendors and accounts automatically. Names are normalized to reuse existing vendors; a new account requires one exact active property-address match (optional ZIP codes are supported). Existing account bindings, inactive flags and payment preferences are preserved. New vendors default to `OTHER` / simulated `CHECK` and follow normal approval policy. Creation and linking have their own audit events.
- A complete new street/city/state address creates a property with `PENDING_ACCEPTANCE` status. The bill announces that it created a new property and shows **Accept property** with the extracted name/address and vendor/account. Acceptance confirms only that relationship, activates the property and reruns normal validation, duplicate, risk and invoice approval checks. Pending properties are labeled in the directory and cannot be selected as active accounts or paid. Normalized addresses reuse pending records; existing conflicting accounts and inactive or ambiguous properties remain in review. Missing property names use the address; unit counts remain unset. The local parser supports US-style addresses for draft creation.
- Vendor plus exact account number is tried first after onboarding. Conflicting addresses and uncertain identities still require review. The offline similarity fallback is explicitly labeled as a demo recommendation. Review supports either an existing account or entering a new vendor/account and confirming a property; there is no fixed vendor whitelist.
- Confidence is interpreted by code: at least 95% is eligible to continue, 80–94% requires review, lower scores reject the suggestion and require manual resolution. Confidence does not waive other checks.
- Money uses integer cents. Zero, negative and fractional-cent values fail validation. Recent settled amounts are compared deterministically; more than 3× the average requires a documented variance confirmation.
- Duplicate identity is a unique database constraint, retained even after manager rejection. Concurrent workflow requests cannot reserve/pay the same identity twice. SQLite transactions, conditional status updates and a unique payment per bill protect submission.
- Policy thresholds are explicit: utilities below $2,000 auto approve; other lower amounts need a Property Manager; $5,000–$20,000 inclusive needs a Regional Manager; over $20,000 needs a Director. Property taxes always require a Director. The read-only policy page displays database policy definitions consumed by the engine.
- Payment submission independently reloads the bill, account, policies, approvals, reviews and prior payment. Caller-supplied approval, role or payment-method fields are never trusted.
- Every workflow state change creates an audit event in the same database transaction. Seeded historical payments are explicitly marked as imported synthetic ledger history, not presented as actual prior workflow executions.

## Browser payment navigation

The payment phase can now open the vendor website in Chromium, follow visible links, enter the accepted account/invoice information, review the exact amount, submit, and verify a receipt. It does not use vendor-specific selectors. Recognizable controls use a bounded deterministic planner; unfamiliar layouts can use `OPENAI_API_KEY` for structured next-action planning. The model selects a visible control and an approved invoice field, never arbitrary JavaScript, selectors, credential values or a new amount.

Invoice payment links are retained separately from financial fields. One explicit link becomes a proposed destination. A property-manager or higher persona verifies a new website; later invoices reuse that vendor destination unless their links conflict. Multiple or missing links require a destination choice. New vendors and PORTAL accounts no longer silently settle through a fake portal provider. Existing configured ACH/card/check demonstrations keep their mock provider flows.

When no invoice link or saved vendor destination exists and `OPENAI_API_KEY` is configured, the app also searches for the official vendor payment page. Only a candidate URL with an exact source citation is retained; citations are shown beside the result. Search never approves the destination. Ambiguous names, fictional vendors, missing citations and API failures remain a destination handoff. This uses the [OpenAI Responses web-search API](https://developers.openai.com/api/docs/guides/tools-web-search); the live paid API paths have not been exercised in this implementation session.

Try scenario **06 · Follow the vendor’s payment website** on Upload. Select the property-manager persona, verify the proposed local website, then approve the invoice. The app launches its own browser, follows the account lookup and payment form, records every step, and captures a screenshot and receipt. Two deliberately different local layouts (`/payment-demo/classic` and `/payment-demo/compact`) use the same navigator. No real money moves in these simulators.

Install Chromium once with `node node_modules/playwright/cli.js install chromium`. The app and the simulator must run at `PAYMENT_DEMO_ORIGIN` (default `http://127.0.0.1:3002`). Start at this port with `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3002`. Existing installations need `npx prisma db push` for the additive navigation/receipt schema; back up the database first. The October 10 update already backed up and migrated this local database without resetting invoices.

External-site execution is **disabled by default**. Configuring `PAYMENT_BROWSER_LIVE_ENABLED=true` makes approved, verified external destinations eligible for real execution; the app footer changes to identify live mode. This is an experimental local demonstration with demo personas, not production authentication or a production payment system. No real vendor payment was tested. Do not enable it against real funds without replacing demo identity and validating the particular portal, funding source, authorization and recovery process.

When sign-in is needed, run `node --env-file=.env --import tsx scripts/connect-payment-session.ts <vendor-account-id>` to sign in manually and save an account-specific browser session under ignored `storage/browser-sessions`. Passwords and MFA codes are never supplied to the planner. The browser uses that session on the next run. Additional payment processor origins require explicit `PAYMENT_BROWSER_ALLOWED_ORIGINS` configuration. The navigator stops for missing information, CAPTCHA/MFA, unsupported frames/controls, unapproved origins, differing totals/fees or unverifiable receipts. It does not assume it can operate every website. Supported external pages must use public HTTPS; the current network guard conservatively rejects IPv6-only hosts.

Submission is reserved in SQLite immediately before the final click, after rechecking approval, duplicates, account and amount. A unique navigation claim prevents concurrent workers; a unique payment and portal receipt prevent duplicates. If the browser fails before submission, **Resume browser payment** may retry. If it fails after reservation, the outcome is **UNKNOWN** and automatic retries are disabled. Local receipts can be reconciled against the simulator ledger after interruption; external uncertain outcomes require manual reconciliation and are not implemented as a blind retry. The bill is marked PAID only after verified receipt evidence. Steps, handoffs and receipt IDs are audited; browser screenshots remain local under `storage/payment-evidence`.

## Hosted fictional payment portals

The local simulator and hosted demo vendors are separate execution modes. Configure `PAYMENT_BROWSER_DEMO_ORIGINS` as comma-separated **exact HTTPS origins**, plus `PAYMENT_BROWSER_DEMO_EMAIL` and `PAYMENT_BROWSER_DEMO_PASSWORD` with the portals' published test login. The current local configuration registers the ten fakeElectric company-suite sites and Fieldstone. A hostname containing "demo" is not enough; subdomains and lookalike suffixes do not inherit permission. Real payment execution remains disabled.

Registered demos use visible controls to sign in, find the approved invoice, use the site's sample payment details, authorize only a one-time simulated payment, and capture its receipt. The browser establishes vendor/account identity on the account page, requires the matching invoice and exact amount before submission and on the receipt, accepts explicit zero fees, and rejects additional charges. No vendor-specific selectors or payment endpoints are used for execution. The navigation model can select only a control ID present in the current snapshot. Self-links are excluded, rendered text preserves invoice boundaries, and async page/receipt rendering is awaited. Hosted demos never receive local simulator run tokens and do not use its local receipt ledger.

`node --env-file=.env --import tsx scripts/verify-hosted-demo-preview.ts` checks Brightwater and Northline through final submission readiness, deliberately stopping at the submission guard without paying or resetting data. These demos must retain their initial unpaid bills for the script's expectations to hold. Copper Ridge bill BILL-1001 was actually paid through its hosted browser UI on October 10, 2026: $518.70, receipt PAY-DB61770F. Both remote ledger and local workflow agree, with one successful attempt. See `docs/hosted-demo-results.json`. Other registered domains have not all been executed end to end.

## Document understanding and AI (extraction)

PDF, PNG and JPEG uploads up to 10 MB are accepted after a byte-signature check. Files are stored outside `public/`, under random names in `storage/`, and served by a document route. Included demo PDFs are recognized by SHA-256 of their bytes, never by filenames. All other uploads default to document AI: original PDF pages or image bytes are sent to the model, with a strict field-and-source schema. Interpretation uses layout and meaning rather than a growing list of vendor or label patterns.

Each returned field includes confidence, a supporting passage and page number. These are model-reported sources, not independent proof. Missing or conflicting values remain unresolved. Non-invoice documents are rejected. The bill page exposes the sources; **Re-read document** preserves the previous fields and source report in audit history and reruns validation. New properties still require acceptance, and invoice approval/payment checks remain separate.

For general document interpretation, set these locally in `.env` and restart:

```dotenv
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-4.1-mini
```

Missing configuration, connection errors, quota limits, refusals and incomplete responses produce reader-specific errors, never a silent regex fallback. Files remain saved for retry or manual entry. The model has no database tools or payment/approval capability. Responses use `store: false`; API use requires network access and incurs the configured provider's charges.

For deliberately limited offline demonstrations only, set `BILL_EXTRACTION_MODE=offline`. That opt-in text parser recognizes supported labels and cannot interpret scans/images or arbitrary layouts. Its utility-statement reference derivation is a demo behavior; the AI reader leaves absent invoice identifiers unresolved. Fixture scenarios and manual entry require no key.

Run `node --env-file=.env --import tsx scripts/evaluate-document-reader.ts` for the opt-in live evaluation. It sends three fictional fixture PDFs, an image-only rendering, an unseen two-page invoice, a missing-deadline invoice and a resume. It checks exact expected fields, page evidence and rejection behavior, writing results to ignored `storage/reader-evaluation/results.json`. All seven passed on October 10, 2026 with `gpt-4.1-mini`. This is a small evaluation corpus, not a guarantee for every document. `npm test` covers routing, transport and schema failures without paid calls.

Official references: [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [file inputs](https://developers.openai.com/api/docs/guides/file-inputs).

## Payment simulation and demo identity

Only `MockACHProvider`, `MockCreditCardProvider`, `MockCheckProvider` and `MockPortalProvider` are registered. They generate `SIM-...` references and use a repeatable first-attempt failure for scenario 05. Successful settlement waits at least 1.1 seconds. `getStatus` derives the result from the mock reference, so process restarts do not lose provider state. This deliberately avoids random presentation failures.

The persona selector creates an opaque, HTTP-only, same-site session referencing a seeded user. Approval authority is checked on the server. **This is a local demo persona switch, not production authentication.** Mutation origins are restricted to loopback hosts. Do not expose it as a multi-tenant financial system. Production would need real authentication, property-scoped authorization, encrypted document storage, malware scanning, secrets management and retention controls. SQLite and the stage-per-request runner are chosen for a teachable single-host demo. Audit records are inspectable, not cryptographically tamper-proof.

The provider call is transaction-local because all providers are side-effect-free mocks. A real provider needs an outbox/worker and provider-enforced idempotency plus reconciliation; do not put an irreversible external payment call into a database transaction and assume rollback can undo it.

## Verification

The [October 12 engineering audit](docs/engineering-audit.md) records fixed defects, remaining production blockers, and the next engineering priorities. This is a local demonstration with explicit demo personas; a passing build does not make it a production payment system.

```sh
npm run check       # lint, formatting, route types/TypeScript, unit + SQLite tests
npm run test:e2e    # production build + isolated DB + Chromium on port 3001
npm run verify      # both checks above; also run in .github/workflows/ci.yml
npm run format      # apply the shared source/configuration formatting
npm audit           # check the locked dependency tree against current advisories
```

If Chromium is not installed, run `npx playwright install chromium`. E2E tests never reset the presentation database. The tests cover duplicate identity, confidence boundaries, approval thresholds/roles, invalid transitions, payment safeguards, anomalies, concurrent submission, persisted reload, manual entry, original-file upload, unknown documents, rejection of invalid files/origins, all five scenarios and mobile navigation. See `docs/verification.md` for executed results and limitations.

Run `npx prisma generate` after installing dependencies if the generated client is missing. Workflow tests create a temporary directory beneath `storage/` and remove it on completion; E2E databases and screenshots remain there for diagnosis. Existing uploads, browser sessions, and database backups are application data, not disposable build output. Keep `.env*`, storage, SQLite sidecar files, and test reports out of source control; `.env.example` is the configuration template.

## Ideas for students

Replace the extraction adapter, add a bounded read-only investigation agent, build property-scoped approval permissions, add vendor account onboarding, introduce a queue worker, or improve the matching evidence. Keep the deterministic gates and test the negative paths. A model suggesting a plausible answer is not evidence that the application should move money.
