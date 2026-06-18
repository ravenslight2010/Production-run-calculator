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
- Mergeable universe excludes brands, flavors, and die types (sizes) — they are not
  ingredients.

**Why:** the whole point of the feature is a clean rewrite with no orphaned references
and no inventory drift; silently swallowing an inventory read failure reintroduces drift.

## Parity note
Mobile has NO separate `ingredientTypes`/`mixIngredients` master lists (web does). The
mobile merge universe is pepTypes + cheese + dough + frontline ingredients. This is an
intentional asymmetry from the underlying data model, not a parity bug.
