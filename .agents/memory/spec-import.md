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
- **Both apply paths MUST loop `recipeApplyTargets(r, parsed.profiles)`** (web storage
  + mobile RunContext), NOT `recipeTargets` directly, so the one recipe ties to every
  profile identically. `recipeApplyTargets` = explicit `recipeTargets` when present,
  else a conservative same-import fallback: a brand-only recipe (no flavor, so
  `recipeTargets` is empty) links to ALL same-brand profiles in the import; a recipe
  with no brand anchor links to nothing (never broadcast across unrelated products).
  **Why:** the AI sometimes leaves `targets[]` empty for a shared recipe; the prompt
  nudge (D3) is best-effort, so the deterministic apply-time fallback is the backstop.
  Keep the fallback semantics web+mobile-identical; never broaden an explicit target.
- **`summarizeSpecImport` intentionally counts by recipe (so a multi-target import
  is 1 recipe, not N)** — do not "fix" it to count targets.

## Brand = full product-line header; SIZE fold is only a fallback
The BRAND is the product-line name from a block's HEADER cell, kept in full
INCLUDING distinguishing qualifiers (`Original`, `Ultra Thin`, `Thin Crust`,
`Deep Dish`, `Gluten Free`, …); drop only generic trailing words
(`Pizzas`/`Pizza`/`Recipe`/`Specs`). Two sheets from the same company but
different product lines are DIFFERENT brands (`Basha's Original` vs `Basha's Ultra
Thin Crust`) and must NOT collapse to the bare company name, or their identical
flavor names (Cheese, Pepperoni, …) overwrite each other. The prompt also tells
the model NOT to match a qualified product-line brand to a shorter KNOWN brand
that merely lacks the qualifier (else it re-collapses via the "reuse KNOWN name"
rule; the lib's levenshtein fuzzy is safe here — ratio ≫0.34).
- **Only when a sheet has NO product-line qualifier and differs purely by SIZE**
  (e.g. Lowes 7in vs 11in) does the size fold INTO the brand (`Lowes 7in`,
  `Lowes 11in`) — never the flavor. Size is the fallback, product line wins.
- **Why the original folding rule caused a bug:** the prompt used to fold SIZE into
  the brand with no mention of product lines, so `Basha's Original Pizzas` /
  `Basha's Ultra Thin Crust Pizzas` both flattened to `Basha` and their flavors
  merged. A user "merge" then wrote a learned brand alias `Basha 11in → Basha`
  (plus mis-confirmed `Basha's … Mix → Lowe's/Lucia's … Mix` item aliases) that
  kept re-collapsing every future import. **Learned aliases/corrections persist in
  `spec_import_aliases` + `ai_corrections` and are re-sent to the AI each import —
  a bad confirm poisons all later imports until the rows are deleted.**
- Instruction lives ONLY in the server prompt (`buildParseSpecSheetPrompt`);
  clients are thin, no parity edit. Pinned by `aiParseSpecSheet.test.ts`.
- **NOTE:** profiles/runs are still keyed by `brand|flavor` only (no size/line
  field) — `PROFILE_KEY`, `mergeParsedSpecImports`, `mergeImportRuns`. Separation
  works ONLY because the distinguishing text lives in the brand string itself.

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
- **AI match pass is fail-safe AND two-pass (brand→flavor).** Names that
  canonicalize as "new" go to the EXISTING `/ai/match-import`. Pass 1 sends
  brands+flavors+ingredients+applicators+pepperoni; pass 2 re-collects ONLY
  newly-surfaced flavors (deduped via `askedFlavorKeys`) under the now-corrected
  brand names. Server-sanitized matches are applied (incl. extra-domain via
  `applyNameMatches`'s `extra` param) and merged into `newAliases` (learned).
  Wrap in try/catch — on ANY failure keep the canonical parse and continue.
- **Match-import now covers 5 domains, all canonicalized server-side.** Besides
  brand/flavor, `/ai/match-import` matches ingredient (kind-scoped),
  applicator, and pepperoni names. `sanitizeMatchImport` drops anything whose
  candidate wasn't asked OR whose match isn't a real saved target (via
  `findCanonical`), so a hallucinated name can never rename to a non-existent
  target. Reviewer runs over all 5 domains.
- **INVARIANT: the match step must NEVER fold two different product-line siblings
  together — enforce it in the sanitizer, treat the prompt as advisory only.**
  The parse prompt keeps qualified siblings apart, but the match AI folds imported
  brands onto EXISTING saved brands — so a stale/earlier saved brand
  (`Basha's Original`, or a bare `Basha`) becomes a magnet and re-collapses a new
  `Basha's Ultra Thin Crust` sheet even with a clean parse. The guard drops any
  conflicting brandMatch server-side (applies to both clients via contract-first).
  Two complementary, deterministic conflict signals: (1) a KNOWN qualifier lexicon
  (Original/Ultra Thin/Deep Dish/…), and (2) a dictionary-free STRUCTURAL check —
  a shared leading company stem then divergent distinguishing tokens (so unlisted
  qualifiers like "Stone Fired" vs "Artisan" still conflict). Identical
  distinguishing-token sets (typos/word-order/generic suffix) are NOT a conflict.
  **Why lexicon alone is insufficient:** it under-blocks when both siblings use
  qualifiers not in the list; the structural check closes that gap.
  **Tradeoff (chosen deliberately):** a suffix-typo/abbreviation on a multi-word
  brand (`Basha Orig` → `Basha's Original`) is also blocked and becomes a new brand
  for review — separate over silently-wrong merge, matching the user's stated
  preference. Code pointer: `conflictingProductLine` in `aiMatchImport.ts`.
- **GOTCHA: `knownIngredients` in the match-import body is a RECORD keyed by
  recipe kind (`{dough,sauce,cheese: string[]}`), NOT a flattened `{kind,name}[]`.**
  Only `unmatchedIngredients` is the `{kind,name}[]` array. The hand-written
  client `MatchImportInput` once drifted to the flattened shape for
  `knownIngredients` → server Zod 400 → swallowed by `linkParsed`'s `catch {}` →
  whole match pass silently no-ops. **Why:** the client type is hand-maintained,
  not generated, so it can drift from `AiMatchImportBody`. Guarded by
  `aiMatchImport.test.ts` (accepts record, rejects array). Keep web+mobile
  `MatchImportInput` in lockstep with the OpenAPI `MatchImportInput` schema.
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
