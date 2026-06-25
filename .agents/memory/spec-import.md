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

## Size variants fold into the BRAND, not the flavor
When one brand's spec sheet has multiple SIZE variants (e.g. Lowes 7in vs 11in),
the AI prompt instructs that the size become part of the BRAND name
(`Lowes 7in`, `Lowes 11in`) — flavor stays just the flavor (`Pepperoni`). NOT
brand `Lowes` + flavor `7in Pepperoni`. **Why:** each size is a distinct profile
with its own die/applicators; sizes differ by ~0.5 levenshtein ratio so they
won't fuzzy-collapse into the base brand. Instruction lives ONLY in the
server prompt (`buildParseSpecSheetPrompt`); clients are thin, no parity edit.

## Mobile summary parity
- Mobile `buildSpecStore().profileExists` must mirror web `profileObjHasRealData`:
  any non-empty recipe array (dough/frontline/app{1-4}CheeseRecipe) OR any
  non-blank app/pep type, dieType, or recipe-name string counts as "exists"
  (=update). A narrow string-only check under-reports updates in the summary.

## Auto-link pipeline (prepare step) — keep web+mobile IDENTICAL
The prepare flow runs ONE fixed sequence on both apps (`src/specImport.ts`,
`context/specImport.ts`): chunked parse → canonicalize → AI match pass →
`applyNameMatches` → `crossFillSpecImport` → reconcile diff → dropped-row note.
Any change to one app's order/logic must land in the other verbatim.
- **AI match pass is fail-safe.** Names that canonicalize as "new" are sent to
  the EXISTING `/ai/match-import` in ONE call; server-sanitized matches are
  applied and merged into `newAliases` (learned). Wrap in try/catch — on ANY
  failure keep the canonical parse and continue; never block the import.
- **Cross-fill is conservative (D5).** `crossFillSpecImport` fills a profile's
  missing `dieType`/`sauceOzPerPizza` from same-brand siblings ONLY when all
  specifying siblings AGREE; never overrides a value that's already set; leaves
  blank on conflict. Pure, in `@workspace/spec-import`.
- **Full ingestion (D4), no silent truncation.** `splitGridsForPrompt` chunks an
  oversized single workbook across multiple parse calls; cores merge all chunks;
  `droppedRows` is propagated and surfaced via `appendDroppedNote` so the user is
  told exactly what was dropped. Row cleaning is shared with prompt rendering to
  avoid drift.
- **Auto-reconcile in review (D1), no AI/cost.** During prepare, the deterministic
  `@workspace/spec-reconcile` diff runs spec-vs-current-recipes; result lands in
  `SpecImportPrepared.discrepancies` (both apps) and renders on the review screen
  (web `SpecImportDialog`, mobile `SpecImportModal`, capped at 12 +N more).
  Mobile builds `currentRecipes` via `presetMapsToReconcileRecipes` from
  RunContext presets (master-data.tsx); web from storage. `Discrepancy.message`
  is plain-language — render directly.
- **targets[] nudge stays prompt-only (D3).** Strengthened in
  `buildParseSpecSheetPrompt` only; no contract change, no client parity edit.
