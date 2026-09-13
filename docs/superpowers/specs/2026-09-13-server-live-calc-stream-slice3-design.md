# Server Live-Calc Streaming — Slice 3: Ingredient/Consumption Sums

## Context

Slice 1 made `serverCalc` authoritative for active runs (5s tick, 10s freshness window).
Slice 2 widened the tick to any selected run with `runValues` (pending runs included).

However, two sets of derived data are still computed locally on every device:
- **Summary stats** (`computeSummaryStats`) — the server already streams these in the `summaryStats` payload field. The client adopts them for persisted runs but always recomputes locally for the *current* run. This is the one remaining gap: the current run's summary stats should also come from the server when the form values are recent enough.
- **Warehouse/inventory consumption rows** (`aggregateNeedRows`, `computeRunLines`) — these expand per-run ingredient lbs/batches into per-ingredient warehouse pull rows and packaging needs. Today every device computes them from local `FormValues` using `computeSummaryStats` and recipe expansion. Cross-device inconsistency is possible when a device's form values lag behind the sync boundary.

**Goal of slice 3:** stream `runLines` (the full ingredient + packaging consumption breakdown per run) from the server alongside `summaryStats`, so the Warehouse tab, Inventory tab, and Summary tab can adopt server-authoritative values with the same freshness/fallback pattern. The current run's summary stats also adopt from the server.

## What is already computed server-side

`computeRunConsumptionLines(vals, pepTypes)` in `@workspace/inventory-math` is a pure function from `SummaryStatsInput` (which matches `FormValues`). The server already imports it (used in `consumeRunInTransaction` for run-end inventory deduction). The math exists; it is simply not streamed to clients in real-time.

## Approach

### Server: add `runLines` to `computeServerLiveState`

1. Extend the return type of `computeServerLiveState` (in `sync.ts`) to include:
   ```ts
   runLines?: Record<string, Array<{ itemKey: string; qty: number }>>;
   ```
2. Inside the `summaryStatsMap` loop (which already iterates all runs), also call `computeRunConsumptionLines(vals, pepTypes)` and store the result keyed by `runId`. The new `runLines` map goes into every SSE frame alongside `summaryStats`.

### Client: adopt `runLines` from SSE

3. In `home.tsx` SSE receive path, store `msg.data.runLines` (or `msg.runLines`) in a new `serverRunLinesRef`.
4. In `inventoryShared.ts` (or the Warehouse/Inventory components), when the server runLines are available for a persisted run and the device is online, use them instead of computing locally. The current run continues to compute locally (form is being edited), OR adopts the server value with the same freshness guard if the run has not changed since the last sync push.
5. Same fallback pattern: offline / stale / no server data → local compute. Never a blank UI.

### Current-run summary stats adoption

6. The `persistedRunSummaryStats` memo in `home.tsx` currently always computes `computeSummaryStats(v)` for the current run. With slice 3, when the server's `summaryStats[currentRunId]` is available and the form values match the last-pushed values, adopt it. Add a guard: `lastSyncedFormHash` or simply check `isOnline && serverSS[currentRunId]` (the server only has the current run's stats if the client has pushed the current form values — which happens on every sync).

## Tests

**Server:**
- Unit: `computeServerLiveState` now returns `runLines` map for each run with runValues; empty when no runs / no runValues.
- Integration: SSE frame with seeded runValues includes `runLines` for the selected run.

**Client:**
- Warehouse/Inventory: adopts server runLines when online + fresh; falls back to local compute when offline/stale.
- Summary tab: adopts server summaryStats for current run when online; local fallback.

**Regression:** all existing slice-1 + slice-2 tests stay green; `state-accuracy-check`; `sync-invariant-check`.

## Code references

- `lib/inventory-math/src/index.ts` — `computeRunConsumptionLines`, `computeSummaryStats`, `ln`
- `artifacts/api-server/src/routes/sync.ts` — `computeServerLiveState` (extend return)
- `artifacts/run-calculator/src/pages/home.tsx` — `serverSummaryStatsRef`, `persistedRunSummaryStats`, `aggregateNeedRows`
- `artifacts/run-calculator/src/inventoryShared.ts` — `computeRunLines`, `computeRunConsumptionLines`

## Out of scope

- Mobile parity.
- Run-timing server authority (slice 4).
