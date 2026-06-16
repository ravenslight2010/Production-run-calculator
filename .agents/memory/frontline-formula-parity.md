---
name: Frontline formula parity (web ↔ mobile)
description: How mobile computeCalc frontline math mirrors web, and what is intentionally NOT mirrored.
---

Mobile `computeCalc` (RunContext.tsx) frontline ingredient math mirrors web `computeCalc` (home.tsx):

- Sauce / applicator 1-4 / pepperoni 1-2 batch counts are **raw fractional division** (lbs / effBatch), NOT ceiled. Web shows fractional; do not reintroduce `Math.ceil` on these.
- Frontline ingredient pizza basis = web's `casesLeftToRun`, not the simpler `casesLeft`:
  `casesLeftToRun = casesNeeded - skids*casesPerSkid - casesOnCurrentSkid - casesOnLine + casesPerLayer`
  (`casesOnLine = floor(ppm * liveFreezerMin / pizzasPerCase)`), then
  `pizzasForIngredients = casesLeftToRun*pizzasPerCase + casesPerLayer*pizzasPerCase` (web doubles the layer buffer for frontline only). The "Based on N cases" label shows `casesLeftToRun`.

**Intentionally NOT mirrored:** dough lbs/batches and timing (`minutesRemaining`, `estCompletionMs`) still use `pizzasLeft` (the `casesLeft` basis). Mobile's dough supply path (`computeDoughSupply`) already uses its own `casesLeftToRun`.

**Why:** user explicitly approved aligning the two reported frontline divergences (batch rounding + basis) to the canonical web app; dough/timing alignment was out of scope.

**How to apply:** any future edit to frontline batch/lbs formulas must keep web and mobile identical. Mobile keeps `lbs > 0` guards on batch ternaries that web omits — only matters in negative-lbs tail edge cases; harmless, leave as-is unless byte-for-byte parity is demanded.
