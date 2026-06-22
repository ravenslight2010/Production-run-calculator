---
name: Warehouse staging checklist
description: Per-run "What Each Run Needs" check-off state — how it's keyed, stored, and synced across web+mobile.
---

# Warehouse staging checklist

Warehouse staff tick off per-run need rows (ingredients + packaging) in the
"What Each Run Needs" card as they pull/stage them.

- **Storage:** `dayState.stagedItems?: Record<string, boolean>` (web `DayState`,
  mobile `AppState`). Only checked rows stored as `true`; unchecking deletes the
  key. NOT master data — a today-only day-state overlay.
- **Key:** `${runId}::${label}__${unit}` where `label`+`unit` come from the same
  `aggregateNeedRows`/`aggregatePackagingNeeds` (web) and
  `buildRunNeedRows`/`buildRunPackagingRows` (mobile) row builders. The
  `label__unit` form matches across platforms, so a check on one device lines up
  on the other for the same logical row.
- **Sync:** rides in the synced day-state exactly like `substitutions` —
  authoritative whole-map replacement on the accepted day (last-writer-of-day
  wins; same residual ≤30s echo-race tradeoff as substitutions, not merged
  per-key). Added to web `appStateToPayload` build + accept paths, mobile
  `SyncDayState`/`SyncableState`/`appStateToPayload`/`applyPayloadToState`.
- **Reset:** cleared at the daily reset everywhere substitutions are: web
  `freshDayState` + both rollover `DayState` constructs; mobile `freshDay`,
  `rolloverDay`, `DEFAULT_APP_STATE`, `normalizeState`.

**Why the substitutions pattern:** it's the established today-only synced overlay
in this codebase; reusing it (whole-map replace, same reset points) keeps the new
field from being clobbered by additive list unions and keeps web+mobile parity.
