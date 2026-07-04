---
name: Server-side ingredient catalog
description: Factory-wide ingredients table with stable ids; recipe rows reference ids, names resolve live; hybrid rollout alongside existing local option lists.
---

## What changed

Ingredients moved from client-side string lists (synced via additive union + `mergedAway`/`deletedItems` tombstones) to a factory-wide server table (`ingredientsTable` in `lib/db`) with stable ids. Pure resolution/normalization logic lives in `@workspace/ingredient-catalog`. Recipe rows (`RecipeRow`) got an optional `ingredientId` field alongside the existing `ingredient` name string.

**Why hybrid, not a hard cutover:** the existing local option lists (`ingredientTypes`, `cheeseIngredients`, `doughIngredients`, `frontlineIngredients`, `pepTypes`, `mixIngredients` on web; 4 of those on mobile) still drive the UI pickers, master-data screens, and every historical surface (profiles/templates/history/presets). Rewriting all of that in one pass to be ID-first was out of scope and risky for a factory-wide table with no rollback. Instead: the server catalog is the new authoritative source for *display name resolution*, seeded once from local lists (`migrateIngredientListsToCatalogIfNeeded`, marker-guarded, idempotent, only seeds if the catalog is empty), and every list mutation (add/rename/merge/delete) now ALSO best-effort dual-writes to the catalog. `inventory_items` key format (`ingredient:<name>:lbs`) is untouched — the catalog only affects recipe-row *display*, not inventory keys.

## How name resolution works

- `buildIngredientIndex(items)` → `{ byId, byName }`.
- `resolveActiveIngredient(id, index)` follows `mergedInto` pointers (cycle-safe, bounded) to the live ingredient; merges/deletes are soft (`mergedInto` pointer / `enabled: false`), never hard deletes, so old recipe rows referencing a gone id can still resolve to a name.
- `hydrateRecipeRows(rows, index)`: for rows with an `ingredientId`, refreshes `ingredient` from the current catalog name (propagates renames/merges with zero client-side rewrite) and re-points `ingredientId` if merged away; for legacy rows with no id, best-effort backfills one by case-insensitive name match. Never drops a row or blanks a name it can't resolve — falls back to whatever name the row already carried.
- Both apps hydrate ONLY the currently-active recipe rows (web: `form.getValues()`'s 6 recipe fields; mobile: the current run's 6 recipe fields via `updateCurrentRun`), not every run/history/preset — those refresh lazily next time they become active. This bounds the blast radius of the new effect.

## Gotchas

- **`hydrateRecipeRows` is `Array.map`-based** — it always returns a NEW array reference even when no row changed (per-row identity is preserved, array identity is not). Any caller that gates a state update on "did hydration change anything" must compare row-by-row (`next.some((row, i) => row !== rows[i])`), not array reference — otherwise a `useQuery` refetch (new array each poll) falsely looks like a change and re-stamps/pushes the run every poll cycle.
- Dual-writes on rename/merge/delete are **best-effort and non-blocking**: local list mutation always succeeds first; catalog write failures are swallowed (network/offline) and self-heal next time that name is touched (via `findOrBuildIngredient`).
- Mobile only maps 4 of web's list categories to the catalog (`pepTypes`→pep, `cheeseIngredients`→cheese, `doughIngredients`→dough, `frontlineIngredients`→frontline) — mobile has no generic `ingredientTypes`/`mixIngredients` list. Die types are intentionally excluded from the catalog too (see die-types-merge-exclusion memory).
- GET is open to any signed-in user (both apps need it to resolve names/build pickers); create/rename/merge/delete are manager-gated (`manage-inventory` capability), matching the mixes/cheese-recipes precedent.
