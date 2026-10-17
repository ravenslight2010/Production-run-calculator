# Production Run Calculator: Next Decomposition Roadmap

**Audit date:** 2026-10-16
**Audited source revision:** `8c71a65f2221659053edbd69e8808a436488434c`
**Scope:** Planning and read-only source/evidence review. No application, API, data, dependency, workflow, deployment, or infrastructure changes.

## Executive recommendation

Keep the product as one responsive web application with one authenticated API and one canonical data/sync model. Continue **selective internal modularization**, but do not start another broad rewrite or assume another bundle split is automatically beneficial. Do not create separate applications, services, databases, auth systems, or sync systems on the current evidence.

There is one specific current-source candidate worth resolving before any new optimization: the eager Home import of `LiveRunTabContent` statically imports at least four panel modules that Home also declares as deferred. The source edges are present on the audited revision, but the available Vite build manifest is bound to a different source revision, so the current bundle impact is **not measured**. A revision-matched build and graph check should confirm the exact current leak and size before a narrowly scoped implementation is accepted.

After that, choose further internal boundaries from demonstrated change hotspots. The 20,803-line Home module and 161,498-byte sync route are maintainability indicators, not proof that an extraction will improve user experience or runtime cost. Keep shared state, transaction, authorization, and lifecycle ownership where it is until a separately approved design demonstrates a safe seam.

## Sequencing and evidence boundary

- Before this audit began, Tasks #3245 (Plan QC and Allergen Phase 2) and #3246 (Complete Local AI Evaluation Setup) were both **Merged**. QC follow-on Tasks #3247 and #3248 were also **Merged**. The required sequencing was satisfied.
- The task board was checked again during the review. Tasks #3256 and #3257, which continue local evaluator work, and Task #3260 (Pin Interactive Shell Node) became **Active** during the audit. They do not own the calculator Home, API route-family, or live-state surfaces reviewed here. No work in those tasks was changed or interrupted.
- Earlier decomposition tasks #1173, #1675, #1698, #1707, and #1744 are **Merged**. Their completion is not treated as proof that current source still has the intended boundary or that their historical measurements describe the current revision.
- The report relies on source, retained documents, task records, and safe local checks. It does not use production database access, customer exports, secrets, credentials, or a production probe.
- No current revision-bound bundle, authenticated startup, browser memory, or network trace could be produced in this workspace. The attempted standard web build stopped before Vite ran because prepared build identity is stale/incomplete. Details are retained in the evidence ledger below.

## Current ownership map

