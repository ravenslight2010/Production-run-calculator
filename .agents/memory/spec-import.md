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

## Spec import also creates/matches SERVER cheese recipes (pool link)
- Both apps' `applySpecImport` already write `app{n}CheeseRecipeName` +
  `app{n}CheeseRecipe` onto profiles. The applicator "Cheese" cards are PICK-ONLY
  (hydrate rows from the server cheese pool, see cheese-server-master-data.md), so
  a name that isn't in the pool hydrates to nothing. `commitSpecImport` therefore
  also seeds the server pool.
- **Flow (web `src/specImport.ts` + mobile `context/specImport.ts`, identical):**
  `collectSpecImportCheeseRecipes(parsed, userMixNamesLower)` (pure, `@workspace/
  spec-import`) → cheese-kind, non-mix (same `specImportRecipeIsMix` gate as the
  Mixes routing), de-duped by name; brand from `recipeTargets(r)[0]`, flavors from
  same-brand targets, components verbatim (NO unit conversion — oz-in-lbs quirk
  kept, manager fixes batch lbs in editor). Then `specCheeseDraftToRecipe` (pure,
  `@workspace/cheese-recipes`; deterministic id `cheese:spec:<name-slug>`, blank
  shredder/cellulose/notes, enabled) → `addCheeseRecipesIfAbsentByName(existing,
  candidates)` (MATCH-DON'T-CLOBBER: skip if name OR id already exists) →
  `saveCheeseRecipes(merged)`.
- **Best-effort, manager-gated on the server** (`saveCheeseRecipes` 403s for
  non-managers) — wrapped in try/catch so a failed pool save never fails the
  import (the profile links already applied locally). `commitSpecImport` returns
  `{mixesAdded, cheeseRecipesAdded}`; callers invalidate `["cheeseRecipes"]` and
  append a cheese note to the toast. Mirrors the Mixes seeding block exactly.
- **Why name-slug id (not `cheese:brand:name` like cheese-import):** so re-importing
  the same sheet targets the same recipe id and matching by name stays idempotent;
  no collision with the importer's brand-scoped ids.

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

## Standalone procedure sheets + catch-all "All Varieties" scope (real-library hardening)
- **Standalone sauce/dough/cheese-only procedure sheets** (no per-flavor spec grid,
  just a title + one ingredient table) must import as a NAMED recipe attached to a
  BRAND, with NO invented flavor and NO size suffix. Prompt (`buildParseSpecSheetPrompt`)
  tells the model: brand from the sheet title, leave flavor + targets EMPTY for a
  standalone procedure. **Why:** baseline probe showed a sauce sheet silently
  producing brand="" targets=[] (dropped) and a dough sheet inventing a bogus
  `Aldo's 12'' / Dough` target. Prompt-only, pinned by `aiParseSpecSheet.test.ts`.
- **Catch-all-flavor targets are deterministically scrubbed in the sanitizer** (pure
  `isCatchAllFlavor` + scrub in `sanitizeParsedSpecImport`, shared lib → both clients).
  A target whose flavor is a whole-brand scope word ("All Varieties"/"All"/"N/A"/
  "every variety"/empty) or the recipe's own kind ("Dough" on a dough recipe, "Sauce"
  on a sauce recipe — **but NOT "Cheese" on a cheese recipe; "Cheese" is a real
  flavor**, gated by `KINDS_WHOSE_NAME_IS_NEVER_A_FLAVOR`={dough,sauce}) is NOT a
  real profile. Keeping it makes a junk `Brand / All Varieties` profile; instead drop
  the explicit target and promote its brand to a brand-wide anchor (`recipe.brand`) so
  `recipeApplyTargets` fans the recipe to EVERY real flavor of the brand. **Why:** the
  25-customer-tab cheese-mix file emits one "Standard/All Varieties" mix per brand;
  without the scrub each becomes a bogus catch-all profile. Kept conservative
  (`CATCH_ALL_FLAVORS` allow-list) so a genuine flavor is never swallowed. Tests in
  `specImport.test.ts`.
