# V1 findings reconciled to V2

**V1 source inspected:** checkout `dc6e5205f55fa74005373c6d7f06fae8df0f3399`,
2026-11-10.  
**Prior app-wide baseline:** `docs/research-reconciliation/app-wide-audit-2026-10-29.md`,
updated through 2026-11-04, source/build identities recorded in that report.
The audit is archived at
[the exact report copy](archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md).

This is a scoped V2 assessment. It reuses the prior twelve-domain audit rather
than repeating it. The audit's latest source fingerprint predates this
inspection; current V1 source and focused, non-database tests were checked for
the launch capabilities below. No production, database, deployment, or
physical-device claim is inferred.

## Evidence checked on the inspected checkout

Thirteen focused test files passed, 286 assertions/tests total, on
`dc6e5205f55fa74005373c6d7f06fae8df0f3399`:

| Source of truth | Test files | Result |
|---|---|---:|
| Shared run calculations | `lib/live-calc/src/liveCalc.test.ts` | 14 passed |
| Inventory math | `lib/inventory-math/src/index.test.ts`, `mixSurplus.test.ts` | 96 passed |
| Production rules | `lib/production-rules/src/index.test.ts` | 17 passed |
| Import parsing/review semantics | `lib/spec-import/src/importSafety.test.ts`, `deterministicWorkbook.test.ts`, `mergeParsedSpecImports.test.ts` | 40 passed |
| Server auto-track claims and capability checks | `artifacts/api-server/src/lib/autoTrackServerTicks.test.ts`, `autoTrackCoordination.test.ts`, `middlewares/requireCapability.test.ts` | 74 passed |
| Client lifecycle and sync policy | `artifacts/run-calculator/src/domain/runSyncPolicy.test.ts`, `startRunReadiness.test.ts`, `hooks/useRunLifecycleManager.test.tsx` | 45 passed |

These are focused unit-level checks. They did not use PostgreSQL, test all
importer families, validate a full manager/operator UI journey, exercise two
physical devices, or establish published V1 behavior.

## Capability reconciliation

