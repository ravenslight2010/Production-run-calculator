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

## Editable review + merge/deletion safety (mass-upload hardening)
- **Import must respect the SAME tombstones as live sync — a re-import can NOT
  silently resurrect a merged-away/deleted brand/flavor or recipe name.** Filtering
  runs at PREPARE time via shared `partitionTombstonedParse(parsed, isProfileTomb,
  isRecipeTomb) -> {kept, skipped}`. `kept` feeds summary/discrepancies/apply;
  `skipped` is surfaced in the review (excluded by default, user can knowingly
  re-include). Recipe tombstone namespaces: dough=`doughRecipeNames`,
  sauce=`frontlineRecipeNames` (frontline IS sauce), cheese=`cheeseRecipeNames`;
  profiles reuse `profileKeyIsTombstoned`.
  **Why:** without this, the additive-union import path re-adds exactly what a user
  merged/deleted, same failure mode as sync (see merge-tombstones/deletion-tombstones).
- **Nameless recipes are KEPT (name ""), not dropped, by the sanitizer** so the
  editable review can flag them for a user-supplied name. `recipeApplyIssue`
  (missing-name/no-rows) and `profileApplyIssue` (missing-brand/missing-flavor) are
  shared pure helpers used by the dialog's needs-attention flags.
- **"Nothing-vanishes" is enforced at the button, not just visually.** Apply is
  DISABLED while any INCLUDED item still has an apply-issue (`attentionCount>0`),
  because `applySpecImport` silently skips blank-name/no-rows/blank-brand-flavor
  rows — so an enabled Apply over an invalid included item would drop it exactly
  like the old silent-drop bug. Fix or uncheck to proceed.
- **Re-including a tombstoned item clears its tombstone on apply.** `applySpecImport`
  calls `clearMergedAway`/`clearDeleted` for every applied profile (brand + flavor
  namespaces) and recipe (kind namespace) so a knowingly re-included merged/deleted
  item STICKS instead of being stripped again by the additive sync union. Safe to
  clear unconditionally (no-op when not tombstoned); only kept items reach apply.
- **The review is editable and commits only the kept+corrected set.** Web
  `SpecImportDialog` emits an edited `ParsedSpecImport` via `onConfirm(parsed)`;
  `home.tsx` commits `{...prepared, parsed: edited}` (preserves aliases/sourceNames
  for the snapshot). Per-item include/exclude, fix recipe name+kind, fix profile
  brand/flavor (datalist from `prepared.brands`/`flavorsByBrand`). Discrepancy list
  is recomputed live from the edited set via exported `buildDiscrepancies`.
- **Parse-accuracy prompt asks for a non-empty name per recipe + explicit
  dough/sauce/cheese classification** (cheese/topping tables are CHEESE even beside
  the sauce section; only tomato-based blends are SAUCE). Prompt-only, pinned by
  `aiParseSpecSheet.test.ts`.
- **MOBILE parity DEFERRED (parity paused):** shared lib + server prompt already
  cover both; mobile `SpecImportModal` + `context/specImport.ts` prepare still need
  the tombstone filter + editable review when parity resumes.

## Import profile-tombstone must use deletedItems ONLY, never the flat mergedAway set
- **Symptom:** "I import the spec sheet and nothing ever shows up." A parsed
  profile is routed through `importProfileIsTombstoned`; a true result silently
  drops it into the (unchecked) "skipped/merged away" review bucket → Apply
  disabled → nothing applies.
- **Root cause:** `importProfileIsTombstoned` fed the FLAT `mergedAway` set into
  `profileKeyIsTombstoned`, which returns true if `tombSet.has(brandLc) ||
  tombSet.has(flavorLc)`. The flat set is written ONLY by ingredient/app/pep type
  merges (`applyIngredientMerge`; `MERGE_NAME_FIELDS` = app/pep only). Genuine
  brand/flavor merges/deletes (`mergeBrands`/`mergeFlavors`/`removeBrand`/
  `removeFlavor`) record in the STRUCTURED `deletedItems` map ("brands" /
  "flavor:<brand>"), never the flat set. So the flat check could ONLY misfire —
  common flavor names (PEPPERONI, CHEESE, SUPREME) collide with a merged-away
  ingredient/pep name.
