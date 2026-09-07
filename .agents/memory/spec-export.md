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
  explicit `Product Brand` and `Product Flavor` rows, original mix name, optional
  `Pull N Days Early`, then `Ingredient | Per Pizza | Per Batch` (Per Batch left
  blank; importer uses Per Pizza), then a `Total | | <batchSize>` row. Markers
  are authoritative even when blank (`Unassigned`); legacy workbooks still use
  tab/name inference.

## Data gathering (web glue)
Recipe rows come from the shared recipe libraries (`load*RecipePresets`); for any
recipe name a profile references but that is missing from its library, fall back
to the profile's inline recipe rows so nothing is dropped.

## Known limitation
Web-only pep "B" applicator slots (`pep{1,2}TypeB` etc.) have no representation
in the AI spec-import format, so they are intentionally OMITTED from the export.
Not a regression — the importer can't read them back either.

## Testing
The mix round-trip is deterministic and unit-tested end-to-end. Spec/recipe
workbooks are verified as semantic grids and through real XLSX write/read.
Production writer coverage must prove styling does not change cell values, and
download orchestration must prove one failed file does not stop later files.

## Why this is web-only right now
Parity is PAUSED (`.local/parity-pause-log.md`). The lib is platform-agnostic;
mobile needs only a glue module + the checkbox UI when parity resumes.
