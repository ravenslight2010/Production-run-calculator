---
name: mixSeed frontlineIngredients is an alias set, not recipe data
description: Why MIX_SEED.frontlineIngredients must keep duplicate/legacy ingredient spellings and must never be normalized
---

# mixSeed.ts `frontlineIngredients` is a backward-compat alias set

`MIX_SEED.frontlineIngredients` (in `artifacts/run-calculator/src/mixSeed.ts` and the
mobile mirror) is **not** recipe data — it is a deliberate superset of *every*
historical spelling of every topping/mix ingredient, including legacy and
mis-typed variants. `home.tsx` sync uses it as an exact-match `new Set(...)` to
detect old topping spellings arriving in `payload.frontlineIngredients` and
redirect them into mix ingredients.

**Rule:** When normalizing/deduping ingredient names, normalize ONLY the recipe
data (`specSeed.ts` CHEESE_RECIPES/specs, `mixPresets.ts` MIX_PRESETS). Leave
`mixSeed.ts` `frontlineIngredients` untouched — collapsing its duplicate/legacy
entries silently breaks backward-compat sync redirection (old payload spellings
leak into the frontline list instead of being reclassified as toppings).

**Why:** A bulk quoted-string ingredient-name normalization once collapsed the
legacy aliases here; typecheck and recipe-data dedup still passed, but the sync
cleanup regression was invisible until code review. The set being a `Set` hides
the duplicate entries (harmless), but the *removed* legacy spellings are the bug.

**How to apply:** Any canonical name you introduce in recipe data must already be
present in `frontlineIngredients`; verify that, but never remove the old variants.
Keep genuinely distinct ingredients distinct (e.g. SHEEP Romano vs Cow's Romano;
FR Tomatoes vs plain Diced Tomatoes).