| Area | Current owner and boundary | Shared dependencies | Cost/risk of moving it |
| --- | --- | --- | --- |
| Application shell and authentication | `App.tsx` owns top-level routing/providers, auth startup, service-worker update handling, and the authenticated Home lazy entry. | One React Query client, `AuthProvider`, global error/update handling, shared API session. | Low-to-medium for isolated presentation; high if auth/session lifecycle or route origin changes. |
| Home composition and navigation | `pages/home.tsx` remains the web composition root. `Home` owns canonical client `DayState`, selected run/form handoff, persistence orchestration, sync receive/push wiring, and composition of tabs. `useHomeNavigation` owns tab/back-stack state. | Shared context values, run/form identity, sync refs and schedulers, import actions, capability-aware controls. | High for state/lifecycle movement; medium for presentation-only modules with narrow props/contexts. |
| Live run and station UI | `LiveRunProvider` owns live clock/calculation and auto-track integration; `LiveRunTabContent` composes the production surfaces. `HomeTabCtx` and narrower Setup/Warehouse/Inventory/Mixes contexts feed tab components. | Home-owned form/day state, clock isolation, pause/resume, claims, foreground recovery and run identity. | High for moving clock, auto-track, form, or run ownership. Low-to-medium for a screen that consumes an existing context without adding a new store. |
| Deferred UI | `DeferredDepartmentSurface.tsx` provides lazy modules, accessible loading status, and local retry for several editor surfaces. Home also declares dynamic loaders for selected tabs, station panels, and dialogs. | The same Home providers and shared contexts remain mounted. | A valid boundary can reduce transfer/parse work; duplicated imports can defeat it. First-visit latency, retry, offline/PWA cache, and navigation require verification. |
| API composition | `app.ts` applies logging/observability, CORS, parsers, auth-token compatibility, `/api`, static production web serving, and terminal JSON errors. `routes/index.ts` mounts health/public/auth routes, then authenticated capability-family routers and an authorization inventory. | One Express process, shared middleware order, route contracts, database, scope and capability checks. | Registration grouping is relatively low risk; splitting middleware, auth, or transactions is high risk. |
| API capability families | Five explicit families currently group core sync/runs, master-data/imports, inventory/operations, administration, and retained AI. They are router modules inside one process, not separately deployable services. | Shared route authorization audits, global auth, common DB and job registry. | Low-to-medium when preserving paths/order; high if a family becomes a service or independent auth boundary. |
| Canonical data | Drizzle/Postgres in `lib/db`; scoped daily sync state, master-data tables, completed history, auth/session tables, audit/conflict data, and server-job records remain server-owned. Browser storage is a restart/cache aid, not another canonical store. | Shared transactions, scope, idempotency, reset epochs, data-heal history and schema ownership. | Very high for moving persistence, duplicating databases, or splitting transactions. Any schema change needs the additive schema checklist and approval gates. |
| Sync and run lifecycle | Browser `Home` composes `synchronizationStateMachine`; domain policies handle merge choices; server `sync.ts` owns wire handlers, locked/protected merges, SSE, operational intents and server auto-track claims. Offline actions are queued and remain provisional until accepted. | One day-state row per scope/date, reset fence/epoch, run-value stamps, tombstones, outboxes, exact run IDs, canonical responses. | Very high. Stale writes, sleeping devices, reset, retry, clock/counter correctness, and atomic completion can fail silently if ownership is duplicated. |
| Authentication and authorization | One server session model supports cookie and bearer clients; `requireAuth` resolves session and live/sandbox scope, then capability middleware gates routes. | DB sessions/roles, password/session revocation, daily-reset fences, route-level authorization inventory. | Very high. A new app/service would need shared session trust, scope propagation, capability parity, CORS/origin policy, and revocation consistency. |
| Imports and review | Home owns selected files, review state, cancellation/generation guards, commit and errors; parsers and pure logic live in `lib/*`; server routes/jobs own bounded AI or long-running work where used. Workbook/department loaders defer specific entry points. | Same profiles, aliases, master data, authorization, import history, and explicit reviewed Apply paths. | High if UI review/commit or persistence ownership is moved. Pure parsing libraries are lower-coupling, but their source and formula provenance must remain intact. |
| Background work | API startup initializes readiness, starts server auto-track, scheduled maintenance/alerts, and the server-job worker in the API process; the worker dispatches registered workloads. | Same database, scope, leases/idempotency, startup readiness, and API process resources. | High if separated: job leases, duplicate scheduling, health/readiness, DB pool budget, deployment and failure recovery all need an explicit design. |

### Current coupling observations

- `docs/home-architecture.md` and `docs/storage-sync-ownership.md` define clear responsibility seams and forbid second copies of live state. Home is still the state-owning composition root, but multiple controllers and contexts already extract narrower responsibilities.
- Home has 20,803 lines at this revision. It statically imports `LiveRunTabContent`; that component statically imports `WarehouseTabContent`, `MixesTabContent`, `SetupContent`, and `SummaryToolsContent`. Home separately declares dynamic loaders for those same four modules. These current source edges make those four panels reachable from the opening Home graph even when their dynamic loader is intended to defer them.
- The server mounts six authenticated router families: the five functional families proposed in #1707 plus a separate `server-jobs` family. `sync.ts`, `inventory.ts`, `qcWorkflows.ts`, and `operationalReports.ts` remain large route modules. These files are loaded in the same API process; family grouping provides ownership organization, not startup isolation or independent scaling.
- `sync.ts` contains several related high-risk boundaries: full-day writes/merges, operational intents, server claims, reset/date behavior, SSE, and canonical responses. The large file size alone is not a reason to split it.

## Reconciliation of prior proposals

