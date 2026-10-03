# App/Main/Plans Reconciliation Report

## Compared revisions

- Initial app baseline: `bf695fd5983e2813017b83e5ca596e8aaf313672`
- Protected rebase base: `main-repl/main` at `e8dc4a0a`
- Reconciled review revision: `1c773002949213c6a78d5ab9b6b7580603e9f1c6`
- GitHub main: `8885c9a523aeb6035d4690679c3487174a00a6fa`
- Merge base: `afa300299e41c12458120ba1e2c1a4aba9a6c53f`
- Protected recovery reference: branch and tag `recovery-baseline-task-2415-20260921`
- Fresh map: [branch-map-2026-09-21.md](branch-map-2026-09-21.md)

GitHub `main` did not move after the attached 2026-09-20 snapshot. Protected delivery incorporated concurrent reviewed app-main work through `e8dc4a0a`; the app line now contains 153 app-only commits versus the same five GitHub-main-only commits.

## Integration decision

The current app tree remained the functionality baseline. No reset, rebase, force push, whole-tree merge, or wholesale file replacement was used.

- The corrected main battery audit was incorporated as current evidence with explicit implementation and production-evidence boundaries.
- Main's route/heartbeat and source-library repair commit was not replayed because focused review found its behavior in newer app code and a replay would overwrite later sync and repair work.
- Main's older sync/import/AI planning was not copied over newer app authorities. Its still-valid conclusions are represented in the unified reliability plan, current importer plans, AI value audit, and current backlog.
- The aggregate merge and superseded first battery audit were not replayed.

## Capability reconciliation

| Domain | Repository status | Open boundary |
|---|---|---|
| Sync | Partial | Complete/partial snapshot fencing and measurements are built; repeated-offline convergence, current deployment evidence, and device/conflict visibility remain |
| Server calculations | Done for projected live surfaces | Offline and unsaved edits intentionally retain shared local fallback |
| Inventory | Partial | Freeze completion totals before deduction; waste/returns and facility reconciliation |
| Mixes | Partial | Physical-event deduction and surplus exist; broader operational reconciliation remains |
| Freezer | Partial | Dated lots/allocations exist; unified lookahead and physical reconciliation remain |
| Warehouse | Partial | Snapshots/staging/needs exist; multi-day capacity and conflict planning remain |
| Imports | Partial | Apply atomicity, guarded undo, deterministic-first parsing, provenance, QC gate |
| QC | Open beyond thin foundations | Durable role, checks, audit model, approvals, reporting |
| Allergens | Partial | Ingredient mapping, QC/cleaning gates, declarations, reporting |
| Reporting | Partial | Automation, exports, costs, trends, comparisons |
| Downtime | Partial | Live alerts, classification, cost, recurrence, correlations |
| Battery/performance | Partial | Visibility-aware timer consolidation and Floor Mode Wake Lock are built; real-device measurements remain |

## Historical evidence handling

The uptime brief proves one healthy warm production probe on 2026-09-20. It does not establish the cause of intermittent downtime or current deployment configuration. The bug/security audit was used as a claim inventory. Implemented auth, capability, sandbox, input-size, sync-sanitization, and complete-write snapshot-fencing controls remain credited; repeated-offline convergence, import atomicity, account lifecycle, and AI operational-data boundaries remain owned by dedicated work.

## Mirrored documentation

- `docs/idea-backlog.md` is the current catalog and now contains a capability matrix.
- `.agents/memory/idea-backlog.md` is explicitly marked historical.
- `docs/importer-redesign-plan.md` is current; its memory copy is marked historical.
- Focused memory notes remain concise invariants; complete-write fencing is explicitly labeled proposed rather than implemented.

## Remaining evidence gaps

- Exact published revision and current deployment target.
- Authenticated published SSE behavior and any cross-instance fanout.
- Production payload, reconnect, pool-pressure, and capacity measurements.
- Facility inventory reconciliation and operator acceptance.
- Durable QC/allergen records and approval evidence.
- Real-device battery and Wake Lock behavior.

Development tests and repository inspection must not be used as substitutes for those production or human observations.

## Validation

- `git diff --check` — passed.
- `pnpm run audit:recovery` and JSON mode — 10 passed, 0 intentional differences, 0 missing.
- `pnpm run typecheck` — passed after repairing malformed test-only merge residue in the sync convergence suite; no runtime code changed.
- API sync release shards — 113 non-SSE tests passed with 7 skipped; 7 SSE tests passed with 113 skipped.
- Sync convergence integration suite — 4 tests passed after the protected rebase added stale-break-plan recovery coverage.
- Client test budget — 299 files and 2,792 tests passed in 81 seconds, within the 150-second budget.

The standard release gate was not run because reconciliation did not change runtime application code. Delivery remains subject to the assigned task's protected completion review.