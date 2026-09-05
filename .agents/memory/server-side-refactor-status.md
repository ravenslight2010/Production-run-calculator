---
name: Server-side refactor status
description: Where the server-side refactor stands after Codex 2026-09-05 session — Steps 1-3 done, 4-6 blocked or not started.
---

# Server-side refactor — current status (2026-09-05)

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

## Attempted and reverted

**Step 4: Warehouse panel extraction** — tried to extract the ~300-line inline warehouse panel into a memo component using `useHomeTabCtx()`. Failed because the panel references ~20 Home-scope variables not in the context (`markCountedMutation`, `activeRunNeedDetails`, `activePackagingRows`, `cycleCountSchedules`, `runValuesById`, `fmtTime`, `runLabel`, `computeSummaryStats`, `WarehouseNeedsList`, `DEFAULT_VALUES`, etc.). Threading them through would widen re-render scope, defeating the React.memo benefit. Reverted cleanly.

**Root cause:** The 8 panels that ARE extracted (LiveRun, LivePackaging, LiveSauce, LiveFrontline, LiveDough, LiveSetupRecipes, LiveStoppages, LiveSummary) only need the narrow production data from `useHomeTabCtx()`. The remaining panels (Warehouse, Setup non-recipe, AI/Manager) are management-heavy with deep dialog/mutation/computed-state dependencies.

## Not started

**Step 5: React.memo on remaining panels** — blocked by Step 4. The already-extracted panels already use `memo()`.

**Step 6: Server-side auto-track** — `useAutoTrack` is 1,645 lines, deeply coupled to React refs, timers, form values, and state. Moving tick detection server-side is a multi-day architectural change. Key files: `hooks/useAutoTrack.ts`, `autoTrackCoordinationClient.ts`, `lib/autoTrackCoordination.ts`.

## Key architectural notes

- `computeCalc` is called in `LiveRunContext.tsx` inside a `useMemo` that runs every second (via `useClock`). The `DEFAULT_PEP_TYPES` is injected.
- `computeServerCalc` runs on the server when a sync PUT happens (inside `broadcast()`). It uses `Date.now()` for the wall clock, `dayState.currentIndex` for the current run, and `runValues[runId]` for the FormValues. It does NOT have temp overrides (ve=v for server).
- The `CalcRef` (`liveRunCalc.ts`) is a mutable ref read by non-live UI sections (home.tsx) — it still gets its value from the useMemo in LiveRunContext.
- The `SyncPayload.runValues` stores per-run FormValues as `Record<string, FormValues>` — the server treats it as untyped jsonb.

## What the next agent should do

1. Verify the branch is merged to main (PR #19).
2. For Steps 4-6: the deep coupling in home.tsx is the blocker. Consider:
   - Splitting `HomeCtx` into smaller, narrower contexts per concern (warehouse context, management context, etc.)
   - Or: moving the management-heavy data to the server (server-computed warehouse need rows, server-computed reorder suggestions) so the client doesn't need to hold it all.
   - The battery win from Step 6 (server-side auto-track) is the biggest remaining prize but requires understanding the full 1,645-line useAutoTrack hook first.
