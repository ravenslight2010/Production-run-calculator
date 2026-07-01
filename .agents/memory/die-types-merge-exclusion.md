---
name: Die types excluded from merge
description: Die types must not participate in the Merge feature; the non-obvious sync/tombstone rule that keeps that true.
---

# Die types excluded from merge

Die types are a distinct physical-tooling list, NOT an ingredient-name pool, so
they must never be mergeable or rewritten by an ingredient merge.

**Why:** user asked to "exclude die types from merge." Merging a die type, or
rewriting a run's `dieType` because an ingredient merge map happens to contain a
colliding name, corrupts tooling selection.

**How to apply — every merge surface must exclude die types:**
- `MERGE_NAME_FIELDS` (mergeIngredients.ts) must NOT list `dieType` (else
  `mergeSettingsObject` rewrites the die field on runs/profiles/templates/history).
- Merge universes (`mergeFullUniverse` for AI suggest/import auto-check, scoped
  `mergeUniverse` "ingredients" tab) must NOT include the die-types list.
- `collectMergeSurfaces()` (merge-confirm preview counts) must NOT include die types.
- `applyIngredientMerge` list-rewrite (`listKeys` in storage.ts) must NOT include
  `DIE_TYPES_KEY`.

**Subtle sync leak (the one that's easy to miss):** the sync-receive `mergeList()`
applies the GLOBAL, non-namespaced `mergedAway` tombstone set (populated by every
ingredient merge). If die types run through `dropMergedAway`, an ingredient
merged-away source name that matches a die type deletes that die type on the next
sync. Fix: `mergeList(..., applyMergedAway=false)` for `DIE_TYPES_KEY`. Die types
still honor their OWN per-namespace deletion tombstones via `dropDeleted(..., "dieTypes")`.

**Parity:** landed WEB-only while parity is paused. When parity resumes, mirror all
of the above in mobile's `context/mergeIngredients.ts` + `RunContext` merge/sync paths.
`profileObjHasRealData`'s `dieType` check is unrelated to merge — leave it.