| Proposal/task | Present-day classification | Current-code/evidence reconciliation |
| --- | --- | --- |
| #1173 — safe efficiency audit | **Partially completed; historical measurements remain useful.** | The retained audit records master-data request deduplication (5 requests to 1; 80% fewer requests/response bytes in its fixture), conditional gzip/ETag transport, workbook deferral, and browser budgets. It also records failed/blocked browser journeys. It is not a complete current baseline for every requested dimension, and the current revision was not measured. |
| #1675 — recover UI decomposition | **Completed for the named UI extraction; broader Home decomposition remains.** | Current source has Home tab contexts and extracted setup, warehouse, inventory, mixes, live-station, and management modules. `docs/home-architecture.md` and current hooks locate run identity, lifecycle, sync, and import-dialog responsibilities. Home remains a very large composition root, so this was not a reduction to small page modules. |
| #1698 — split Home by measured feature boundaries | **Partially completed in current source; the intended separation needs a current-build check.** | Home declares dynamic loaders and retry boundaries. However, the current eager import chain through `LiveRunTabContent` statically imports at least four modules that are separately intended to defer. This is a concrete source-level boundary conflict; the exact generated chunk effect is unmeasured because the available manifest is stale. Do not treat the stale manifest’s additional listed modules as confirmed for this revision. |
| #1707 — group API routes by capability | **Original five capability families completed; background work is now a sixth mounted family. Deeper handler/service extraction is partial.** | `routes/index.ts` has explicit family routers and a route authorization inventory. In the current tree, there are 86 non-test route TypeScript files and approximately 277 textual `router.get/post/put/patch/delete` registrations (not a count of unique public paths). `sync.ts` is 161,498 bytes and `inventory.ts` 109,900 bytes. No current cyclomatic-complexity, change-churn, or route-startup measurement was found. All families remain in one in-process server. |
| #1744 — server-canonical run lifecycle | **Completed as a repository ownership direction; current production behavior is not re-proven by this audit.** | Current code has server auto-track tick/claim and operational-intent paths, durable client queues, canonical response handling, protected sync merges, and focused integration/unit suites. `docs/storage-sync-ownership.md` records the ownership contract. The audit did not run the domain suites or access production; this task does not claim a new live lifecycle proof. |

Completed task state is distinct from current architecture and current measurement: only the source checks described here speak to the audited revision; historical bundles and browser results are not current outcomes.

## Measurements and current availability

| Dimension | Evidence | Status for 2026-10-16 revision |
| --- | --- | --- |
| Web production bundle | Historical 2026-09-06 report: Home chunk 1,323.48 kB minified / 345.54 kB gzip after workbook isolation; earlier department and workbook before/after results are in `artifacts/run-calculator/docs/performance-audit-2026-08-23.md`. | **MISSING.** Build failed before Vite ran. Existing `dist/public` assets and manifest are ignored generated output, not source-bound to this revision. `.local/build-identity/expected-source.json` names revision `c7b378056309c36d73150f575dc3cbb6cbc62719`, while audited HEAD is `8c71a65f2221659053edbd69e8808a436488434c`. Do not use existing asset sizes as current measurements. |
| Startup/load/first-use latency | Historical 2026-08-23 signed-out navigation: 2,156 ms to DOM content loaded and 2,192 ms to load. The report marks these development-preview observations and they are not equivalent to the current 1,500 ms app-commit budget. Historical management first visit records 313–320 ms, but its stated 250 ms comparison conflicts with a separately documented 350 ms scoped first-visit budget; clarification was added to the historical report without changing its retained FAIL status. | **MISSING.** No current authenticated browser run or same-revision build. |
| Render, live calculation, storage, HMR | `artifacts/run-calculator/docs/performance-budgets.md` lists 250 ms general tab/Home commit, 16 ms calculation, 100 ms storage scan, and 1,500 ms HMR budgets; diagnostics record bounded timings and optional Chromium heap samples. | **MISSING** current distributions, p50/p95, render counts, and memory values. Budgets are targets, not current results. |
| API/network and sync | Historical bootstrap capture: 464,534 identity bytes, then 40,522 gzip bytes (91.3% body reduction), and 304 with zero body on matching validator. Historical active/foreground polling moved from 5 requests to 1. | **MISSING** current API waterfall, sync payload distribution, SSE behavior, and current production/dev network trace. Historical scope was master-data bootstrap only, not operational sync. |
| Service/route complexity | Current source counts: 6 authenticated router families (five functional families plus server jobs); 86 non-test route files; approximately 277 textual route registration calls; `routes/index.ts` 522 lines, `sync.ts` 3,758 lines / 161,498 bytes, `inventory.ts` 109,900 bytes, `ai.ts` 977 lines. | **AVAILABLE as static structure only.** Registration-call count is not unique routes. No verified route-level complexity/churn metric, startup cost by family, server memory profile, or independently deployable-service need. |
| API startup/background resource cost | `index.ts` shows schema/readiness checks, role seeding and data heals before ready, then auto-track and auxiliary worker loops. | **MISSING** current startup duration, CPU/memory profile, queue saturation, and production capacity. Development data cannot establish published-runtime capacity. |
| Current deferred Home graph | Current source has four directly confirmed static edges described above. Existing manifest-based checker output reports 18 deferred surfaces in the eager graph, but it reads the stale `dist/public/.vite/workbook-boundary-manifest.json`. | **PARTIAL.** The four source edges are confirmed. The current generated graph, exact current number of leaked modules, and current chunk cost are **MISSING**. |
| Workbook loader boundary | `check-workbook-boundary.mjs` reported a pass against the existing generated manifest. | **BLOCKED for current revision** because the manifest is stale; not claimed as a current-source pass. |

