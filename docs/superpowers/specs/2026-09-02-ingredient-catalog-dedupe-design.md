# Ingredient catalog duplicate repair

## Problem

The ingredient catalog contains multiple enabled, unmerged rows with the same
normalized name. The write path now reuses an existing active name owner, but
older duplicate rows prevent Drizzle from creating the intended partial unique
index. The same schema drift also prevents the import-history idempotency route
from using its declared conflict target.

## Repair design

Add a marker-guarded, one-time server heal that groups enabled, unmerged
ingredients by scope and trimmed case-insensitive name. For each duplicate
group:

- Keep the oldest row as the canonical identity, using the ID as a stable
  tie-breaker.
- Union every category into the canonical row.
- Soft-merge each duplicate by setting `mergedInto` to the canonical ID and
  disabling it.
- Retain every row so historical recipe and inventory references continue to
  resolve through the existing merge-chain logic.

The existing ingredient save route already prevents normal repeat imports from
creating another active same-name identity.

## Rollout

Production schema diffs run before the new server starts, so the partial
ingredient-name unique index cannot be created in the same publish that first
runs the heal. Use two bounded stages:

1. Ship and verify the heal while leaving the partial ingredient-name index out
   of the declared schema. Apply the independent import-history idempotency
   index.
2. After the live heal marker and zero-duplicate predicate are verified, restore
   the partial ingredient-name unique index and publish the schema protection.

No direct production mutation or startup-time DDL is used.

## Verification

- Pure tests cover canonical selection, category union, scope isolation,
  disabled/merged exclusions, and stable tie-breaking.
- Development restart records the one-time marker and leaves zero active
  normalized-name duplicate groups.
- A second restart makes no additional changes.
- `push-force` succeeds and creates the import-history idempotency index.
- Full revision-bound release evidence passes before either publish decision.
