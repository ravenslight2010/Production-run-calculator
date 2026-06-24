---
name: Mixes section + make-day calculator
description: Pre-blended "mixes" master-data feature (define mixes, pick a make-day → per-run batches + Pull-For-Mix lbs); mirrors freezer-pull pattern; web+mobile parity.
---

# Mixes

Manager-defined pre-blended mixes (e.g. dough/sauce blends made ahead). Master-data,
factory-wide, manager-gated writes, **NOT in /sync**, additive DB — mirrors the freezer-pull
items pattern exactly.

## Model & pure logic
- Lives in `@workspace/mixes` (`lib/mixes/src/index.ts`). Apps keep only platform glue +
  re-export from the lib; tests import the lib directly.
- A Mix: name, brand+flavor (used to match scheduled runs), batchSize (lbs/batch), daysEarly
  (default 0), notes?, amountAlreadyMade, components[{ingredient, perPizza lbs}], plus id/scope.
- `buildMixPlan({runs, mixes, today})`: enabled-only; brand+flavor matched case-insensitively;
  keep run if `0 <= daysUntil(run.date) <= mix.daysEarly`; per-component lbs = perPizza×pizzas;
  totalLbs = sum; remainingLbs = max(0, total − amountAlreadyMade); batches = remaining/batchSize
  (0 if ≤0); grouped by date ascending. **Advisory-only** — never auto-writes.

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
