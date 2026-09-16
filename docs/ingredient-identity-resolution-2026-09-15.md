# Ingredient identity resolution — 2026-09-15

## Decision

An inventory owner approved these canonical production-ingredient labels on
2026-09-15:

- `Diced Chicken (C&F - 001MPDC40 or House of Raeford - 28501)`
- `Bacon (C&F 001ANUB40 or Tri Meats TM3514U)`
- `IQF Cilantro`
- `Goat Cheese`

The approval applies to duplicate production-ingredient catalog identities. It
does not combine warehouse products, lots, barcodes, unit conversions, balances,
or ledger history.

Spinach remains unresolved. `Spinach`, `Fresh Spinach (broken up)`, and the
fresh/chopped source variants stay separate because the retained workbooks do
not establish that every variant is the same warehouse product.

## Evidence and scope

- **Environment:** production, live data scope (read-only)
- **Captured:** 2026-09-15
- **Code revision inspected:** `840c149d`
- **Data class:** minimized production operational metadata
- **Sources:** retained source-library reconciliation dated 2026-08-26,
  its post-correction production snapshot, and bounded read-only production
  queries against ingredient, alias, inventory, recipe, repair-marker, and
  master-data-health tables
- **Sanitization:** no credentials, user records, request bodies, complete
  recipes, lot numbers, barcodes, or ledger entries were retained

The retained snapshot showed three active same-name catalog rows for each
approved label after repeated source reconciliation. The current production
query shows that condition has already been repaired:

| Canonical label | Current active roots | Retained merged predecessors |
|---|---:|---:|
| Diced Chicken (C&F - 001MPDC40 or House of Raeford - 28501) | 1 | 2 |
| Bacon (C&F 001ANUB40 or Tri Meats TM3514U) | 1 | 2 |
| IQF Cilantro | 1 | 2 |
| Goat Cheese | 1 | 2 |

Each predecessor points directly to the one active root. Category coverage on
the surviving rows is the union of the duplicate rows.

## Import retention

The deployed ingredient write path serializes catalog writes within a scope and
reuses the active owner of an exact normalized name instead of inserting a new
identity. The released exact-name duplicate repair marker is present in
production and reports that it completed.

Existing learned aliases retain source-supported retired spellings, including:

- `Cilantro, IQF` → `IQF Cilantro` in all three ingredient namespaces
- the approved SKU-order variants of the canonical Bacon label
- the approved SKU-order variant of the canonical Diced Chicken label

No self-alias is needed for Goat Cheese because repeated imports use the exact
canonical name and are handled by the serialized name-owner write path.

## Reference and inventory verification

Recipe components that use catalog IDs continue to resolve through retained
`mergedInto` pointers. Legacy name-only recipe rows already use canonical
labels for the approved Bacon, Cilantro, and Goat Cheese identities in the
bounded production check. No recipe reference was deleted.

Production currently contains no live `inventory_items`, `inventory_lots`, or
`inventory_ledger` rows. Therefore this resolution changed no physical
inventory records or totals, and there were no product links to repoint. This
is an explicit coverage fact, not evidence that future distinct products may
be combined.

The latest completed production master-data health scan (2026-09-12) reports
zero ingredient findings. No new production mutation or data heal was run for
this review because the approved state is already present; another heal would
add risk without changing the result.

## Result

- Four approved identities each resolve to one active production ingredient.
- Retained predecessor IDs preserve historical recipe resolution.
- Existing import guards and learned aliases prevent recreation through the
  reviewed paths.
- Spinach and other ambiguous variants remain separate.
- No warehouse product, lot, barcode, conversion, balance, or ledger history
  was merged or modified.

## Remaining uncertainty

The latest health scan predates this review by three days, but the direct
read-only ingredient query is current as of 2026-09-15. Inventory separation
can only be re-verified against real product links after inventory items exist.