### Existing performance budgets (targets, not results)

The checked-in budget document sets 1,500 ms for initial calculator commit, 250 ms for ordinary tab transition and Home render, 350 ms for staff first visit, 16 ms for live calculation, 100 ms for persisted run-value storage scan, 1,000 ms for a timed API request, and 10,000 ms for authenticated first visit on slow 3G. Import budgets are 120,000 ms parse, 2,000 ms review-open, and 10,000 ms commit/export. Keep each scoped budget distinct; do not compare management first-visit load with the ordinary tab-transition threshold.

## Ranked options

Scores below are qualitative trade-offs, not measured results. “Effort” and “validation” describe likely scope based on current boundaries.

| Rank | Option | User/maintainability benefit | Safety | Effort | Coupling | Migration risk | Validation burden | Prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Confirm and resolve the current Home deferred-import conflict; retain it only if a fresh same-revision build demonstrates a meaningful transfer/parse benefit. | Medium-to-high potential for faster authenticated first view; exact bytes unknown. | Medium: station composition and screen behavior must remain intact. | Low-to-medium. | Medium-high because shared live composition is involved. | Low if presentation imports alone move; higher if providers/context move. | High: current bundle graph, live run, navigation, retry, responsive and browser coverage. | A prepared build identity matching the audited source, then a fresh manifest/bundle baseline. |
| 2 | Continue **internal Home modularization**, one change hotspot at a time, using already-owned contexts/controllers; do not move canonical state. | Medium maintainability benefit from narrower review/change surface; no automatic performance claim. | Medium-high with presentation-only boundaries. | Medium. | Medium-high in `home.tsx`. | Low-to-medium if no state owner changes; high if form/sync/timer ownership moves. | High when a changed surface reaches live state; lower for pure presentation. | Evidence of a repeated change hotspot and a chosen owner-approved boundary. |
| 3 | Extract a cohesive API application-service seam only when recurring change/test evidence points to a particular route family (sync or inventory are candidates, not commitments). Preserve URL, middleware, capability inventory, transaction boundaries and one server. | Medium maintainability/testability benefit. | Medium-low for sync/stock mutations. | Medium-high. | High. | Medium-to-high if transaction or error mapping shifts. | High: contract/auth, integration, locking/idempotency, startup and route inventory. | Identified operation and tests that prove behavior before extraction. |
| 4 | Further broad lazy loading or splitting every department/route. | Unknown; possible additional loading overhead and first-use latency. | Medium-low. | Medium-high. | High. | Medium. | High. | A revision-bound bundle/network baseline that identifies an actual eager cost and user benefit. |
| 5 | Separate web app, service, database, auth, or sync deployable. | No concrete current benefit established. | Low on current evidence. | Very high. | Very high. | Very high. | Very high, including operational readiness and failure modes. | Explicit owner approval plus measured independent scaling/availability need, ownership design, cost/capacity budget, auth/scope plan, DB transaction design, SSE topology, deployment and rollback plan. **Not recommended now.** |