- **Web apply pool = parsed.profiles + all existing `loadBrandFlavors()` profiles**
  (`applySpecImport` builds `applyProfilePool`, passes to `recipeApplyTargets`) so a
  brand-only recipe attaches to EXISTING same-brand flavors, not just profiles in the
  same import. **WEB-ONLY glue** (parity paused) — mobile apply path still needs the
  same pool build when parity resumes.
- **Multi-brand shared recipe → `ParsedRecipe.brandAnchors: string[]` (not a single
  `recipe.brand`).** A shared procedure can name SEVERAL customers ("Masa Dough — used
  for Hannaford and Lucia"), emitting multiple whole-brand catch-all targets. The
  sanitizer collects ALL distinct catch-all brands (ci) into `brandAnchors`;
  `recipeApplyTargets` fans EVERY anchor to its same-brand profiles (added to explicit
  per-flavor targets, de-duped). Single-anchor + no singular brand still ALSO sets
  `recipe.brand` for back-compat/display. **Why:** the earlier scrub kept only the
  first catch-all brand as `recipe.brand`, silently dropping the rest (data loss).
  SHARED lib → both clients. Tests in `specImport.test.ts`.
- **Standalone-title brand rule now splits CUSTOMER vs TYPE titles.** A title that is
  a customer/product-line (Lucia, Medulla, Lowe's, Member's Selection) → use as
  `brand`; a title that is only a sauce/dough TYPE (Garlic Alfredo, Gravy, Masa Dough,
  Malted Barley, Margherita) → leave `brand` EMPTY (imports as a shared library recipe
  for manual assignment). A body note naming customers ("used for Hannaford and
  Lucia") routes to per-brand whole-brand `targets` (flavor LEFT EMPTY) — prompt
  explicitly forbids inventing a flavor (guards a "Masa"→"Masala" phonetic
  hallucination seen under empty grounding). Prompt-only, pinned by
  `aiParseSpecSheet.test.ts`. **Why:** the batch-1 "brand from title" rule mislabeled
  type-named procedures as junk brands (brand="GARLIC ALFREDO").
- **Meat & Veggie topping-mix file = same shape as the cheese-mix file** (per-customer
  tabs, each with one or more named topping mixes). These are CHEESE-kind recipes
  (topping blends), mapped to specific flavors by mix name — the existing cheese-tab
  handling + catch-all scrub covers them; no new code path needed.

## Recipe row units: sheets are in OUNCES by default — AI reports, sanitizer converts
- This factory's spec sheets ALWAYS write recipe ingredient amounts in OZ, but
  the canonical `RecipeRow.lbs` is real POUNDS (recipe totals are used as
  absolute batch/barrel lbs in inventory-math — a raw oz read is 16× too big).
- **Rule:** the AI NEVER converts. It copies row numbers verbatim into `lbs`
  and reports the sheet's unit per recipe via `rowsUnit: "oz"|"lbs"`.
  `sanitizeParsedSpecImport` converts EVERY recipe row oz→lbs (÷16, 3-decimal
  round) UNLESS `rowsUnit` explicitly says pounds (lb/lbs/pound variants, ci).
  Missing/unknown unit = assume oz (user: "spec sheets are always in oz").
- **Double-conversion guard:** sanitize is server-only (the parse route);
  clients/saved-sheet reconcile/premix never re-sanitize. If a new caller ever
  re-runs sanitize on already-converted data it will divide by 16 twice.
- App-exported recipe workbooks label columns `Lbs`, giving the model the
  pounds signal on re-import.
- Embedded applicator-blend extraction (client-side, post-sanitize) keeps
  numbers verbatim on purpose (no unit signal in those cells). `doughballOz`
  is oz by definition — untouched.

## Cheese blend identity is its NAME — strip BOTH the "Applicator" label and the per-weight suffix
- A cheese recipe dedupes by NAME (`collectSpecImportCheeseRecipes` /
  `addCheeseRecipesIfAbsentByName`). Spec grids express one blend at multiple
  per-pizza weights AND prefix every topping/cheese row with the label
  "Applicator - " (e.g. `Applicator - Aldo's Cheese Mix 2.07 Pizella, 1.19
  Part Skim Mozzarella, ...`). If the name isn't fully normalized, the
  deterministic path and the AI/clean path diverge and fork ONE blend into TWO
  "same" pool recipes.
- **Two normalizations must BOTH be applied on every name-producing path:**
  (1) strip the trailing/embedded per-weight composition
  (`cleanSpecCheeseRecipeName` + `parseEmbeddedBlend`), and (2) strip a leading
  "Applicator" row label (`stripApplicatorLabel`, applied inside BOTH
  `parseEmbeddedBlend` and `cleanSpecCheeseRecipeName`). Fixing only the weight
  (an earlier fix) still left `Applicator - Aldo's Cheese Mix` vs
  `Aldo's Cheese Mix` as a duplicate.
- **Why:** the label is a spec-sheet row prefix, never part of the blend name;
  the deterministic fallback (`extractEmbeddedApplicatorBlends`) used to keep it
  while the AI stripped it.
- **How to apply:** any new cheese-name-cleaning path must run through the
  shared helpers so web + mobile stay identical (both consume
  `@workspace/spec-import`). Existing already-imported duplicates are NOT
  auto-healed — the manager merges/deletes the stray one once.
- `rowsUnit` is consumed inside sanitize and never emitted → no OpenAPI change.

## Pepperoni is a pep TYPE, never a recipe (+ die reviewer false-positive)
- **Pepperoni must NOT import as a cheese recipe.** Pepperoni belongs on a profile's
  `pepperonis` (type + sticks + oz/pizza). The importer has only dough/sauce/cheese
  recipe kinds, so a "Pepperoni Stick" row was bucketed as a bogus CHEESE recipe →
  the AI reviewer then flagged it as mis-classified (false-positive popup). Fixed
  three ways: (1) prompt (`buildParseSpecSheetPrompt`) states pepperoni incl.
  "pepperoni sticks" is ALWAYS a profile pepperoni, never a recipe; (2) deterministic
  backstop `isPepperoniOnlyCheeseRecipe(rows)` (pure, `@workspace/spec-import`) — the
  sanitizer drops a cheese recipe whose rows are ALL pepperoni; (3) a real cheese
  blend that merely LISTS pepperoni among other cheeses is KEPT (every-row guard).
- **DICED pepperoni is the ONE exception — it stays a cheese/topping recipe.** Diced
  pepperoni is a topping ingredient, NOT a stick pep type, so the helper excludes any
  `diced` row (`DICED_RE`) from the drop and the prompt calls it out explicitly. A
  recipe containing diced pepperoni is never dropped.
- **Die reviewer false-positive:** the spec-sheet `reviewSuggestions` instructions
  (`ai.ts`) now tell the reviewer die types are commonly non-numeric custom dies
  (e.g. "Argus"/"Mystic"), not inch sizes — don't flag a die for not being a numeric
  size. (Die source itself: `.agents/memory/die-size-source.md`.)
- All three are shared-lib/server → both clients auto-covered; pinned by
  `aiParseSpecSheet.test.ts`.

## Batch-3 real-library hardening (combined brand cells, grounding backstop)
- **A doughball/yield table near the bottom of a procedure sheet lists the customers
  it feeds** — one row per customer, sometimes `Customer (Flavor)` in parentheses
  (e.g. `Hannaford (Masala Pizza)`). Prompt tells the model to read each such row as
  a target: brand = the customer, flavor = the parenthesized product ONLY if written,
  else EMPTY (whole-brand). This is the row that legit customer/flavor targets come
  from on an otherwise type-named sheet (e.g. Naan Dough → Hannaford/Masala Pizza).
- **One cell listing SEVERAL customers joined by `&`/`and`/`/`/`+` must SPLIT into one
  target per customer, same flavor** (`Lucia's Craft & 4Hands` → `Lucia's Craft` +
  `4Hands`, each carrying `Masala Pizza`). BUT a single company name that legitimately
  contains `&` (`Maria & Son`, `Ben & Jerry's`, `M&M`) stays ONE brand. **Prompt-only
  by design** — a deterministic `&`-split is UNSAFE because real single-company brands
  contain `&` (Maria & Son is a real customer in this very library). Verified live:
  Naan splits into 3 targets AND Tikka Masala keeps `brand="Maria & Son"` whole.
  Pinned by `aiParseSpecSheet.test.ts`.
- **Standalone procedure NAME = the full sheet title minus generic process words; do
  NOT peel the first word into a junk `brand`.** A `MYSTIC PIZZA SAUCE PROCEDURE` sheet
  was parsed as `brand="Mystic" name="Pizza Sauce"` (junk truncated name); now
  `name="Mystic Pizza Sauce"`. If it's a TYPE with no customer, `brand` stays EMPTY;
  a plausible product-line word left as `brand` (Mystic) is acceptable, the junk-split
  name is not. Prompt-only.
- **Deterministic grounding backstop for invented target flavors** — `isGroundedFlavor`
  (pure, `lib/spec-import`) + a demote branch in `sanitizeParsedSpecImport`. A target
  flavor sharing ZERO word tokens (len ≥3) with the source workbook text AND not in
  the factory's known flavors is treated as model-invented and demoted to a whole-brand
  anchor (kept fan-out, no junk `Brand / <invented>` profile). Threaded server-side via
  `sanitizeParseSpecSheet(raw, input)` (`sourceText = workbookText`, `knownFlavors =
  flatten known.flavorsByBrand`); runs on the parse response so **both clients are
  covered, no client edit**. **Conservative on purpose:** returns keep when no grounding
  is passed (back-compat) or when any token matches, so a real flavor written on the
  sheet is never dropped. **Important:** what looked like a batch-3 hallucination
  (`Modified Malted Barley → Four Hands / "Mission Taco Mexican"`) turned out to be a
  REAL sheet flavor (`… Pizza varietiy: Mission Taco Mexican`), and the backstop
  correctly KEPT it (tokens are in the source). So the backstop is defense-in-depth,
  NOT triggered by a confirmed batch-3 case. Tests in `specImport.test.ts`.
- **PROFILE flavors need a STRICTER grounding than the recipe-target token check —
  full-phrase per-cell + snap.** The parse model paraphrased "Buffalo Chicken" →
  "BBQ Chicken" for every brand at every chunk size; the shared-token test can't
  catch it ("chicken" appears either way). `groundProfileFlavor` +
  `buildProfileFlavorGrounding` (pure, `lib/spec-import`): a profile flavor is
  grounded only if it's a known flavor OR its normalized phrase appears inside a
  single source CELL (workbookText split on tabs/newlines — per-cell, because a
  whole-text substring check false-positives on adjacent cells "BBQ\tChicken").
  Ungrounded → SNAP to the nearest flavor that IS in the source (shared word
  tokens, score ≥ 0.5; known-flavors-in-source preferred via bonus); no confident
  match → keep the profile but append a warning to `note` — flagged or corrected,
  never dropped (no data loss), never silently invented. Runs inside
  `sanitizeParsedSpecImport`, so both clients covered; back-compat (no grounding
  → no change). Tests in `specImport.test.ts`.
- **`Production_Schedule_*.xlsx` (87 weekly tabs, columns Brand|Flavor|Units|Customer|
  Ship|PO) is a SCHEDULE file, not a spec sheet** — it belongs to the schedule importer,
  not `/ai/parse-spec-sheet`. Out of scope for spec-import hardening; do not feed it to
  the spec parser (it would time out / mis-parse).

## Hand-fixing mixed size-line brand/flavor data directly in the DB
- **Same failure class as Basha, seen again with Lowe's (`Lowe's` vs `Lowe's 7in`):** two
  size lines' flavors leak into each other (size-tagged strays like `7in Red Fajita` under
  the 11in/general brand, `11in White Spinach` under the 7in brand) AND learned rules keep
  re-mixing them on every import.
- **To un-mix without the app UI, replicate what `mergeFlavors`/`removeFlavor` do, three
  parts — all required or the fix silently reverts:**
  1. **Edit EVERY `scope='live'` `daily_sync` row's `data->'brandFlavors'`, not just the
     latest.** Live-sync's additive union pulls each brand's flavor list from ALL rows, so
     a stray left in an older row re-appears.
  2. **Write `deletedItems` tombstones** in namespace `flavor:<brand lowercased>` (see
     `flavorNamespace`) for every removed string, names LOWERCASED (matching is
     case-insensitive). Without the tombstone the union resurrects the removal. (Mirror of
     the existing Basha tombstones already in `deletedItems`.)
  3. **Delete the collapse rules in BOTH `spec_import_aliases` AND `ai_corrections`** or the
     next import re-mixes: the size-collapse is a `brand` row `X 11in → X 7in` in each
     table; wrong flavor remaps are `flavor` rows scoped by `context='<brand>'` (e.g.
     `Buffalo Chicken → BBQ Chicken`). Keep benign normalizations (`Lowes → Lowe's`,
     `ULTIMATE PEPPERONI → Pepperoni`) and unrelated mix/item renames.
- **Before removing a flavor, check no `dayState.runs` / `runValues` reference it** (they'd
  orphan). Bump `daily_sync.updated_at` so clients re-pull. Profiles are NOT in the synced
  blob (client-local only) — orphaned profiles are benign and can't be cleaned via DB.
- **Only remove UNAMBIGUOUS strays** (a size-tagged name whose clean equivalent already
  exists in the correct brand). Casing/truncation near-dups without a clear canonical
  (e.g. `White Spin` vs `White Spinach`) are left alone — ask, don't guess.
- **The injection vector is DOUGH (and any) recipe target lists, not just profile rows.**
  `applySpecImport` runs every recipe through `recipeApplyTargets` and calls
  `registerBrandFlavor(brand, flavor)` for each target (storage.ts ~1897), writing the
  flavor string VERBATIM. A dough sheet listing pizzas as `7" Red Fajita` creates a flavor
  `7" Red Fajita`. Premix sheets can't touch brand/flavor (Mixes only). Cheese/mix&veg go
  through the spec importer too but were clean in the data (no mix/cheese name = a flavor).
- **Size-in-flavor can be INTENTIONAL, not contamination.** Profiles are keyed brand+flavor
  with NO size field, so encoding size in the flavor (`Bobo's` `12" CHEESE` / `9" CHEESE`,
  `Medulla 12x16` `Cheese 7"`) is a valid way to run multiple sizes of one brand — the
  alternative Lowe's uses is separate brands (`Lowe's` vs `Lowe's 7in`). Confirm with the
  user before stripping size tags; only merge the obvious dup (sized vs un-sized SAME name,
  e.g. Bobo's `12" DELUXE` vs `Deluxe` → keep sized, tombstone `deluxe`).

## Chunked parsing of very large exports (multi-AI-pass integrity)
- **`splitGridsForPrompt` keeps "Recipe:" blocks ATOMIC across chunk breaks.** A
  chunk break that lands inside a recipe block (header/targets in one chunk,
  ingredient rows in the next) makes the AI drop or orphan the split half. The
  splitter detects block-start rows (`/^recipe:\s*\S/i` on the first cell) and
  rewinds a mid-block break so the whole block moves to the next chunk (with a
  forward-progress guard when one block exceeds a whole chunk). Pinned by
  block-atomic tests in `specImport.test.ts`.
- **The per-chunk budget is bounded by the AI's OUTPUT side, not the 60k input
  cap.** Parse output ≈ input restructured as JSON, and dense one-profile-per-row
  sheets demand hundreds of JSON objects back. Verified live: ~56k chunks
  truncated past `max_completion_tokens` (non-JSON → empty), ~30k chunks
  (~240 profiles) were FLAKY (model sometimes returned valid-but-empty JSON),
  ~16k chunks (~100-130 profiles) parsed correctly every time →
  `DEFAULT_LIMITS.maxTotalChars` = 16k. More chunks = more reliable calls;
  `DEFAULT_MAX_PROMPT_CHUNKS` (8) still covers a 30-brand × 8-flavor export.
- **Sanitizer caps must exceed what one chunk can legitimately carry.**
  `maxProfiles` was 100 while a profile-dense chunk can hold ~176 rows — the
  sanitizer silently sliced valid profiles off large exports. Now 400.
- **The route's non-JSON fallback must carry a `note`.** It used to return bare
  `{profiles:[],recipes:[]}` → a failed chunk merged in as silent data loss;
  `mergeParsedSpecImports` joins notes so the user sees the failure.
- **Known residual (NOT a chunking issue):** on a large synthetic export the
  model consistently paraphrased the flavor "Buffalo Chicken" → "BBQ Chicken"
  (all brands, all chunk sizes, even single-chunk). Real flow mitigates via
  known-list canonicalization; profile-level grounding against sourceText (like
  the recipe-target backstop) would close it fully.

## Failed AI pass on a chunk → ONE automatic client-side retry
- The parse server returns `profiles:[] recipes:[]` + a `note` when the model's
  response is cut off/malformed. Both prepare cores (web `parseWorkbookCore`,
  mobile `parseGridsCore`) retry such a chunk ONCE before merging, so one bad
  pass doesn't force re-running (re-billing) the whole import.
- Retry condition: `(0 profiles AND 0 recipes) OR note present`, AND the chunk's
  prompt text ≥ `RETRY_MIN_CHUNK_CHARS` (200) — tiny header-only chunks can
  legitimately parse to nothing and are never retried.
- Fail-safe: if the retry ITSELF throws, keep the first (noted) result rather
  than failing the import; a failed retry result is also discarded in favor of
  the original so the note still surfaces. One retry per chunk stays under the
  10/min parse rate limit for realistic imports (≤8 chunks/file).
- Web+mobile identical (only `knownInput` vs `store.known` differ).

## Profile BRAND grounding backstop (mirrors flavor grounding, looser)
- `sanitizeParsedSpecImport` grounds profile `brand` names against the workbook
  cells + `grounding.knownBrands` (server passes `known.brands` in
  `sanitizeParseSpecSheet`). Paraphrased brands snap back ("Corrected brand …"
  note); no confident match → kept + "was not found on the sheet" warning.
- **Looser than the flavor check on purpose — the prompt REQUIRES some brand
  transforms:** a token-SUBSET of a single cell counts as grounded (covers
  dropped generic trailers like "Pizzas"), and digit-leading tokens ("7in") are
  ignored entirely (size folds can come from a different cell than the header).
  Snapping to a raw cell strips generic trailers (`stripGenericBrandTrailers`)
  so it returns the product-line name the prompt would have produced.
- **Consequence:** a COLLAPSED brand (bare "Basha" from a qualified header) is
  still grounded (its tokens are a subset of the header cell) — this backstop
  catches paraphrase/invention, not collapse; collapse is handled by the prompt
  + match-import sibling guard. In tests without `knownBrands`, a real brand
  absent from the sheet gets flagged — pass the brand in `sourceText` or
  `knownBrands` when writing grounding tests.

## Structured grounding warnings (not in `note`)
- Flavor-grounding corrections/flags are STRUCTURED `warnings` ({brand, flavor,
  message}) on ParsedSpecImport, keyed to the FINAL post-correction profile
  names so review UIs attach them per-row; `note` stays model-text only.
- **Why:** folding warnings into `note` made a mere correction look like a
  failed pass to the chunk-retry rule (any note ⇒ retry ⇒ re-billing) and
  buried them in free text on the review screen.
- **How to apply:** every parse-carrying path (merge, tombstone partition,
  applyNameMatches renames, client canonicalize) must carry + rename warnings
  or row-matching silently breaks after canonicalization.

## Recipe NAME grounding (paraphrased names must not mint duplicate recipes)
- The parse model can paraphrase an EXISTING recipe name (e.g. "Thin Crust
  Dough" for the factory's "Ultra Thin Dough"), which downstream counts as NEW
  and silently mints a near-duplicate recipe. Backstop = pure
  `groundRecipeName(name, knownNames)` in `@workspace/spec-import`, wired into
  `sanitizeParsedSpecImport` via `grounding.knownRecipeNames` (per kind:
  dough/sauce/cheese).
- Decision ladder (conservative by construction): exact ci-match → untouched;
  normalized-phrase equal (punctuation/case) → SNAP to existing name (+warning);
  identical distinctive-token sets after stripping generic filler
  (dough/sauce/cheese/mix/blend/recipe/pizza + plurals) with a UNIQUE best →
  SNAP; token overlap ≥0.5 → KEEP name + structured "closely matches existing …
  verify it isn't a duplicate" warning; else untouched. Ambiguous full-overlap
  tie → flag, never snap. No known list for a kind / blank / all-generic name =
  no judgment (back-compat).
- Known recipe names ride the `ParseSpecSheetKnown` contract as
  `doughRecipes`/`sauceRecipes`/`cheeseRecipes` (also embedded in the parse
  prompt so the model reuses names verbatim). Web sends
  `Object.keys(recipePresetMapForKind(kind))`; mobile sends preset-map keys in
  `buildSpecStore` (sauce = frontline presets, frontline IS sauce). Keep the
  three wiring points (OpenAPI known lists, web loadSpecImportKnown, mobile
  buildSpecStore) in lockstep like the other known lists.
- **Why snap only at full distinctive-token identity:** a 0.5-overlap pair
  ("Thin Crust" vs "Ultra Thin") is plausibly a DIFFERENT product line —
  auto-snapping would overwrite a real recipe; the review warning keeps the
  human in the loop. Tests in `specImport.test.ts` (groundRecipeName + RECIPE
  NAME grounding blocks).

## Junk-file pre-AI guard (xlsx never throws on garbage)
- **`XLSX.read` does NOT throw on non-spreadsheet bytes** — a renamed PDF/image/
  random binary "reads" as one junk-text sheet, so without a guard the wrong-type
  pick burns an AI parse call and yields a garbled review instead of the per-file
  "could not be read … skipped" note.
- **Fix:** pure `gridSanityIssue(grids)` in `@workspace/spec-import` (empty check +
  binary heuristics: control-char fraction >2% OR word-like fraction <35% over a
  ≥16-char sample; tiny legit sheets never judged). Both parse cores (web
  `parseWorkbookCore`, mobile `parseGridsCore`) throw it BEFORE `splitGridsForPrompt`
  / the AI call, so single-file shows the message and multi-file emits the skip note.
- **How to apply:** any new AI-parse entry point that reads a user-picked workbook
  must call `gridSanityIssue` before the first AI request. Real CSV/text in any
  language passes; keep thresholds shared-lib only (parity). Tests:
  `specImportJunkFileGuard.test.ts`.

## Missing numbers must warn, not silently become 0
Sanitizer coerces missing applicator/pepperoni oz-per-pizza to 0 (types stay non-null),
but a silent 0 reads as "the sheet said 0 oz" in the review preview. Any coerced-missing
numeric must push a structured groundingWarning keyed to the grounded brand+flavor so the
review screens flag it. Warning headers in all 4 review/saved-sheet UIs say "items" (not
"flavor names") because warnings now cover more than name corrections.

## Mix routing at apply time
The AI importer's kinds stay dough/sauce/cheese; pre-blended topping mixes
arrive as `kind:"cheese"` and are routed to the MIX name category at apply
time, not in the AI schema.
- **Why:** cheese and mix share one preset map, ingredient pool, and the
  applicator-slot profile tie — the ONLY difference is which name list (and
  deletion-tombstone namespace) the name registers under; extending the AI
  schema would touch the OpenAPI contract, lib, and both clients for no gain.
- **How to apply:** a cheese-kind recipe routes to Mix when its name is
  already in the user Mix list (ci) or contains the standalone word "mix"
  without mentioning cheese (same split as the stray-mix recategorizer). Keep
  the classifier pure/exported; the routing must cover BOTH the tombstone
  clear and the name-list registration, or re-imports recreate cheese/mix
  duplicates. Web-only: mobile has no mix/cheese name category lists.

## Embedded blends in applicator cells (post-purge lesson)
Many spec grids pack a full blend recipe INSIDE one applicator cell ("Aldo's
Cheese Mix 1.75 Pizella, 1.0 Part Skim Mozzarella, 0.1 Grated Parmesan"). The
prompt teaches the model to split these: clean mix name → applicator `type`,
number+ingredient pairs → one cheese-kind recipe.
- **Why:** before the 2026-07-03 purge the seed data supplied clean mix names
  + recipes, so known-name grounding masked this; on an empty install the raw
  (truncated) cell text landed verbatim as applicator types and NO cheese/mix
  recipes were created. Also PROMPT_MAX_CELL_CHARS was 80, cutting the blends
  mid-word before the AI ever saw them — now 240.
- **How to apply:** keep the EMBEDDED BLENDS prompt section; don't lower the
  cell clamp; tests sizing "long cell" fixtures must be clamp-relative
  (build to > PROMPT_MAX_CELL_CHARS), never hardcode 80/240.
- **Prompt compliance is probabilistic — a deterministic unpacker is the real
  guarantee.** `extractEmbeddedApplicatorBlends` in the lib parses any
  composition the model leaves embedded (clean name → type, pairs → one
  cheese recipe).
- **A cheese blend's identity is its NAME — same base name = ONE pool recipe,
  never a per-weight "(variant N)" copy.** Spec sheets express cheese as
  per-pizza OUNCES, so one named mix legitimately shows different component
  amounts across pizzas (e.g. 2.07 oz on a plain-cheese pizza, 1.75 oz on a
  topped one). The old unpacker forked a "(variant N)" whenever the same base
  name had a different composition, which — because per-pizza oz ALWAYS differs
  — split one mix into two ("Aldo's Cheese Mix" bug). Now `extractEmbeddedApplicatorBlends`
  keys by base name (first composition seen wins; manager refines batch lbs
  later), matching `collectSpecImportCheeseRecipes`'s name-dedupe. **Why:** the
  variant behavior was the lone name-keying outlier and contradicted the rest
  of the importer. `cleanSpecCheeseRecipeName` also strips an embedded
  composition (first line + `parseEmbeddedBlend` name) so an AI-emitted
  name-with-breakdown collapses the same way.
- **The unpacker MUST run once over the MERGED workbook parse, never per
  chunk** (so NOT in the server's per-chunk sanitize): running once keeps
  applicator relinking consistent within a single pass. Both clients call it at
  `rawMerged` before `canonicalizeParsed`.
- **One blend at two applicator weights = ONE cheese pool recipe.** The AI
  sometimes suffixes the per-pizza weight onto the cheese name ("Aldo's Cheese
  Mix 2.07" / "(2.07)"). `canonicalizeSpecImportCheeseRecipeNames` (runs on the
  MERGED parse, before apply/seed, in BOTH clients) strips trailing weight
  tokens via `cleanSpecCheeseRecipeName` so the variants collapse to one pool
  recipe; the weight lives on the applicator field `app{n}OzPerPizza`, never in
  the name. Skips mix-routed + non-cheese recipes; keeps the name if stripping
  would leave no letters (protects e.g. "5 Cheese Blend").
- **When the AI PRE-SPLITS one embedded blend into numbered cheese recipes**
  ("Aldo's Cheese Mix 1" / "…2", i.e. the split happens before our deterministic
  `extractEmbeddedApplicatorBlends`), canonicalize alone only fixes the NAMES —
  it still leaves two same-named recipes. `dedupeSpecImportCheeseRecipes` (pure,
  in the lib) then merges same-name non-mix cheese recipes into ONE:
  first-occurrence rows/app/doughball win, `targets` + `brandAnchors` are UNIONED
  so no profile loses its cheese link. **Why:** the split variants attach to
  DIFFERENT flavors; collapsing them late (the old commit-time-only path) risked
  dropping a flavor's cheese link, and the review showed two rows. **How:** run
  `dedupeSpecImportCheeseRecipes(canonicalizeSpecImportCheeseRecipeNames(x))` at
  PREPARE time (before summary/discrepancies) in ALL FOUR prepare sites (web +
  mobile, single- + multi-file), so the review shows one recipe. Commit still
  canonicalizes as an idempotent safety net. `cleanSpecCheeseRecipeName` also
  strips a `#`-prefixed trailing number ("Mix #1").
