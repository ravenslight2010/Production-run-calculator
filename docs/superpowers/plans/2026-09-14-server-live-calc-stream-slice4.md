# Server Live-Calc Streaming — Slice 4: Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement task-by-task.

**Goal:** Server-authoritative batch/finish timing in `OperationalProjection`; client reads projection timers when confirmed, with local fallback.

**Spec:** `docs/superpowers/specs/2026-09-14-server-live-calc-stream-slice4-design.md`

---

## Task 1: Add batch timing fields to `OperationalProjection`

**Files:**
- Modify: `lib/live-calc/src/operationalProjection.ts` (type + `buildOperationalProjection`)
- Test: `lib/live-calc/src/operationalProjection.test.ts` (create or extend existing live-calc tests)

**Steps:**
- [ ] Extend the `timers` type with `currentBatchNum: number; secUntilNextBatch: number; totalBatchesNeeded: number;`.
- [ ] In `buildOperationalProjection`, compute:
  - `currentBatchNum = calc.timePerBatchSec > 0 ? Math.floor(effectiveElapsedSec / calc.timePerBatchSec) : 0`
  - `secUntilNextBatch = calc.timePerBatchSec > 0 ? calc.timePerBatchSec - (effectiveElapsedSec % calc.timePerBatchSec) : 0`
  - `totalBatchesNeeded = calc.timePerBatchSec > 0 && calc.totalTimeSec > 0 ? Math.ceil(calc.totalTimeSec / calc.timePerBatchSec) : 0`
- [ ] Keep projection version at `1` (additive, non-breaking).
- [ ] Write/update unit tests: exact parity with the client formulas, `timePerBatchSec = 0` → zeros (no NaN), `totalTimeSec = 0` → 0.
- [ ] Run lib tests — green.
- [ ] Commit: `feat(live-calc): batch timing fields in operational projection`.

---

## Task 2: Client reads projection timers with local fallback

**Files:**
- Modify: `artifacts/run-calculator/src/contexts/LiveRunContext.tsx`
- Test: `artifacts/run-calculator/src/contexts/__tests__/LiveRunContext.calcTick.test.tsx` (extend) or a new focused test.

**Steps:**
- [ ] In `LiveRunContext`, when `confirmedProjection` exists for the current run, read `currentBatchNum` / `secUntilNextBatch` / `totalBatchesNeeded` from `confirmedProjection.timers` (fall back to the existing local derivation if the new fields are absent — older servers).
- [ ] Keep the local derivation as the offline/no-projection path.
- [ ] Tests: with a projection fixture → values come from projection; without projection (offline) → local derivation runs; absent new fields → local fallback.
- [ ] Run `LiveRunContext.calcTick`, clock-isolation, `operationalState` — green.
- [ ] Commit: `feat(web): read batch timing from server projection`.

---

## Task 3: Regression gates + docs + merge

**Steps:**
- [ ] Run: lib live-calc tests, api-server `sync.liveCalcTick`, run-calculator suites (calcTick, clock-isolation, operationalState), `state-accuracy-check` files; typechecks (libs, api-server, run-calculator).
- [ ] Update `docs/idea-backlog.md` §13 (slice 4 done), `.agents/memory/codex-fixes.md`.
- [ ] Commit: `docs: mark live server-calc streaming slice 4 done`.
- [ ] Merge `feat/live-calc-stream-slice4` → `main`, push.