- **Fix:** `importProfileIsTombstoned` passes an EMPTY flat set; a profile is
  suppressed on import ONLY by a real brand/flavor tombstone in `deletedItems`.
- **How to apply:** for PROFILES, brand/flavor tombstones live exclusively in
  `deletedItems`; do NOT gate a profile on the flat `mergedAway` set. The flat set
  is for ingredient/app/pep/recipe NAMES only. (The sync-receive
  `profileKeyIsTombstoned` in home.tsx still takes a `tombSet` param — its
  regression test simulates it — but no real brand/flavor path populates it.)

## Targetless-recipe silent miss (review-side backstop)
- **A recipe with rows + a name but NO target/brand passes every apply-issue check
  yet attaches to ZERO profiles** — `recipeApplyTargets(r, profiles)` returns `[]`
  (no explicit targets, no same-brand fallback anchor). At apply the recipe NAME
  still registers in the library, but no run/profile uses it, so the user sees "the
  recipe didn't import." This is distinct from the `attentionCount` apply-issues.
- **Web dialog backstop (`SpecImportDialog`):** each RecipeRow computes
  `recipeApplyTargets(candidate, edited.profiles)`. An included, issue-free recipe
  with 0 targets shows a SOFT amber "Won't show on any product yet" warning + Brand
  + Flavor assign inputs (datalists) that set the recipe's `brand`/`flavor`.
  `RecipeItem` carries editable `brand`/`flavor` (init from `orig`), always flowed
  into the emitted `edited` recipe. Deliberately NOT part of the hard Apply-block —
  the recipe still saves to the library either way; this only helps it ATTACH.
- **Attach preview:** attaching recipes show "Attaches to: Brand — Flavor (+N more)"
  so the user can confirm the tie before applying.
- **Parse visibility:** read-only "Read: …" summaries per row (profile: die/sauce/
  applicators/peps; recipe: ingredient·lbs preview) let users catch a numeric
  misparse. Numeric EDITING was intentionally left out of scope.
- **When parity resumes:** mirror the attach-target warning + assign inputs and the
  read-only summaries in the mobile `SpecImportModal`.

## Polluted learned-name pools break imports (de-conflict at read/apply time)
- **Symptom → cause:** "file couldn't be read / nothing imports" even though the
  .xlsx parses fine. Real cause = corrupt learned-name data (cycles/chains) in the
  server `ai_corrections` pool AND the client `spec_import_aliases` pool (e.g.
  `PEPPERONI <=> ULTIMATE PEPPERONI`, `A => B` alongside `B => C`). They get injected
  into the parse prompt AND applied in `canonicalize`, renaming/colliding valid
  flavors so downstream tombstone logic skips them.
- **Fix = non-destructive read/apply-time de-confliction (NOT a DB purge):** pure
  `dropConflictingCorrections` (`lib/ai-memory`) + `dropConflictingSpecAliases`
  (`lib/spec-import`). Rule: within a scope (domain / kind; context ignored) a name
  that is BOTH a source and a target is conflicted — drop every mapping touching it.
  Kills cycles/chains, keeps coherent many-to-one ingredient aliases.
- **Three wiring points (all must be guarded):** server `loadCorrections`, shared
  `canonicalize()` (covers both clients), AND server `buildParseSpecSheetPrompt` —
  the prompt embeds client `input.aliases` DIRECTLY, so filtering only in
  `canonicalize` is insufficient; de-conflict the aliases before embedding too.
- **Why non-destructive:** read-time guards neutralize existing bad rows without a
  risky purge; the pools keep learning and self-heal as coherent data accumulates.
