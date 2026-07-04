---
name: Mixes section + make-day calculator
description: Pre-blended "mixes" master-data feature (define mixes, pick a make-day → per-run batches + Pull-For-Mix lbs); mirrors freezer-pull pattern; web+mobile parity.
---

# Mixes

Manager-defined pre-blended mixes (e.g. dough/sauce blends made ahead). Master-data,
factory-wide, manager-gated writes, **NOT in /sync**, additive DB — mirrors the freezer-pull
items pattern exactly.

## Units: perPizza is OUNCES, batch/totals are POUNDS (2026-07-04)
- A Mix component's `perPizza` is **ounces per pizza** — it matches the premix spec sheet's
  "Per Pizza" column (verified against live data: per-pizza 0.4–2.98, batch sizes ~112–147,
  cross-check ≈662 pizzas/batch only holds if perPizza=oz & batchSize=lbs). `batchSize`,
  `amountAlreadyMade`, and all plan totals are **pounds**.
- **Why:** `buildMixPlan` originally did `lbs = perPizza × pizzas`, treating oz as lbs — 16×
  too high (showed ~16 batches where 1 was needed). It now divides by `OZ_PER_LB` (16).
- **How to apply:** any per-pizza display/label must read "oz per pizza" (the field is
  internally named `lbs` across the recipe system but the UI unit is oz — the run card header
  already says "Oz / Pizza"). Pull-For-Mix totals stay "lbs" (they're computed pounds). The
  spec-export "Per Pizza" column header is a structural import anchor — leave it as "Per Pizza".

## Model & pure logic
- Lives in shared lib `@workspace/mixes`. Apps keep only platform glue + re-export; tests
  import the lib directly.
- A Mix matches scheduled runs by brand+flavor (case-insensitive) and has a make-ahead window
  (daysEarly). The plan scales each component by the day's pizza count and reports batches.
- **Aggregate by day+product, not by run.** Multiple scheduled runs for the same brand+flavor
  on one day MUST be summed (pizzas/cases) into a single card, and `amountAlreadyMade` applied
  ONCE per product. **Why:** a first attempt computed one entry per run, so split runs produced
  duplicate cards and subtracted "already made" multiple times (understating batches). A
  regression test covers "two runs, same day, same product".
- **Advisory-only** — never auto-writes / never moves stock.

## Run resolution (the parity-sensitive bit)
The planner needs, per scheduled run: `pizzas` and `cases`.
- Web: loadProfile → FormValues → `computeSummaryStats` → totalPizzas/totalCases.
- Mobile: brandProfiles → DEFAULT_SETTINGS spread (+casesNeeded, optional dieType) →
  `pizzas = casesNeeded × pizzasPerCase`, `cases = casesNeeded`.
- Both reduce to the same numbers: totalPizzas = casesNeeded×pizzasPerCase, totalCases = casesNeeded.
  Keep these two paths in lockstep when either side's summary math changes.

## UI
- Editor: `MixesManager` (web in settings area; mobile in `app/master-data.tsx`, gated
  `canManageInventory = hasCapability("manage-inventory")`). Mobile uses a **ChipPicker**
  (free-text + quick-pick chips) as the RN parity adaptation of the web `<datalist>`; local
  draft + commit-on-blur via `normalizeMix` (preserves id/scope).
- Planner: web Mixes section/tab; mobile `app/mixes.tsx` make-day screen (14-day chip picker,
  registered as `<Stack.Screen name="mixes">` in `app/_layout.tsx`, linked from settings).

## Gotcha
- Mobile `hasCapability`/`useMe` come from `@/hooks/useRole` (NOT `@/hooks/useMe`).

## Settings list UX (decided)
- With ~57 imported mixes a flat list of full editors is unusable. The Mixes settings list
  is search + brand groups (collapsed by default; forced open while searching or when only
  one group) + compact rows expanding to the existing MixEditor on tap. Grouping/search
  semantics live in @workspace/mixes (`mixMatchesQuery`, `groupMixesByBrand`: ci brand
  grouping on trimmed brand, alpha sort, no-brand last, in-group name sort) so web+mobile
  can't drift. Add Mix clears search and pre-opens the no-brand group + new editor
  (client-generated id survives the save round-trip, so expansion is stable).

## Saved-sheet list refresh (staleness gotcha)
MixReconcilePanel (web + mobile) fetches its premix/spec saved-sheet lists in local state,
not react-query. Any flow that saves a new sheet (spec import, premix import) must bump the
parent `sheetListSignal` passed as `refreshSignal`, or the just-saved sheet looks like it
"didn't save" (import buttons render right above the panel, which stays mounted). If a new
import path is added, wire it into the same signal — or migrate the lists to react-query keys.

## Mixes is the SINGLE source for mix recipes (2026-07-04)
The separate "Mix" recipe-type management was merged INTO server Mixes. Server Mixes master
data is now the ONLY source of mix recipe names + ingredients + recipe-card rows on BOTH apps.
**Why:** users had two disconnected places ("Mix" lists/local presets vs the Mixes editor);
merging removes drift and makes the Settings → Mixes editor the one source of truth.
**How it applies:**
- Web (`home.tsx`): the 4 per-applicator Mix cards are PICK-ONLY — `recipeNameOptions` =
  `serverMixNames`, `ingredientOptions` = `serverMixIngredients`, and `onRecipeNameChange`
  hydrates rows from `serverMixRowsByName` ONLY (dropped the old factory-preset and
  `loadCheeseRecipePresets` fallbacks). `IngredientSelect`/`MixRecipeCard` add/remove
  handlers are now optional; when absent the Enter-add, per-option remove-X, and "Add …" UI
  (incl. the confirm-Yes button, guarded `onRemoveOption?.()`) are hidden. The Manage Lists
  "Mix" grouped tab is removed (Dough/Sauce/Cheese only).
- Mobile (`configure.tsx`): the unified applicator `RecipeEditor` now gets
  `factoryPresets={serverMixPresets}` (server only — dropped the local `userMixPresets` +
  built-in `factoryMixPresets` composition), `factoryLabel="Mixes"`, and `onSaveMix` is
  removed so no local mix list is written. Mobile never had a separate mix-ingredient list or
  a distinct mix card (one RecipeEditor per applicator; mixes only ever entered via chips), so
  there was no extra mobile UI to strip — parity is behavioral, not component-for-component.
- CONSEQUENCE: mix recipe management is now MANAGER-ONLY (Mixes writes are
  `manage-inventory`-gated) whereas the old "Mix" tab / local save was open to all staff.
- The merge-tool "Mixes" tab was ALSO removed (web merge category selector + mobile
  `MERGE_TABS`) because it read the old LOCAL `mixRecipeNames`/`mixRecipePresets` list and
  showed mix names that aren't on the server Mixes screen — a confusing "second list" that
  broke single-source. Mix names are now renamed/removed in the Mixes editor. The `"mixes"`
  case handling in the merge switch/scope/apply code is left dormant (unreachable, harmless);
  the `MergeCategory` union still includes `"mixes"`.
- STILL DORMANT (backward-compat, both apps): sync payload fields
  (`mixIngredients`/`mixRecipeNames`, local `mixRecipePresets`) still exist so old synced data
  doesn't error; the web `manageCategory === "mix"` block no longer renders.
- Migration note: local-only mixes (old "Mix" tab / "save as mix" on a run) were NEVER in the
  server `mixes` table — they don't appear in Mixes and a premix reimport only brings back
  mixes that are actually in a sheet; hand-entered ones must be re-added in the Mixes editor.
