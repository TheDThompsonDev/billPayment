# Engineering audit — October 12, 2026

## Assessment

This is a capable local demonstration with a sound domain foundation. It is not ready to operate as a hosted or real-money payment product. The most valuable existing decisions are integer-cent money, deterministic approval/payment gates, database-enforced duplicate identity, transactionally recorded state changes, and meaningful negative-path integration tests. Those boundaries should survive future refactoring.

Scope: source/configuration review, dependencies, API/upload handling, payment lifecycle concurrency, React data flow, repository hygiene, TypeScript, unit/integration tests, production build, and local Chromium workflows. This is a single-reviewer engineering audit, not a penetration test, comprehensive accessibility assessment, load test, or certification. No real vendor payment or dedicated paid model evaluation was requested or performed. The baseline workflow tests inherited local configuration, so incidental website-discovery API requests cannot be ruled out; subsequent runs explicitly isolate that configuration.

## Defects fixed

| Priority | Finding and consequence                                                                                                                                                                                                         | Resolution                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Payment-navigation recovery wrote state using only the bill ID. A delayed worker could overwrite a newer run; timeout did not revoke its pre-submission token. A destination could also change between reading and claiming it. | Claims compare the destination/version; timeout, discovery completion, failure, resume, and receipt finalization check the relevant state/token. Pre-submission expiry revokes the token. Late failures cannot overwrite a newer run or settlement. See `src/services/payment-navigation.ts`. |
| P1       | Upload size was checked using optional `Content-Length` before `formData()` buffered the body. JSON mutations had no application body bound.                                                                                    | `src/lib/request-body.ts` counts streamed bytes, cancels oversize input, limits multipart bodies to 11 MiB with a separate 10 MiB file cap, and limits JSON to 64 KiB. Oversize requests return 413. Reverse-proxy connection/rate limits are still a deployment requirement.                 |
| P2       | Upload files were left behind when database creation failed.                                                                                                                                                                    | Failed persistence now removes the just-created file and reports cleanup failures to the server log.                                                                                                                                                                                          |
| P2       | Both the initial React payload and bill polling response included the machine's absolute document path and internal document hash.                                                                                              | A shared presentation function omits storage paths, hashes, and navigation tokens; the UI receives `hasDocument`. Polling explicitly uses `no-store`, with consistent payment-attempt ordering. This remains a redacted ORM response, not a fully versioned public API.                       |
| P2       | Chromium could remain open after context/session setup failed, or evidence capture threw.                                                                                                                                       | Browser lifetime is protected by an outer `finally`, including initialization and evidence failures.                                                                                                                                                                                          |
| P2       | Session replacement deleted the old session before creating the next; expired sessions accumulated.                                                                                                                             | Rotation and expired-session cleanup now share a database transaction. Demo identity semantics are unchanged.                                                                                                                                                                                 |
| P2       | Workflow tests could inherit model/payment configuration, accumulated test databases, and reused process-ID filenames.                                                                                                          | Tests explicitly disable live/model configuration and use unique temporary directories, cleaned after disconnect. Existing historical storage is preserved.                                                                                                                                   |
| P2       | No lint/format gate or CI; TypeScript recursively included scratch files under ignored storage.                                                                                                                                 | Added supported ESLint/TypeScript/React Hooks checks, formatting checks, editor settings, route-type generation, bounded TS inputs, and a GitHub Actions verification workflow. Fixed the reported lint errors and removed hook-dependency suppressions.                                      |
| P3       | The dashboard labeled all properties as active, including pending properties.                                                                                                                                                   | The displayed count now filters to `ACTIVE`.                                                                                                                                                                                                                                                  |

Dependency cleanup also replaced the umbrella `radix-ui` import with the already-declared Slot package, removing 71 installed packages. `pdf-lib`, used only by fixture/evaluation/test code, is now a development dependency. E2E screenshots now use Playwright's per-test output directory instead of overwriting documentation images. The first browser run refreshed five existing documentation captures before this behavior was corrected; historical backups and uploaded documents were not deleted.

## Remaining findings, ordered by deployment impact

### P1 — Demo identities and unrestricted reads block hosting

`src/services/session.ts` defaults to the analyst when a session is absent or expired. `src/app/api/session/route.ts` permits switching to any seeded role without authentication. Bill, document, and browser-evidence GET handlers do not enforce user/property access. Same-origin mutation checks are useful CSRF protection for the local demo; they are not authentication. Before hosting: introduce an identity provider, default-deny server authorization, property/organization scope, session revocation, and tests for unauthorized reads and mutations. Keep the persona selector confined to an explicit demo deployment.

