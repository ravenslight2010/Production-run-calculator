---
name: Cheese catch-all flavors normalize to empty
description: Why cheese blends labeled "All Varieties" must normalize to an empty flavors list, and where that happens.
---

Cheese blends assigned to a whole-brand catch-all label ("All Varieties", "All", "Any", "N/A", etc.) must NOT keep that label as a literal flavor. The CheeseRecipe model contract represents "applies to every flavor of the brand" as an EMPTY `flavors` list, and the run/setup pickers (`cheeseNamesForRun`) only treat `flavors.length === 0` as all-varieties.

**Why:** if a blend is stored as `flavors: ["All Varieties"]`, the picker treats "All Varieties" as a specific product flavor, so the blend is hidden the moment the operator selects a real flavor like "Meat Lovers" — leaving a blank cheese card with nothing sensible to pick. This was the reported bug after importing a cheese workbook.

**How to apply:** `normalizeFlavors` in `lib/cheese-recipes/src/index.ts` drops catch-all labels (local `CATCH_ALL_FLAVOR_WORDS` set mirroring `CATCH_ALL_FLAVORS` in `@workspace/spec-import`). Because both web (`src/cheeseRecipes.ts`) and mobile (`context/cheeseRecipes.ts`) `fetchCheeseRecipes()` run `normalizeCheeseRecipes` on every API load, this heals already-stored DB rows at read time (no migration) and fixes future imports — one shared place, full web+mobile+server parity. Filtering is exact whole-label match on trimmed lowercase, so real flavors like "All Meat" are safe.

Separate, non-code issue in the same bug report: a spec sheet can reference a cheese blend name that doesn't exist in the workbook (e.g. "Aldo's Cheese Mix 2" when the real blend is "Aldo's Standard Cheese Mix"). Name-based auto-link then finds nothing → blank recipe. That's a data mismatch the user resolves by picking/renaming; the normalization fix just makes the correct blend appear in the dropdown.
