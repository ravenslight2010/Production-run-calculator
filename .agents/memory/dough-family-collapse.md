---
name: One recipe per dough family
description: Spec-import dough variant names collapse onto the single base pool recipe; never mint variant placeholders.
---

The factory keeps ONE dough recipe per family ("CRB Dough", "Malted Barley Dough"). Spec-sheet dough names like `11" CRB`, `CRB Heavy Plus recipe`, `Heavier CRB`, `Thick Malted Barley` are NOT separate recipes — the qualifier only selects a doughball-weight row in the family's mixing-procedure workbook.

**Why:** User explicitly wants "1 CRB recipe like it used to be"; variant placeholders polluted Manage Lists and split profiles across empty recipes.

**How to apply:**
- `findSpecImportDoughFamilyMatch(name, existingNames)` in `@workspace/spec-import`: pool recipe matches when its distinctive tokens (loose key minus generic dough words + unit words; DIGITS stay distinctive) are a subset of the variant name's tokens. Most-specific wins; cross-family ambiguity → null. Dough-only — unsafe for sauce ("Sweet n Sour" vs "Sour").
- Wired as last dough fallback in `linkSpecImportNamedRecipesToExisting` (skipped when THIS import carries a recipe under the variant name — then it's a real new recipe).
- Web commit path: re-runs the dough relink against the LIVE server pool before `applySpecImport` (prepare's pool fetch is best-effort), and the placeholder loop skips dough candidates that family-match the pool — keeps suppression and profile names consistent, no stranded references.
- Web prepare: dough link universe = local presets ∪ server pool.
- SAUCE family match is separate and stricter: `findSpecImportSauceFamilyMatch` uses distinctive-token SET EQUALITY (generic tokens sauce/recipe/pizza/frontline dropped, possessive fold) — subset matching is unsafe for sauce ("Sweet n Sour Sauce" would hit "Sour Sauce"). Two pool names sharing one loose key are equivalents (first wins), different loose keys under one family key → ambiguous → null. Wired via kind-aware `findSpecImportNamedRecipeFamilyMatch` into profile linking (both kinds) and recipe renames (sauce only — dough recipe-level snap deliberately excluded).
- Last line of defense: web `addNamedRecipesToServerIfAbsent` drops candidates that family-match the existing pool, so ANY push path (incl. stale local-preset migration) can't mint variants.
- Related importer fixes: `specImportCheeseRecipeIsMix` treats "blend" like "mix"; die-type link pass folds die/dies tokens (`specImportDieTypeMatchKey`) and web canonicalization is case-insensitive (`canonicalDieTypeName`).
