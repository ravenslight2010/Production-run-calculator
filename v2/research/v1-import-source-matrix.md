# V1 source importer coverage in V2

Status: implemented deterministic, manager-reviewed adapters for the six
non-schedule V1 importer families. The importer reads a bounded file in memory;
it stores only the V2 target rows and a source-family, parser-version, and
SHA-256 summary. It does not retain the uploaded workbook or document.

This is not a general-purpose V1 importer. V2 uses the existing manager
setup-catalog preview, stage, Apply, history, retry, and guarded Undo lifecycle.
The six source adapters target the existing `mixes` or `run-templates` setup
families from the approved setup models. Run templates are review-only setup
records, not executable runs or live production defaults. The pre-existing V2
CSV import and dough/shipping capacity-workbook paths remain separate and
unchanged.

## Source-to-V2 matrix

| V1 family | Supported source and layout | V2 target and preserved meaning | Review-only / unsupported cases |
|---|---|---|---|
| Spec sheets | XLSX with a deterministic `Brand` + `Flavor` table. Recognized V1 profile columns include die type, dough and sauce recipe names, sauce oz/pizza, dough-ball weight, doughballs/tray, applicator type/oz per pizza, and pepperoni type/sticks/oz per pizza. | One `run-templates` setup record per explicit brand/flavor row. Numeric fields keep their source units. | Arbitrary V1 AI layouts and photos/OCR are not parsed or applied. Cheese applicator recipe columns and unknown populated columns are unresolved; formula cells, including cached formula results, are unresolved. Blank fields remain absent. |
| Premix sheets | XLSX with one or more side-by-side ingredient blocks. `Per Pizza`/`Per Batch` headings are supported, including the source typo `Pert Pizza`; the ingredient name is the preceding column. `Total` supplies batch pounds when present. Explicit `Pull N days early/prior` and `Is Prep: yes/no` values are recognized. | One `mixes` record per named block. Each ingredient retains per-pizza ounces and per-batch pounds independently. A blank quantity remains `null`; no unit conversion or ingredient-code inference is performed. | Brand, flavor, enabled, and prep state are not guessed; the manager must supply required booleans. Formula quantities, unreadable quantities, missing names, and duplicate identities require correction or explicit review-only disposition. A missing total or pull value stays unknown. |
| Cheese mix specs | XLSX brand tabs with assignment lines such as `All Varieties: Recipe`, side-by-side recipe blocks, `LBS` markers, and explicit `For 1st/2nd/3rd/4th Cheese Applicator` text. | One `run-templates` record per explicitly assigned brand/flavor profile. Recipe component amounts stay in batch pounds. Explicit slots map only to the corresponding V2 cheese recipe fields; separate slot blocks are combined into the same profile candidate. | There is no standalone V2 cheese-recipe catalog. A missing slot, non-exact assignment, slot conflict, formula/missing component, shredder setting, or cellulose-percent summary requires review. The manager must choose an explicit slot and may correct values from the transient parsed evidence. |
| Shipping guides | XLSX with a `PIZZA`/`PRODUCT`/`BRAND`, `BOX`/`SHIPPER`, and `PIZZAS/CS` header. Supported columns include circle, cases, grip sheets, and stacking. Recognized values follow the deterministic V1 mappings; `N/A` circles/grip sheets map to `none`, and `4 - 3PACK` maps to 12 pizzas/case. | One `run-templates` record per source product label. Supported packaging values retain their V2 text or numeric fields. | Dimensions, pallet type, film, pallet height, unknown values, formulas, and other populated columns stay unresolved. `X` grip-sheet notation is not mapped. Product labels are preserved as text, not linked to a product or brand by fuzzy matching. The existing capacity importer is not replaced. |
| Sauce guides | XLSX sentence rows or DOCX text paragraphs using `Brand uses Recipe on/for Flavor at N oz`, including explicit continuation clauses `and on/for Flavor at N oz`. `their recipe` maps to the stated brand as in V1. | One `run-templates` record per explicit brand/flavor assignment, with sauce recipe name and oz/pizza. `all`, `all varieties`, and `all other varieties` are represented as an empty flavor only when stated. | DOCX tables or unsupported paragraph layouts, non-positive or missing amounts, formulas, unknown sentences, and ambiguous flavor splits remain unresolved. Photos/OCR and guessed recipe links are not supported. |
| Dough guides | XLSX; only column A is read. Each supported row follows `Brand (flavors) = Dough Recipe`; nested parentheses and top-level comma-separated flavors are preserved. `(all)` is represented as an empty flavor. | One `run-templates` record per explicit brand/flavor mapping, preserving the source dough recipe name. | Other columns are ignored as in V1. Rows that look like malformed assignments, formulas, blanks, or duplicate targets remain unresolved or skipped; no fuzzy brand/flavor link is made. |

## Shared review, persistence, and recovery

- Preview is manager-only, CSRF-protected, bounded to 5 MiB input, 32 XLSX
  sheets, 2,000 source rows, and a 2 MiB JSON response. DOCX sauce text is
  bounded during ZIP expansion and XML extraction.
- Formula cells are detected before values are read. Both formula and cached
  values stay out of the candidate and appear as unresolved review items.
- The manager can edit the generated code/name/field JSON, include or exclude
  candidates, mark a mapping corrected, acknowledge a row as review-only, or
  mark it skipped. A cheese candidate cannot be staged without an explicit
  cheese slot. The ordinary strict V2 CSV parser validates every final target
  record before staging.
- History retains the source SHA-256 and parser version, source-row count,
  staged-record count, skipped count, unresolved count, and created/updated
  totals. It never stores the uploaded bytes or transient raw evidence.
- An uncertain stage response retries the same locally retained request ID,
  target CSV, and source summary. The API's request hash makes an exact replay
  idempotent and rejects reusing that ID with changed content. Applying a
  staged import is separately idempotent.
- Reimporting the same source identity uses the same generated V2 code and
  updates that target record; changed identities create separate records.
  Unmentioned V2 records are never deleted. Duplicate identities in one
  preview are unresolved instead of silently deduplicated.
- The existing guarded setup-catalog Undo is the only recovery guarantee.
  Undo restores the prior target snapshot when no later dependency or edit
  blocks it; it does not reverse unrelated edits or erase import history.
- Synthetic fixtures and disposable PostgreSQL tests are the evidence source.
  No customer workbook, photo, production row, V1 write, production database,
  or publish action is part of this implementation.

## Verification limits

The adapters deliberately support a bounded deterministic subset of V1 layouts.
They do not invoke AI, OCR, near-duplicate matching, or automatic source
application. Chromium and WebKit browser evidence, plus desktop/phone/tablet
layout coverage, is recorded by the task's disposable browser suite; it is not
physical Android/iOS evidence or a production-data validation.
