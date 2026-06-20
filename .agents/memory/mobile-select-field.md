---
name: Mobile SelectField parity
description: One reusable mobile bottom-sheet picker mirrors web's two select variants; which flags map to which fields.
---

Mobile `SelectField` (components/UI.tsx) is the single searchable bottom-sheet picker that replaces all mobile chip/free-text selection controls, and it must stay at parity with web's TWO distinct pickers in `run-calculator/src/pages/home.tsx`:

- Web `IngredientSelect` (recipe rows, recipe names): search + tap-select + per-item delete + "Add X", **no clear**. Mobile equivalent: pass `onAddOption`/`onRemoveOption`, leave `allowClear` off.
- Web `TypeDropdown` (die type, pepperoni 1 & 2): same, **plus `allowClear`** which renders a top "— None" row that calls `onChange("")`. These fields are optional and MUST stay clearable — losing the clear path is a parity regression.

**Why:** Converting chips→picker silently drops two affordances: toggle-off (clear) and per-row option add/remove. Both exist on web and were caught as regressions in review.

**How to apply:**
- Clearable fields (die, pep1, pep2) → set `allowClear`.
- Allergen → fixed set, `allowAdd={false}`, no clear ("none" is an explicit option), color dots via `optionColor`.
- Recipe ingredient rows in `RecipeEditor` → thread `onAddIngredient`/`onRemoveIngredient` from each call site to the matching master list (`frontlineIngredients`/`cheeseIngredients`/`doughIngredients`) via `addListItem`/`removeListItem`; without them the picker can't add/remove options.
- Modal bottom sheet wraps content in `KeyboardAvoidingView` (`behavior` = `"padding"` iOS, `undefined` Android — never `"height"` on Android).
