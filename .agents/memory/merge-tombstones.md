---
name: Merge tombstones (mergedAway)
description: Why ingredient merges need a synced tombstone to survive additive live-sync, and the cross-peer re-add tradeoff.
---

# Merge durability via `mergedAway` tombstone

Ingredient/die "merge similar names" removes source names locally, but live-sync
reconciliation is **additive union only** (server is last-write-wins KV; clients
never delete on merge). So a merged-away name gets resurrected from a stale peer
or from the device's own pre-reload server pull. Symptom reported by user: "manual
merge — the box closed and nothing happened" (duplicates reappear).

**Fix:** a synced `mergedAway: string[]` tombstone, at web+mobile parity.
- Recorded when a merge runs: the source names, **excluding any name that is also a
  merge target** (a name mapping to itself is not a real source).
- Carried in the sync payload over the same KV channel.
- On reconcile: union remote+local tombstones, then strip tombstoned names out of
  **every** master-data list union — including the `ingredientTypes` list, which has
  its own bespoke union path separate from the shared `mergeList` helper. (Regression
  caught in review: it's easy to add the tombstone filter to `mergeList` and forget
  the one-off `ingredientTypes` block.)
- Cleared for a name when the user explicitly re-adds it (add* funcs / addListItem),
  so a name can be resurrected later.

**Why:** without this, any merge silently un-does itself on the next sync tick.

## Web merge must refresh in place, not reload (separate, also fixed)
Web merge originally ended with `window.location.reload()`. Two problems: (1) the
always-mounted Merge panel + its `mergeSuggestions` list were torn down, so only ONE
suggestion could ever be applied before the box "closed"; (2) the reload's sync-pull
could race the merged-payload push and resurrect un-merged names.

Fix — mirror mobile's in-place merge instead of reloading:
- `handleApplyMerge` returns a success boolean; `applyMergeSuggestion` drops just the
  applied suggestion (referential `x !== s` filter) so the panel stays open and the
  user works through the rest. Mobile `applySuggestion` does the identical filter.
- A `refreshAfterMerge()` re-reads **every** React surface `applyIngredientMerge`
  rewrites: master lists (incl. mix lists — `reloadMasterData` originally omitted
  them), `templates`, `history`, `dayState`, and the current-run `form.reset` +
  `resetFieldArrays`. Missing any one leaves stale state; in particular the
  current-run form MUST be reset or its autosave writes the pre-merge names back.
- **Ordering trap:** `buildSyncPayload` serializes the active run from
  `form.getValues()`, not storage. So `refreshAfterMerge()` (which does the
  `form.reset`) must run **before** the `/api/sync/today` PUT, or the push ships
  stale pre-merge current-run values. Build the payload from `loadDayState()` after
  the refresh.

## Accepted tradeoff: cross-peer re-add resurrection
Tombstones reconcile by **union** (`local ∪ remote`), with no per-name version/clock.
Consequence: if device B re-adds a tombstoned name (clearing B's tombstone), device A
that still holds the tombstone keeps stripping the name and can re-poison the server.
This is a deliberate scope decision for the bug ("merges must stick"); the common case
(merge, then never re-add the exact merged-away spelling) works. A full fix needs a
removal-aware model (tombstone map with timestamps / version vectors / explicit
"resurrected" set with precedence) — not done here.

**How to apply:** any new synced master-data list must run its incoming union through
the same tombstone filter (`dropMergedAway` on web, `dropTomb` on mobile). Mobile sync
paths must stay fail-safe (no throws) — guard with `?? []` / `String()` coercion.
