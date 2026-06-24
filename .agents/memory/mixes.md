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
