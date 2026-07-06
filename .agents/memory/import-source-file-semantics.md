---
name: Import source-file semantics (spec sheets, dough, sauce, cheese workbook, premix)
description: How the real factory spreadsheets relate and decompose — needed to make Excel imports match by name correctly. Domain facts from the operator, not derivable from code.
---

# Import source-file semantics

The user's mental model of how their upload files link together, and the improvement they want. Everything keys off the **spec sheets** by NAME.

## Authority / recommended import order
- **Spec sheets are the source of truth** for pizza names, ingredients, and weights. Every other file bases its names off the spec sheet, but some use common factory-floor / shorthand / abbreviated names.
- Desired import order: **1) spec sheets first → 2) dough & sauce → 3) cheese workbook & premix LAST**, so the messy abbreviated names in step 3 can be matched back to names the spec sheets already established (instead of creating mismatched duplicates).

## Per-file facts
- **Dough sheet**: lists every pizza + the dough weight for it, so it already knows where it goes — but only for pizzas that exist in the spec sheet.
- **Sauce sheet**: has no pizza list; spec sheets still reference the sauce by name, so sauce ties back purely by name.
- **Premix sheet** (per-pizza AND per-batch columns):
  - **PER-PIZZA rows ≈ 98% match the spec sheet → these are the real MIXES.**
  - The remaining rows are **pull-early / prep-for-the-run ingredients (e.g. fresh spinach) — NOT mixes.** The importer must split these out, not treat them as mixes.
- **Cheese workbook**: the recipes for how each spec-sheet cheese blend is made. Ratios may or may not be accurate.
  - Contains **mixes inside blends** — e.g. **Aldo's**: a cheese SPICE mix that goes into a cheese mix (a sub-mix nested in a blend).
  - Some prep items (fresh spinach) also live here — see **Cornerbooth Spin & Mushroom** — the same spinach that appears in the premix sheet's non-mix rows.

## Why it matters / the ask
- Step 3 (cheese workbook + premix) is where names get abbreviated most, so it's where **brand/flavor cheese & mix name-matching helpers are needed most** — to tie shorthand names to the right blend for each brand+flavor. Relates to follow-up "Connect cheese spec to blend".
- Reminder of existing invariants: cheese = per-BATCH lbs; premix/mixes = per-PIZZA oz; sauce == frontline pool (see spec-import-batch-vs-perpizza.md, premix-import.md, cheese-server-master-data.md).