| V2 first-release outcome | V1 evidence at the inspected revision | V1 claim label / lifecycle | V2 starting point and remaining boundary |
|---|---|---|---|
| **Run control and every production station** | Current source has run routes, server-owned lifecycle/sync paths, station-specific state, shared calculation libraries, and production-rule enforcement. The focused calculation/rules/client lifecycle tests passed above. The prior audit includes selected lifecycle/browser evidence, but those browser results are bound to their recorded earlier revisions. | **Partially verified**; implemented contract with bounded current unit evidence. Source presence and unit tests do not prove complete station workflows or physical production correctness. | V2 has a local run-control model, service, SQL command boundary, request-scoped handler, OpenAPI description, and screen draft. The real auth/CSRF adapters and executable host are absent; station-specific workflows are not implemented. The approved V2 outcome remains broader than the current code. |
| **Full inventory and fresh opening count** | Current V1 routes and schema include lot/ledger accounting, run-consumption idempotency, prepared-mix handoff, and finished-case adjustments. Inventory math passed 96/96 focused tests. Prior disposable-database evidence is historical and bounded. | **Partially verified**; implemented accounting contracts, not physical-count or production-accounting sign-off. | V2 architecture specifies lots, append-only movements, idempotent commands, and a first-class physical opening count. V2 does not yet implement inventory workflows. V1 balances and movement history must not be carried. |
| **Recurring imports and master-data setup** | V1's seven importer families and distinct Apply/Undo boundaries are documented in the archived import plan. Current focused deterministic/import-safety tests passed 40/40. Existing UI and persistence results in the prior audit are tied to their own test revisions; no importer database or browser suite was run for this package. | **Partially verified**; supported parser/review contracts exist, while current end-to-end persistence and source correctness are not established here. | V2's architecture includes staged, manager-confirmed, idempotent import Apply. No recurring V2 import UI/API exists. Draft #3913 is specifically setup/master-data transfer; it is not evidence that ordinary production imports are implemented. |
| **Authentication and roles** | V1 has username/password session routes, capability middleware, role routes, and DB-backed session/schema boundaries. The selected current capability tests passed as part of the 74 API tests. No auth database/browser integration ran. | **Partially verified**; current source and focused capability checks, not full auth certification. | V2's request handler requires injected authentication and CSRF adapters, but the adapters/session implementation are absent. Draft #3914 proposes V2-owned sign-in and existing-role revalidation. V1 credentials, password hashes, sessions, and reset tokens are excluded from transfer. |
| **Multi-device sync and read-only offline behavior** | Current V1 source includes canonical server sync routes, snapshot/outbox boundaries, client recovery, and conflict policy. Current client sync/lifecycle tests passed 45/45. The prior audit's browser evidence is synthetic and revision-bound; physical wake and device handoff remain unverified. | **Partially verified**; current unit evidence and historical bounded browser evidence, not physical-device or published verification. | V2 architecture defines revisioned snapshots/cursors, SSE as invalidation only, and read-only cached state while disconnected. V2 has no completed multi-device/PWA flow or two-session browser proof. |
| **Automatic tracking** | Current V1 source contains server tick/claim selection, coordination, and station-specific accounting. The selected server tick/coordination tests passed within the 74 API tests. This does not prove deployed timing, capacity, or exact incident cause. | **Partially verified**; implemented contract and selected unit evidence; operational outcome remains unverified. | V2 architecture proposes one supervised worker with database leases, fencing, and idempotent due-action receipts. No worker process or restart proof exists in V2. |
| **Cutover and retained V1 history** | V1 schemas and existing plans distinguish setup/master data from production runs, sessions, inventory movement, and operational history. This assessment made no data query or transfer. | **Verified** for the documented scope boundary only; cutover execution is not run. | V2's architecture recommends carrying approved setup/master data and identities/roles, requiring fresh sign-in and a fresh physical inventory count, and excluding run history and V1 stock. It recommends a separately restricted read-only V1 archive with a retention decision; no archive exists. |
| **Replit deployment boundary** | Current repository configuration is not a V2 deployment. The current V2 architecture records official Replit documentation checked 2026-11-10: same-project artifacts publish together; separate projects do not share a managed production DB; one Reserved VM can host multiple processes. | **Partially verified**; documented platform fit, not an executed application deployment. | The candidate is one V2 project/Reserved VM with supervised API and worker processes. Shared synthetic database behavior, restarts, publish compatibility, and usable connection limits remain untested. Do not publish the V1 project to test this. |

## Status of the planning records

Accessible task records were checked on 2026-11-10 and are preserved under
[task-record snapshots](archive/task-records/):

| Record | Captured state | How to interpret it |
|---|---|---|
| #3715, Compare all research and plans with the current app | Merged | Its V1 audit is a completed input. The audit report, not the task reference, is the portable evidence. |
| #3907, Finalize V2 Architecture and Data Plan | Merged | The architecture and cutover plan are the current V2 planning source, not proof of implementation or deployment. |
| #3908–#3912, earlier V2 deployment/run/station/inventory/data-copy proposals | Archived in the supplied task context; records report `CANCELLED` | Historical proposals only. Do not treat them as approved requirements or recreate those tasks. |
| #3913, Bring approved setup and master data into V2 | Draft (`PROPOSED`) | Not accepted or implemented; limited to setup/master-data transfer. |
| #3914, Give V2 staff secure sign-in with existing roles | Draft (`PROPOSED`) | Not accepted or implemented; limited to sign-in, roles, and safe identity transfer. |
| #3915, Package V1 Research for V2 | Active (`IN_PROGRESS`) at snapshot time | This package's task record; not an additional V2 feature approval. |

One architecture-sequencing conflict remains open: the merged architecture
calls the deployment pilot a gate before V2 feature implementation, while the
owner-confirmed V2 scope note and current V2 README say isolated V2 code can be
written before the separate-project pilot, which is a pre-release gate. The
existing V2 run-control slice already exists. This bundle preserves both
statements rather than imposing a retroactive code freeze; see
[the gap ledger](gaps.md#decision-and-evidence-ledger).

## Scope limits

This reconciliation does not repeat the prior audit's twelve-domain matrix,
certify production, assess all historical files, or assert complete V1
behavior. It does not include customer workbook contents, production rows,
credentials, sessions, or hidden task conversations. The V1-wide source catalog
is metadata discovery rather than full content review; its original raw
inventory is not included because it exposes customer-source filenames.
