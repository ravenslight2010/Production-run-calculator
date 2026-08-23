# Production Run Calculator efficiency audit

Date: 2026-08-23

## Scope and safety bar

This audit measured the calculator before and after separating the complete
workbook workflow from calculator startup, inspected the ownership boundaries
around `Home` and `LiveRunProvider`, and retained only changes that improved a
shipped metric without moving ownership of live calculations, auto-tracking,
or synchronization.

## Before/after measurements

The workbook workflow now has one cached, on-demand loader for run workbook
parsing/export and spec workbook import/export. The existing Home orchestration,
review state, retry behavior, generation guards, cancellation, and error
messages remain in place.

| Measure | Before | Candidate result / final | Result |
| --- | ---: | ---: | --- |
| Vite production build | 7.55 s | 9.57 s | Build-time variance; not a startup budget |
| Main JS chunk | 2,446.33 kB / 681.57 kB gzip | 2,442.21 kB / 679.40 kB gzip | Improved by 4.12 kB / 2.17 kB gzip |
| Deferred run-workbook chunk | included in main | 8.78 kB / 3.59 kB gzip | Deferred until workbook action |
| Largest optional HEIC chunk | 1,352.90 kB / 341.41 kB gzip | unchanged | Already deferred at the call site |
| CSS | 184.49 kB / 26.35 kB gzip | unchanged | Unchanged |
| Precache payload | 4,039.04 KiB | 4,039.34 KiB | No improvement; reverted |
| Calculator unit tests | 2,265 passed / 213 files | 2,265 passed / 213 files | Passed |
| Performance protection tests | not separately run in baseline | 15 passed / 3 files | Passed |
| Typecheck | not separately run in baseline | passed | Passed |

The main chunk reduction is modest because other management importers still
share some workbook dependencies, but the complete run/spec workflow is now
requested only by workbook actions rather than by calculator startup.

Browser preview evidence on the final build reached the sign-in shell at the
calculator workflow port (1280×720). Its unauthenticated navigation timing was
2,156 ms to DOM content loaded and 2,192 ms to load. The local development
session also recorded HMR updates of 3,694–4,252 ms; these are development
measurements only and are not treated as a shipped optimization target.

## Ownership and dependency findings

- `LiveRunProvider` owns the one live clock, calculation result, timer
  countdowns, and auto-track integration. It must remain a shared provider.
- `Home` owns form state, persistence, sync, and import orchestration. Moving
  those across deferred boundaries would risk stale forms, lost writes, or
  duplicate stores.
- Management staff and management AI/review surfaces are deferred and have
  explicit load timing and error fallbacks.
- Warehouse-only polling and QC surfaces are already deferred by their
  department boundaries.
- HEIC conversion is already dynamically imported only for HEIC/HEIF files.
- Workbook actions share one cached lazy loader. The loader is a loading
  optimization only; Home remains the owner of import review, cancellation,
  commit, and error state.

## Retained safe improvements

The audit retains the existing measured startup improvements:

1. Staff management is loaded only when its management surface is opened.
2. Management AI/review code is loaded only when its tab is opened.
3. QC and warehouse-only work is deferred from the calculator startup path.
4. Browser diagnostics cover navigation, tab transitions, render commits, HMR,
   API timings, calculation timings, storage scans, deferred work, and optional
   Chromium heap samples.

These changes preserve the shared operational owners and have dedicated
performance/browser protection coverage.

## Regression coverage

Run during this audit:

- `pnpm --filter @workspace/run-calculator run build`
- `pnpm --filter @workspace/run-calculator run typecheck`
- `pnpm --filter @workspace/run-calculator run test -- --run`
- `pnpm --filter @workspace/run-calculator run test:performance`

The full calculator suite passed: 213 files and 2,265 tests. The focused
performance suite passed: 3 files and 15 tests.

## Authenticated browser journey evidence

The browser journeys were run on 2026-08-23 with the repository's explicit
approved test-mode flags (`E2E_TEST_DB=1` and
`E2E_APPROVED_DESTRUCTIVE_MODE=1`). The safety guard was not changed and no
snapshot-update flag was used. API and calculator workflows were restarted
before the run and were reachable through the configured preview.

| Journey | Result | Evidence |
| --- | --- | --- |
| Authenticated management performance | **FAIL** (1 test, repeated) | Authenticated desktop startup completed; staff surface stayed deferred, API requests and browser navigation diagnostics were captured. `management:staff-first-visit` measured 313–320 ms against the 250 ms transition budget. |
| Production / warehouse / QC / management navigation | **BLOCKED** (0/2 viewport tests) | Both desktop and phone runs timed out waiting for the authenticated `More` control before department navigation. |
| Phone layout and import controls | **PASS** (7 passed, 1 expected skip) | 375×812, 390×844, and 568×320 authenticated layout journeys passed; the physical Android test was skipped because no device endpoint was configured. The manager import-control/review path was exercised in the phone suite. |
| Sync convergence | **PARTIAL** (3/4) | Desktop and phone deletion/reload convergence passed; one desktop reset-epoch test received a null `dayState` payload while asserting the empty reset state. |
| Sync diagnostics download | **PASS** (3/3) | Date-scoped download, older-event filtering, and active-date behavior across local midnight passed. |
| Accessibility smoke | **PASS** (9/9) | Sign-in, zoom, authenticated staff workflows, dialogs, and import-review accessibility checks passed at desktop, phone, and tablet viewports. |
| Reload/navigation persistence | **PASS** (5/5) | Tab/back/invalid-tab recovery and crust preference reload/fresh-session journeys passed. |
| Screen-off/wake lifecycle | **PARTIAL** (3/4) | Counter, pause, and stale-write protection checks passed; one disconnected-peer case timed out during signup before reaching the lifecycle assertion. |
| Cross-device smoke | **BLOCKED** (0/2) | Both desktop and phone projects reached recovery but could not observe the expected `Sync connected` title within the assertion window. |
| Visual production/import journey | **FAIL** (1 failed, 1 not run) | The desktop production screenshot differed from the reviewed `live-run-desktop.png` baseline before the import-review screenshot; the phone project was not run after the failure. No baseline was updated. |

The successful journeys provide authenticated startup, deferred-panel,
API/download, render/layout, accessibility, memory-safe reload, and sync
diagnostics evidence through their existing Playwright attachments and
assertions. The failures are retained as evidence rather than being relabeled
as passes: the management budget and visual baseline are application/test
regressions to investigate, while the department, smoke, reset-payload, and
signup timeouts need triage before release. The physical-device keyboard path
remains unverified in this environment.

The existing browser performance journey
(`e2e/management-performance.spec.ts`) remains the required evidence for
authenticated startup, deferred staff loading, API request capture, timing
budgets, and desktop manager navigation. An attempted run during this audit
now completed its isolated setup and captured the evidence above. Production,
sync, phone, accessibility, and import journeys were also run in that approved
mode; their individual outcomes are recorded above.

## Known bottlenecks and next bounded opportunity

- The main JS chunk remains about 2.44 MB minified because shared `Home`
  orchestration and several deterministic guide importers still share parts of
  the workbook dependency graph. The complete run/spec workflow itself is now
  requested on demand.
- The HEIC converter is large, but it is already an optional chunk and should
  not be moved into the initial bundle.
- Any future guide-import split should preserve the same cached loader and
  review-state ownership rather than introducing a second workbook loader.
