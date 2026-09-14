# Server Live-Calc Streaming — Slice 5: Line-Phase Authority

## Context

Slices 1–4 moved the live calc, run consumption lines, summary stats, and batch/finish timing to the server. The one remaining time-varying display surface that devices still derive locally from scratch is **line phases** — the 3-stage line model (press/frontline → freeze tunnel → wrapper/packaging) computed by `computeLinePhases` in `@workspace/live-calc/linePhases`.

Today every device parses the run's pause list, reads `preTunnelMin`/`postTunnelMin`/`freezerTime` from local form values (`ve`), and recomputes the full phase model on every render. This means:

1. **Cross-device divergence**: a device with unsaved local form edits shows different phase states than the server or other devices.
2. **Tunnel-policy lag**: after a pause or resume, devices parse local stoppages while the next server tick carries the same canonical lifecycle but is ignored for display.
3. **Incomplete server-authority**: the client owns display for pause propagation and drain states even when the server already owns everything that *computes* them.

Slice 5 closes this by having the server compute and stream `LinePhases` inside `OperationalProjection`, the same shared model the client uses as its offline fallback, and having the client adopt it with countdown extrapolation and local fallback.

## Goal

Make the server the single source of truth for the line-phase model while keeping smooth per-second countdowns local between 5s ticks:

1. **Server computes line phases.** `buildOperationalProjection` derives the full `LinePhases` from the day-state run lifecycle (`startedAt`/`pausedAt`/`endedAt`/`stoppages`), effective `preTunnelMin`/`postTunnelMin`/`freezerTime` (from `applyTemporaryOverrides`), and the server clock — the same shared model the client already uses.

2. **Client adopts confirmed projection phases.** When a confirmed `OperationalProjection` exists for the current run AND the projection's `facts.runStatus` matches the local `runStatus` prop, `LiveRunContext` adopts the server `linePhases` and extrapolates each stage's `remainMs` by the wall delta since `capturedAtServerMs`.

3. **Boundary-crossing safety.** When an extrapolated countdown would hit zero mid-tick (a phase transition is imminent), the client re-derives locally with the same inputs. This keeps `packagingDrainActive` (auto-track gating) and per-second UI transitions exact even when the server tick hasn't arrived yet.

4. **Fallback.** Without a confirmed projection, with a lifecycle mismatch (client just paused/ended, server tick still shows running), or when the server omits the new field (older server), the existing local `computeLinePhases` derivation runs unchanged.

## Why it matters

- **Cross-device consistency**: all devices see the same phase states from one authoritative source while the projection is fresh.
- **Less client-owned display logic**: the server owns the model; the client is a thin countdown-extrapolation display with an exact local fallback when needed.
- **Battery**: `computeLinePhases` is already cheap, but adopting the server frame means devices with stale/dirty local values no longer need to run the derivation and recompute countdowns from scratch each render.
- **Incremental**: older servers without `linePhases` in the projection are handled by the client's existing local path.

## Payload contract

Additive to `OperationalProjection` (version stays `1`; new field is non-breaking for older clients because the SSE receive path tolerates extra fields and `LiveRunContext` only reads the field when present).

```ts
linePhases: LinePhases;   // from @workspace/live-calc/linePhases
```

`LinePhases` contains three `PhaseInfo` objects (`stage1`, `stage2`, `stage3`), each with `label`, `state` ("filling" | "active" | "paused" | "draining" | "resuming" | "empty"), and `remainMs`.

## Client adoption rules

The client adopts the server `linePhases` only when **all** of the following are true:
- `confirmedProjection` exists for the current run (already gated by `classifyOperationalDisplay` / receipt freshness).
- `confirmedProjection.linePhases` exists (older server without the field → local fallback).
- `confirmedProjection.facts.runStatus === runStatus` (no lifecycle mismatch: a just-paused/ended run that the server tick hasn't caught up with stays local for ≤5s).

When adopted:
- Each stage's `remainMs` is extrapolated by `max(0, operationalNowMs - capturedAtServerMs)`.
- If any extrapolated stage would transition (remainMs was >0, becomes ≤0), the client re-derives locally to avoid showing the wrong stage for up to 5s.

When not adopted, the local derivation is unchanged.

## Tests

**Server** (`lib/live-calc`):
- `buildOperationalProjection` line phases parity: matches `computeLinePhases` with the same day-state inputs.
- Paused run (safe stop-tunnel policy): staged drain, stage1 draining.
- Ended run: wall-clock sequential drain.
- Pending run: all stages empty.
- Zero/missing timing values: no NaN.
- Deterministic across two builds.

**Client** (`LiveRunContext.linePhases.test.tsx`):
- Confirmed projection + matched runStatus → adopts server phases; remainMs extrapolated by delta.
- No projection → local derivation.
- Lifecycle mismatch (runStatus differs) → local derivation.
- Boundary-crossing (countdown would expire mid-tick) → local derivation.
- Older server omitting `linePhases` → local derivation.

**Regression**:
- `LiveRunContext.calcTick`, `clock-isolation`, `wakeSnap`, `operationalState`, `linePhases.test.ts` (client), `autoTrackFreezerDrain` all pass.
- api-server `sync.liveCalcTick` 20/20 pass.

## Out of scope

- **home.tsx display strips**: the active-run line-status strip in `home.tsx` still calls `computeLinePhases` locally rather than consuming `useLiveRun().linePhases`. The context adoption is authoritative for `packagingDrainActive` and the exposed value; the strips can be displaced in a follow-up energy slice to reduce direct client derivation.
- Ended-run recap badge for `lastEndedRun` where `lastEndedRun.id !== currentRunId`.
- Mobile parity.

## Rollback

Reversible in two small commits: (1) revert adding `linePhases` to the projection in `buildOperationalProjection`, (2) revert the adoption logic in `LiveRunContext`. The client falls back to local derivation automatically when the field is absent.
