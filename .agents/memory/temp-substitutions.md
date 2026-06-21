---
name: Temporary ingredient substitutions
description: Day-state overlay that swaps/adds/removes recipe ingredients for today only; affects totals AND inventory consumption keys.
---

# Temporary ingredient substitutions (web + mobile)

Floor-staff feature: when an ingredient runs low/out, overlay today's recipes
without touching master data or saved run recipes. Three actions: **swap** (new
amount), **add** (supplement alongside), **remove**. Applies to ALL of today's
runs that contain the ingredient. Auto-reverts at daily reset; manual "Clear all".

## Where the math lives
Pure overlay computation is in `@workspace/inventory-math` (shared, tested):
`applySubstitutions`, `applyRecipeSubstitutions`, `substitutionsForIngredient`,
types `IngredientSubstitution {id, ingredient, action, substitute?, amount?}`,
plus `SUBSTITUTION_RECIPE_FIELDS` (doughRecipe, frontlineRecipe, app1-4CheeseRecipe)
and `SUBSTITUTION_TYPE_FIELDS` (app1-4Type, pep1Type, pep2Type). Recipe rows match
by `row.ingredient`; type fields match by VALUE (so consumption keys change too).

**Why the dual application matters:** the overlay must feed BOTH the material-total
calc AND the inventory-consumption line builder. Type fields are overlaid so the
consumption key `ingredient:<Name>:lbs|batches` points at the substitute, not the
short item — otherwise auto-deduct draws down the wrong stock.

## Storage / sync
Lives in **synced day-state**, NOT master data. Web: `DayState.substitutions` +
module-level mirror in `substitutionState.ts` (web computeCalc is inline and can't
take an arg, so the shared-calc module reads active subs from there via an effect).
Mobile: `AppState.substitutions`, threaded explicitly as the 3rd arg to
`computeCalc(state, nowMs, subs)` and into `consumeOpenRunsForRollover(runs, subs)`
/ start/endRun via `overlaySettings(settings, subs)`. Both cleared on reset/rollover
and accepted wholesale from a remote day (authoritative whole-day overlay).

## UI parity
`SubstitutionsManager` (manage panel, lives in Inventory tab) + `RecipeSubstitutionBadge`
(read-only, on each recipe screen) exist in both apps. Low-stock alert rows have a
"Substitute" prefill shortcut. One active substitution per affected ingredient
(case-insensitive replace on add).
