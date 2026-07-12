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
