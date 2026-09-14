# Server Live-Calc Streaming — Slice 5: Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement task-by-task.

**Goal:** Server computes and streams the 3-stage line-phase model in `OperationalProjection`; client adopts confirmed projection phases with countdown extrapolation and exact local fallback.

**Spec:** `docs/superpowers/specs/2026-09-14-server-live-calc-stream-slice5-design.md`

---

## Task 1: Server line phases in `OperationalProjection`

**Files:**
- Modify: `lib/live-calc/src/operationalProjection.ts` (type + `buildOperationalProjection`)
- Test: `lib/live-calc/src/liveCalc.test.ts` (new slice-5 describe block)

**Steps:**
- [x] Add `linePhases: LinePhases` to the projection type (version stays `1` — additive).
- [x] Compute with `computeLinePhases` from day-state lifecycle (`pausedAt`/`endedAt`/pause `stoppages`), effective `preTunnelMin`/`postTunnelMin`/`freezerTime` from `applyTemporaryOverrides`, and server `nowMs`.
- [x] Tunnel-policy inputs mirror the client `pauseStopsTunnel()` default: missing/undefined → `true` (safe stop).
- [x] Unit tests: parity with `computeLinePhases`, paused staged drain, ended sequential drain, pending empty, zero-value NaN guard, determinism.
- [x] `pnpm --filter @workspace/live-calc exec vitest run` green (25/25).
- [ ] Commit: `feat(live-calc): line-phase model in operational projection`.

## Task 2: Client adoption with extrapolation + fallback

**Files:**
- Modify: `artifacts/run-calculator/src/contexts/LiveRunContext.tsx`
- Test: `artifacts/run-calculator/src/contexts/__tests__/LiveRunContext.linePhases.test.tsx` (new)

**Steps:**
- [x] Expose `linePhases: LinePhases` on `LiveRunContextValue`.
- [x] Adopt `confirmedProjection.linePhases` when: confirmed projection for current run, field present, and `confirmedProjection.facts.runStatus === runStatus`.
- [x] Extrapolate each stage `remainMs` by `max(0, operationalNowMs - capturedAtServerMs)`.
- [x] Boundary-crossing fallback: if an extrapolated countdown would hit 0, re-derive locally (identical math — no day-state writes).
- [x] Offline / no projection / lifecycle mismatch / older server → local derivation unchanged.
- [x] Tests: adopt+extrapolate, no-projection fallback, lifecycle-mismatch fallback, boundary fallback, older-server fallback.
- [x] Regression: calcTick, clock-isolation, wakeSnap, operationalState, client linePhases, autoTrackFreezerDrain — 97/97.
- [ ] Commit: `feat(web): adopt server line-phase model in live context`.

## Task 3: Regression gates + docs + merge

**Steps:**
- [x] api-server `sync.liveCalcTick` 20/20; run-calculator + lib typechecks clean (no new tsc errors introduced; baseline live-calc test-file warnings unchanged).
- [x] Write slice-5 spec + plan, update `docs/idea-backlog.md` §13, append `.agents/memory/codex-fixes.md`.
- [ ] Commit: `docs: mark live server-calc streaming slice 5 done`.
- [ ] Push `feat/server-line-phase-model`, open PR → `main`.

## Notes

- `home.tsx` display strips remain local derivations this slice (out of scope, tracked in the spec); the context value is authoritative for `packagingDrainActive` and available for a future strip displacement.
