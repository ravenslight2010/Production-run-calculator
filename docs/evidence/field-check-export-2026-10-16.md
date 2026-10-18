# Field-check export browser verification

- **Captured:** 2026-10-16 02:32 UTC
- **Environment:** isolated local browser fixture and disposable local PostgreSQL database; not production evidence.
- **Revision:** not recorded.
- **Command:** `npm_config_offline=true bash scripts/src/run-isolated-browser-suite.sh --config=playwright.field-checks.config.ts`
- **Outcome:** passed — 10 tests, 0 failures, 0 retries, in 3.8 minutes.

The configured `field-check-diagnostics.spec.ts` ran on Chromium and WebKit at all five requested viewports: desktop, phone portrait/landscape, and tablet portrait/landscape. The test verified safe report JSON content and suggested filename, privacy filtering, the visible injected download failure, retained observations after failure and successful retry, authorized reviewer access, and denial for an account without reviewer capability. Each run also checked that the report view did not overflow horizontally.

## Sanitized screenshots

The suite captured the safe field-check details panel for each matrix entry. These are relative, runner-generated paths under the ignored test-results directory; they show synthetic diagnostic labels and bounded timings, with no credentials, account identifiers, or browser URLs. They are local run artifacts, not committed copies.

- Chromium, desktop: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-desktop-chromium/safe-field-check-details.png`
- Chromium, phone portrait: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-phone-portrait-chromium/safe-field-check-details.png`
- Chromium, phone landscape: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-phone-landscape-chromium/safe-field-check-details.png`
- Chromium, tablet portrait: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-tablet-portrait-chromium/safe-field-check-details.png`
- Chromium, tablet landscape: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-tablet-landscape-chromium/safe-field-check-details.png`
- WebKit, desktop: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-desktop-webkit/safe-field-check-details.png`
- WebKit, phone portrait: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-phone-portrait-webkit/safe-field-check-details.png`
- WebKit, phone landscape: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-phone-landscape-webkit/safe-field-check-details.png`
- WebKit, tablet portrait: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-tablet-portrait-webkit/safe-field-check-details.png`
- WebKit, tablet landscape: `artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-tablet-landscape-webkit/safe-field-check-details.png`

## Environment notes

No browser or package limitation blocked the run. Although npm package acquisition was offline, the existing schema/audit-protection setup fetched three small Nix runtime dependencies from the configured Nix cache; setup completed. The build emitted non-blocking chunk-size and deprecated-option warnings. No fixture/runtime repair was needed. The runner uses a disposable database and cleaned it up after the suite.

## Export policy and focused checks

The client builds a new schema-version-1 JSON envelope from the existing
reviewer-authorized report, never serializes the report object itself, and makes
no new network request or observation write. Limits: 18 checks, five recent
non-successes per check, 64,000 UTF-8 bytes. The filename contains only the fixed
report prefix, schema version, and capture time. Missing/invalid details are
`unavailable`; `local` is an unknown build, not an environment claim. Arbitrary
build strings are never echoed. Revision-shaped build strings become only an
unverified category. Environment and exact build identity remain unknown.

Only fixed check/status/browser categories, canonical timestamps, bounded counts,
and approved duration/source/failure-code fields are retained. Free-form labels,
errors, URLs, operational payloads, and run/user/client identifiers are excluded.
The export labels hardware entries as reported confirmations, not independently
verified physical-device evidence. It does not establish readiness or historical
causes. A legend explains numeric categories and saturated duration values.

| Result | Check |
|---|---|
| PASS | `pnpm --filter @workspace/run-calculator exec vitest run src/fieldCheckExport.test.ts` — 9 tests, including every output field, privacy injection, missing details, oversized structures/scalars, filename, numeric bounds and browser cleanup/failure |
| PASS | `CI=true pnpm run typecheck` — repository checks and all configured artifact/library typechecks |
| PASS | `git diff --check` |
| PASS | Reviewer browser downloads, denied account API/UI gates, failure/retry and unchanged API observations — 10 isolated matrix cases above |
| PASS | Development API readiness after recovery: process, startup, database, audit protection, dependencies and background workers all `ok` |
| PASS | Signed-out development preview displays the sign-in landing page; protected changes verified by the isolated manager suite, not this signed-out screenshot |
| NOT RUN | Physical Android Chrome and iOS Safari/PWA — no physical device service used; emulated browser evidence only |
| NOT APPLICABLE | Native-mobile, production heals, new telemetry, new route/schema, and release-readiness decision — outside this client-only export |

## Failure ledger

- **Resolved:** the first development preview attempt returned 502 because the
  API workflow was not started. Starting it exposed a one-off startup database
  probe failure (`database_schema_failed`). A single retry of the existing API
  workflow recovered; readiness returned `ok` and the preview rendered sign-in.
  No database/code repair or production action was needed.
- **Expected, tested:** injected object-URL failure shows a fixed actionable
  message; retry succeeds and observations remain unchanged. Browsers do not
  expose whether a person later cancels the save dialog or whether the OS
  finishes writing a file; the app does not claim to confirm that.
- **Observed, outside the changed surface:** automatically supplied deployment
  logs contained earlier transient database timeout warnings and a later
  successful readiness record. These are not export verification or an
  authorization for production changes; no production remediation was performed.
- **Non-blocking fixture build warnings:** chunk size and deprecated bundler
  option; no build, browser, fixture or unit-test failures remain.
