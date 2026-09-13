# Server Live-Calc Streaming — Slice 2: Setup-Form Calcs

## Context

Slice 1 made the server the live calc authority **while a run is active**: the SSE stream emits a 5s `serverCalc` tick and the client adopts it inside a 10s freshness window with local `computeCalc` fallback. However, the **Setup tab** is outside that path. Today the Setup tab derives its numbers in two places:

- `computeCalc` (from `@workspace/live-calc`) already computes the bulk of setup-relevant values — yield, batch needs, trays, dough depletion, timing, ingredient lbs/batches per applicator/pepperoni slot, sauce batches.
- But the Setup tab does **not** consume the streamed `serverCalc`; it renders from its own local `v`/form watch. Each device runs the same math, but there is no server authority and no dedupe: every edit triggers a full local recompute on every device.

Goal: extend the slice-1 pattern so that **while a run is selected (including a pending run in Setup), the server streams the computed setup calc** — same `ServerCalcResult` shape — and the Setup tab adopts it with the same freshness/run-identity guard and local fallback.

## What is already computed server-side (no new math needed)

`computeServerCalc(payload, defaultPepTypes, nowMs)` already derives a full `Calc` from `SyncPayload.runValues[run.id]` and `dayState.runs[currentIndex]`:

- Yield/`perBatch`, `perTray`, `traysPerBatch`, `batchesPerSkid`
- `batchesNeeded`, `traysNeeded`, `stacksNeededTotal`, `casesLeftToRun`, `buffer`, `doughShortCases`, `doughDepletionSec`
- `totalTimeSec`, `adjustedTimeSec`, `timePer<Tray|Batch|Skid|Case>Sec`, `rackTimes`
- `sauceBatches`, `sauceDepletionSec`
- Ingredient lbs/batches: `app1..4`, `pep1..2` (incl. `LbsB`/`BatchesB` variants)
- `ppm` via `computeEffectiveLineSpeed` (dough OR crusts sub-tab)

The Setup-form calc is therefore **not new math** — it is the same `Calc` computed from the same `runValues` the server already persists. Slice 1 simply gated the tick to active runs (`startedAt && !endedAt`); slice 2 widens the adoption surface so a selected pending run's Setup tab also uses the streamed values.

## Approach (delta on slice 1)

1. **Emit setup calcs on the SSE stream.** The per-client calc tick (`liveCalcTick.ts` + `sync.ts`) changes from *active-run only* to *any selected run with usable runValues*. Idle behavior: when no run is selected, or the day state has no runs, emit nothing (same as slice 1). The tick frame keeps `calcTick: true` + `serverCalc` (same `ServerCalcResult` shape) + `serverTime` + `canonicalRevision`.

2. **Client adoption in the Setup path.** The Setup tab reads `v`/form watch today. Add an adoption branch mirroring slice 1:
   - When online + connected + the streamed `serverCalc.runId === currentRunId` + receipt fresh (`shouldUseServerCalc`, `LIVE_CALC_STALE_MS` 10s) → the setup-visible numbers (yield, batch needs, timing, ingredient lbs/batches) come from `serverCalc.calc`.
   - Otherwise → local `computeCalc` path exactly as today (blank-free).
   - Pure helper: `shouldUseSetupServerCalc` (or reuse `shouldUseServerCalc` + a selected-run predicate). No day-state writes; read-only derivation.

3. **Display-only switch.** The Setup tab is a planning surface: values shown for yield/batch/timing/ingredients swap to the server-derived `Calc` when adopted; input fields stay editable locally (still pushed through the normal sync path). Nothing about form constants or `v`/`ve` changes.

## Payload contract

Reuse `ServerCalcResult` untouched: `{ runId, calc }`. The tick frame is additive to the existing operational payload (`operationalProjection`, `serverCalc`, `capturedAtServerMs`) — same as slice 1. No day-state shape changes; unknown/new SSE fields must be tolerated by the client receive path (already true).

## Client guard details

Same freshness semantics as slice 1:
- window = 2 tick intervals default (10s, `LIVE_CALC_STALE_MS`)
- run identity: `receipt.runId === currentRunId` AND `currentRunId === currentRun?.id`
- hard stops: run switch, reset epoch advance, SSE reconnect missing the window → instant local fallback

## Tests

**Server:**
- Unit (`liveCalcTick`): pending run (startedAt absent) with runValues → emit true; no runs → false; ended run → false; interval cadence unchanged.
- Integration (SSE, CI): selected pending run with seeded runValues → calcTick frame with `serverCalc.runId` matching the selected run; idle → no frame.

**Client:**
- `operationalState`: pending-run freshness helper branches (online/offline/disconnected/no receipt/stale/fresh).
- Setup adoption: fresh streamed calc used (no local recompute); stale/offline falls back; run switch cancels; does not write day state.

**Regression:** `state-accuracy-check`, `sync-invariant-check`, slice-1 `LiveRunContext.calcTick`, `operationalState`, api-server `sync.liveCalcTick` stay green.

## Out of scope (later slices)

- Ingredient/consumption **sums** (inventory draw-down projections, mix-component totals beyond per-slot lbs/batches) — slice 3.
- Full run-timing server authority (finish-time projections, elapsed-server vs elapsed-client reconciliation) — slice 3/4.
- Mobile parity.

## Rollback

Small, independent commits on the feature branch: revert the tick predicate → active-run only; return client adoption to the slice-1 gate. Both changes are additive and do not alter day-state writes.

## Code references

- `artifacts/api-server/src/lib/liveCalcTick.ts` — `shouldEmitLiveCalcTick` / `buildLiveCalcTickFrame` (active-run predicate to widen)
- `artifacts/api-server/src/routes/sync.ts` — per-client calc tick interval
- `lib/live-calc/src/index.ts` — `computeCalc` / `computeServerCalc`
- `artifacts/run-calculator/src/operationalState.ts` — `shouldUseServerCalc`, `LIVE_CALC_STALE_MS`
- `artifacts/run-calculator/src/pages/home.tsx` — SSE receive + `adoptOperationalProjection` / `adoptServerCalcReceipt`
- `artifacts/run-calculator/src/components/SetupContent.tsx`, `SetupProfileEditor.tsx` — Setup tab render path
