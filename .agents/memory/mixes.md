---
name: Mixes section + make-day calculator
description: Pre-blended "mixes" master-data feature (define mixes, pick a make-day → per-run batches + Pull-For-Mix lbs); mirrors freezer-pull pattern; web+mobile parity.
---

# Mixes

Manager-defined pre-blended mixes (e.g. dough/sauce blends made ahead). Master-data,
factory-wide, manager-gated writes, **NOT in /sync**, additive DB — mirrors the freezer-pull
items pattern exactly.

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

## Per-run Mix Recipe card sources server mixes (2026-07-04)
The Setup-tab per-applicator "Mix Recipe" name picker hydrates ingredient rows with priority:
built-in factory presets (EMPTY since the 2026-07-03 purge) → server Mixes master data
(matched by trimmed, case-insensitive name; components perPizza fed straight into the row
value — the card's totals are proportional so units pass through) → the local user preset
pool. Server must beat the local pool: web's passive cheese-preset autosave can poison the
pool with wrong rows saved under a mix name. Mobile mirrors this in the preset chips
(server wins over a same-named locally saved mix). If mixes change server-side, the run
card picks it up on re-select — the Settings Mixes editor is the source of truth.
Also applies to the web Manage Lists → Mix tab "view" editor: a name matching a server mix
renders its components READ-ONLY (edit lives on the Mixes tab); only non-server names fall
through to the local-pool editor. Mobile has no such lightweight mix editor (its master-data
screen embeds MixesManager) — intentional parity exception.