### Why separate deployables are not justified

The product’s production workflows share run identity, live day-state, one server-authoritative lifecycle, scoped master data, role/capability checks, and transactions that combine operational effects. A new deployable would add cross-origin/session/CORS and cookie or bearer-token decisions; duplicate or shared authorization and scope enforcement; API/version compatibility; DB connection pools and transaction coordination; background-job ownership and idempotency; health/readiness and rollout/rollback coordination; and ongoing hosting/observability cost. Splitting sync or API processes also requires a supported SSE fan-out/topology and queue/lease design. Current retained plans explicitly say that published capacity/topology evidence is incomplete and that local measurements are not production capacity. No evidence here demonstrates that these costs solve a current problem.

## Owner-visible decisions before implementation

- **No decision is needed to accept this audit.** It makes no product or deployment change.
- Before accepting Slice 1, decide whether the primary goal is authenticated first-view performance or maintainability. The current source-level import conflict makes first-view performance the first candidate, but the exact bundle savings must be measured before keeping a split.
- Before accepting Slice 2, choose a Home change hotspot based on actual review/task history; do not select a boundary only because it is a large file or component.
- Before accepting Slice 3, identify one concrete route operation and confirm its transaction, authorization and error contract. “Split sync” or “split inventory” is not a sufficiently bounded decision.
- A separate deployable requires explicit owner approval and the evidence gates listed above; the current recommendation is to defer it.

## Recommended bounded sequence

The sequence below is for future owner-approved implementation planning, not permission to edit product code in this audit.

### Slice 0 — Establish a revision-bound baseline and resolve evidence status

- Prepare build identity for the exact source revision through the approved project build process, then run the standard web build and retain its generated manifest/chunk sizes. Do not use a stale artifact or refresh production identity as a substitute.
- Re-run both deferred-boundary checks against that exact build. Trace every reported eager surface to its current source importer; separate true code leaks from manifest/test defects.
- Capture authenticated desktop and phone cold start, first production view, first use of any affected panel, and navigation under the existing slow-network browser profile. Report median and p95 over at least five clean contexts; include transferred bytes and gzip for the entry and Home chunks.
- Run the existing performance checks relevant to the changed paths. Do not run full release suites solely for this decomposition audit.
- **Acceptance:** source/build identity match; both boundary checks have explicit current-revision results; baseline includes raw/gzip bundle sizes, authenticated timing distributions, and browser/network profile. Missing setup remains a named blocker, not a pass.

### Slice 1 — Fix only the confirmed Home static edge if the fresh build proves it is costly

- **Depends on:** Slice 0 and a separately accepted implementation scope.
- Change the import ownership of the four confirmed panels only if the fresh manifest confirms they enter the initial Home graph and their bytes are material. Keep the current `Home`, `LiveRunProvider`, auth, sync, form, and master-data owners mounted once.
- Do not duplicate component state or introduce a second loader/review path. Preserve accessible loading/retry behavior and prefetched intent where it exists.
- **Acceptance:** deferred graph checker passes for all declared deferred panels; the initial authenticated Home transfer falls by at least **25 KiB gzip or 5% of the measured Home gzip payload, whichever is larger**; no other chunk or first-use transition exceeds its current scoped budget; no error, retry, permission, or offline-cache regression.
- If the current chunk savings do not meet that threshold, retain no additional split; document the measured result and choose a maintainability-only boundary instead.
- **Rollback:** revert the presentation/import-only change. No persistence or schema migration should be included.

### Slice 2 — Select one Home maintainability seam from actual change hotspots

