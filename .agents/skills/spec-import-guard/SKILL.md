---
name: spec-import-guard
description: "Run this checklist whenever you touch the spec import pipeline — AI parse prompts (buildParseSpecSheetPrompt, aiParseSpecSheet.ts), parse/sanitize logic (lib/spec-import, @workspace/spec-import), the alias system (sanitizeSpecAliases, collectSpecAliases, canonicalize, specImportAliases.ts), corpus harness (lib/corpus-harness), chunk/merge logic (splitGridsForPrompt, mergeParsedSpecImports), import link passes (linkParsed, linkSpecImportNamedRecipesToExisting), or spec export (lib/spec-export)."
---

# Spec Import Pipeline Guard

## When to use this skill

Read and follow this skill whenever you touch **any** of:
- AI parse prompts (`buildParseSpecSheetPrompt`, `aiParseSpecSheet.ts`)
- Spec import pipeline logic (`lib/spec-import/`, `@workspace/spec-import`)
- Alias system (`sanitizeSpecAliases`, `collectSpecAliases`, `canonicalize`, `specImportAliases.ts`)
- Corpus harness (`lib/corpus-harness/`)
- Chunk/merge logic (`splitGridsForPrompt`, `mergeParsedSpecImports`)
- Sanitizer (`sanitizeParsedSpecImport`)
- Import link passes (`linkParsed`, `linkSpecImportNamedRecipesToExisting`, `linkSpecImportDieTypesToExisting`)
- Spec export (`lib/spec-export/`) — export output feeds back into the AI parse path

---

## Validation sequence (run in this order)

### 1. SPEC_PARSE_VERSION check

**Always do this first when the prompt or pipeline changes.**

- Location: `artifacts/run-calculator/src/specImport.ts` — search for `SPEC_PARSE_VERSION`. It is version-salted into the hash used to cache parse results in the `saved_spec_sheets` DB table.
- **Bump rule:** any change to the parse prompt, sanitizer output shape, chunk limits, or pipeline ordering MUST increment `SPEC_PARSE_VERSION`. If you don't, the saved-parse cache serves stale results from before your change — managers re-import the same file and see the old broken parse instantly, with no indication something changed.
- **What counts as a change:** new/removed/reworded prompt instructions, changed field names in the AI JSON output, new sanitizer rules that alter which items survive, changed filler tokens in `SPEC_IMPORT_FILLER_TOKENS`, new fields on `ParsedRecipe` / `ParsedProfile` (e.g. `brandAnchors`, `referenceOnly`, `doughballsPerTray`), any change to how known-lists grounding (brands, flavors, deletion tombstones) is applied before hashing. Style-only rewording that cannot change model output is safe to skip.
- **How to verify:** after bumping, confirm the constant appears in `artifacts/run-calculator/src/specImport.ts` and is the only thing controlling the cache key.

### 2. Run the corpus harness (`test:corpus`)

```
pnpm --filter @workspace/corpus-harness run test
```

- Parses the entire `attached_assets/source-library` corpus **deterministically** (no AI, no network) against checked-in JSON snapshots.
- Catches: dropped rows, mis-routed recipes (cheese vs. mixes), near-dup pressure regressions, grid-sanity failures.
- **If snapshots fail:** inspect the diff. If your change intentionally altered output (e.g. a new sanitizer rule), regenerate snapshots with the package's `snapshots` script and review the full diff before committing.
- **Routing invariant (do not flip):** `specImportCheeseRecipeIsMix` — the mix/blend name-word rule beats the cheesy-components check. Real premixes contain cheese ("White Fajita Mix" carries Monterey Jack); cheese-workbook blends named "…Mix" are safe because the cheese-workbook importer never consults this heuristic. If the corpus invariant flags a cheese-workbook name routing to Mixes, check it has a mix/blend word — that leak is the accepted boundary; a leak WITHOUT the word is a real regression.

### 3. Run the lib/spec-import unit tests

```
pnpm --filter @workspace/spec-import exec vitest run
```

This runs the 25 dedicated test files in `lib/spec-import/src/` covering alias hygiene, sanitizer, canonicalize, chunk union, merge logic, and import link passes. **Required after any change to `lib/spec-import/`.** The web artifact's Vitest config covers only `artifacts/run-calculator/src/**/*.test.{ts,tsx}` and does not include these library tests.

### 4. Real-AI harnesses (required when the AI prompt or model changed)

