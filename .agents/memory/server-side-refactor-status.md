---
name: Server-side refactor status
description: Where the server-side refactor stands — Steps 1-5 + 6a + 6b foundation (pure auto-track engine) done; 6b/6c not started.
---

# Server-side refactor — current status (2026-09-06)

## Done (merged to main, PR #25) — Step 6b foundation: pure auto-track engine

**Step 6b foundation: pure auto-track engine extracted to `lib/live-calc/src/autoTrackEngine.ts`** — timing/cadence (`getAutoTrackTiming`, `clampWebPeriodMs`), `suggestedDoughStaging`, `computeAutoTrackSuggestion`, `computeAppSlotInfo`, `computeNetSecondDue`, and claim-mutation builders now live in live-calc (unit-tested) and `useAutoTrack` delegates to them. Re-exports keep home.tsx / LiveRunContext.tsx / __mocks__ working. Zero behavior change; refs/effect order untouched. Makes Steps 6b/6c tractable by giving client + server a shared source of truth. Follow-up: per-tick case/tray/batch delta extraction.

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

## Not started

**Step 6b/6c: Full server-side auto-track tick execution** — Step 6a (server schedule) is in PR; the remaining work is client adoption of server-driven tick fires and eventually server-owned tick execution. `useAutoTrack` is 1,645 lines, deeply coupled to React refs, timers, form values, and state — that decomposition is needed before 6b/6c. Key files: `hooks/useAutoTrack.ts`, `autoTrackCoordinationClient.ts`, `lib/autoTrackCoordination.ts`.

**Step 4c (if wanted): Schedule panel** — the Schedule editor stays inline; it is dialog-heavy by design (schedule dialog fields are DIALOG_REGISTRY-excluded elsewhere), so it may not benefit from a narrow ctx. The AI panel also stays inline (lazy, closures-only).

## Key architectural notes

- `computeCalc` is called in `LiveRunContext.tsx` inside a `useMemo` that runs every second (via `useClock`). The `DEFAULT_PEP_TYPES` is injected.
- `computeServerCalc` runs on the server when a sync PUT happens (inside `broadcast()`). It uses `Date.now()` for the wall clock, `dayState.currentIndex` for the current run, and `runValues[runId]` for the FormValues. It does NOT have temp overrides (ve=v for server).
- The `CalcRef` (`liveRunCalc.ts`) is a mutable ref read by non-live UI sections (home.tsx) — it still gets its value from the useMemo in LiveRunContext.
- The `SyncPayload.runValues` stores per-run FormValues as `Record<string, FormValues>` — the server treats it as untyped jsonb.

## What the next agent should do

1. Verify PR #22 (Setup/Summary extraction, step 5) is merged to main.
2. Step 6a (server-computed schedule) shipped as the first slice of server-side auto-track; 6b/6c (client adoption of server tick fires, then server-owned tick execution) require decomposing the 1,645-line useAutoTrack hook first — scope carefully.
3. When extracting any remaining panel, reuse the recipe: narrow per-concern ctx + dep registry + Suite 4 freeze-guard test; keep dialog/manage/merge/import fields out of the dep lists.
