# Reviewed default full-release browser inventory

## Decision and provenance

The product owner explicitly approved the **216-case split** in this work's
coverage review on 2026-10-23. This is an inventory-maintenance decision, not
full-release certification, physical-device evidence, or published-app evidence.
The release-maintenance agent owns the reconciliation; the release owner owns
authorization and prerequisites for the later runtime release check.

On 2026-10-27, the owner separately approved replacing the one
`Frontline App on-hand stock survives off-tab work, adjustment, pause, and reload`
identity with
`Frontline App1 batch supply survives off-tab work, adjustment, pause, and reload`.
The reviewed total remains 216. This follows the current whole-batch UI and
retains off-tab server depletion, manual adjustment, pause, and reload coverage;
the replaced case's direct fractional-pound edit is no longer exposed by the UI.

On 2026-10-30, the owner approved the current default inventory at **227**
identities after a fresh no-test listing found 12 additions and one retired
identity against the prior 216-case contract (net +11). The updated exact set is
recorded in the linked contract. This is inventory approval only; no browser
tests were run, and #3692 retains ownership of the full runtime suite.

The exact default identities are the file and complete title path strings in
[`full-browser-case-contract.mts`](../scripts/src/full-browser-case-contract.mts).
Every one belongs to project **`chromium`**, selected by
[`playwright.config.ts`](../artifacts/run-calculator/playwright.config.ts).
The reporter checks the project, count, exact identity set, and duplicates.
The existing reporter regression collects from that actual config and rejects
additions, removals, same-count substitutions, duplicates, and other projects.
No browser cases were deleted or skipped to meet a numeric target.

### Reconciliation

| Inventory observation | Cases | Meaning |
| --- | ---: | --- |
| Previous reviewed contract | 172 | Exact identities, despite the release matrix's stale 170-case prose |
| Historical A37 collection | 249 | Collection mismatch recorded in `server-live-state-authority.md`; not runtime results |
| Historical pre-change collection | 252 | Zero collection errors; all in `chromium`; 81 added identities, one removed |
| Retained unchanged identities | 171 | No retired coverage or duplicate identities identified |
| Renamed die-timer identity | 1 | Existing fill/switch/preserve-time test, suite renamed from `run-form die tunnel defaults` to `run-form die defaults and split timer` |
| Additional intended app regressions | 44 | Explicitly accepted below |
| Dedicated-only additions | 36 | Explicit harness/engine/opt-in decisions below, not deletion |
| Previously approved default (2026-10-23) | **216** | `171 + 1 + 44`; equivalently `252 - 36` |
| Current owner-approved default (2026-10-30) | **227** | Fresh current listing: 12 added, 1 retired from the prior contract |

The historical 249-case observation and 252-case collection are not reused as
current discovery evidence. The 252-case discovery above was read-only, using the pinned release runner
and `playwright test --config=playwright.config.ts --list --reporter=json`,
with explicit local API/web origins and no server-start request.
Its two leading Node-test diagnostics revealed a helper `.test.mjs` being loaded
by Playwright's broad default matcher; the browser config now selects only
`**/*.spec.ts`. This removes helper execution, not any listed browser case.
Raw JSON was kept temporarily outside the repository; retained information here
is limited to test metadata, not account, request, database, or secret values.

## Accepted additions and ownership

All filenames below are under `artifacts/run-calculator/e2e/`. Exact title
paths are in the linked contract rather than a second editable copy.
Existing focused configs remain useful for engine/viewport variants; their
existence alone is not a reason to remove default Chromium app regressions.