> **Why these exist:** the spec importer's per-chunk limits are tuned empirically to the current model (`gemini-3.1-pro-preview`): 16 k-char chunk budget (`DEFAULT_LIMITS.maxTotalChars`), 65 536 `max_completion_tokens` on `/ai/parse-spec-sheet`, sanitizer `maxProfiles` 400. When `AI_MODELS` / `pickModel` is repointed, these limits can silently become wrong — the failure mode is an import that "succeeds" but quietly drops data (truncated output → non-JSON → empty chunk, or valid-but-empty JSON). These harnesses are the only defence.

Run **both** after any prompt or model change:

---

#### 4a. Large-spec round-trip harness (on-demand — size regression)

**Run this whenever `AI_MODELS` / `pickModel` changes.** It is the primary guard against silent data loss at scale. Full run takes 10–20 minutes (real AI calls, costs money).

**Prerequisites:**
1. API server running: start the `artifacts/api-server: API Server` workflow (port 8080) **or** the `API Server` workflow (port 5000).
2. Set env vars — either:
   - `VERIFY_USERNAME` + `VERIFY_PASSWORD` (an existing manager account), or
   - Leave both unset to auto-sign-up a fresh user (only works when it will be the **first** user in the DB — use a clean test database or promote via `user_roles.role='manager'`).
3. If the API is on a non-default port, set `API_BASE=http://localhost:PORT/api`.

**Quick smoke run (cheap, ~2 min, 12 chunks):**
```bash
BRANDS=4 FLAVORS=3 \
VERIFY_USERNAME=mymanager VERIFY_PASSWORD=mypass \
pnpm --filter @workspace/scripts run verify-large-spec-import
```

**Full run (30 brands × 8 flavors = 240 profiles + 90 recipes, ~10 chunks, ~10–20 min):**
```bash
VERIFY_USERNAME=mymanager VERIFY_PASSWORD=mypass \
pnpm --filter @workspace/scripts run verify-large-spec-import
```

**Reading a failure:** when data is lost the harness exits 1 and prints a clear diff:
```
FAIL — 6 problem(s):
  - MISSING PROFILE: Golden Crust / Veggie
  - MISSING PROFILE: Golden Crust / BBQ Chicken
  - MISSING RECIPE: [dough] Golden Crust Dough
  - MISSING ROW: [sauce] Rustic Hearth Sauce → Spice Blend
  - WRONG LBS: [cheese] Alpine Stone Cheese Blend → Mozzarella: got 400, expected 423
  - MISSING TARGET: [dough] Golden Crust Dough → Golden Crust / BBQ Chicken

Data was lost or corrupted between export → chunk → AI parse → merge.
If the AI model recently changed, re-tune: the 16k chunk budget
(DEFAULT_LIMITS.maxTotalChars in lib/spec-import), the 65536
max_completion_tokens on /ai/parse-spec-sheet, and maxProfiles (400).
```

**Interpreting results:**
- `MISSING PROFILE` / `MISSING RECIPE` — whole items lost; likely a chunk returning empty JSON or the chunk-size budget too wide for the new model's output cap. Reduce `DEFAULT_LIMITS.maxTotalChars` in `lib/spec-import/src/index.ts`.
- `MISSING ROW` / `WRONG LBS` — partial data loss; the AI parsed the item but truncated its ingredient list. Same fix.
- `MISSING TARGET` — recipe present but brand/flavor link lost; the `"Brand: flavor, …"` target row was cut by the prompt-cell clamp. Check `PROMPT_MAX_CELL_CHARS` wrapping in the exporter.
- A single empty chunk on the **first attempt** that passes on retry = transient flakiness; still-empty after 3 retries = systematic model/limit regression.

**Harness script:** `scripts/src/verify-large-spec-import.mts`
Rate-limit: throttles at 8 req/min, sleeps 65 s on 429.

---

#### 4b. Parse-rule stress + round-trip harness (on-demand — rule regression)

Run after any **prompt rewrite** (not just model changes). Covers qualifier-brand separation, known-sauce grounding, paraphrase snapping, and xlsx round-trip.

The script must be bundled with esbuild first (Node's native type-stripping cannot load `@workspace/api-zod`'s extensionless internal imports):
```bash
cd artifacts/api-server
./node_modules/.bin/esbuild scripts/e2e-spec-roundtrip.ts --bundle \
  --format=esm --platform=node --outfile=/tmp/e2e-spec.mjs \
  --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
node /tmp/e2e-spec.mjs
```

