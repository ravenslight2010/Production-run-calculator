# V2 station calculations: workbook-backed examples

## Scope and source handling

The owner identified the V1 workbook set as the approved source and approved using
only a planned case count from the archived schedule. The schedule contributes
only the numeric value at `3-17!E8` (55); customer, product-row, shipping, and PO
fields are not copied into the regression fixture. The V1 schedule importer maps
the `Units` column to planned cases.

The explicit Cheese calculation is a non-production worked example marked
`Example` in its workbook. The 55-case cross-station scenario uses the approved
count-only schedule value with setup values from the matching source workbooks.
It is an archived schedule example, not a synthetic run or a live production
database record. No production database was queried.

Tests pin SHA-256 fingerprints for the source workbooks. If a workbook changes,
the source cells and expected results must be reviewed before updating the pins.

## Evidence and expected results

| Station/example | Approved source and native units | V2 input / expected result |
| --- | --- | --- |
| Cheese worked example | `attached_assets/source-library/cheese/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_07.10.26_1784339826076.xlsx`, `Edwardo!A21:A25`: 1,092 cases, 12 pizzas/case, 0.01 oz/pizza, total 8.19 lb. `Edwardo!B29:B30`: 5.000 lb + 1.250 lb = 6.25 lb/batch. | 8.19 lb required; 2 batches. The workbook separately rounds component amounts to 6.6 lb and 1.6 lb (8.2 lb combined); the station total follows its explicit 8.19 lb figure. |
| Line and case target | `attached_assets/source-library/schedule/Production_Schedule_7-8-26_1784339875921.xlsx`, `3-17!E8`: 55 planned units/cases. Only the count is used. `_archived/v1/artifacts/run-calculator/src/utils/runExcel.ts` confirms V1 maps `Units` to planned cases. | At run start: target 55, remaining 55, work in progress 0, completion 0%. |
| Shipping units | `attached_assets/source-library/shipping/Shipping_and_Palletizing_Guide_07.02.2026_1784339849858.xlsx`, `Sheet1!E3`: 12 pizzas/case; `F3`: 60 cases/skid. | 55 cases require 1 skid. |
| Cheese / Frontline recipe | `attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx`, `OZ!B24`: 2.90 oz/pizza. `attached_assets/source-library/cheese/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_07.10.26_1784339826076.xlsx`, `Aldo!B13:B17`: 20.000 + 35.000 + 0.300 + 0.300 = 55.600 lb/batch. | Cheese: 119.63 lb, 3 batches. Frontline: the V2 +20 lb allowance yields 139.63 lb; with 20 lb on line and 10 lb consumed (test-state values, not workbook facts), 2 batches remain to make. |
| Pepperoni | `attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx`, `OZ!C25`: 1.90 oz/pizza. No positive pepperoni batch weight is supplied by the cited workbooks. | 78.38 lb; batch count remains unknown (`null`) rather than inventing a recipe size. |
| Sauce | `attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx`, `OZ!B23`: 4.00 oz/pizza. `attached_assets/source-library/sauce/Aldo_Pizza_Sauce_02_1784339518984.xlsx`, `Sheet1!C19`: 271.50 lb recipe batch. | V2 adds its 30 lb preparation allowance: 195 lb total; 0.72 estimated barrels; 1 full barrel remains to make when none are made. |
| Dough | `attached_assets/source-library/dough/Aldo's_Dough_Mixing_Procedure_-_09_1784339683714.xlsx`, `Sheet1!D11`: 310.50 lb/batch; `C32`: 7.7 oz/doughball; `E32`: 645.19 doughballs/batch; `F32`: 24 doughballs/tray. | The yield formula gives 645.19 doughballs/batch. At 12 pizzas/case, the approved fractional capacity is 53.7658 cases/batch. For 55 cases, V2 needs 2 batches. |
| Packaging remainder | Shipping guide `Sheet1!F3`: 60 cases/skid; the count-only target is 55 cases. | 1 skid needed, none complete, 0 cases on the current skid before packing. Boundary checks cover 59, 60, and 61 packed cases. |

## Boundary checks

- Dough with the approved 53.7658 cases/batch: 53 cases needs 1 batch; 54 and
  107 need 2 batches; 108 needs 3.
- Sauce at 80 and 81 cases produces 0.99 and 1.01 estimated barrels, requiring
  1 and 2 full barrels respectively.
- Frontline supply immediately below and at the 139.63 lb requirement changes
  batches-to-make from 1 to 0.
- Packaging changes from 59 cases on the current skid to a completed skid at 60,
  then 1 case on the next skid at 61.
- Line completion remains capped at 100%, with remaining cases floored at zero.
- The supplied Pepperoni specification supports pounds but not a recipe batch
  count; synthetic tests continue to cover the positive-batch-weight path.

## Approved dough rule and remaining owner review

On 2026-11-16, the owner approved preserving the fractional dough yield. V2
uses 53.7658 cases per batch (645.19 doughballs / 12 pizzas per case, rounded
to four decimal places) and calculates batches as
`ceil(targetCases / casesPerBatch)`. This yields 1 batch for 53 cases, 2 for
54 and 107, and 3 for 108. The approved recipe yield and case size are
unchanged; V2 accepts four decimal places for this capacity.

The following separate source-mapping questions remain open:

1. V1's applicator-1 math adds 20 lb and reports fractional batches. V2 exposes
   that 20 lb in Frontline, rounds pounds to hundredths, and reports whole batches.
   The test uses source-backed applicator rate/recipe values but synthetic
   on-line/consumed progress. Confirm that this station mapping and whole-batch
   behavior are intended.
2. V1 Sauce math adds 30 lb and uses cases per layer; V2 matches the 30 lb
   allowance but has no cases-per-layer input. The comparison uses the planned
   case target without a layer buffer. Confirm whether V2 intentionally omits
   that V1 buffer.
3. The Pepperoni sheet gives 1.90 oz/pizza, but its notation does not establish a
   separate batch weight or an unambiguous stick allowance. V2 reports pounds
   and leaves batches unknown until an approved batch size is supplied.