| Spec | Additional cases | Reviewed purpose / specialist owner |
| --- | ---: | --- |
| `die-tunnel-defaults.spec.ts` | 1 | Split timer paired-run/pause/reload/peer behavior; Run controls (plus the separately counted rename) |
| `field-check-diagnostics.spec.ts` | 1 | Safe sync/performance sources; field diagnostics |
| `guarded-undo.spec.ts` | 1 | Server Undo access, history, pagination, responsive controls; Undo |
| `home-deferred-panels.spec.ts` | 1 | Functional deferred-panel navigation, not timing capture; Home |
| `ignored-match-filter.spec.ts` | 1 | Category/brand fences and restore; master-data matching |
| `import-gold-lab-responsive.spec.ts` | 1 | Review-panel layout only, not source capture; Import Gold UI / compatibility |
| `line-map-responsive.spec.ts` | 1 | Station cards; Line Map |
| `live-sauce-dough-phone.spec.ts` | 1 | Frontline App1 batch supply, server depletion, correction, and reload |
| `manager-attention.spec.ts` | 7 | Keyboard/focus, counts, contrast, denied staff access; management/accessibility |
| `merge-alias-retarget.spec.ts` | 7 | Scoped aliases, confirmations, ignore persistence, cross-manager sharing; master-data matching |
| `merge-ignore-undo.spec.ts` | 1 | Scoped flavor-ignore Undo; master-data matching |
| `mix-plan.spec.ts` | 1 | Ordinary ingredient total for prep card; Mix Plan |
| `packaging-recovery.spec.ts` | 1 | Acknowledged Resume/correction convergence; Packaging |
| `phone-layout.spec.ts` | 2 | Tablet-landscape Floor Mode and update/QC containment; responsive UI |
| `qc-allergen-activity-responsive.spec.ts` | 1 | Recorded daily sources; QC/allergen |
| `qc-brix-authenticated.spec.ts` | 1 | Manager/operator corrections and sign-off; QC |
| `qc-date-code-authenticated.spec.ts` | 1 | Approval, mismatch retention, reload; QC |
| `qc-import-review-authenticated.spec.ts` | 1 | Conflict/retry/badge/persistence; QC imports |
| `qc-import-review-reload-badge.spec.ts` | 1 | Retained review and badge deltas; QC imports |
| `qc-intelligence-authenticated.spec.ts` | 1 | Filter/export/reload, denied staff; QC reports |
| `qc-planning-authenticated.spec.ts` | 1 | Canonical schedule refresh; QC planning |
| `qc-recipe-review-authenticated.spec.ts` | 1 | Revision-scoped stale conflict/reload; QC recipes |
| `qc-workflows-authenticated.spec.ts` | 1 | Targets/checks on phone/tablet; QC responsive UI |
| `report-issue-confirmation.spec.ts` | 1 | Failed-report retry retains input; issue reporting |
| `run-startup-slow-network.spec.ts` | 1 | Run usable before optional panels; startup |
| `sync-convergence.spec.ts` | 2 | Frontline peer recovery and canonical edit/wake latency; sync |
| `workbook-auto-ai-fallback.spec.ts` | 4 | Model-free deterministic parse, permission denial, stubbed fallback/retry and read-only source audit; workbook imports |

These are intended runtime checks, not claims that they have passed at runtime
as part of this inventory task.

## Dedicated-only additions: exact file/case selection and lane owners

Configs below are in `artifacts/run-calculator/`. Whole-file exclusions select
all titles in the stated spec; the two partial-file selections are described
explicitly. Counts refer to current default Chromium discovery before exclusion,
not to the multi-project totals of the dedicated configurations.

| Spec / selection | Cases | Owning config | Why not default |
| --- | ---: | --- | --- |
| `csp-production.spec.ts` (all) | 1 | `playwright.csp-production.config.ts` | Production Express/TLS server, CA and certificate pin; default preview cannot prove CSP |
| `docker-caddy-browser-smoke.spec.ts` (all) | 2 | `playwright.docker-caddy.config.ts` | Container/Caddy origin and readiness prerequisites |
| `home-opening-measurement.spec.ts` (all) | 1 | `playwright.home-opening-measurement.config.ts` | Named desktop/phone timing projects and special performance server; default project would skip timing |
| `import-gold-apply.spec.ts` (all) | 1 | `playwright.import-gold.config.ts` | Explicit source-use/retention capture gates; not silently enabled |
| `pwa-handoff.spec.ts` (all except the three retained sentinels below) | 26 | `playwright.pwa.config.ts` | Dedicated two-build/service-worker harness; owner retains only the three existing release sentinels in default |
| `reduced-motion.spec.ts` (all) | 2 | `playwright.reduced-motion.config.ts` | Calculator and mockup servers, reduced-motion context and responsive engine matrix |
| `webkit-https.spec.ts` (all) | 1 | `playwright.pwa.config.ts` | Public HTTPS image/runtime diagnostic, not app regression |
| `recipe-picker-webkit.spec.ts` (all) | 1 | `playwright.recipe-picker-webkit.config.ts` | Safari picker engine/viewport ownership |
| `run-startup-slow-network.spec.ts` / `started Run reload during delayed optional panel startup › reload preserves a started Run while its Sauce chunk is held in desktop WebKit` | 1 | `playwright.run-startup.config.ts` | Explicitly requires `desktop-webkit`; would skip in default Chromium |
| **Total** | **36** | | |

