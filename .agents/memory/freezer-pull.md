---
name: Freezer-pull notification
description: Warehouse "Pull Out Freezer for [date]" feature — config model, matching/windowing logic, web+mobile parity.
---

# Freezer-pull "Pull Out Freezer for [date]"

Warehouse-tab notification: managers tag ingredients as freezer-pull items, each with
its own `daysEarly` (default 3). When an upcoming scheduled run falls within an item's
window AND that run's recipe uses the item, a card grouped by run date lists the items
to pull now with quantities.

## Architecture (mirrors Production Rules — NOT a sync feature)
- Config is factory-wide server master-data in `freezer_pull_items`, **not** in `/sync`
  day-state. Same posture as production rules / denied merges / change history.
- Pure logic in shared lib `@workspace/freezer-pull`: `normalizeFreezerPullItem(s)`,
  `daysUntil`, `buildFreezerPullPlan({runs, freezerItems, today})`, `DEFAULT_DAYS_EARLY=3`.
- **Why:** keeps web+mobile matching/windowing identical; apps only resolve scheduled
  runs into need-rows and render.

## Matching / windowing contract
- Match key = **need-row label** (the same join key the warehouse staging checklist
  uses), case-insensitive. Packaging rows are included in the matching input on both apps.
- Show an item for a run only when `0 <= daysUntil(runDate, today) <= item.daysEarly`
  (past runs excluded). Output is grouped + sorted by run date.
- Quantity fields on `FreezerPullItem` are **strings** (mirrors other lib item shapes).

## Server gating (intentional asymmetry)
- GET `/freezer-pull-items` is `requireAuth` only (floor staff must see pull cards).
- POST/DELETE require `requireCapability("manage-inventory")`.
- **Why:** reads feed the warehouse card for everyone; only managers edit config.
  Read policy is locked by a dedicated test (operator→200, no-token→401) separate from
  the GATED_ROUTES write tests.

## Parity gotcha (accepted)
- Manager UI quick-add suggestion list differs by platform: web offers dough/frontline/
  cheese/pep + `mixIngredients` + `ingredientTypes`; mobile context has no
  `mixIngredients`/`ingredientTypes`, so it offers dough/frontline/cheese/pep only.
  Manual entry gives full functionality on both — this is a data-availability difference,
  not a behavior drift.

## Resolution paths (kept behaviorally identical)
- Web: `loadProfile` → `FormValues` → `aggregateNeedRows` + `aggregatePackagingNeeds`,
  unit = `row.sub ?? ""`.
- Mobile: `brandProfiles[profileKey]` → `RunSettings` → `RunState` → `computeCalc` →
  `buildRunNeedRows` + `buildRunPackagingRows`.
