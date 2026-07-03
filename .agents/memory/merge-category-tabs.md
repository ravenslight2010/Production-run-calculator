---
name: Merge category tabs
description: The Merge section's 6-tab category selector (web+mobile) — scoping rules, full-vs-scoped universe split, and the brand/flavor merge path.
---

# Merge category tabs

The Merge manager offers 6 category tabs — Ingredients, Mixes, Dough, Sauce,
Cheese mixes, Brand/Flavor — so a manual merge stays within one master-data group.

## WEB: category tabs merge RECIPE NAMES, Ingredients tab merges ingredients
(Web-only during the parity pause; see `.local/parity-pause-log.md`. Mobile still
merges ingredient names on every tab.)
- **Mixes/Dough/Sauce/Cheese** tabs merge that category's **recipe NAMES** (the
  named recipe presets), NOT ingredient names. **Ingredients** tab merges only real
  ingredients, EXCLUDING any name that is a recipe name in another category.
- Recipe-name merge path is separate from the ingredient path: pure logic in
  `src/mergeRecipeNames.ts` (`RECIPE_NAME_FIELDS_BY_CATEGORY`: dough→`doughRecipeName`,
  sauce→`frontlineRecipeName`, cheese→`app1-4CheeseRecipeName`, mixes→none;
  `foldPresetKeys` folds preset map KEYS with target's rows winning); storage glue in
  `applyRecipeNameMerge` (tombstones + list/preset fold + re-points selection fields);
  dispatch `handleConfirmMerge` → `handleApplyRecipeNameMerge`. NO inventory fold, NO
  alias/correction learning (unlike the ingredient path). Mixes = list+tombstone only.
- **Mixes guardrail:** only user-added mix recipe names are mergeable away (factory
  MIX_SEED names would be re-seeded); `handleApplyRecipeNameMerge` filters sources.
- **Sync-race guards (the two easy-to-miss ones):** (1) `applyRecipeNameMerge` returns
  the ids of runs it re-pointed; the caller MUST bump `runValuesUpdatedAt` for exactly
  those before the sync push, or a stale remote at an equal/older stamp overwrites the
  merge. (2) The dough/frontline/cheese preset union on sync-receive MUST filter
  tombstoned keys (`dropTombstonedPresetKeys`), or a stale peer resurrects the
  folded-away recipe-name preset. Selection-field re-pointing alone is not enough.
- **AI "Suggested merges"** shown only on the Ingredients tab (recipe-name tabs have
  no learned-alias path).
- **Stray mix names in `ingredientTypes`:** real user data has recipe/mix NAMES (containing
  the word "mix") dumped into `ingredientTypes` with spellings that match NO recipe-name
  list, so exact-match exclusion can't hide them. `isStrayMixName` (mergeRecipeNames.ts)
  flags a whole-word `\bmix\b` ("mixed"/"premix" excluded), allowlisting genuine ingredients
  (`DEFAULT_INGREDIENT_TYPES` + `MIX_SEED.frontlineIngredients` + `pepTypes`, e.g. "Hot
  Giardiniera Mix"). Used both to hide them from the Ingredients tab AND by a one-time
  marker-guarded migration that RE-CATEGORIZES them: cheese-named → `cheeseRecipeNames`,
  else `mixRecipeNames`. **Why:** name-based classification only — the data model can't tell
  a stray mix name from a real ingredient.
  **Cross-device convergence:** the migration only needs to run on ONE device (the polluted
  one). It tombstones removed names under `deletedItems["ingredientTypes"]` and adds to the
  cheese/mix lists; both are in the synced payload, so every peer's sync-receive drops the
  strays (`dropDeleted`) and unions the moves in. Do NOT make such a migration rerunnable —
  it would auto-relocate any legitimately user-added "…mix" ingredient on every load.

## Reclassify (move a recipe name between category tabs) — web-only
- Manage Lists names panels have a per-row "Move to another category" action
  (`moveRecipeName` in home.tsx): removes the name from the source list (which
  TOMBSTONES it under the source namespace so peers drop it) and adds it to the
  target (which clears any target tombstone), carrying saved recipe rows between
  preset maps. Change History records it as type `"move"` (undoable).
- **Shared cheese/mix preset map gotcha:** mix recipe rows live in the CHEESE
  preset map. A cheese→mix move tombstones the name under `cheeseRecipeNames`,
  so the sync-receive cheese-preset drop would WIPE the moved recipe's rows on
  the next sync. The receive handler must filter tombstones through
  `dropTombstonesForAliveNames(deletedMap, "cheeseRecipeNames", mixNamesList)`
  before `dropTombstonedPresetKeys` — a name alive in the mix list is a move,
  not a deletion. Regression test: `recipeReclassifySyncReceive.test.ts`.
- Preset shape differences when carrying rows: dough map stores `{ rows }`,
  sauce stores `rows[]`, cheese/mix share one `rows[]` map (cheese↔mix move
  skips the row copy entirely).
- **Dangling-selection invariant:** a move (unlike a merge) has no same-category
  target to re-point to, so every run/template/history/profile selection field
  still holding the moved name must be BLANKED (`clearRecipeNameSelections`,
  same traversal as the merge) and the changed runs' `runValuesUpdatedAt`
  stamps bumped before the push — else stale peers resurrect the old selection.

## Two universes, don't conflate them
- **Full universe** (`mergeFullUniverse` web / `fullUniverse` mobile): every
  mergeable ingredient list unioned. Used by the AI "Suggested merges" scan, the
  post-import auto-check, and `loadSuggestion` canonicalization — these all look
  for duplicates ACROSS categories, so they must NOT use the scoped list.
- **Scoped universe** (`mergeUniverse` web / `universe` mobile): only the selected
  tab's list; drives the source/target pickers.
- **Why:** suggestions are cross-category by nature; pickers are intentionally
  scoped. Wiring suggestions to the scoped list silently hides real duplicates.

## Brand/Flavor tab is its own path (not `mergeIngredients`)
- Sub-mode toggle: **Brands** (merge whole brands) or **Flavors** (merge flavors
  within one selected brand). Flavors mode needs a chosen brand — guard before apply.
- Dispatch: web `handleConfirmMerge` → `handleApplyBrandFlavorMerge`; mobile
  `apply()` → `mergeBrands` / `mergeFlavors` (in RunContext).
- Semantics: brand merge unions the merged-away brands' flavor sets into the kept
  brand; both modes re-point ONLY today's runs' `settings.brand`/`settings.flavor`
  and write a `deletedItems`/tombstone entry (survives the additive live-sync union).
- **Parity choice:** per-flavor profiles keyed to a merged-away brand are left
  as-is (mirrors `renameBrand`). Brands carry no inventory, so nothing folds.

## Mobile-specific gotchas
- Mobile has **no mix-ingredient list**, so the Mixes tab is always empty — kept
  for structural parity, shows a graceful empty message.
- The old MergeManager early-returned when the universe was empty; that would hide
  the tab row. Empty state MUST render BELOW the tabs, never as an early return.
- `switchCategory`/`switchMergeCategory` must clear the form + open suggestions so
  nothing leaks across categories; default `bfBrand` to the first brand on entry.