The three previously reviewed PWA sentinels remain in default and are not
retired or silently dropped:

- `PWA update handoff › auto-reloads when Home was already safe before update discovery`
- `PWA update handoff › preserves unsafe work, then auto-reloads after safe inactivity`
- `PWA update handoff › recovers an old HTML-served Home chunk onto the current build once`

### Preserved pre-existing exclusions

No ownership changed for these lanes:

- `task3494-audited-import.spec.ts`: focused audited import config, not default;
  the shared-dialog matrix uses Vite source mode so its direct module import
  shares the app's singleton. The standard 227-case release lane remains built
  preview and excludes this file.
- `completed-history-archive.spec.ts`: focused synthetic archive read/reload
  check via `playwright.release-debug.config.ts`, not default.
- `live-authority.spec.ts` and `live-authority-continuation.spec.ts`:
  their respective standalone authority configs, never part of this inventory.
  Previously passing selected authority runs were not repeated here.
- `calendar.spec.ts`: `playwright.calendar.config.ts`.
- `release-webkit-smoke.spec.ts`: `playwright.webkit.config.ts`.
- `ios-safari-pwa-device.spec.ts`: physical-device config.
- Existing `@focused-only` and physical Android/suspension/process-restart
  exclusions remain unchanged; no physical evidence is inferred from Chromium.

## Agent-owned execution

Owner-approved execution: update selection and contract together, exercise the
existing real-config discovery regression and reporter entry-point guards, then
run supported static checks. No database migrations/data writes, API changes,
browser installs, runtime suite, authority reruns, or publishing are authorized
by this inventory task. The isolated browser wrapper's disposable database,
production fence, process-group cleanup, pinned toolchain, and release budgets
remain unchanged.

## Applicable safeguards and verification

Applicable guidance: task-execution rules, verify-before-commit, web-app
configuration rules, and evidence hygiene. The smallest regression extends the
existing reporter/discovery check rather than adding a browser journey.
Compatibility applicability is recorded below; release execution and production
checks retain their separate authorization boundary.

| Observation | Disposition |
| --- | --- |
| Default collection differed from 172 and docs still said 170 | Reconciled with explicit owner approval; exact identities, not count-only approval |
| Runtime reporter checked count only | Now checks exact identities, duplicates and project before accepting runtime evidence |
| Node helper tests polluted collection JSON | Restrict default discovery to browser `.spec.ts`; no listed case removed |
| First regression run found 213 instead of 216 | Whole-file PWA exclusion also hid three retained sentinels; replaced with the approved partial-file selection |
| Next regression exposed grep/title separator mismatch | Regression now uses Playwright's space-joined title format, not the display `›` separator |
| Existing duration fixture assumed 50 seconds always exceeded 25% of the suite | Fixture now scales its synthetic increase above both existing thresholds; production thresholds unchanged |
| Focused static check initially omitted TypeScript's `--ignoreConfig` requirement | Corrected the explicit-file invocation; no compiler policy changed |
| Focused static check found per-test `timedout` spelling and an undeclared parser property | Corrected Playwright per-test status to `timedOut` (whole-run status stays `timedout`); explicitly typed the existing compiler parser diagnostics without changing runtime validation |
| Root `pnpm run typecheck` initially stopped at `Invalid prepared build-source record.` | An ignored inherited web stage-start marker used obsolete `production-source-v3`. Archived that intermediate with its bytes preserved; publish preparation/sealed records untouched. Root check then PASS |
| An attempted syntax check named a nonexistent standalone unit file | Located and ran the actual existing `src/recipeRefreshSpecSyntax.test.ts`: 4/4 PASS |
| Public development preview still shows the previously recorded update-failed notice and signed-out 401s | Existing authority document A44 observation, not caused by browser inventory maintenance; no claim of release health. Release owner must classify development identity behavior separately from published evidence before certification |

