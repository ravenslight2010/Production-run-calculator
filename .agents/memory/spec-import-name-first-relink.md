---
name: Spec import name-first dough/sauce assignment + relink
description: Dough/sauce TYPE (name) imports before the recipe exists; a later recipe import relinks by loose name. Gotchas about the ghost-profile guard and the brand/flavor registry.
---

Spec-sheet import captures a profile's dough/sauce NAME (`ParsedProfile.doughName` / `sauceName`) even when the workbook carries no matching mixing recipe: the name is registered as a dropdown option (tombstones cleared) and set on the profile only when it has no mixed rows (lbs>0) and no existing name. When the actual dough/sauce recipe imports LATER, the tie loop's relink-by-name pass attaches rows/doughball weight (and the canonical spelling) to every saved profile whose stored name loose-matches (`specImportNameMatchKey`).

**Gotchas:**
- **Ghost-profile guard excludes dough**: `profileObjHasRealData` deliberately ignores `doughRecipe`/`doughRecipeName`, so a profile whose ONLY data is a dough assignment is never persisted (and a dough-only relink save is silently dropped). Real spec profiles always carry dieType/applicators, so this only bites synthetic tests — give test profiles a `dieType`.
- **Relink walks the brand/flavor registry** (`loadBrandFlavors`), not raw profile keys — profiles saved in tests via `saveProfile` alone are invisible to it; register with `saveBrandFlavors` too.
- Generic placeholders ("Dough", "Pizza Dough", "Crust", like "Sauce") are dropped by the sanitizer; "dough"/"crust" are generic tokens in grounding, so a paraphrase whose distinctive tokens all sit in one sheet cell counts as grounded (kept), not snapped.
- Exported Profiles tab carries "Dough Recipe"/"Sauce Recipe" columns so exports round-trip these assignments.

**Review-time reassignments must follow through AND be learned (dough/sauce):**
- A "use existing" pick or manual rename during import review renames only the RECIPE — unless the profiles' `doughName`/`sauceName` are repointed to the recipe's FINAL name, nothing connects and the raw sheet label leaks into the type dropdowns. The dialog's `edited` output pipes profiles through the pure `repointProfileNamedRecipes` helper (kind-scoped, loose-key) for exactly this.
- **Why:** users reported "imports don't remember my reassignments" — links/renames looked applied in review but every re-import resurrected the raw name.
- **How to apply:** any new review-time decision that renames a dough/sauce recipe must (1) repoint profile assignments in the confirmed parse, and (2) emit a learnable `recipeName` alias (context `dough`/`sauce`) so `canonicalizeParsed` applies it on the NEXT import (alias-only, no fuzzy — pool snapping stays the link pass's job; works even when the recipe is absent from the sheet).
- Cheese/mix renames ARE learned (appType kind, context null) but must NEVER apply as a one-sided slot rename: canonicalizeParsed skips appType aliases on blend-named slots, and a separate lockstep pass (`applySpecImportBlendNameAliases`) renames the cheese/mix RECIPE and every loose-matching applicator slot together at prepare. Only lockstep is safe — a slot-only rename disconnects the slot from its recipe; a recipe-only rename does the same in reverse. Slot-only sheets (alias hit but no recipe in the import) are left to the ordinary canonicalize pass. userNamed recipes are never rewritten.
