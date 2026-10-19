---
name: Excel spec/recipe/mix export
description: How the in-app Excel EXPORTER of spec profiles + recipes + mixes is built to round-trip back through the existing importers.
---

# Excel export for spec sheets, recipes & mixes

The exporter is the mirror image of the two IMPORTERS and must round-trip
through them (export → edit in Excel → re-import, no data loss/misparse). Sheet
layout logic is pure and shared (`@workspace/spec-export`); apps keep only glue.

## Five separate workbooks — never combine
The spec/recipe importer is AI-based; the premix importer is deterministic and
scans for a "Per Pizza" anchor. Export therefore produces independent Specs,
Dough, Sauce, Cheese, and Mixes files.

**Why:** Managers need customer- and recipe-oriented sheets, while every file
must remain directly re-importable through its existing importer.

**How to apply:** Keep each category independently selectable and downloadable.
Specs group by brand; dough/sauce by recipe; cheese/mixes by brand with
`Unassigned` for library-only records.

## Layout that the importers re-read
- **Specs workbook:** one tab per brand, with one row per flavor and the brand
  value preserved in every row. Columns retain die type,
  sauce oz/pizza, 4 applicator slots (type + oz/pizza), 2 pep slots (type +
  sticks + oz/pizza).
- **Dough/Sauce workbooks:** one tab per library recipe, including unreferenced
  recipes. Prefix the kind in the tab name so Excel truncation cannot remove it.
- **Cheese workbook:** one tab per using brand; shared recipes repeat on each
  applicable tab and unreferenced recipes go to `Unassigned`.
- **Recipe blocks:** `Recipe: <name>`,
  then one `Brand: flavor, flavor` row per brand that USES the recipe (derived
  from profile recipe-name references, so re-import re-attaches it without
  duplicating the library entry), then the kind-specific extra
  (`Target Doughball Weight (oz)` for dough, `Applicator Slot` for cheese), then
  an `Ingredient|Lbs` table. These are exactly the shapes the parse prompt
  recognizes. Kind is conveyed by the TAB NAME (not a "Kind:" row). Emit
  recipe-wide target metadata only when tied profiles agree; never export the
  first profile's value as if it applied to every target.
- **Mix workbook:** one tab per brand with vertical deterministic premix blocks:
  explicit `Product Brand`, `Product Flavor`, and `Is Prep` Yes/No rows, original
  mix name, optional `Pull N Days Early`, then `Ingredient | Per Pizza (oz) |
  Per Batch (lbs)` and a `Total | | <batchSize lbs>` row. Blank per-batch cells
  remain blank; do not synthesize values from the total.

Only case-insensitive records with identical data may be coalesced. Preserve
conflicting profile values, recipe formulas, repeated ingredient rows, and zero
rows. Shared recipes are expected to repeat on each applicable Cheese brand tab.

Emit recipe-wide dough metadata or applicator slots only when every tied profile
has the same value. Conflicting or incomplete metadata belongs on Specs rows,
not as a guessed recipe-wide default.

Mix `Per Pizza (oz)` and `Per Batch (lbs)` are separate source fields. Identical
raw numbers under different headings do not establish a shared unit basis.

## Data gathering (web glue)
Recipe/profile exports use fresh server-acknowledged profile and recipe-pool
reads, not a browser cache fallback. The selected Specs/Dough/Sauce/Cheese
workbooks in one export action share one gathered input. Profile-inline recipe
rows fill a missing or empty pool entry; a conflicting populated formula stays
visible as another same-name block.

**Why:** Cached browser state and last-write-wins name maps can emit stale data
or conceal same-key conflicts.

**How to apply:** Never choose a winning formula from row order or magnitude.
Keep profile references and recipe rows from the same fresh gathered input;
fail visibly if the server source is unavailable.

## Import compatibility and missing values

An absent `Is Prep` marker in an older workbook means “not represented”; when
updating a saved mix, preserve its existing prep classification. Explicit Yes/No
markers from new exports are authoritative. Prep mixes may have a zero batch
size or no brand/flavor assignment; those values alone do not make them invalid.

A blank per-batch component cell is unknown, not a deletion. When a reviewed
re-import matches the same ingredient and per-pizza amount, retain the saved
per-batch reference amount by row occurrence. Do not sum repeated rows.
Conflicting same-product-key mix blocks must not use last-write-wins; stop before
applying and identify the product key for source review.

**Why:** Older sheets omit newer metadata, and blank cells must not silently
erase server-saved data.

**How to apply:** Keep compatibility rules at the importer boundary and test
blank, explicit, zero, repeated-row, and conflicting cases.

## Known limitation
Web-only pep "B" applicator slots (`pep{1,2}TypeB` etc.) have no representation
in the AI spec-import format, so they are intentionally OMITTED from the export.
Not a regression — the importer can't read them back either.

## Testing
Keep deterministic real-XLSX write/read tests for both recipe/spec and Mixes
exports. Cover case-only duplicates, conflicting same-key records, shared
recipes, repeated and zero rows, sheet-name collisions, long targets, units,
prep markers, legacy missing markers, and save/reload of per-batch values.
Download failures must remain visible and must not fall back to stale data.

## Cheese/Mixes overlap classification

For the 36 names shared by the 2026-10-17 Cheese and Mixes outputs, the owner
states none belong in Cheese. The supplied 2026-10-08 Cheese source has 0/36
exact names and the Premix source has 10/36; current pool membership alone
still leaves one name in both pools.

**Why:** Raw ingredient/value sequences under `Lbs` and `Per Pizza` do not prove
recipe identity or unit equivalence, and a dual-pool name cannot be safely
resolved from spelling alone.

**How to apply:** Keep Mix links in Specs, exclude explicit Mix and Mix-only
links from Cheese targets, and leave dual-pool conflicts visible until the
current profile intent is confirmed. Never convert quantities or generalize
this owner decision to new names.

For the identified dual-pool profile, the owner confirmed App1 should retain its
existing Mix recipe and be typed as Mix, but explicitly declined any production
change. This resolves intent, not authorization.

**Why:** Category approval and permission to mutate production are separate;
the existing Cheese row also has historical references and no safe tombstone.

**How to apply:** Keep stored data untouched unless a safe writable path and
explicit approval are provided; do not hard-delete the historical Cheese row.

## Why this is web-only right now
Parity is PAUSED (`.local/parity-pause-log.md`). The lib is platform-agnostic;
mobile glue remains a separate change when parity resumes.