- **SCENARIO 2** (same run): a sheet abbreviating ready-made sauces the factory already has (`known.sauceNames`) must import with NO false "not found on the sheet" warning; a control re-sanitize WITHOUT the known list must warn; a scripted paraphrase must still warn/snap.
- The deterministic xlsx write → read → grid half is guarded in CI (no AI): `lib/spec-export/src/xlsx-roundtrip.test.ts` (`test:spec-export`). The esbuild harness is the only check for the AI-parse half.
- Expected final line: `ALL CHECKS PASSED — full round-trip with no data loss.`

---

**When to skip real-AI harnesses:** if the change is purely deterministic (sanitizer, chunk logic, alias system, import link passes) and you have not touched the prompt or model routing, the real-AI harnesses can be skipped. Corpus + lib/spec-import unit tests are sufficient.

### 5. Alias hygiene checks

After any change to alias creation, application, or learning paths, verify these rules hold. All are enforced in `sanitizeSpecAliases` (`@workspace/spec-import`), applied on **every** alias read/apply path (canonicalize, blend alias application, premix redirects):

| Guard | Rule | Consequence of missing it |
|---|---|---|
| **Digit-signature mismatch** | Drop aliases where external and canonical names have different digit signatures (e.g. `"11 IN FOUR HANDS" → "Four Hands"`, `Lowe's 7" → Lowe's`). | Different die sizes or product sizes silently collapse. |
| **Generic slot-type names** | Reject `"Mix"` or `"cheese"` on either side of `appType` aliases. | Every blend renames to the literal "Mix" and merges into one garbage record. |
| **Cross-family mix↔cheese pairs** | `isCrossFamilyMixCheesePair`: never apply or learn an `appType` alias where one name is a cheese-token name and the other is a plain mix-token name. | A MIX applicator silently re-routes onto a cheese recipe on every re-import. |
| **Chains/cycles** | Drop aliases where a name is both source and target. | Alias pass loops or cancels itself; valid flavors renamed out of existence. |
| **Modifier-dropping pairs (ingredient kinds)** | `isModifierDropNamePair`: for `cheeseIngredient` / `doughIngredient` / `sauceIngredient`, drop aliases where one name's loose-key token set is a proper subset of the other (`"Sea Salt" → "Salt"`). | Different ingredients silently merged factory-wide. |
| **Fuzzy matches never learned** | `collectSpecAliases` must skip `source === "fuzzy"`. | Unconfirmed guesses written to factory-wide memory poison every future import. |
| **Deleted names excluded** | Known-lists glue must filter brands/flavors through deletion tombstones before building the match universe; alias targets pointing to deleted names must be dropped before use. | Import lands under tombstoned names; autofill finds nothing. Requires SPEC_PARSE_VERSION bump. |

**Every new alias consumer or learn path must call `sanitizeSpecAliases`.** Sanitizing only at apply time is insufficient — the suggestion-build step and the learn loop must also sanitize, or poison re-accumulates via a self-perpetuating review-pick loop.

### 6. Import order verification

The correct import order is: **spec sheet → dough/sauce workbooks → cheese workbook → premix workbook**.

Spec-first is the worst order for dedup — the AI match-import pass runs but the target pool is empty, so it no-ops. After the spec is in, the later deterministic importers can only dedupe by their respective name keys:

- **Cheese** (`addCheeseRecipesIfAbsentByName`): dedupes by **exact** case-insensitive name only — no filler-token folding. A one-word drift (`"Craft"` present in workbook but absent in spec) creates a duplicate.
- **Mixes/premix** (`addSpecMixesIfAbsent` → `mixNameMatchKey`) and **dough/sauce recipe-name linking** (`linkSpecImportNamedRecipesToExisting`): use the **loose key** (`specImportNameMatchKey`) — lowercase, strip apostrophes/punct, drop filler tokens `standard`/`regular`/`pizza`. Tolerates case/punct/filler drift but NOT extra distinguishing words, reordering, or misspellings.

When diagnosing a "duplicated recipe" report: first confirm which key the relevant importer uses, then compare the spec-extracted name vs the workbook name using that key — do not assume the AI match-assist rescued the mismatch.

### 7. Chunk union spot-check

When touching `mergeParsedSpecImports` or chunk-level merge logic, verify the union/replace semantics are correct:

