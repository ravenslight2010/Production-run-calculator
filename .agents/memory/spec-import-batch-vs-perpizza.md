---
name: Import format gotchas — per-batch vs per-pizza, noise headers
description: Which workbook fits which importer, and the non-recipe "noise" lines that steal a cheese block's LBS marker.
---

# Per-BATCH vs per-pizza workbooks

- "Cheese Mix Recipe Specs" and "Meat & Veggie Mix Recipe Specs" workbooks are both **per-BATCH lbs**, tabbed-by-customer, with the same column-block shape (name row, an "LBS" marker row, ingredient+lbs rows, a "Total" row).
- The **Mixes** feature (and its premix importer) is **per-PIZZA oz**: `parsePremixWorkbook` only anchors on a "Per Pizza" header column, and the `Mix` model stores per-ingredient `perPizza` (no per-ingredient per-batch field). Feeding it the Meat & Veggie file finds no "Per Pizza" anchor, so it falls to the name-only path and produces mixes with `batchSize:0` and every component `perPizza:0`.

**Why:** these are two different data models. A per-batch topping recipe (e.g. "Bobo's Deluxe Mix", total 91 lbs) has no per-pizza numbers anywhere in the source, so it genuinely cannot be represented in the current Mixes feature.

**How to apply:** if a "Meat & Veggie" (or any per-batch lbs) workbook needs to import faithfully, it must go through a cheese-like per-batch path, not the Mixes/premix importer. As of 2026-07-05 the user chose to just delete the 21 zeroed placeholder mixes and re-import once the format is sorted, rather than build a new per-batch mix feature.

# Cheese importer noise headers

- Non-recipe lines can sit in the name column directly above a real recipe block: revision stamps ("3/4/2025 Rev. 20", "02/06/26 Revision 11"), a bare "Cellulose" summary label, and calc/example text ("8.19 total mix ... *0.8 = 6.6 ..."). Because the real block's "LBS" marker is within ~3 rows, the scanner used to treat the noise line as the header and attach the ingredients to it — losing the real recipe (e.g. "Edwardo's Parmesan Oregano Mix" was mis-named as the calc line).
- `scanColumnBlocks` now rejects these via `isNonRecipeName` and collapses whitespace in captured names.

**Why:** proximity-to-LBS alone is not enough to identify a header; some sheets put dated/calc noise right above a block.

**How to apply:** keep the guard at header selection only (never on ingredient rows). Do NOT reject "/" broadly — legit names contain it ("Aldo's Parmesan / Oregano Mix", "Lowe's Pepperoni/Romano"). Re-verify any new junk class against the full workbook before widening the filter.
