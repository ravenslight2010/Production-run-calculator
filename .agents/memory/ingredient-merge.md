---
name: Ingredient merge feature
description: How the user-driven "merge similar ingredients" works across web+mobile+server, and its safety invariants.
---

# Ingredient merge (web + mobile + server)

User picks one or more SOURCE ingredient names + a TARGET to keep; every reference is
rewritten to the target across all surfaces, lists are deduped, and inventory stock is
folded into the target.

## Shape
- Pure helpers mirrored verbatim: `run-calculator/src/mergeIngredients.ts` and
  `run-calculator-mobile/context/mergeIngredients.ts`. Keep them identical.
- Server: `POST /inventory/merge` (openapi operationId `mergeInventory`). Re-points
  lots+ledger itemId to the target BEFORE deleting the source row, writes a zero-delta
  "adjust" ledger note, then broadcasts.
- Web apply: `storage.applyIngredientMerge(map)` rewrites every localStorage surface;
  `home.tsx` Merge tab → `handleApplyMerge`.
- Mobile apply: `RunContext.mergeIngredients(sources,target)`; UI `MergeManager` in
  `app/master-data.tsx`.

## Invariants (do not regress)
- **Inventory-first-or-abort.** Read+fold inventory on the server BEFORE rewriting any
  local data. If `fetchInventory()` throws OR `mergeInventory()` throws, abort with a
  user-facing error and leave local data untouched — otherwise the two stores drift.
  (Web returns early; mobile `mergeIngredients` throws and the UI catches it.)
- **Recipe rows are renamed, never combined.** A recipe that referenced two now-merged
  names keeps both rows so its total weight is preserved exactly.
- **dieType IS in scope.** The spec ("die type selections") requires the `dieType`
  field to be rewritten, so `dieType` is in `MERGE_NAME_FIELDS` and `dieTypes` is part
  of the mergeable universe + deduped list rewrite. Only brands and flavors are
  excluded (they have their own rename path), NOT die types.
- **Similarity-first picker.** The source/target picker must surface closest matches
  first using the shared `scoreNameMatch` helper, not alphabetical. Rank by max
  similarity to any selected source (or the typed target); fall back to alphabetical
  when nothing is selected.

**Why:** the whole point of the feature is a clean rewrite with no orphaned references
and no inventory drift; silently swallowing an inventory read failure reintroduces drift.
An earlier pass wrongly excluded dieType and used alphabetical ordering — code review
rejected both as core spec requirements.

## Parity note
Mobile has NO separate `ingredientTypes`/`mixIngredients` master lists (web does). The
mobile merge universe is pepTypes + cheese + dough + frontline + dieTypes. This is an
intentional asymmetry from the underlying data model, not a parity bug.