- **Depends on:** Slice 0 and owner selection of a concrete, repeated change hotspot. This can proceed without moving live state or changing the Slice 1 loading boundary.
- Use code review history or task evidence to identify a cohesive area that repeatedly changes independently. Extract one presentation or pure view-model seam with typed props and existing contexts; keep state ownership in Home/controllers/providers.
- Avoid an arbitrary line-count target. The measurable result is a narrower, independently testable owner boundary and no duplicated state, write path, or provider.
- **Acceptance:** focused component/domain tests and typecheck pass; existing run identity, autosave, permission, and loading behavior remain unchanged; the extraction introduces no new per-second subscribers for non-live screens. If it touches lifecycle, forms, auto-track or sync, require the applicable `state-accuracy-check` and `sync-invariant-check`.
- **Rollback:** one reversible module extraction with no route/schema/state-shape changes.

### Slice 3 — Consider one API application-service seam only after identifying a concrete repeated operation

- **Depends on:** A named operation with existing contract/auth/transaction tests and owner acceptance of the no-contract-change scope.
- Start with a single operation and keep the family router, URL, middleware order, capabilities, response contract, and database transaction boundary unchanged.
- Do not extract `sync.ts` wholesale, alter server-job ownership, introduce another DB pool, or split SSE into a service as a “cleanup.”
- **Acceptance:** before/after contract and authorization inventories are identical; focused API integration tests cover authorization, scope, concurrency/idempotency, error mapping and the owning transaction; startup and memory are measured in the same environment before/after and show no material regression. For sync/lifecycle changes, include the full relevant sync and state-accuracy invariants and multi-device tests.
- **Rollback:** revert the service extraction without schema changes. Any later persistent-data or topology proposal requires a separate owner-approved plan and compatibility window.

### Decision gate — Separate deployable

Do not draft implementation work for a new app/service/database/auth/sync topology unless a future evidence package demonstrates a distinct user or resource benefit and includes: published workload and instance/pool budgets; clear canonical data ownership; shared auth/session and capability model; transaction and job idempotency design; SSE/fan-out topology; failure/degraded behavior; deployment/readiness/rollback; and incremental migration costs. Owner approval is required before any topology change.

## Future browser validation matrix

For any web-facing slice, automated browser emulation must cover the affected paths in Chromium and WebKit at:

| Viewport | Chromium/Chrome emulation | WebKit/Safari emulation |
| --- | --- | --- |
| Desktop | Required | Required |
| Phone | Required | Required |
| Tablet portrait | Required | Required |
| Tablet landscape | Required | Required |

Also verify loading/error/retry, reload/PWA update safety, authentication and permission gates, and offline or slow-network behavior when relevant. These are emulated browser results only. Physical Android Chrome and physical iOS Safari/PWA are separate evidence; not run in this audit and not implied by emulation.

## Findings and unresolved evidence ledger

