---
name: Frontline recipe is the sauce recipe
description: The app's internal "frontline" recipe system is what the UI calls "Sauce Recipe" — seed sauce data there, no new field.
---

# Frontline recipe == Sauce recipe

The internal "frontline" recipe system IS the sauce recipe. There is no separate
"sauce recipe" data structure.

**Why:** `FrontlineRecipeCard` renders with the title "Sauce Recipe", and the
Setup-tab "Sauce" dropdown is bound to `frontlineRecipeName` (with rows in
`frontlineRecipe`). The naming is a historical mismatch between internal field
names and the user-facing label.

**How to apply:** When importing/seeding sauce recipes, target the existing
frontline plumbing — do NOT add a new field or UI:
- Library: `frontlineRecipePresets` (Record<name, RecipeRow[]>), the recipe-names
  list, and the frontline ingredient list.
- Per-profile tie: set `frontlineRecipeName` + `frontlineRecipe` on the brand/flavor
  profile, and only when `frontlineRecipe` is empty/absent (protect user edits).
- Oz-per-pizza usage is a separate profile value and is not part of these recipes.
- Keep web (`artifacts/run-calculator`) and mobile (`artifacts/run-calculator-mobile`)
  identical; mobile seeds run in the single ordered combined effect (see
  mobile-seed-ordering.md).
