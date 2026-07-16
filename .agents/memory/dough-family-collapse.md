---
name: One recipe per dough family
description: Spec-import dough variant names collapse onto the single base pool recipe; never mint variant placeholders.
---

The factory keeps ONE dough recipe per family ("CRB Dough", "Malted Barley Dough"). Spec-sheet dough names like `11" CRB`, `CRB Heavy Plus recipe`, `Heavier CRB`, `Thick Malted Barley` are NOT separate recipes — the qualifier only selects a doughball-weight row in the family's mixing-procedure workbook.

**Why:** User explicitly wants "1 CRB recipe like it used to be"; variant placeholders polluted Manage Lists and split profiles across empty recipes.

**How to apply:**
- `findSpecImportDoughFamilyMatch(name, existingNames)` in `@workspace/spec-import`: pool recipe matches when its distinctive tokens (loose key minus generic dough words + unit words; DIGITS stay distinctive) are a subset of the variant name's tokens. Most-specific wins; cross-family ambiguity → null. Dough-only — unsafe for sauce ("Sweet n Sour" vs "Sour").
- Wired as last fallback in `linkSpecImportNamedRecipesToExisting` for BOTH profiles and RECIPES: an incoming variant dough recipe snaps onto the base name too, so the profile↔recipe tie survives and its rows/doughball weight fold into the family instead of being stranded under a name the pool guard drops.
- Web commit path: re-runs the dough relink against the LIVE server pool before `applySpecImport` (prepare's pool fetch is best-effort), and the placeholder loop skips dough candidates that family-match the pool — keeps suppression and profile names consistent, no stranded references.
- Web prepare: dough link universe = local presets ∪ server pool.
- SAUCE family match is separate and stricter: `findSpecImportSauceFamilyMatch` uses distinctive-token SET EQUALITY (generic tokens sauce/recipe/pizza/frontline dropped, possessive fold) — subset matching is unsafe for sauce ("Sweet n Sour Sauce" would hit "Sour Sauce"). Two pool names sharing one loose key are equivalents (first wins), different loose keys under one family key → ambiguous → null. Wired via kind-aware `findSpecImportNamedRecipeFamilyMatch` into profile linking AND recipe renames for both kinds (dough recipe-level snap enabled after variant recipes stranded doughball weights).
- Last line of defense: web `addNamedRecipesToServerIfAbsent` drops candidates that family-match the existing pool, but REMAPS a dropped dough candidate's doughball weight onto the family name (fills only unset pool weights) so the weight is never lost.
- Web prepare/commit sauce linking uses local ∪ server pool too (family base may exist only in the pool); commit-time relink loops BOTH kinds.
- Cheese-kind recipe rows are per-pizza OUNCES verbatim (SpecCheeseRecipeDraft contract) — the oz→lbs default conversion must skip kind=cheese, and any parse-unit semantics change must bump SPEC_PARSE_VERSION or stale saved parses resurrect corrupted amounts.
- A user-typed rename (userNamed) never re-categorizes cheese↔mix — the word heuristic is unreliable on chosen names.
- Related importer fixes: `specImportCheeseRecipeIsMix` treats "blend" like "mix"; die-type link pass folds die/dies tokens (`specImportDieTypeMatchKey`) and web canonicalization is case-insensitive (`canonicalDieTypeName`).
