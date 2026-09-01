# Test and release evidence matrix

This is the maintained map of test ownership and release relevance. The
release check is intentionally a bounded gate, not an alias for every
available test command. A skipped or unavailable optional environment is a
reported gap, not evidence of coverage.

## Test surface and ownership

| Surface | Owner / source of truth | Command or location | Release relevance |
| --- | --- | --- | --- |
| CI-wide shared-library unit tests | Every library package that exposes a `test` script | `.github/workflows/ci.yml`: `pnpm -r --filter "./lib/**" --if-present test` | Broad CI coverage; this is intentionally wider than the bounded release set |
| Pure calculations and shared decision logic | Library package owning the function | Package `test` scripts; especially `inventory-math`, `production-rules`, `spec-reconcile`, `spec-import`, `scheduled-recipe-check`, and `spec-export` | Required when the library or its consumers change |
| API route, validation, auth, and persistence contracts | API server route or shared API contract | `@workspace/api-server` unit and integration suites; `test:release:*` shards | Required for server, schema, auth, sync, and contract changes |
| Sync merge, reset, LWW, and SSE | API sync routes plus web sync receive/write paths | `test:release:sync`, `test:release:sync-sse`, `sync-convergence.spec.ts`, and focused sync tests | Required for any sync, day-state, stamp, reset, wake, or live-counter change |
| Concurrent sync and inventory mutations | Disposable-Postgres integration tests for live and scheduled-day sync merge retries, cross-date scheduled-write isolation, plus inventory row-lock/idempotency boundaries | `@workspace/api-server run test:release:concurrency` | Required only when sync conflict/retry (including future scheduled-day writes and cross-date isolation), inventory locking, consumption idempotency, or related transaction boundaries change; bounded to 180 seconds |
| Web rendering and client state | Run Calculator components/hooks | `@workspace/run-calculator test`, typecheck, and focused rendered tests | Required for client or shared UI/state changes |
| Browser operational journeys | `run-calculator/e2e` fixtures and Playwright configs | Smoke, main E2E, department, management-performance, photo-count, and sync-convergence commands; full release mode enumerates 112 cases with a 30-minute timeout and 25-minute warning | Required when navigation, reload, auth, persistence, or user-visible behavior changes |
| Accessibility | `accessibility-smoke.spec.ts` and axe checks | `test:e2e:a11y` | Required for interactive UI, semantic, focus, or layout changes |
| Visual baselines | `visual-regression.spec.ts` snapshots | `test:e2e:visual` | Required for intentional geometry/hierarchy/responsive changes; baseline updates require explicit review |
| PWA/service-worker handoff | `pwa-handoff.spec.ts` self-contained fixture | `test:pwa-handoff` | Required for PWA, service-worker, cache, or update-prompt changes |
| Import and export pipelines | Import/export libraries and corpus fixtures | `pnpm --filter @workspace/spec-import run test`, `test:spec-reconcile`, `test:spec-export`, `test:corpus`, package-specific import tests | Required for import parsing, linking, aliases, merge, or export changes |
| Startup and preview health | Workflow startup and clean-start harness | `check:clean-start` | Required before browser evidence and for run-command, proxy, or workflow changes |

## Required release sets by change category

Run the smallest row that crosses the changed boundary, then run the standard
release check when publishing:

The standard release check is intentionally bounded. Its explicit shared-library
test gates are `run-calculator`, `production-rules`, `inventory-math`,
`spec-reconcile`, `spec-import`, `scheduled-recipe-check`, `spec-export`, and
`corpus-harness`; it does not claim to replace the CI-wide library sweep above.

