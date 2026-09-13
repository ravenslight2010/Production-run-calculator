# Server Live-Calc Streaming — Slice 2: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend slice 1 so that **any selected run** (including pending runs in Setup) gets streamed `serverCalc` values over the SSE calc tick, and the Setup tab adopts them with the same freshness/fallback guard. The same `ServerCalcResult` shape is reused; no new math is needed.

**Spec:** `docs/superpowers/specs/2026-09-13-server-live-calc-stream-slice2-design.md`

---

## Task 1: Widen the server tick predicate to any selected run

**Files:**
- Modify: `artifacts/api-server/src/lib/liveCalcTick.ts`
- Test: `artifacts/api-server/src/routes/sync.liveCalcTick.test.ts`

**Steps:**
- [ ] Add new pure helper `shouldEmitSetupCalcTick(data, nowMs, lastTickMs, tickMs)` (same `DEFAULT_LIVE_CALC_TICK_MS` floor): true when the **selected** run has `runValues` in the payload (even if `startedAt` absent) AND the interval has elapsed; false when no runs, no `runValues`, or too soon. This is independent of `shouldEmitLiveCalcTick` (which remains active-run-only for backward compat / clarity).
- [ ] Extend `buildLiveCalcTickFrame` (or add a new sibling) to also handle the setup-tick case: emit `{ calcTick: true, canonicalRevision, setupTick: true }` so the client can distinguish active-run vs setup ticks if needed (the payload shape `serverCalc + serverTime` stays the same).
- [ ] Write failing unit tests for `shouldEmitSetupCalcTick`: selected run without runValues → false; with runValues but no startedAt → true; started and not ended → true (active-run path still covers this); ended → false; interval not elapsed → false.
- [ ] Run tests — green.
- [ ] Commit: `feat(api): widen calc tick to any selected run with runValues`.

**File:** `artifacts/api-server/src/routes/sync.ts`

**Steps:**
- [ ] In the per-client calc tick interval, add a second emission path: if `shouldEmitSetupCalcTick(client.lastData, nowMs, client.lastCalcEmitMs, tickMs)` is true AND the client has a `selectedRunId` from the SSE query, emit the setup calc tick using `buildLiveCalcTickFrame` (which now also emits for pending runs with runValues). Cache `selectedRunId` from the initial SSE connect request.
- [ ] If both active-run and setup ticks qualify, emit only once (active-run has priority to avoid duplicate frames).
- [ ] Integration test (CI): seed pending run with runValues; `LIVE_CALC_TICK_MS=2000`; assert a `calcTick: true` frame arrives with `serverCalc.runId === pendingRunId` within the interval; no runValues → no frame.
- [ ] Commit: `feat(api): setup-form calc tick for selected pending runs (SSE)`.

---

## Task 2: Client adoption helper for pending (setup) runs

**Files:**
- Modify: `artifacts/run-calculator/src/operationalState.ts` (helper already in slice 1 — no change needed if reusing `shouldUseServerCalc` + selected-run identity)
- Test: `artifacts/run-calculator/src/operationalState.test.ts`

**Steps:**
- [ ] Verify that `shouldUseServerCalc` + `currentRunId === currentRun?.id` + `receipt.runId === currentRunId` is sufficient for pending runs (no new helper needed). If a pending-run-specific guard is desired (e.g., the receipt must be a `setupTick` or `setupTick === true`), add a small boolean param — but the plan recommends keeping it simple and reusing the existing guard.
- [ ] Add a test for the pending-run case: `shouldUseServerCalc({online: true, syncConnected: true, receipt: {runId: "pending-1", ...}, nowMs: receipt.capturedAt + 5000})` → true. No new type/shape changes.
- [ ] Commit: `test(web): pending-run freshness guard coverage`.

---

## Task 3: Setup tab adoption of streamed calc

**Files:**
- Modify: `artifacts/run-calculator/src/pages/home.tsx` — SSE receive path: ensure `calcTick` frames for pending runs route through `adoptServerCalcReceipt` (same as active-run path).
- Modify: `artifacts/run-calculator/src/components/SetupContent.tsx` or `SetupProfileEditor.tsx` — read from `useLiveRun().calc` (or a dedicated `useSetupCalc` hook wrapping the context) instead of computing local `v`/form-only values for the yield/batch/timing/ingredient displays.
- Modify: `artifacts/run-calculator/src/contexts/LiveRunContext.tsx` — ensure the `calc` memo already uses `adoptServerCalc` for any `currentRun` (not just active runs). Verify that `currentRun?.id` is populated for selected pending runs (it is — `currentRunId` is set by the tab selection).
- Test: new `LiveRunContext.setupCalcTick.test.tsx` (or extend the existing calcTick test).

**Steps:**
- [ ] In `home.tsx` SSE receive, confirm `calcTick: true` frames for pending runs are handled: they should call `adoptServerCalcReceipt(msg.serverCalc, msg.snapshotId, msg.serverTime)` — the existing branch already covers this if the frame has `serverCalc` (no change needed). Verify by reading the current handler logic and adding a structural test or manual assertion.
- [ ] In `LiveRunContext.tsx`, verify the `adoptServerCalc` guard applies to pending runs (it uses `currentRunId === currentRun?.id`, which is true when a pending run is selected). No structural change needed — just ensure the existing logic is the same guard for active and pending runs.
- [ ] For the Setup tab, switch any local calc derivations to read from `useLiveRun().calc` (the context value). Key fields to verify: `perBatch` (recipe yield), `batchesNeeded`, `traysNeeded`, `doughShortCases`, `doughDepletionSec`, `totalTimeSec`, `adjustedTimeSec`, `app1..4Lbs`/`Batches`, `pep1..2Lbs`/`Batches`, `sauceBatches`. If any of these are currently inline-computed in the Setup tab, replace with `calc.<field>`.
- [ ] Write tests: setup-adoption fresh → uses streamed calc; stale → falls back; run switch cancels.
- [ ] Commit: `feat(web): setup tab adopts streamed server calc with fallback`.

---

## Task 4: Regression gates + docs

**Steps:**
- [ ] Run `sync-invariant-check` test files, `state-accuracy-check` files, `LiveRunContext.calcTick.test.tsx`, `operationalState.test.ts`, `typecheck:libs`, run-calculator + api-server typechecks.
- [ ] Update `docs/idea-backlog.md` §13 (mark slice 2 done), `.agents/memory/codex-fixes.md`.
- [ ] Commit: `docs: mark live server-calc streaming slice 2 done`.
- [ ] Merge `feat/live-calc-stream-slice2` → `main` (`git checkout main && git merge --no-ff feat/live-calc-stream-slice2`), push `main` and the branch.
