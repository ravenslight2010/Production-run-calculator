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
- **Dough sheet ("… Dough Mixing Procedure" workbooks, e.g. CRB / Malted Barley)**: ALL real dough recipes come from these — spec sheets only name the dough. One workbook = ONE shared ingredient recipe (LBS column, maybe multi-batch "2 Bag/4 Bag/5 Bag" columns) used by MANY named dough variants. Variants are header lines of the form `Variant Name: flavor, flavor…` (e.g. "Lowe's CRB: Californian, Pepperoni…", "Lowe's & Lucia's Craft CRB Heavy Plus: Caribbean", "Lowe's Thick Barley (Argus): Buffalo, Meat Lovers…"). Spec-sheet dough names ("CRB Heavy Plus recipe", "Thick Malted Barley recipe") map to those variant lines by loose name. Bottom of sheet: per-variant-group doughball table (OZ / LBS / YIELD / PER TRAY). Also contains numbered mixing-step text and revision stamps — not ingredients.
- **Sauce sheet**: has no pizza list; spec sheets still reference the sauce by name, so sauce ties back purely by name.
- **Premix sheet** (per-pizza AND per-batch columns):
  - **PER-PIZZA rows ≈ 98% match the spec sheet → these are the real MIXES.**
  - The remaining rows are **pull-early / prep-for-the-run ingredients (e.g. fresh spinach) — NOT mixes.** The importer must split these out, not treat them as mixes.
- **Cheese workbook**: the recipes for how each spec-sheet cheese blend is made. Ratios may or may not be accurate.
  - Contains **mixes inside blends** — e.g. **Aldo's**: a cheese SPICE mix that goes into a cheese mix (a sub-mix nested in a blend).
  - Some prep items (fresh spinach) also live here — see **Cornerbooth Spin & Mushroom** — the same spinach that appears in the premix sheet's non-mix rows.

## Keep the in-app guidance spec-first
- The Manage Lists ▸ Import "Best import order" block MUST stay **spec-first, cheese/premix last**. It once read the reverse (blocks first, spec last), which silently defeats matching: the cheese & premix importers link their shorthand names onto the recipes the spec import already created, so the spec has to exist first.

## Cheese workbook "depth" (sub-mixes + prep items) — IMPLEMENTED (web)
- **Sub-mix** = a cheese blend block whose (brand-stripped, punct-normalized) name matches an ingredient ROW inside another blend on the SAME customer tab. Real layout: two side-by-side blocks where the parent lists the sub-mix as a small-lbs component (e.g. Aldo "Parm / Oregano Mix" 0.3 → its own "Aldo's Parmesan / Oregano Mix" block). Detected per-tab by `detectCheeseSubMixes` in `@workspace/cheese-import`; exact-on-normalized-key (no fuzz) so a raw-cheese component ("Whole Mozzarella") never links to the standalone "Whole Mozzarella Cheese Mix" block. Sub-mixes still import as recipes but are LABELED (not pizza-facing).
- **Prep items** = fresh/perishable ingredient rows inside blends (only signal is the NAME — no structural marker). `collectCheesePrepItems` matches `/\b(fresh|spinach|mushroom)\b/i`, surfaced read-only. Real file: all 11 hits were spinach variants.
- Real 25-tab workbook sanity: 112 recipes → 5 sub-mixes + 11 prep items, zero false positives. Extend `CHEESE_PREP_RE` as new sheets reveal more perishables.

## Premix prep items are TWO kinds (not just cheese has prep)
- Prep-to-pull items live in the PREMIX sheet too, not only the cheese workbook. `collectPremixPrepItems` surfaces:
  1. **per-batch-only rows** split OUT of a mix (perPizza==0, e.g. fresh spinach) — legacy behavior.
  2. **per-pizza ingredients whose NAME says they need run-day prep** (`PREMIX_PREP_RE`, a curated name list; e.g. pineapple / "drained") — these STAY in the mix (real ingredient, never removed) but are ALSO surfaced with `alsoInMix:true` as a reminder (e.g. "Pineapple - Drained" → drain the juices). No structural marker exists; name is the only signal, so keep the regex narrow and expand only from observed real imports (drain-juice items like sauerkraut also qualify).

## Why it matters / the ask
- Step 3 (cheese workbook + premix) is where names get abbreviated most, so it's where **brand/flavor cheese & mix name-matching helpers are needed most** — to tie shorthand names to the right blend for each brand+flavor. Relates to follow-up "Connect cheese spec to blend".
- Reminder of existing invariants: cheese = per-BATCH lbs; premix/mixes = per-PIZZA oz; sauce == frontline pool (see spec-import-batch-vs-perpizza.md, premix-import.md, cheese-server-master-data.md).