| ID | Finding/result | Severity and evidence | Owner and next action |
| --- | --- | --- | --- |
| F-01 | Current standard web build **BLOCKED** before Vite. | Medium evidence gap. `BASE_PATH=/ bash scripts/src/run-release-node.sh pnpm --filter @workspace/run-calculator run build` exited 1 with “Web build identity is incomplete or stale.” Expected build revision is `c7b378056309c36d73150f575dc3cbb6cbc62719`; audited HEAD is `8c71a65f2221659053edbd69e8808a436488434c`. No current bundle was generated by this attempt. | Build/source-identity owner: prepare a revision-matched identity and rerun the focused web build before using bundle numbers. No identity files or build settings were changed in this audit. |
| F-02 | Home source statically imports optional panels through `LiveRunTabContent`. | Medium product/performance risk; exact byte cost is unknown. `home.tsx:67` imports `LiveRunTabContent`; `LiveRunTabContent.tsx:15-19` statically imports Warehouse, Mixes, Setup, and Summary panels; Home also has dynamic loaders for those modules. This can make optional code reachable from the initial Home chunk. | Calculator UI owner: validate with a source-matched build graph, then decide whether a narrow import-boundary repair merits acceptance. This is not fixed here because product code changes are outside this task. **Merits a separately accepted implementation change after the roadmap is reviewed.** |
| F-03 | Existing manifest boundary results are stale for the audited revision. | Low-severity evidence-integrity limitation, not a current-build result. The existing manifest-based deferred-home checker reported 18 modules in the eager graph; existing generated assets and manifest are not bound to audited HEAD. The source confirms at least the four F-02 edges; the other 14 are unconfirmed for current HEAD. Workbook checker reported a pass against the same existing artifact. | Calculator build owner: rerun both checks on a same-revision build and classify each module. Keep current-revision status **MISSING/BLOCKED** until then. |
| F-04 | Historical management-performance report has a threshold mismatch. | Low documentation/evidence issue. The report’s regression section defines a 350 ms first-visit budget, but its 2026-08-23 row compares 313–320 ms with 250 ms. Current `performanceDiagnostics.ts` assigns 350 ms to first visit, but it cannot retroactively establish the historical assertion. | Fixed in `artifacts/run-calculator/docs/performance-audit-2026-08-23.md`: retained the reported test **FAIL** while documenting that its budget comparison is unresolved and must not be reinterpreted without original assertion output. |
| F-05 | Historical task plans point to performance docs at a path not present in the checkout. | Low locator issue. The reports are in `artifacts/run-calculator/docs/`, not top-level `docs/`. This roadmap uses and cites the verified artifact-local paths. The old merged task records were not edited. | Closed for this report by using the verified paths. No code or historical platform task record changed. |
| F-06 | Current render, memory, startup, network, and server resource distributions are unavailable. | Missing evidence, not a regression claim. No current authenticated browser run, same-revision build, or production capacity probe was performed. | Future Slice 0 owner: collect revision-bound local browser evidence. Published capacity/topology requires its own authorized evidence lane; do not infer from development workspace data. |

## Verification record

- Task board sequencing and overlap: **PASS** — #3245/#3246 and #3247/#3248 were merged before substantive work; later active tasks reviewed and found unrelated.
- Read-only source and document inspection: **PASS** — ownership map, prior proposals, current code paths, retained performance documents, and imported roadmap status reconciled.
- Workbook-boundary script against existing artifact: **PASS, stale artifact only** — not a current-source pass.
- Deferred-Home-boundary script against existing artifact: **FAIL, stale artifact only** — 18 entries reported; only four edges independently confirmed from current source.
- Standard web build for audited revision: **BLOCKED** — stale/incomplete build identity; no Vite build ran.
- Current authenticated browser matrix, render/network/memory measures: **MISSING / NOT RUN** — planning-only audit; no current build or browser measurement was available.
- API contract, route, sync and state-accuracy tests: **NOT RUN** — no product code changed; historical passing tests are not represented as current verification.
- Worktree: no application code changed; only the historical report clarification and this new roadmap document were changed.

## References

- `AGENTS.md`
- `replit.md`
- `.agents/skills/task-execution-rules/SKILL.md`
- `.agents/memory/roadmap-synthesis.md`
- `.agents/skills/state-accuracy-check/SKILL.md`
- `.agents/skills/sync-invariant-check/SKILL.md`
- `.local/tasks/task-3249.md`
- `.local/tasks/full-calculator-efficiency-audit.md`
- `.local/tasks/split-home-by-measured-feature-boundaries.md`
- `.local/tasks/recover-ui-decomposition.md`
- `.local/tasks/group-api-route-families.md`
- `.local/tasks/server-canonical-run-lifecycle.md`
- `artifacts/run-calculator/docs/performance-audit-2026-08-23.md`
- `artifacts/run-calculator/docs/performance-live-trace-2026-09-05.md`
- `artifacts/run-calculator/docs/performance-budgets.md`
- `docs/home-architecture.md`
- `docs/storage-sync-ownership.md`
- `artifacts/run-calculator/src/App.tsx`
- `artifacts/run-calculator/src/pages/home.tsx`
- `artifacts/run-calculator/src/components/live-stations/LiveRunTabContent.tsx`
- `artifacts/run-calculator/src/departments/DeferredDepartmentSurface.tsx`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/routes/sync.ts`
- `artifacts/api-server/src/routes/capabilities`
- `lib/db/src/schema`
- `docs/sync-reliability-unified-plan-2026-09-19.md`
- `attached_assets/FULL-PLAN-production-run-calculator-2026-10-03_1791084665943.md`
