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

## Durable factory-wide tombstone (survives the day boundary)
The synced `mergedAway` array alone is NOT enough: it lives only inside the
per-day, whole-blob, last-write-wins sync row. A new day's row starts empty and
whichever device seeds it wins, so a device that was offline during the merge
reseeds the new day with the old names + an empty tombstone → merged names
reappear the next day. (User report: "merged duplicates yesterday, they came
back today.")

**Fix:** a durable, factory-wide server tombstone table `merged_away`, mirroring
`denied_merges` (GET/POST/DELETE `/merged-away`, any signed-in user, names
normalized trim+lowercase, idempotent insert, per-name delete, `currentScope()`
isolation). Behavior, at web+mobile parity:
- POST the merge's source names (excluding self-mapping targets) on every merge —
  best-effort, never blocks the merge.
- On load (web mount effect) / sync-init (mobile bootstrap), fetch the durable
  set, union it into local `mergedAway`, and prune **every mergeable master
  list**. Both paths are fail-safe (best-effort try/catch; mobile setState is the
  ErrorBoundary-uncatchable async path).
- DELETE on explicit re-add, preserving "re-add resurrects".

**Parity trap (caught in review, twice):** mobile `addListItem` is ONE generic
handler over all `MasterListKey`s — including non-mergeable `brands`/`stopReasons`
— whereas web has per-list `add*` handlers and only the mergeable ones clear the
tombstone. BOTH the local `mergedAway` removal AND the durable DELETE must be
gated on `MERGEABLE_LIST_KEYS` (die/pep/cheese/dough/frontline). The first pass
gated only the durable DELETE and left the LOCAL filter unconditional, so adding a
non-mergeable brand named like a tombstoned ingredient still cleared the local
tombstone and could re-push it via day-sync. Gate them together. Mobile merge
universe = pep+die+cheese+dough+frontline (NO ingredientTypes/mix); web prunes
ingredientTypes/pep/die/cheese/dough/frontline/mix.

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

## Merge-suggestion "Load" must canonicalize + scroll (separate, also fixed)
The AI/learned merge-suggestion "Load" button (prefill the manual form) looked dead.
Two causes: (1) on web the manual merge form renders BELOW the suggestion list inside
the Manage dialog, so Load updated state off-screen — looked like a no-op. (2) source
rows only tick when the loaded name EXACTLY matches the universe spelling
(`mergeSources.includes(name)`), but AI/learned names can differ in case, so even
loaded sources didn't visibly select.

Fix (web `loadMergeSuggestion`, mobile `loadSuggestion`, parity): canonicalize target
+ sources to the universe's exact spelling (case-insensitive find, fallback to trimmed
raw), dedupe, drop any equal to target. Web additionally scrolls the form into view via
a `mergeFormRef` + `requestAnimationFrame(scrollIntoView)`; the manual-form fragment was
wrapped in `<div ref={mergeFormRef} className="space-y-4 scroll-mt-2">` (mobile is a
ScrollView so no scroll needed — logic-only parity).

**How to apply:** any "load suggestion into a form" affordance must snap names to the
canonical list (case-insensitive) or checkbox/selection state won't reflect, and on web
ensure the target form is actually visible (scrollIntoView) when it sits below the list.
