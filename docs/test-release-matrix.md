# Test and release evidence matrix

This is the maintained map of test ownership and release relevance. The
release check is intentionally a bounded gate, not an alias for every
available test command. A skipped or unavailable optional environment is a
reported gap, not evidence of coverage.

## Test surface and ownership

| Surface | Owner / source of truth | Command or location | Release relevance | Report lane IDs |
| --- | --- | --- | --- | --- |
| CI-wide shared-library unit tests | Every library package that exposes a `test` script | `.github/workflows/ci.yml`: `pnpm -r --filter "./lib/**" --if-present test` | Broad CI coverage; this is intentionally wider than the bounded release set | `ci-library-sweep` |
| Pure calculations and shared decision logic | Library package owning the function | Package `test` scripts; especially `inventory-math`, `production-rules`, `spec-reconcile`, `spec-import`, `scheduled-recipe-check`, and `spec-export` | Required when the library or its consumers change | `shared-library-focused` |
| API route, validation, auth, and persistence contracts | API server route or shared API contract | `@workspace/api-server` unit and integration suites; `test:release:*` shards | Required for server, schema, auth, sync, and contract changes; release execution bounds independent shards at two concurrent database jobs | `ci-api-postgres`, `api-unit-isolated`, `api-integration-shards`, `api-roles` |
| Sync merge, reset, LWW, and SSE | API sync routes plus web sync receive/write paths | `test:release:sync`, `test:release:sync-sse`, `sync-convergence.spec.ts`, and focused sync tests | Required for any sync, day-state, stamp, reset, wake, or live-counter change | `api-sync`, `api-sync-sse`, `api-sync-convergence` |
| Concurrent sync and inventory regression coverage | Disposable-Postgres integration tests for live and scheduled-day sync merge retries, cross-date scheduled-write isolation, plus inventory row-lock/idempotency boundaries | `@workspace/api-server run test:release:concurrency`; release-shard calibration is a separate manual workflow | Required only when sync conflict/retry (including future scheduled-day writes and cross-date isolation), inventory locking, consumption idempotency, or related transaction boundaries change; bounded to 180 seconds | `ci-release-concurrency-fixtures`, `api-concurrency`, `release-concurrency-calibration` |
| Bounded API application workload | Isolated API routes and inventory/sync persistence against a per-run disposable PostgreSQL database | Manual-only `.github/workflows/api-load-workload.yml`; `@workspace/api-server run test:load:isolated` | Opt-in only; not part of routine CI or standard/full release gates. Capped at four clients, four rounds, four sync attempts per write, 187 total API requests, twelve in-flight requests, and six minutes. Checks application correctness, not release-shard capacity; timings are diagnostic, not a performance SLO | `api-load-workload` |
| Web rendering and client state | Run Calculator components/hooks | `@workspace/run-calculator test`, typecheck, and focused rendered tests | Required for client or shared UI/state changes | `ci-client-unit` |
| Browser operational journeys | `run-calculator/e2e` fixtures and Playwright configs | Compatibility, Chromium smoke, WebKit, main E2E, calendar, phone, multi-device, and wake/retry commands; full release mode enumerates the main-suite contract | Required for layout, touch, browser-engine, or cross-device journey changes; release browser stages remain serial | `browser-compatibility`, `browser-smoke`, `browser-webkit`, `browser-main`, `browser-calendar`, `browser-phone`, `browser-multi-device`, `browser-wake-retry` |
| Department and station-specific browser journeys | `run-calculator/e2e` focused Playwright configs | Department, dough correction, recipe refresh, and AI-outage phone commands | Required when the corresponding station or department journey changes; isolated fixtures remain separate | `browser-department`, `browser-dough-correction`, `browser-recipe-refresh`, `browser-ai-outage-phone` |
| Passive field verification | Field-check contract/unit coverage, API validation/scoping tests, and manager Reported Issues browser coverage at desktop/tablet/phone widths | Focused client/API tests; browser-visible coverage is in `test:e2e:a11y` | Required for lifecycle observation, field-check ingestion, or manager-panel changes; browser evidence is limited to signals the browser can observe | `passive-field-verification` |
| Accessibility | `accessibility-smoke.spec.ts` and axe checks | `test:e2e:a11y` | Required for interactive UI, semantic, focus, or layout changes | `browser-a11y` |
| Visual baselines | `visual-regression.spec.ts` snapshots | `test:e2e:visual` | Required for intentional geometry/hierarchy/responsive changes; baseline updates require explicit review | `browser-visual` |
| PWA/service-worker handoff | `pwa-handoff.spec.ts` and `pwa-morning` fixture owners | `test:pwa-handoff`, `test:e2e:pwa-morning` | Explicitly out of the standard browser gate; required for PWA, service-worker, cache, or update-prompt changes; responsive/PWA emulation is not physical iOS evidence | `pwa-handoff`, `pwa-morning` |
| Physical Android checks | Physical-device Playwright projects | `test:e2e:phone:device`, `test:e2e:ai-outage:phone:device` | Optional; requires a physical Android Chrome service. Emulation is not physical-device evidence | `physical-android-main`, `physical-android-phone` |
| Physical iOS Safari/PWA readiness | `ios-safari-pwa-device.spec.ts` and `playwright.ios-safari-pwa.config.ts` | `check:e2e:ios:pwa:device`, then `test:e2e:ios:pwa:device` | Optional environment-dependent lane; requires `PLAYWRIGHT_REAL_IOS_SAFARI_WS_ENDPOINT`, retains separate iOS evidence, and reports unavailable services as `BLOCKED`/`NOT_RUN`; browser/PWA only, not native-app coverage | `physical-ios-pwa` |
| Import and export pipelines | Import/export libraries and corpus fixtures | `spec-import`, `spec-reconcile`, `spec-export`, `corpus-harness`, and focused package tests | Required for import parsing, linking, aliases, merge, or export changes | `import-export-focused` |
| Import lifecycle integrity | Import-family parser/apply tests, merge-backfill libraries, reconciliation libraries, and saved-source API routes | `docs/import-lifecycle-integrity-audit-2026-09-06.md` and the focused suites listed there | Required when changing recipe-row identity, replacement/union rules, merge backfill, source snapshot retention, or re-import resurrection guards | `import-lifecycle-integrity` |
| Performance and photo-count browser checks | Run Calculator performance and photo-count owners | `test:performance`, `test:e2e:management-performance`, `test:e2e:photo-count` | Focused, opt-in coverage when performance or photo-count behavior changes | `browser-client-performance`, `browser-management-performance`, `browser-photo-count` |
| Startup and preview health | Workflow startup and clean-start harness | `check:clean-start` | Required before browser evidence and for run-command, proxy, or workflow changes | `startup-clean-start` |
| Database schema and persisted-field verification | Disposable schema fixtures and API schema owners | CI schema-safe rollback rehearsal plus the schema/integration tests for the changed route | Required for database or persisted-field changes | `ci-schema-safe-rollback` |
| CI typecheck and repository contract tests | CI workflow and scripts package | TypeScript codegen bridge, workspace typecheck, skill catalog checks, and routine scripts suite | Runs on CI push to `main` and pull requests; a passed report is not production-readiness evidence | `ci-typescript-codegen-bridge`, `ci-typecheck`, `ci-skill-catalog-check`, `ci-skill-catalog-tests`, `ci-scripts-routine` |
| Standard and full release checks | Release scheduler and release-check workflow | `pnpm run release:check`; opt-in `pnpm run release:check:full` | Existing PR/dispatch triggers, bounded gates, barriers, and serial browser stages remain authoritative | `release-standard`, `release-full` |
| Manual operational verification | Operations owner | Verify external notification delivery and published deployment behavior | Manual operational evidence only; local/browser/API tests cannot prove it | `manual-operational-notifications` |

