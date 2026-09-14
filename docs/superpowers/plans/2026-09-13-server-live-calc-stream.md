# Server Live-Calc Streaming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server the live calc authority while a run is active — 5s calc ticks over the existing sync SSE, client adoption with a freshness window and instant local fallback — so the client stops recomputing `computeCalc` per second when online.

**Architecture:** Extend the existing operational sync path (`computeServerLiveState` already runs on events and on the 15s heartbeat in `artifacts/api-server/src/routes/sync.ts`). Add a per-client 5s active-run calc tick that re-runs the cached live-state computation with fresh `nowMs` (no extra DB reads). Client adopts `serverCalc` via an existing receipt (`OperationalSnapshotReceipt`) guarded by a new staleness window; on stale/offline it falls back to local `computeCalc`. Everything is read-only — no day-state writes.

**Tech Stack:** Node/Express SSE (`REST` + `text/event-stream`), TypeScript 6.0.3, vitest 5, React context.

**Spec:** `docs/superpowers/specs/2026-09-13-server-live-calc-stream-design.md`

## Global Constraints

- Tick payload reuses `ServerCalcResult` (`{ runId, calc }`) — no new shapes.
- Additive only: no day-state shape changes; unknown/new SSE fields must be tolerated by the client receive path.
- Ticks are read-only derivations: never write day state, never change LWW stamps (`sync-invariant-check` §1/§5).
- 5s cadence default, configurable via `LIVE_CALC_TICK_MS` (min 2000 for tests). Emit only while an active run exists (startedAt && !endedAt); idle emits nothing new.
- Client: adopt while online + connected + receipt fresh (window = 2 tick intervals default 10s); fall back to local `computeCalc` on stale/offline/run-switch — never a blank UI.
- Existing 15s heartbeat (`AUTO_TRACK_HEARTBEAT_MS`) and its lease semantics are untouched.

---

### Task 1: Pure active-run calc-tick helper + unit tests

**Files:**
- Modify: `artifacts/api-server/src/routes/sync.ts` (extract + export pure helper)
- Test (create): `artifacts/api-server/src/routes/sync.liveCalcTick.test.ts`

**Steps:**
- [ ] Write failing unit tests for a pure `shouldEmitLiveCalcTick(data, nowMs, lastTickMs, tickMs)` helper: true when a run has `startedAt` and no `endedAt`; false when idle (no runs), all ended, or too soon since `lastTickMs`; true exactly at/after `tickMs`.
- [ ] Run the new test file — confirm it fails (helpers don't exist).
- [ ] Implement the helper in `sync.ts` near `computeServerLiveState`; export it. Use `CalcRunMeta`/`dayState.runs` shape from `lib/live-calc`.
- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/routes/sync.liveCalcTick.test.ts` — green.
- [ ] Commit: `feat(api): active-run calc tick helper (pure)`.

### Task 2: Per-client 5s calc tick on the SSE channel

**Files:**
- Modify: `artifacts/api-server/src/routes/sync.ts` (SSE client setup ~1743, broadcast ~365, heartbeat ~1748)
- Test (create): `artifacts/api-server/src/routes/sync.liveCalcTick.integration.test.ts`

**Steps:**
- [ ] Add `lastData`/`lastCanonicalRevision`/`lastCalcEmitMs` to the `SseClient` object (cache the last day payload — updated in `broadcast` and on SSE initial frame when `data` present).
- [ ] Add a per-client interval `LIVE_CALC_TICK_MS` (default 5000, floor 2000) that, when `shouldEmitLiveCalcTick(lastData, nowMs, lastCalcEmitMs, tickMs)` is true, re-runs `computeServerLiveState(lastData, nowMs, lastCanonicalRevision)` and writes `data: {...live, calcTick: true}`; otherwise no-op. Clear interval on `res.close`.
- [ ] Write an integration test (follow existing `sync.integration.test.ts` SSE patterns): connect to `/sync/events` with `LIVE_CALC_TICK_MS=2000` and a seeded active run → assert a second frame arrives with `calcTick: true`, `serverCalc.runId === active run`, and `serverTime` > first frame; idle seed → assert no `calcTick` frame within the window.
- [ ] Run the test — green; run `pnpm --filter @workspace/api-server exec vitest run src/routes/sync.liveCalcTick.integration.test.ts`.
- [ ] Commit: `feat(api): 5s server-calc tick for active runs (SSE)`.

### Task 3: Client freshness-window adoption helper + unit tests

**Files:**
- Modify: `artifacts/run-calculator/src/operationalState.ts`
- Test: `artifacts/run-calculator/src/operationalState.test.ts`

**Steps:**
- [ ] Add pure `shouldUseServerCalc({ online, syncConnected, receipt, nowMs, windowMs })`: false when offline/disconnected/no receipt; false when receipt older than `windowMs` (default 10_000, exported constant `LIVE_CALC_STALE_MS`); true otherwise. Do NOT change `classifyOperationalDisplay` semantics (UI "confirmed" stays display-only).
- [ ] Write failing tests in `operationalState.test.ts` for all branches.
- [ ] Run — confirm fail; implement; run — green.
- [ ] Commit: `feat(web): freshness-window guard for server calc adoption`.

### Task 4: LiveRunContext + home wiring (adopt ticks, fall back when stale)

**Files:**
- Modify: `artifacts/run-calculator/src/contexts/LiveRunContext.tsx` (calc memo ~245)
- Modify: `artifacts/run-calculator/src/pages/home.tsx` (SSE receive handler that calls `adoptOperationalProjection` / `adoptServerCalcReceipt`; calcTick frame branch)
- Test: `artifacts/run-calculator/src/contexts/__tests__/LiveRunContext.calcTick.test.tsx` (new)

**Steps:**
- [ ] In `home.tsx` SSE receive path: when a frame has `calcTick: true` and a `serverCalc`/`operationalProjection`, route it through the existing `adoptOperationalProjection(...)` / `adoptServerCalcReceipt(...)` with `capturedAt = frame.serverTime` (respect existing runId/snapshotId dedupe). Do not write day state.
- [ ] In `LiveRunContext.tsx`: replace the `operationalDisplayState === "confirmed"` gate with `shouldUseServerCalc({ online: operationalOnline, syncConnected: operationalSyncConnected, receipt: serverCalcReceipt, nowMs: Date.now() })` (plus existing `currentRunId === currentRun?.id` and `serverCalc.runId === currentRun.id`). When false → local `computeCalc` path (unchanged).
- [ ] Write tests: adopt-when-fresh uses `serverCalc` and does NOT call `computeCalc` (spy/stub the module); stale/offline calls `computeCalc`; run switch cancels adoption.
- [ ] Run the new test + `LiveRunContext.clock-isolation.test.tsx` + `operationalState.test.ts` — green.
- [ ] Commit: `feat(web): adopt server-calc ticks with staleness fallback`.

### Task 5: Regression gates + docs

**Files:**
- Run: `sync-invariant-check` skill test files (`blankRunValueSync.test.ts`, stamp guards), `state-accuracy-check` files, run-calculator + api-server unit suites, `typecheck:libs` + artifact typechecks.
- Modify: `docs/idea-backlog.md` §13 (note slice 1 done), `.agents/memory/codex-fixes.md` (log this feature).

**Steps:**
- [ ] Run gates; fix any regressions within slice scope.
- [ ] Update backlog + memory log.
- [ ] Commit: `docs: mark live server-calc streaming slice 1 done`.
- [ ] Merge branch → `main`, push (repo convention).