- **Chunks of one workbook** → must call `mergeParsedSpecImports(list, { profileSlots: "union" })`. Chunks are **complementary** (a chunk boundary can split one product's spec block mid-grid), so applicator/pepperoni lists must union or the earlier chunk's weights are silently lost.
- **Multiple files in one batch** → must keep the default `"replace"` semantics. A later workbook restating a product is a correction.

**Union semantics detail:** identical re-emits (loose type key + same oz) collapse with slot/batchLbs enrichment; a 0-oz entry is dropped when the same type also carries a real weight; the SAME type at DIFFERENT weights stays as TWO entries — a pizza can legitimately run one topping on two stations at different per-pizza weights.

If the parse prompt was rewritten, confirm the **DUPLICATE APPLICATORS** section is still present (one `applicators[]` entry per station, own `ozPerPizza`, never collapse/sum/copy). This section is pinned by `aiParseSpecSheet.test.ts`.

---

## Known gotchas

### Stale parses resurrect old results
The `saved_spec_sheets` table (`savedSpecSheetsTable`) caches parse results keyed by a version-salted hash. If `SPEC_PARSE_VERSION` (in `artifacts/run-calculator/src/specImport.ts`) is not bumped after a pipeline change, every manager who re-imports the same file gets the old broken parse served instantly from cache — the change has zero effect in production until the version is bumped or the row is manually deleted.

### Spec-first dedup failure
Importing the pizza spec before the master-data workbooks (cheese, premix, dough, sauce) leaves parallel near-duplicate recipes for anything with a name drift between the spec and the workbook. The AI match-import pass cannot help because the pools are empty at spec-import time. This is expected behavior, not a bug — document it for managers.

### Stub pollution from unlinked zero rows
Every spec import seeds placeholder rows (all-zero lbs) in every server pool for recipe names it references. If the matching workbook is never imported, or the name drifts, the stub persists in prod forever and clutters pickers. After any spec import pipeline change that affects which names get seeded, audit the pools for new zero-lbs rows. Treat "same name, all-zero lbs" as "stub never filled."

### Alias poison self-perpetuates via the review dialog
If the alias suggestion-build step (`buildAliasLinkSuggestions`) reads the raw (unsanitized) alias list, a poisoned entry surfaces as a pre-selected "Use existing" pick. When confirmed, it is re-learned — a self-perpetuating loop. The fix requires sanitizing at **four layers**: suggestion build, the learn path, the commit save, and the server POST backstop. Any new entry point into the alias system must sanitize before surfacing suggestions and before writing.

### Product-line siblings must never collapse
The match-import AI can fold a new qualified brand (`Basha's Ultra Thin Crust`) onto an existing shorter brand (`Basha's Original`) because they share a company stem. The server-side `conflictingProductLine` guard in `aiMatchImport.ts` drops these matches. If you add new qualifier words that the KNOWN qualifier lexicon doesn't cover, also verify the structural check (shared leading stem + divergent distinguishing tokens) still catches them — the lexicon alone is insufficient.

### Prompt cell clamp — exporter output must stay under limit
`gridsToPromptText` / `splitGridsForPrompt` clamp every cell to `PROMPT_MAX_CELL_CHARS` (80, exported from `@workspace/spec-import`). The exporter's `"Brand: flavor, flavor…"` recipe-target row is ONE cell — with many flavors it can exceed 80 chars and the clamp silently cuts trailing flavors. Any new exporter output destined for the AI prompt path must keep every single cell under `PROMPT_MAX_CELL_CHARS` or wrap across multiple rows. Guarded in CI: `lib/spec-export/src/prompt-roundtrip.test.ts` (run via `test:spec-export`).

### Deleted names need a SPEC_PARSE_VERSION bump
When the known-lists glue is updated to filter brands/flavors through deletion tombstones (or to drop alias targets pointing to deleted names), the old grounding is baked into saved parse snapshots — bump `SPEC_PARSE_VERSION` or the tombstone filter has no effect on cached parses.

---

## Quick reference: test commands

| What | Command | When required |
|---|---|---|
| Corpus regression (deterministic, no AI) | `pnpm --filter @workspace/corpus-harness run test` | **Always** after any spec import change |
| Spec-export prompt round-trip (cell clamp) | `pnpm --filter @workspace/spec-export run test` | After exporter changes |
| lib/spec-import unit tests (alias, sanitizer, merge, link) | `pnpm --filter @workspace/spec-import exec vitest run` | After any lib/spec-import change |
| Large spec round-trip — smoke (real AI, ~2 min) | `BRANDS=4 FLAVORS=3 VERIFY_USERNAME=… VERIFY_PASSWORD=… pnpm --filter @workspace/scripts run verify-large-spec-import` | Quick check after prompt or model changes |
| Large spec round-trip — full (real AI, 10–20 min) | `VERIFY_USERNAME=… VERIFY_PASSWORD=… pnpm --filter @workspace/scripts run verify-large-spec-import` | **Required** after any AI model change — see step 4a for full setup |
| Parse-rule stress + xlsx round-trip (real AI) | esbuild + node — see step 4b above | After prompt or model changes |
