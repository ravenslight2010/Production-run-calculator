# Server Migration — Warehouse Coverage Adopts Streamed Consumption Lines

## Context

Slice 3 made the server compute and stream per-run consumption `runLines`
(keyed by run id, `ConsumeLine[]` = `{ itemKey, qty }`) in every sync SSE frame.
The client stored them in `serverRunLinesRef` but **never read them**: the
warehouse coverage advisory (`computeWarehouseCoverage`) still derived each
run's consumption locally from `FormValues` (via `computeRunConsumptionLines`).

That left the Inventory tab's "covered / short / conversion / missing"
comparison inconsistent with the server-canonical consumption the rest of the
app adopts (live calc, summary stats, timers, phases), and every device
re-derived the same math from its own local values.

## Goal

Make the server-streamed `runLines` the coverage source for any run with a
known id, keeping the local derivation as the offline/absent fallback — the
same adoption pattern as slices 1–6.

## Changes

- `artifacts/run-calculator/src/inventoryShared.ts`:
  - New `RunConsumptionSource = { runId?: string | null; values: FormValues }`.
  - `computeWarehouseCoverage` now takes `runSources: RunConsumptionSource[]`
    and an optional `serverConsumptionLinesByRunId: Record<string, ConsumeLine[]>`.
    For each source, the aggregation uses the server lines when the run id has
    them; otherwise `computeRunConsumptionLines(source.values)`. Server lines
    replace — never double — the local derivation.
  - `ConsumeLine` is re-exported (already exported).
- `artifacts/run-calculator/src/pages/home.tsx`:
  - New `inventoryRunSources` memo (run ids + effective values).
  - New `inventoryServerRunLines` memo reading `serverRunLinesRef` (tab-gated).
  - `inventoryTabCtxValue` exposes `coverageRunSources` + `serverRunLines`
    (dep registry `inventoryTabCtxDeps.ts` updated in step-lock with the memo).
- `artifacts/run-calculator/src/contexts/InventoryTabCtx.ts` — value contract
  gains `coverageRunSources` + `serverRunLines`.
- `artifacts/run-calculator/src/components/InventoryTabContent.tsx` +
  `InventoryTab.tsx` — props thread through; the coverage memo passes the
  server lines into `computeWarehouseCoverage`.

## Safety

- Absent server data (offline, pre-first-frame, run not streamed) falls back to
  the exact local math — never blank, never zeroed.
- Server lines for an unmatched run id are ignored.
- Display-only advisory: no inventory writes change.
- Refresh cadence matches the existing summaryStats pattern (reactive on
  day-state/values changes; the SSE frame also carries calc/projection state
  bumps).

## Tests

- `warehouseCoverage.test.ts` — existing suites updated to the new source
  shape; new tests: server lines replace the run's local lines (deterministic
  delta), and unmatched server run ids are ignored (output identical to
  local-only).
- Regressions: `warehouseGrouping`, `inventoryFinalizationCoverage`,
  `inventoryShared.incidentReporting`, `LiveTabMemo.snappy` (dep registry) —
  93/93 total.

## Out of scope

- Run-end ledger writes (`useRunLifecycleManager` posts local lines to the
  API on end/advance) — a write path, unchanged.
- Mobile parity.

## Rollback

Revert the signature change + wiring; coverage returns to the local-only
derivation. All changes are additive display plumbing.