The machine-readable lane contract is maintained in
[`docs/test-lane-catalog.json`](./test-lane-catalog.json). The scripts-package
contract test requires a one-to-one match between these matrix IDs and the
catalog. Test-result JSON uses schema version 1; it is not release evidence or
production-readiness proof. Release summaries retain individual outcomes for
the API, shared-library, startup, and browser gates that run inside the release
command.

The shared test-results report records counts only from validated, current-run
Playwright JSON case summaries: `browser-webkit` (standard/full WebKit smoke)
and `browser-compatibility` (full-mode phone/tablet WebKit). It stores totals
for total, completed, passed, failed, skipped, and not-run cases, without case
details. Direct Vitest lanes, browser suites without a JSON case summary, and
`browser-main` (whose full-suite summary is Markdown) remain `null`; console
output is not a count source.

The full Chromium contract currently enumerates 170 cases, including the
Summary-card live-timer focus regression added after the previous 169-case report.
Physical Android suspension and process-restart checks remain excluded from
desktop Chromium and require the dedicated real-device lane. The two
narrow-landscape sign-in checks and the virtual-keyboard-resize check are part
of the full lane. A missing physical-device endpoint is not replaced by desktop
emulation evidence.

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
- The standard cross-browser release contract is Chromium smoke plus the
  single-project WebKit smoke. Full release additionally runs the compatibility
  lane's phone and tablet WebKit projects for authentication, current-run
  lifecycle, and manager report preview. That WebKit-only invocation explicitly
  selects those two projects and excludes compatibility Chromium projects; the
  dedicated WebKit smoke additionally owns failed-pull/reconnect recovery.
