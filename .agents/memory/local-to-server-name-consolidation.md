---
name: Local→server master-data name consolidation
description: One-time client migration pattern that folds legacy local-only recipe name lists into server pools without losing names or fighting live sync.
---

One-time marker-guarded effect (`run-calc-recipe-name-consolidation-v1`, manager-gated) consolidates the 4 legacy local name lists (sauce/frontline, dough, cheese, mix) into the server pools. Pure planner `planNameConsolidation` lives in `@workspace/named-recipes`.

**Rules that must hold for any future consolidation of this kind:**
- **Never drop a name silently.** After pushing additions, RE-PLAN (reconcile) against the pools' own near-dup matchers: a name the pool's internal matcher skipped must stay in the local list as a leftover, not be wiped.
- **Wipe via per-namespace deletion tombstones** (same namespace strings as `RECIPE_NAME_MERGE_STORE`: `frontlineRecipeNames`/`doughRecipeNames`/`cheeseRecipeNames`/`mixRecipeNames`) or the additive live-sync union resurrects the wiped names from peers.
- **Near-dup folds go through `applyRecipeNameMerge`** (rewrites run/profile/template references + tombstones), and every re-pointed run needs its `runValuesUpdated` stamp bumped BEFORE the sync push so peers accept the rename.
- **Legacy cheese-list entries split two ways**: `specImportCheeseRecipeIsMix` classifies each as Mix vs Cheese pool; cheese-origin names that became mixes still tombstone under the `cheeseRecipeNames` namespace (that's where the stale name lives).
- **Failure re-arms**: catch resets the in-flight ref and does NOT set the marker, so a partial run (e.g. mid-flight page wipe) retries next load and pool pushes are idempotent (add-if-absent).
- The final sync PUT is best-effort with `epoch=`; a `{stale:true}` outcome is fine because the reset flow wipes local state anyway.

**Why:** pickers union server pools + local lists; stale local-only names ("Mystic", "Mystic Recipe", "mystic sauce") looked like phantom entries not manageable in Manage Lists.