### P1 — Live browser execution needs a stronger trust boundary

`src/services/browser-payment-agent.ts` allows external execution with `PAYMENT_BROWSER_LIVE_ENABLED=true`. It relies on rendered text, selected controls, and payment-label heuristics to decide when the final submission guard must run. An unfamiliar state-changing control may not advertise its semantics in its label. DNS addresses are checked before Chromium independently resolves/connects; the check is not a pinned network connection, and the IPv4 denylist is partial. These are design limitations, not a demonstrated exploit in this audit. Before real use: enforce outbound network policy outside the page process, limit supported payment integrations, and bind irreversible actions to a deterministic provider protocol with reconciliation. Leave live execution disabled in the demo.

### P1 — Request-driven work is not durable processing

`src/components/bill-detail.tsx` advances the workflow from client requests. Navigation, model calls, and payment handling can outlive a request or stop when the page closes. Existing UNKNOWN outcomes correctly prevent blind retries, but external uncertain payment reconciliation is still incomplete. Production needs durable jobs, leases/cancellation, idempotency at the provider, retries limited to safe operations, and an operator reconciliation path.

### P2 — No migration history or operational recovery contract

`package.json` uses `prisma db push`; `prisma/` has no versioned migrations. Introduce and test migrations against a representative copy, backup/restore rehearsals, and deployment rollback procedures before shared data is hosted. Do not baseline or reset an existing database blindly. Current financial statuses and JSON evidence are strings in SQLite; follow with stronger persisted contracts as the schema evolves.

### P2 — Data access and components will become expensive to maintain

`src/services/queries.ts` loads every bill and related extraction before client filtering. The dashboard computes aggregates in JavaScript. `bill-detail.tsx` mixes polling, mutations, interpretation evidence, review forms, and receipt presentation in a large component; `browser-payment-agent.ts` combines browser lifecycle, network policy, planning, and verification. Next steps: server pagination/filtering and aggregate queries, explicit detail DTOs shared by API and UI, a dedicated polling hook with cancellation/stale-response protection, and modules for browser policy/planning/execution. Measure a realistic data set before claiming scalability.

### P2 — API error contracts and storage controls need another pass

Several route handlers still return arbitrary exception messages with status 400, including operational errors. Introduce typed domain errors, consistent 403/404/409/500 mapping, request IDs, and server-only diagnostic details. Add per-user quotas, connection timeouts, file retention/scanning, encrypted storage and credential handling before accepting sensitive third-party bills. The new byte cap does not replace these controls.

### P2 — This folder has no Git metadata

`git status` reported that the supplied directory is not a Git repository. History, branch policy, tracked secrets, and prior changes could not be audited. No commits, remote, or pull request were created. The CI workflow is ready for a GitHub repository but was not executed by GitHub here. Establish source control and review protections before team delivery. Ignore rules now cover environment variants, database journals/WAL/SHM files, logs, reports, coverage, and runtime storage. Existing backups and uploads were retained.

## Verification

- Baseline: 47 tests passed; TypeScript passed; npm reported zero vulnerabilities.
- Updated: 52 tests passed, including streamed-body bounds, multipart/JSON parsing, presentation redaction, and stale-worker recovery. ESLint, formatting checks, and route-type generation/TypeScript passed.
- Production build passed; all 9 Chromium tests passed in approximately two minutes. The first run exposed a hidden retained-panel selector ambiguity, corrected by checking the single accessible region. Final dependency audit: zero reported vulnerabilities. Details are in `docs/verification.md`.
- CI uses a fresh install, generated Prisma client, local Chromium, isolated SQLite, disabled paid/live paths, and a high-severity dependency audit. CI has not run remotely.

## Tooling decisions

ESLint 10 is paired with TypeScript and React Hooks rules. The standard Next.js lint config was evaluated and removed: its `fast-glob` dependency brings the unpatched [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). ESLint 9 is also [out of maintenance](https://eslint.org/version-support/). The selected setup avoids both; it does not claim Next-specific or accessibility lint coverage. Next.js conventions were checked against the installed 16.3.8 documentation, including asynchronous route params/cookies and standalone linting. No forced dependency downgrades or audit suppressions were introduced.

## Recommended sequence

1. Establish Git review/CI and keep `npm run verify` green.
2. Separate the local demo deployment from the intended hosted product; implement identity and property-scoped access before hosting.
3. Add migrations, durable processing, constrained payment integration, and operator reconciliation before moving real money.
4. Address pagination, typed API contracts, component boundaries, observability, storage retention, and measured accessibility/performance.
