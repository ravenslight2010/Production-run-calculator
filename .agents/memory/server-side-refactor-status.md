---
name: Server-side refactor status
description: Where the server-side refactor stands after Codex 2026-09-05 session — Steps 1-3 done, 4a in PR, 4b/5/6 not started.
---

# Server-side refactor — current status (2026-09-05)

## In review (branch `refactor/extract-warehouse-tab`, PR #20)

**Step 4a: Warehouse panel extracted with narrow context** — the earlier Warehouse extraction attempt was reverted because the panel referenced ~20 Home-scope variables. This time it succeeded by doing exactly what the "next agent" note suggested: split off a **narrow `WarehouseTabCtx`** instead of reusing `HomeTabCtx`.
- `WarehouseTabContent.tsx` (memo'd) + `WarehouseNeedsList.tsx` + `FreezerSurplusPanel.tsx` extracted from home.tsx.
- `warehouseTabCtxValue` in home.tsx memoizes on warehouse production deps ONLY — dialog/manage/merge/import fields excluded (freeze pattern, same as `HomeTabCtx`).
- `warehouseTabCtxDeps.ts` (`WAREHOUSE_TAB_CTX_DEP_FIELDS`) + Suite 4 freeze-guard tests in `LiveTabMemo.snappy.test.tsx` prevent dialog fields from leaking back into the warehouse dep list.
- Inventory and Mixes panels remain inline (later phases).

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

## Not started

**Step 4b: Inventory/Mixes/Schedule panels** — same narrow-context pattern as Step 4a; Inventory and Mixes panels are still inline in home.tsx.

**Step 5: React.memo on remaining panels** — mostly done implicitly by Step 4a (WarehouseTabContent is memo'd). Remaining panels still inline.

**Step 6: Server-side auto-track** — `useAutoTrack` is 1,645 lines, deeply coupled to React refs, timers, form values, and state. Moving tick detection server-side is a multi-day architectural change. Key files: `hooks/useAutoTrack.ts`, `autoTrackCoordinationClient.ts`, `lib/autoTrackCoordination.ts`.

## Key architectural notes

- `computeCalc` is called in `LiveRunContext.tsx` inside a `useMemo` that runs every second (via `useClock`). The `DEFAULT_PEP_TYPES` is injected.
- `computeServerCalc` runs on the server when a sync PUT happens (inside `broadcast()`). It uses `Date.now()` for the wall clock, `dayState.currentIndex` for the current run, and `runValues[runId]` for the FormValues. It does NOT have temp overrides (ve=v for server).
- The `CalcRef` (`liveRunCalc.ts`) is a mutable ref read by non-live UI sections (home.tsx) — it still gets its value from the useMemo in LiveRunContext.
- The `SyncPayload.runValues` stores per-run FormValues as `Record<string, FormValues>` — the server treats it as untyped jsonb.

## What the next agent should do

1. Verify PR #20 (Warehouse extraction) is merged to main.
2. Steps 4b-6: apply the `WarehouseTabCtx` recipe to Inventory and Mixes panels (each gets its own narrow ctx + dep registry + freeze-guard test). Keep dialog/manage/merge/import fields out of the dep lists.
3. The battery win from Step 6 (server-side auto-track) is the biggest remaining prize but requires understanding the full 1,645-line useAutoTrack hook first.
