# Hide Zero-Pull Ingredient Prep Cards

**Date:** 2026-08-17  
**Status:** Approved

## Problem

The Ingredient Prep section on the Mixes tab shows a card for every enabled prep mix within its `daysEarly` window — even when the calculated pull total is 0 lbs. This happens when ingredient names don't match any run profile amounts, or when no runs today use those ingredients. Staff see cluttered "No component amounts — pull quantities will be 0 lbs" cards they have nothing to act on.

**Reported examples:** Spinach, Hot Giardiniera Mix cards appeared with 0 lbs and no actionable content.

## Solution

Filter out any prep mix card whose `totalLbs === 0` before rendering. Filtering is render-only — `buildMixPlan` continues to compute and return zero-lbs entries unchanged.

## Behaviour

| Scenario | Result |
|---|---|
| Prep mix has no matching run profiles → `totalLbs === 0` | Card is hidden |
| Prep mix has real amounts, fully covered by "Already made" → `totalLbs > 0`, `remainingLbs === 0` | Card shown ("need 0 lbs") |
| Every prep mix in a date group calculates to 0 lbs | "Ingredient Prep" heading and container don't render at all |
| Regular (non-prep) mix cards | Completely unaffected |
| Prep card with non-zero pull quantities | Shows normally |

## Implementation

In `artifacts/run-calculator/src/pages/home.tsx`, just before the `group.prepMixes.map(...)` call in the Ingredient Prep block:

```tsx
const visiblePrepMixes = group.prepMixes.filter((m) => m.totalLbs > 0);
return visiblePrepMixes.length > 0 && (
  <div ...>
    ...
    {visiblePrepMixes.map((m) => { ... })}
  </div>
);
```

The outer guard (`group.prepMixes.length > 0`) is replaced by `visiblePrepMixes.length > 0`, so the "Ingredient Prep" heading is also hidden when nothing passes the filter.

## Out of Scope

- Mobile Ingredient Prep rendering (mobile does not currently render prep mix cards)
- Changes to `buildMixPlan` in `lib/mixes/src/index.ts` — zero-lbs entries continue to be computed and returned
- A "show all hidden" toggle