| Change category | Required checks |
| --- | --- |
| Server-only route or middleware | API typecheck; API unit tests; relevant API integration test (or release integration shards) |
| Client-only component or pure client logic | Run Calculator typecheck; Run Calculator unit tests; browser smoke when the behavior is user-visible |
| Sync, SSE, reset, day-state, wake, or live counters | API sync and SSE release suites; focused client sync/wake/state tests; sync-convergence browser journey; use the sync and state-accuracy checklists |
| Import, alias, recipe linking, or export | `@workspace/spec-import` and other relevant deterministic package tests; corpus test when routing/chunk/merge behavior changes; API integration when persistence is involved |
| Database schema or persisted field | Shared/library and API typechecks; schema/integration coverage for the owning route; disposable database release integration shards |
| Sync or inventory concurrency boundary | API typecheck; relevant route integration suite; `test:release:concurrency` (180-second budget, including disposable same-date convergence and cross-date scheduled-day isolation races) |
| Auth or capability boundary | API auth/role integration coverage plus an authenticated browser smoke or operational journey for the visible consequence |
| UI semantics, focus, or responsive layout | Client tests; accessibility suite; visual suite only when geometry is the acceptance criterion |
| PWA, service worker, or cache/update behavior | PWA handoff suite; client build/typecheck; clean-start if workflow/build configuration changed |
| Workflow, port, or run-command changes | Clean-start; relevant browser smoke; inspect startup and browser logs before interpreting failures |

## Isolation and fixture contract

- Destructive browser suites must call `requireIsolatedTestDatabase` before
  deleting live-day data. The approved CI database is disposable; production
  and an arbitrary development domain are not safety signals.
- Browser accounts and server entities use unique names and are cleaned up in
  suite teardown. A failed teardown is evidence to report and must not be
  hidden by a later run.
- Reload-sensitive journeys seed state before navigation or explicitly reload
  after seeding, wait for the authenticated shell and baseline data, and
  assert the selected record/value after reload. A default or signed-out shell
  is not a passing fixture.
- Main, accessibility, visual, phone, performance, department, sync, and PWA
  projects use separate configs where their setup boundaries differ. This
  prevents a destructive live-day reset from leaking into isolated checks.
- SSE readers and long-lived browser routes are explicitly aborted/closed by
  their owning test. An abort caused by test cleanup is not a product failure;
  an unexpected stream close must be surfaced by the assertion.

## Evidence and failure classification

The release harness retains the allowlisted clean-start evidence and report.
Visual failures retain expected/actual/diff artifacts in Playwright output;
baseline updates must use an explicit local `--update-snapshots` invocation
and be reviewed, never enabled in CI. Accessibility output identifies the
screen, rule, selector, and remediation.

Interpret failures as follows:

- **Product failure:** the configured process starts and the fixture is valid,
  but behavior, persistence, authorization, or rendered state is wrong.
- **Test/setup failure:** fixture data, selector, capability, or cleanup is
  invalid. Fix the test setup rather than weakening the assertion.
- **Infrastructure failure:** the workflow cannot start, a port is occupied,
  Chromium/database/secret access is unavailable, a child times out, or a
  child is terminated by signal. Release reports preserve timeout and
  infrastructure statuses separately from ordinary `FAIL`.
- **Optional environment gap:** physical Android checks run only when
  `PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT` is provided. Desktop Chromium emulation
  is not physical-device evidence.

## Bounded coverage gaps

These are intentionally tracked as a small list rather than one task per
command:

1. Physical Android lifecycle/keyboard evidence is unavailable without the
   configured device endpoint; keep the optional checks visible and do not
   claim them as release coverage.
2. External notification delivery and production deployment behavior require
   manual operational verification; local browser/API tests cannot prove them.
3. Broad load/concurrency behavior beyond the focused disposable-database lane
   and performance journeys is not covered by the release gate. The focused
   lane is intentionally opt-in for changes to the affected concurrency
   boundary, rather than a check on every release.
4. The standard release command does not run visual, PWA, department,
   photo-count, or full E2E suites; run the category-specific commands when
   those surfaces change or use the full browser mode for broader review.

The owner of each gap is the team changing that boundary. A gap becomes a
release blocker when the corresponding feature is changed, not merely because
the command exists.