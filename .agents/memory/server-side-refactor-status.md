---
name: Server-side refactor status
description: Where the server-side refactor stands — Steps 1-6 + 7a (server-owned net-second auto-track execution) done; server-authority layer complete on web; wall-clock channels still client-driven.
---

# Server-side refactor — current status (2026-09-06)

## Done (merged to main, PR #33) — Step 7a: server-owned net-second auto-track execution

**Step 7a: the server fires due sauce-barrel / applicator-batch claims itself** — an app-level tick loop (`runNetSecondServerTicks` + `startAutoTrackServerTicks`, default 15s, `AUTO_TRACK_SERVER_TICK_MS`, bounded to 24 claims/pass) scans the live scope's recent days, builds due claims from the shared schedule, and applies them through the SAME parse/apply/row-lock transaction as a client claim POST (sauce inventory idempotency included). Runs now keep auto-tracking while every device is closed; a competing client/instance just loses the row-lock race and lands stale/duplicate. Pure claim builder lives in `api-server/lib/autoTrackServerTicks.ts` (DB-free, 10 unit tests); `buildAutoTrackScheduleFromPayload` moved into `@workspace/live-calc` so SSE/claim/tick paths share one derivation. Wall-clock channels (case/tray/batch/hopper) deliberately stay client-driven (they need arm-state machines the server doesn't model). Client unchanged (local tick stays the offline fallback; online devices keep the 6b server-verdict path). Also relaxed the claim parser so sauce anchors may be fractional net-seconds (matches the client's real cadence math and the app-slot behavior; the made counter stays integer-gated).

## Done (merged to main, PR #31) — Step 6c: schedule-bearing SSE heartbeat

**Step 6c: the 15s SSE keepalive ping now carries the server auto-track schedule (delta-only).** Reuses the existing connection/cadence (no extra traffic); clients already adopt it from 6a/6b with local math as the offline fallback. `AUTO_TRACK_HEARTBEAT_MS` env override for tests. This completes the server-authority layer for web: the server owns WHEN (due times + due-now verdicts, live for every device), the claim protocol still owns WHAT (validation/sequencing/manual-correction guards). Integration test drives a fast beat with a realistic full-FormValues run fixture and asserts delta-only behavior (one schedule-carrying frame, then comment pings).

## Done (merged to main, PR #29) — Step 6b: server due-now verdict drives net-second claims

**Step 6b: client fires sauce/applicator claims on the server's `dueNow` verdict** — the Step 6a schedule already computed `dueNow` server-side; this wires it through the coordination event (`dueNow` on the channel state) into `serverDueNowRef`, and the sauce/applicator effects fire immediately on a fresh verdict (one-shot), keeping the local elapsed check as the offline fallback. Generation mismatch clears the verdict so stale runs never fire. Wall-clock channels stay local-fallback (server only echoes them). Server unchanged.

## Done (merged to main, PR #25) — Step 6b foundation: pure auto-track engine

**Step 6b foundation: pure auto-track engine extracted to `lib/live-calc/src/autoTrackEngine.ts`** — timing/cadence (`getAutoTrackTiming`, `clampWebPeriodMs`), `suggestedDoughStaging`, `computeAutoTrackSuggestion`, `computeAppSlotInfo`, `computeNetSecondDue`, claim-mutation builders (PR #25), AND the per-tick write decisions `computeCaseTickWrite`/`computeTrayTick`/`computeBatchTick` (PR #27) now live in live-calc (100 unit tests) and `useAutoTrack` delegates to them. Re-exports keep home.tsx / LiveRunContext.tsx / __mocks__ working. Zero behavior change; refs/effect order untouched. The hook is now ~1,320 lines and every pure decision is shared with the server — Steps 6b/6c are the remaining consumer work.

## Done (merged to main, PR #23) — Step 6a: server-computed auto-track schedule

**Step 6a: server-computed auto-track schedule attached to SSE/claim payloads** — first slice of Step 6:
- `lib/live-calc/src/autoTrackSchedule.ts` (new): pure-function server scheduler. Net-second channels (sauce-barrel, app1-4-batch) are derived from stored anchors + cadence vs pause-aware elapsed net seconds; wall-clock channels (case, tray/batch, hopper) echo the persisted coordination record's canonical `nextDueAt` + `sequence`.
- `artifacts/api-server/src/routes/sync.ts`: `buildAutoTrackSchedule()` attaches `autoTrackSchedule` to every SSE broadcast frame, the initial SSE frame, and claim POST responses.
- `artifacts/run-calculator`: `autoTrackScheduleToCoordination()`/`publishAutoTrackSchedule()` map the schedule into the existing `AUTO_TRACK_COORDINATION_EVENT`; `home.tsx` publishes it on SSE receive + claim response.
- Generation strings match the claim endpoint's `expectedGeneration` (`${runId}:${metaUpdatedAt ?? startedAt ?? 0}`), so claimed sequences stay in parity with the server.
- Advisory only: live-claim validation still lives in `applyAutoTrackClaim` (unchanged).

## Done (merged to main)

**Step 4b: Inventory + Mix Plan panels extracted with narrow contexts** — same recipe as Step 4a (PR #21):
- `InventoryTabContent.tsx` (memo'd) reads `InventoryTabCtx` (deps: `dayState`, `inventoryCandidates`, `inventoryRunValues`, `inventorySubstitutionOptions`).
- `MixesTabContent.tsx` (memo'd) reads `MixesTabCtx` (deps: `canManageInventory`, `currentRunId`, `dayState`, `freezerSurplus`, `mixMakeDay`, `mixPlanItems`, `mixes`, `scheduledDays`).
- `prepMixExpanded` (expand/collapse UI) moved to local state inside `MixesTabContent` — no longer re-renders all of Home. `mixMakeDay` stays in Home so it persists across tab unmounts.
- Dep registries (`inventoryTabCtxDeps.ts`, `mixesTabCtxDeps.ts`) + Suite 4 freeze-guard tests added.
- All three warehouse-inventory department panels are now extracted.

## Done (in PR — branch `refactor/extract-setup-summary`)

**Step 5: Setup panel + Summary tools header extracted** — same narrow-context recipe:
- `SetupContent.tsx` (memo'd) reads `SetupTabCtx` (deps: `v`, `circles`, `shipper`, `skidStacking`, `gripSheets`, `isManager`, `isSupervisor`, `currentRun`, `doughSubTab`). `form` + callbacks ride the ref-capture pattern (not deps).
- `SetupMathConflictBadge` moved into `SetupContent.tsx`; home.tsx re-exports it so `appSlotMathBadge.render.test.tsx` keeps working. `NumField` moved to shared `components/NumField.tsx`.
- `SummaryToolsContent.tsx` (memo'd) consumes `HomeTabCtx` (like `LiveSummaryTabContent`); the manager Operations-desk tools header is no longer inline. Returns null for non-managers.
- AI panel intentionally left inline (already lazy behind `LazyDeferredManagementAiSurface`; closures-only, no extra renders).
- `setupTabCtxDeps.ts` (`SETUP_TAB_CTX_DEP_FIELDS`) + Suite 4 freeze-guard tests added.

## Done (branch `refactor/extract-warehouse-tab`, PR #20 — merged to main)

**Step 4a: Warehouse panel extracted with narrow context** — the earlier Warehouse extraction attempt was reverted because the panel referenced ~20 Home-scope variables. This time it succeeded by doing exactly what the "next agent" note suggested: split off a **narrow `WarehouseTabCtx`** instead of reusing `HomeTabCtx`.
- `WarehouseTabContent.tsx` (memo'd) + `WarehouseNeedsList.tsx` + `FreezerSurplusPanel.tsx` extracted from home.tsx.
- `warehouseTabCtxValue` in home.tsx memoizes on warehouse production deps ONLY — dialog/manage/merge/import fields excluded (freeze pattern, same as `HomeTabCtx`).
- `warehouseTabCtxDeps.ts` (`WAREHOUSE_TAB_CTX_DEP_FIELDS`) + Suite 4 freeze-guard tests in `LiveTabMemo.snappy.test.tsx` prevent dialog fields from leaking back into the warehouse dep list.
- Inventory and Mixes panels extracted in Step 4b (PR #21).

## Done (on branch `refactor/extract-screen-mode-view`, PR #19)

**Step 1: ScreenModeView extracted** — 682 lines moved from home.tsx to components/ScreenModeView.tsx (commit d50d3f81).

**Step 2: Shared calc engine** — `lib/live-calc/` workspace package (commit 60fdcc20).
- `computeCalc(input: CalcInput): Calc` — the pure math engine. Zero React dependency.
- `computeEffectiveLineSpeed()` — moved here from `lineSpeed.ts` (now a thin re-export).
- `computeServerCalc(payload, defaultPepTypes)` — computes calc from SyncPayload for server-side use.
- `Calc`, `CalcFormValues`, `CalcInput`, `CalcRunMeta` types exported.
- `DEFAULT_PEP_TYPES` is injected as a param (not embedded in the lib).
- 21 unit tests pass (index.test.ts).
- Both `@workspace/run-calculator` and `@workspace/api-server` depend on it.

**Step 3: Server-side calc in SSE** (commit 6fea3f55).
- `sync.ts broadcast()` attaches `serverCalc` (the current run's calc) to every SSE frame.
- `home.tsx` SSE handler stores it in `serverCalcRef`.
- Client still computes locally for live per-second display. Server calc is the authority layer.

**Other: Replit handoff updated** (commit d8ddd2bc).

## Attempted, reverted, then succeeded (Step 4a above)

**First attempt (Step 4): Warehouse panel via `useHomeTabCtx()`** — failed because the panel references ~20 Home-scope variables not in the context (`markCountedMutation`, `activeRunNeedDetails`, `activePackagingRows`, `cycleCountSchedules`, `runValuesById`, `fmtTime`, `runLabel`, `computeSummaryStats`, `WarehouseNeedsList`, `DEFAULT_VALUES`, etc.). Threading them through would widen re-render scope. **Lesson:** management-heavy panels need their OWN narrow context (per concern), not the live-tab context — that is what `WarehouseTabCtx` provides.

## Partially started / not started

**Server-owned auto-track tick EXECUTION (post-7a)** — 7a executes the NET-SECOND channels server-side, and clients now SKIP their redundant net-second tick while the server schedule verdict is fresh (Task 1: per-channel `serverScheduleAtMsRef` freshness latch in `hooks/useAutoTrack.ts`, 45s TTL = 3 heartbeat cadences; fresh `dueNow:false` suppresses the local claim, stale/offline restores the local fallback). Task 2 shipped the WALL-CLOCK foundation: `lib/live-calc/src/wallClockEngine.ts` ports the client's arm-state machines (bookkeeping refs, remainder carry, seeds, pressDone/dough-pause/suppression gates, rearm semantics) into a pure engine, and the schedule now emits compute-only wall-clock due-now verdicts via `computeWallClockDueRefs` for fresh runs (canonical echo still wins; gated to live runs < 6h; NO server writes yet). Remaining: server-side EXECUTION of wall-clock claims through the standard parse/apply/row-lock transaction once the engine is battle-tested in production — wire `tickWallClock` events into a run loop like `autoTrackServerTicks.ts` (persist history only if replay divergence for mid-run-mount devices becomes an issue; the claim protocol re-aligns canonical nextDueAt after the first claim). Also open: client skip of redundant wall-clock ticks when the server verdict is fresh (mirror Task 1's latch for case/tray/batch). Key files: `hooks/useAutoTrack.ts`, `autoTrackCoordinationClient.ts`, `lib/autoTrackCoordination.ts`, `lib/autoTrackServerTicks.ts`, `lib/live-calc/src/wallClockEngine.ts`.

**Step 4c (if wanted): Schedule panel** — the Schedule editor stays inline; it is dialog-heavy by design (schedule dialog fields are DIALOG_REGISTRY-excluded elsewhere), so it may not benefit from a narrow ctx. The AI panel also stays inline (lazy, closures-only).

## Key architectural notes

- `computeCalc` is called in `LiveRunContext.tsx` inside a `useMemo` that runs every second (via `useClock`). The `DEFAULT_PEP_TYPES` is injected.
- `computeServerCalc` runs on the server when a sync PUT happens (inside `broadcast()`). It uses `Date.now()` for the wall clock, `dayState.currentIndex` for the current run, and `runValues[runId]` for the FormValues. It does NOT have temp overrides (ve=v for server).
- The `CalcRef` (`liveRunCalc.ts`) is a mutable ref read by non-live UI sections (home.tsx) — it still gets its value from the useMemo in LiveRunContext.
- The `SyncPayload.runValues` stores per-run FormValues as `Record<string, FormValues>` — the server treats it as untyped jsonb.

## What the next agent should do

1. Verify PR #22 (Setup/Summary extraction, step 5) is merged to main.
2. Steps 6a/6b/6c + 7a shipped (server schedule → client adoption → heartbeat → server-owned net-second execution). Remaining: wall-clock channels server-side (port arm-state machines first) and the client battery-win of skipping redundant net-second ticks while connected.
3. When extracting any remaining panel, reuse the recipe: narrow per-concern ctx + dep registry + Suite 4 freeze-guard test; keep dialog/manage/merge/import fields out of the dep lists.