- The WebKit fixture uses unique accounts, a disposable database guard, one
  worker, no inherited destructive global setup, and teardown cleanup. Its
  `browser-smoke/webkit-result.json` artifact records revision, environment,
  test status, and a bounded failure classification.
- SSE readers and long-lived browser routes are explicitly aborted/closed by
  their owning test. An abort caused by test cleanup is not a product failure;
  an unexpected stream close must be surfaced by the assertion.

## Evidence and failure classification

The release harness retains the allowlisted clean-start evidence and report.
The standard WebKit lane retains revision-bound JSON evidence in
`browser-smoke/webkit-result.json`. Full release also retains the phone/tablet
WebKit journeys in `browser-compatibility/webkit-result.json`, validated against
their exact project and case identities. Neither result can overwrite the
full-browser report path.
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
- **Optional environment gap:** physical iOS Safari/PWA checks run only when
  `PLAYWRIGHT_REAL_IOS_SAFARI_WS_ENDPOINT` is provided. Responsive Chromium,
  responsive WebKit, and the filesystem PWA handoff fixture are not physical
  iOS evidence. A missing endpoint is a fail-closed `BLOCKED` readiness result
  or an explicitly recorded `NOT RUN`, never a physical-device pass.

## Bounded coverage gaps

These are intentionally tracked as a small list rather than one task per
command:

1. Physical Android lifecycle/keyboard evidence is unavailable without the
   configured device endpoint; keep the optional checks visible and do not
   claim them as release coverage.
2. Physical iOS Safari/PWA evidence is unavailable without the configured iOS
   device service; keep its evidence directory separate and do not infer it
   from responsive WebKit or PWA handoff results.
3. External notification delivery and production deployment behavior require
   manual operational verification; local browser/API tests cannot prove them.
4. Broad production-scale load and performance behavior is not covered by the
   release gate. The manual bounded API workload checks application-operation
   correctness at a fixed small scale; it is not a production-capacity test,
   and its timings are diagnostic only. Release-shard capacity remains owned by
   the separate concurrency-calibration lane.
5. The standard release command does not run visual, PWA, department,
   station-specific physical-device, responsive visual, photo-count, or full
   E2E suites; run the category-specific commands when those surfaces change
   or use the full browser mode for broader review. Responsive ownership is
   split: compact Chromium smoke is the minimum layout signal, while phone,
   tablet, visual, and physical-device evidence remain owned by their focused
   suites.

The owner of each gap is the team changing that boundary. A gap becomes a
release blocker when the corresponding feature is changed, not merely because
the command exists.

## Release scheduler contract

The release runner uses dependency-aware stages rather than starting every gate
at once:

1. prerequisite checks may overlap;
2. generated-client work completes before shared-output typechecks and their
   consumers;
3. consumer typechecks complete before the bounded API/package-test stage;
4. clean-start completes before browser evidence starts;
5. smoke, accessibility, and (in full mode) the destructive browser suite run
   as separate serial barriers.

The default scheduler cap is four children, configurable locally with
`RELEASE_CHECK_MAX_CONCURRENCY`; API/database shards have a separate cap of
two. A failure finishes the currently running stage, checkpoints all results,
and prevents later stages from starting. Reports are ordered by the declared
gate inventory, not child completion order, and include total and per-stage
wall-clock timing.
