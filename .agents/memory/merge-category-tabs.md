---
name: Merge category tabs
description: The Merge section's 6-tab category selector (web+mobile) — scoping rules, full-vs-scoped universe split, and the brand/flavor merge path.
---

# Merge category tabs

The Merge manager offers 6 category tabs — Ingredients, Mixes, Dough, Sauce,
Cheese mixes, Brand/Flavor — so a manual merge stays within one master-data group.

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