### Completed checks (local Linux x86_64; pinned Node 24.21.0)

All commands below used `bash scripts/src/run-release-node.sh`; no budget,
toolchain lock, HTTPS guard, production fence, or workflow was weakened.

- **PASS**: real default config with its normal reporters, `--list`:
  **216 tests in 54 files**, exact identity/project guard accepted.
- **PASS**: `pnpm --filter @workspace/scripts exec tsx
  ../artifacts/run-calculator/e2e/release-duration-reporter.unit.mts`:
  JSON discovery, identity drift/project/duplicate guards, count/report
  retention and duration thresholds.
- **PASS**: `pnpm --filter @workspace/scripts exec tsx
  ./src/release-evidence.test.mts`: release-evidence contract regression.
- **PASS**: `pnpm --filter @workspace/run-calculator exec vitest run
  src/recipeRefreshSpecSyntax.test.ts`: 4/4, including malformed/missing syntax.
- **PASS**: `pnpm run typecheck` across the workspace after archiving the
  obsolete local intermediate; scripts-package standalone typecheck also passed.
- **PASS**: explicit-file strict TypeScript check of the Playwright config,
  reporter and its unit test (`--ignoreConfig --noEmit --module esnext
  --moduleResolution bundler --target es2022 --skipLibCheck
  --allowImportingTsExtensions --strict --esModuleInterop --types node`).
- **PASS**: whitespace check; no retained full-browser runtime report changed.
- **Observed only**: public preview landing renders. No app runtime source or
  service commands changed, so no app workflow restart was needed.

The default listing does not run global setup, launch browsers, start API/web
servers, install engines, or write a replacement full-suite runtime report.

### Applicability matrix

| Surface | This task's verification / limit |
| --- | --- |
| Default desktop Chromium project | Real-config discovery and reporter guards only; runtime **NOT RUN** |
| Phone and tablet portrait/landscape | Intended identities remain covered; browser-emulated runtime **NOT RUN** |
| WebKit/Safari | Dedicated configurations retained; runtime **NOT RUN**, not needed for selection-only maintenance |
| Physical Android Chrome, iOS Safari/PWA | **NOT RUN**; no physical-device service used or evidence claimed |
| Published app / production hardware | **NOT RUN**; local collection is not published, capacity, or authority evidence |
| Full-release certification | **NOT RUN**; release owner must authorize prerequisites and run actual release gates separately |

The existing serial worker, zero retries, 80-minute warning and 90-minute hard
budget stay intact. Adding intended cases does not demonstrate that they fit
that budget. Preserve existing retained runtime reports; do not rewrite them
to manufacture a 216-case result.

## Standalone discovery boundary maintenance — 2026-10-24

This is separate from the approved default inventory and runtime release check.
The maintenance agent inventoried all **57** `playwright*config.ts` files in
`artifacts/run-calculator` at base revision
`df2b972bf819ebbb8694966810f8b450225da6a1`. Of the 56 dedicated configs, only
`playwright.release-debug.config.ts` lacked an explicit `testMatch`.
The other 55 dedicated configs and the default already selected explicit files
or globs (including project-specific selections). They were not changed.
In particular, `playwright.import-review-timing.config.ts` intentionally selects
`import-review-timing.browser.ts`; a blanket `.spec.ts` conversion of every
config would lose that coverage.

### Reproduction and repair

Bounded read-only collection at approximately 01:14 UTC used:

```sh
RELEASE_RUNNER_LOCK_WAIT_SECONDS=60 bash scripts/src/run-release-node.sh \
  env RELEASE_BROWSER_LOCAL_SERVERS=0 \
  PLAYWRIGHT_BASE_URL=http://127.0.0.1:18082 \
  PLAYWRIGHT_API_BASE_URL=http://127.0.0.1:18081 \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/false \
  timeout 60s pnpm --filter @workspace/run-calculator exec playwright test \
  --config playwright.release-debug.config.ts --list --reporter=json
```

