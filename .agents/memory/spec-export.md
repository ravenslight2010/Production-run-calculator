---
name: Excel spec/recipe/mix export
description: How the in-app Excel EXPORTER of spec profiles + recipes + mixes is built to round-trip back through the existing importers.
---

# Excel export for spec sheets, recipes & mixes

The exporter is the mirror image of the two IMPORTERS and must round-trip
through them (export → edit in Excel → re-import, no data loss/misparse). Sheet
layout logic is pure and shared (`@workspace/spec-export`); apps keep only glue.

## Two separate workbooks — never combine
The spec/recipe importer is AI-based; the premix (mixes) importer is
deterministic and scans for a "Per Pizza" anchor. Emitting mix tabs into the
spec workbook (or recipe tabs into the mixes workbook) would cross-parse. So
export is TWO files: `spec-recipes-*.xlsx` (→ "Import Spec Sheet") and
`mixes-*.xlsx` (→ "Import Premix Sheet"). Both selected ⇒ two downloads.

## Layout that the importers re-read
- **Profiles tab:** one header row + one row per brand+flavor with die type,
  sauce oz/pizza, 4 applicator slots (type + oz/pizza), 2 pep slots (type +
  sticks + oz/pizza).
- **Recipe tabs (Dough/Sauce/Cheese):** per-recipe block = `Recipe: <name>`,
  then one `Brand: flavor, flavor` row per brand that USES the recipe (derived
  from profile recipe-name references, so re-import re-attaches it without
  duplicating the library entry), then the kind-specific extra
  (`Target Doughball Weight (oz)` for dough, `Applicator Slot` for cheese), then
  an `Ingredient|Lbs` table. These are exactly the shapes the parse prompt
  recognizes. Kind is conveyed by the TAB NAME (not a "Kind:" row — that risks
  being misread as a brand).
- **Mix tabs:** deterministic premix format — name row, optional
  `Pull N Days Early`, then `Ingredient | Per Pizza | Per Batch` (Per Batch left
  blank; importer uses Per Pizza), then a `Total | | <batchSize>` row. TAB name
  is the product (`Brand Flavor`) so the importer's name→brand/flavor grounding
  recovers the product AND reconstructs the SAME deterministic mix id
  (update-not-duplicate on re-import).

## Data gathering (web glue)
Recipe rows come from the shared recipe libraries (`load*RecipePresets`); for any
recipe name a profile references but that is missing from its library, fall back
to the profile's inline recipe rows so nothing is dropped.

## Known limitation
Web-only pep "B" applicator slots (`pep{1,2}TypeB` etc.) have no representation
in the AI spec-import format, so they are intentionally OMITTED from the export.
Not a regression — the importer can't read them back either.

## Testing
The mix round-trip is deterministic and unit-tested end-to-end
(buildMixExportGrids → parsePremixWorkbook → groundPremix → premixToMix). The
spec/recipe workbook can't be unit-tested against the AI, so only grid structure
is asserted; correctness relies on matching the parse prompt's recognized shapes.

## Why this is web-only right now
Parity is PAUSED (`.local/parity-pause-log.md`). The lib is platform-agnostic;
mobile needs only a glue module + the checkbox UI when parity resumes.
