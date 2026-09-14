# Server Live-Calc Streaming — Slice 4: Run-Timing Authority

## Context

Slices 1–3 made the server the authority for live calcs (active + pending runs), consumption lines, and summary stats. The one remaining time-varying surface that devices still derive locally from scratch is **run timing**:

- `elapsedBatchSec` — extrapolated locally from `confirmedProjection.effectiveElapsedSec` + `capturedAtServerMs` (needed for smooth per-second display between 5s ticks; this extrapolation is a display concern and stays local).
- `currentBatchNum`, `secUntilNextBatch` — recomputed every render from `elapsedBatchSec % calc.timePerBatchSec`.
- `totalBatchesNeeded` — recomputed from `calc.totalTimeSec / calc.timePerBatchSec`.
- `linePhases` — the 3-stage line model (pre-tunnel / tunnel / packaging) derived from `elapsedBatchSec`, pause policy, and calc timing. Stage boundaries (`preTunnelMin`, `postTunnelMin`, `freezerTime`) and `pauseStopsTunnel` policy are shared (`@workspace/live-calc`), but the full stage derivation still runs per-render.

The `OperationalProjection` already exposes `effectiveElapsedSec` and `timers.{nextBatchInSec, pressRemainingSec, freezerElapsedSec, freezerRemainingSec}` — but the client recomputes the batch counter/next-batch math from its own `elapsedBatchSec` anyway, and `linePhases` is entirely client-side.

## Goal

Make the server the single source of truth for **batch/finish timing** while keeping the smooth per-second display extrapolation local:

1. **Batch timing in the projection.** Add `timers.currentBatchNum`, `timers.secUntilNextBatch`, `timers.totalBatchesNeeded` to `OperationalProjection`, computed server-side from `effectiveElapsedSec` + `calc.timePerBatchSec`/`totalTimeSec` — the same formulas the client uses today, moved into `buildOperationalProjection`.
2. **Client reads projection timers.** In `LiveRunContext`, when a `confirmedProjection` exists for the current run, `currentBatchNum` / `secUntilNextBatch` / `totalBatchesNeeded` come from `confirmedProjection.timers`; otherwise the local derivation remains (offline/pending fallback, never blank).
3. **Line phases derive from the server elapsed anchor but stay a display derivation.** `linePhases` keeps using `elapsedBatchSec` (which is already server-anchored via the projection), and its inputs (`preTunnelMin`, `postTunnelMin`, `freezerTime`, `pausedAt`, pause list) are unchanged. No day-state writes; pure read-only derivation.

## Why it matters

- Cross-device consistency: all devices see the same batch counter and next-batch countdown from the same server anchor, instead of each device's local `elapsedBatchSec` drifting.
- Less per-render derivation: batch timing read directly from the projection instead of recomputed modulo math on every clock tick.
- Parity: the formulas are moved verbatim (same rounding: `floor` for batch num, `timePerBatchSec - (elapsed % timePerBatchSec)` for seconds-until, `ceil` for total) so no numerical behavior changes.

## Payload contract

Additive to `OperationalProjection` (version stays `1`; new fields are non-breaking for older clients because the SSE receive path tolerates extra fields, and the client only reads them when present).

```ts
timers: {
  nextBatchInSec: number;          // existing
  pressRemainingSec: number;       // existing
  freezerElapsedSec: number;       // existing
  freezerRemainingSec: number;     // existing
  currentBatchNum: number;         // NEW
  secUntilNextBatch: number;       // NEW
  totalBatchesNeeded: number;      // NEW
};
```

## Tests

**Server** (`lib/live-calc`):
- `buildOperationalProjection` unit tests: batch timing matches `calc.timePerBatchSec`/`effectiveElapsedSec` formulas; `timePerBatchSec = 0` → zeros (no NaN/Infinity); `totalBatchesNeeded` from `ceil(totalTimeSec / timePerBatchSec)`.

**Client** (`LiveRunContext`):
- With `confirmedProjection`: `currentBatchNum`/`secUntilNextBatch`/`totalBatchesNeeded` read from `confirmedProjection.timers`.
- Without projection / offline: local derivation (existing behavior).
- Regression: existing `LiveRunContext.calcTick`, clock-isolation, `state-accuracy-check` suites stay green.

## Out of scope

- Moving `linePhases` stage boundaries to the server (needs day-state-owned phase model; large change, defer).
- Mobile parity.
- Finish-time wall-clock projections beyond `pressRemainingSec` (later).

## Rollback

Reversible in two small commits: (1) revert adding the three `timers` fields to the projection, (2) revert reading them in LiveRunContext. Client falls back to local derivation automatically when the fields are absent.

## Code references

- `lib/live-calc/src/operationalProjection.ts` — `buildOperationalProjection` (add timers)
- `artifacts/run-calculator/src/contexts/LiveRunContext.tsx` — `currentBatchNum` / `secUntilNextBatch` / `totalBatchesNeeded` (~372)
- `artifacts/run-calculator/src/linePhases.ts` — `computeLinePhases` (unchanged, display-only)
