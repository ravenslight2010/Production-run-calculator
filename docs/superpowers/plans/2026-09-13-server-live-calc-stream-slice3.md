# Server Live-Calc Streaming — Slice 3: Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement task-by-task.

**Goal:** Stream `runLines` (ingredient + packaging consumption per run) from the server in every SSE frame alongside `summaryStats`. Client adopts server-authoritative lines when online and falls back to local compute offline.

**Spec:** `docs/superpowers/specs/2026-09-13-server-live-calc-stream-slice3-design.md`

---

## Task 1: Server — add `runLines` to `computeServerLiveState`

**Files:**
- Modify: `artifacts/api-server/src/routes/sync.ts` (extend `computeServerLiveState` return type + loop)
- Test: `artifacts/api-server/src/routes/sync.liveCalcTick.test.ts` (existing file, add runLines assertions)

**Steps:**
- [ ] In the `summaryStatsMap` loop inside `computeServerLiveState`, add a parallel `runLinesMap: Record<string, ConsumeLine[]>` — call `computeRunConsumptionLines(vals, pepTypes)` for each run that has valid `runValues`. Use the same `pepTypes` derivation as the rollup path (from `dayState.pepTypes` or default).
- [ ] Add `runLines: runLinesMap` to the return object of `computeServerLiveState`.
- [ ] Update the return type annotation to include the new field.
- [ ] Add a test: seed data with a run that has `runValues` → `computeServerLiveState` returns `runLines[runId]` as a non-empty array of `{ itemKey, qty }`.
- [ ] Run tests — green.
- [ ] Commit: `feat(api): stream runLines in computeServerLiveState`.

---

## Task 2: Client — store `runLines` from SSE and adopt in Warehouse/Inventory

**Files:**
- Modify: `artifacts/run-calculator/src/pages/home.tsx` — SSE receive: store `msg.runLines` in a new ref.
- Modify: `artifacts/run-calculator/src/inventoryShared.ts` or Warehouse tab — consume server runLines.
- Test: new test file or extend existing home tests.

**Steps:**
- [ ] In `home.tsx`, add `serverRunLinesRef = useRef<Record<string, unknown>>({})`.
- [ ] In the SSE receive handler (`onMessage`), when `msg.runLines` is present, store it: `serverRunLinesRef.current = msg.runLines`.
- [ ] In `aggregateNeedRows` (or the Warehouse tab's need-row computation), accept an optional `serverRunLines` parameter. When online and server data is available for a run, use `serverRunLines[runId]` instead of computing from scratch. Offline/stale → compute locally.
- [ ] Write a test: online with serverRunLines → uses server lines (no local compute); offline → falls back; stale → falls back.
- [ ] Commit: `feat(web): adopt server runLines in warehouse view`.

---

## Task 3: Client — adopt server summaryStats for current run

**Files:**
- Modify: `artifacts/run-calculator/src/pages/home.tsx` — `persistedRunSummaryStats` memo.

**Steps:**
- [ ] In the `persistedRunSummaryStats` memo, for the current run: when `isOnline && serverSummaryStatsRef.current[runId]` exists, adopt it instead of calling `computeSummaryStats(v)`. The guard: the server only has the current run's stats after the client has synced — which happens on every push, so the server data is at most one sync cycle behind.
- [ ] Verify this does not break the `runSummaryStatsById` memo which appends the current run.
- [ ] Test: online → current run uses server summaryStats; offline → local compute.
- [ ] Commit: `feat(web): adopt server summaryStats for current run`.

---

## Task 4: Regression gates + docs + merge

**Steps:**
- [ ] Run all slice-1 + slice-2 tests: `sync.liveCalcTick`, `LiveRunContext.calcTick`, `operationalState`, clock-isolation; api-server + run-calculator typechecks; lib typechecks.
- [ ] Update `docs/idea-backlog.md` §13 (mark slice 3 done), `.agents/memory/codex-fixes.md`.
- [ ] Commit: `docs: mark live server-calc streaming slice 3 done`.
- [ ] Merge `feat/live-calc-stream-slice3` → `main`, push.