Before repair, stdout began with the two passing Node-test diagnostics from
`qc-date-code-browser-diagnostics.test.mjs` and was therefore not valid JSON.
The subsequent report had zero collection errors and **264** browser identities,
all in project `chromium`. A temporary parser separated that diagnostic prefix
only to retain the pre-repair browser identity baseline; the regression does
not accept or strip any prefix.

The repair adds `testMatch: "**/*.spec.ts"` only to release-debug. Its existing
ignore list, grep, project, global setup and reporters remain unchanged.
The regression extends `e2e/release-duration-reporter.unit.mts`, already run by
the scripts package's `test:release-evidence` command. It parses the entire JSON
stdout, checks errors and project names, rejects configured server commands,
requires browser-spec filenames and unique identities, and compares the SHA-256
of the complete sorted file/title identity array:
`4de725cd89e5874ca2be37d171ce284f3f260ada8847637dcb6e2c3b5fa2a3cf`.
That fingerprint is the historical release-debug baseline of 264 identities,
not a default contract or runtime result.

### Current standalone release-debug inventory

On 2026-10-30, the owner separately approved the discovered 278-identity
release-debug set. A fresh `--list` returned 278 cases in 66 files, all under
the Chromium project. The selection is distinct from the 227-case default
contract. Its reviewed identity SHA-256 is
`95096de5dc942ddd1afd9c2eb5aa4e41cf3ec2ad55cfc4b387ef653542766562`.
The reporter regression now locks both the 278 count and the exact identities.
This was listing-only evidence: no browser tests, server startup, database
setup, or production access occurred. The prior 264-case result remains
historical; the full release runtime remains owned by #3692.

Each discovery subprocess has a 60-second timeout, explicit local origins and
`RELEASE_BROWSER_LOCAL_SERVERS=0`, regardless of inherited caller settings.
`--list` does not execute global setup or browser hooks. No builds, services,
database setup, browser installs or runtime suites were launched.
The dedicated authority configs and their selectors are unchanged; their
previous runtime evidence was not replaced or rerun.

### Verification and failure ledger

Evidence is local Linux development test metadata only, not production data.
Temporary raw collection stayed outside the repository; retained evidence here
contains only filenames, selection metadata and an identity fingerprint, with
no account records, requests, credentials or connection strings.

| Check / observation | Result and disposition |
| --- | --- |
| Pre-repair helper execution during release-debug collection | Reproduced; fixed by the browser-only matcher |
| Real-config discovery/reporter regression | PASS: clean JSON, exact 264 standalone identities and unchanged 216 default identities |
| Added no-server assertion initially expected `undefined` | Playwright serializes the absent server as `null`; assertion now accepts either absent representation, still rejects any configured server |
| Initial root `CI=true pnpm run typecheck` | Failed at `Invalid prepared build-source record.`; inherited ignored web-stage marker had obsolete `production-source-v3` |
| Safe local marker repair | No build process active; archived the stale stage marker byte-for-byte under ignored `.local/build-identity/archived-stages/`; publish/prepared/sealed records untouched |
| Repeated root typecheck after repair | PASS, including API, calculator, scripts and mockup packages |
| Final focused checks | PASS: updated discovery/reporter regression, explicit-file strict TypeScript check of the debug config and regression, and `git diff --check` |
| Source-policy lookup initially named nonexistent `source-fingerprint.mjs` | Corrected via the actual import in `build-source-identity.mjs`: `build-source-files.mjs`; no source change |

Desktop Chromium, phone, tablet portrait/landscape, WebKit/Safari and physical
Android Chrome/iOS Safari/PWA runtime verification are **NOT RUN**: this work
changes collection only and makes no runtime compatibility claim. App screenshots
and workflow restarts are not applicable: no application runtime code or service
commands changed. Release certification, publishing and production writes remain
out of scope. The separately owned full-browser runtime verification already
covers the next release step; no overlapping follow-up is proposed.
