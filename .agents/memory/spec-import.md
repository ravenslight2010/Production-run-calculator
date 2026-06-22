---
name: Spec-sheet & recipe Excel importer
description: User-facing .xlsx importer (spec profiles + dough/sauce/cheese recipes) with AI parse + learned-alias memory; web+mobile parity.
---

# Spec-sheet / recipe Excel importer

Managers upload an .xlsx workbook of spec sheets and/or recipes. Server AI
interprets it into structured brand/flavor profiles + dough/sauce/cheese recipes.
A learned-memory alias layer remembers messy-label→canonical-name mappings to
improve future imports. Apply semantics: **overwrite existing profiles + recipes
and add new ones automatically**, with a single review/summary screen before
applying (no per-item prompts).

## Layering (keep both apps thin)
- Pure logic lives in `@workspace/spec-import` (canonicalize w/ alias→exact→fuzzy
  (levenshtein ratio ≤0.34)→new, `collectSpecAliases`, `summarizeSpecImport`,
  `sanitizeParsedSpecImport`, `gridsToPromptText`). NO platform IO.
- Web glue: `src/specImport.ts` + `src/storage.ts` (`loadSpecImportKnown`,
  `profileExistsForImport`→`profileObjHasRealData`, `recipeExistsForImport`).
- Mobile glue: `context/specImport.ts` (accepts an INJECTED `SpecImportStore`),
  `context/parseSpecSheet.ts`, `context/specImportAliases.ts`. Mobile has no
  localStorage so `master-data.tsx` builds the store from RunContext live values.

## Auth model
- `/spec-import-aliases` CRUD: router-level `requireAuth` only (any signed-in
  user — NOT manager-gated), mirrors importAliases.
- `/ai/parse-spec-sheet`: manager-gated + rate-limited like other `/ai/*`.
- UI "Import Spec Sheet" entry is manager-gated on both apps.

## Sauce ingredient grounding (easy to get wrong)
- **Sauce recipe rows must canonicalize against the FRONTLINE/sauce ingredient
  pool, NOT cheese.** `ingredientKnownForKind("sauce")` returns
  `known.sauceIngredients` (web: `FRONTLINE_INGREDIENTS_KEY`; mobile:
  `frontlineIngredients` from RunContext). An earlier version wrongly reused
  `cheeseIngredients`, producing avoidable "new" sauce ingredients + weak aliases.
- `sauceIngredients` is part of the `ParseSpecSheetKnown` OpenAPI contract and is
  sent to the AI for grounding too — keep the web/mobile `SpecSheetKnown` types,
  `loadSpecImportKnown`, and both AI `known` payloads in lockstep.

## One recipe → many profiles (no duplicates)
- A single recipe (esp. a dough mixing procedure) often covers MANY brand/flavor
  profiles listed as header rows above one ingredient table. `ParsedRecipe` carries
  optional `targets: {brand,flavor}[]`; the AI emits ONE recipe with `targets[]`
  instead of N duplicates. Shared `recipeTargets(r)` = de-duped (case-insensitive)
  union of singular brand/flavor + targets[], dropping entries missing either.
- **Both apply paths MUST loop `recipeTargets(r)`** (web storage + mobile RunContext)
  so the one recipe ties to every profile; canonicalize each target like singular.
- **`summarizeSpecImport` intentionally counts by recipe (so a multi-target import
  is 1 recipe, not N)** — do not "fix" it to count targets.

## Mobile summary parity
- Mobile `buildSpecStore().profileExists` must mirror web `profileObjHasRealData`:
  any non-empty recipe array (dough/frontline/app{1-4}CheeseRecipe) OR any
  non-blank app/pep type, dieType, or recipe-name string counts as "exists"
  (=update). A narrow string-only check under-reports updates in the summary.
