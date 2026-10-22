# Optional import templates

In **Manage Lists → Import**, expand **Optional blank import templates** before
choosing a source file. Formats are shown only for importers the current user can
use. Each download is a new `.xlsx` workbook with supported headers or native
guide sentences and one fictional example. Replace the example, its date, names,
and amounts; add your own records before importing. It is not factory data.

Downloads are generated locally using the existing workbook export utilities.
No upload, retained source, import history, automatic Apply, QC decision, or Gold
Lab operation occurs. The workbook graph loads only when a download is requested.
A failed download offers retry without preventing normal file import.

## Format and unit contract

| Download | Represents | How to fill it |
| --- | --- | --- |
| Pizza spec | Existing deterministic exported spec table, one product per row | Keep Brand, Flavor, Die Type, recipe-name and slot headers. Sauce/applicator/pepperoni amounts are **oz per pizza**; target doughball weight is **oz per ball**; tray values are counts. Ingredient batch recipes are not encoded in these per-pizza fields. |
| Premix | Existing exported premix recipe block | Keep Product Brand, Product Flavor, recipe name, Is Prep, and Ingredient / Per Pizza (oz) / Per Batch (lbs). **Per-pizza oz and batch lbs are independent supplied values**, not interchangeable units. Total is batch lbs. |
| Cheese recipe | Existing exported cheese recipe block | Recipe name, brand/flavor link, applicator slot and Ingredient / Lbs. Weights are **lbs per batch**, never oz per pizza. |
| Shipping guide | Recognized packaging table | Brand, Box, Circle, Pizzas Per Case, Cases Per Skid, Grip Sheets, Stacking. Counts are whole numbers. Example `12"` maps to 12-inch packaging, `N/A` to no grip sheets, `Column` to column stacking. Unsupported packaging strings still require review and are not guessed. |
| Sauce guide | Product-to-sauce mapping guide, not a sauce batch recipe | One sentence per row: `Example Customer uses Example Sauce for Example Pizza at 3.5oz`. Amount is **oz per pizza**. This workbook uses the same deterministic sentence parser as the existing Word guide; `.docx` remains supported. Use spec recipe import for ingredient batch formulas. |
| Dough guide | Existing Pizza-to-Dough mapping guide, not a dough batch recipe | One sentence per row: `Example Customer (Example Pizza) = Example Dough`. `(all)` is supported by the existing parser. No ingredient weights are implied. |
| Production schedule | Existing dated day-block planner format | Put an **ISO date (YYYY-MM-DD)** in the first header cell, beside Brand, Flavor and Cases Planned; product rows go underneath. Repeat the dated header for other days or worksheets. Cases are counts. The date is deliberately in the day header, not an ignored date column in a flat run table. |

Examples use English recognized headers, dot-decimal weight values, and ISO
dates to avoid ambiguous localized dates or decimal separators. Numeric cells and
ordinary Excel-edited text cells pass through the existing workbook readers.
These templates do not introduce a new universal locale or customer-layout
contract.

## Optional, not a format gate

Existing multi-sheet/customer/procedure layouts still use their existing parsers
and review/fallback. Shared preflight does not require template matching: an
unrecognized layout receives review guidance, not a missing-template error.
Blank amounts remain unknown and reviewable; malformed amounts in recognized
canonical tables remain errors. No conversion from batch pounds to per-pizza
ounces is inferred. Formula/source-evidence safeguards are unchanged.

The historical proposed server endpoint is not needed: the client uses the shared
export builders and preflight directly, without an extra API or file retention.

## Agent-owned execution

Objective/owner: the assigned implementation agent owns all seven downloads,
their preparation paths, optional UI, and deterministic regression fixtures.
Evidence is repository-local synthetic workbooks; no customer collection or
production access is needed. User-controlled decisions/permissions: none expected.
Mixed-workbook batch review is separate existing work; no changes to its ownership.

Input/layout inventory: all seven supported formats above; exported product and
recipe tables, shipping tables, native guide sentences, and dated planner blocks.
Fixtures cover serialized XLSX, independent native units, blank/invalid amounts,
unfamiliar layouts, missing/empty/mislabeled guide input, capability filtering,
download failure/retry, and prepare-without-Apply. Repeated recipe sections and
dated day sections on the same sheet are prepared through the actual import
paths; reordered later columns and sections beyond row 30 retain their own
numeric validation. Existing DOCX is retained.
CSV, legacy XLS, customer-specific locales, arbitrary source procedures and
multi-file lifecycle behavior retain existing support, not new template variants.
This is a bounded inventory, not an exhaustive claim about customer workbooks.

## Applicable safeguards and verification

Apply task-execution rules, spec-import guard and verify-before-commit.
No auth, schema, sync, stored-data heal, source-retention or provider changes.
Focused tests serialize and re-read every generated workbook through deterministic
parsers and shared preflight. UI tests cover all seven buttons, capability
filtering, explicit button types, failure and retry. Preparation tests exercise the
actual sauce/dough workbook reader and verify no profile writes.

Compatibility applicability: desktop, phone and tablet portrait/landscape use the
same wrapping two-column/one-column controls with 44-pixel minimum button height.
Chromium/Chrome and WebKit/Safari use the existing XLSX download utility.
DOM unit tests are not browser-engine or physical-device evidence. Physical
Android Chrome and iOS Safari/PWA download handling is not run here; no native
mobile application is involved.

Failure ledger: initial synthetic fixtures omitted required exporter model fields
and asserted names from the stored model instead of parser contracts; corrected.
The first schedule fixture used a flat Date column that the flat importer ignores;
replaced by the existing dated day-block contract, avoiding a parser behavior change.
The exported premix `Per Pizza (oz)` header was not recognized by preflight;
added that exact normalized signature with regression coverage, preserving unknown
layout review. All discovered safely actionable issues remain in this outcome.
Completion checking then found that preflight treated repeated recipe and dated
schedule headers as numeric records. Preflight now recognizes each later section,
ends formula blocks at totals/metadata, and resumes with the next header's column
positions. Added two-block serialized preparation fixtures and negative/blank
amount checks in later sections; these are not silently skipped.

Corpus verification initially rejected its evaluator fingerprint because the
shared preflight source changed. Regenerated snapshots with the pinned runtime;
only the evaluator hash changed, not any retained-source parse result.
The first local preview could not probe a staff session because its API workflow
was stopped. Starting the existing API restored the normal signed-out page;
no authentication behavior was changed.

Verification results:
- **PASS:** 51 focused client tests across template generation, download controls,
  actual guide/premix/schedule preparation, existing guide confirmation and
  workbook styling.
- **PASS:** 387 shared spec-import tests; 12 retained-source corpus tests.
- **PASS:** root `CI=true pnpm run typecheck`, including library declarations,
  generated-contract checks and API/web checks.
- **PASS:** library and calculator typechecks after the repeated-section fix.
- **PASS:** existing web/API workflows start; signed-out entry page renders.
- **NOT RUN:** authenticated import-panel screenshots, browser-engine download
  matrices and physical-device checks. Download interactions are covered by DOM
  tests, and output bytes by XLSX round-trip fixtures; this does not claim actual
  browser save-dialog or device behavior. No critical write flow was changed.

Production logs surfaced alongside local logs showed database-dependency delays
outside this local download change; a later readiness sample reported all checks
OK. This is not production incident closure or release proof. No production
queries, fixes or publication were performed; deployed-runtime follow-through
remains with the existing operational readiness/recovery work and its owner.
