---
name: Merges don't cascade to server master-data
description: Brand/flavor merges only touch local lists + today's runs + tombstones; server-backed brand-keyed master-data must be re-pointed explicitly.
---

Brand/flavor merges rewrite only LOCAL day-state: the brands/brandFlavors lists,
today's runs, and merged-away tombstones (all in the synced blob). They do NOT
touch server-backed master-data that carries its own `brand`/`flavor` fields —
those live in their own tables outside day-state sync (e.g. `cheese_recipes`,
mixes). So after a merge they keep naming the merged-away brand and show under
the old heading.

**Fixed (both brand AND flavor, cheese AND mixes):** the merge apply path now
re-points both server-backed pools through pure helpers, best-effort, upserting
only the changed rows and refreshing the pool's query:
- `repointCheeseRecipesForBrandMerge` / `repointCheeseRecipesForFlavorMerge`
  (`@workspace/cheese-recipes`) → refresh `["cheeseRecipes"]`.
- `repointMixesForBrandMerge` / `repointMixesForFlavorMerge`
  (`@workspace/mixes`) → refresh `["mixes"]`.
Flavor merges are per-brand, so the flavor helpers take the brand and only touch
same-brand rows. Cheese recipes with an empty `flavors[]` ("All Varieties")
already cover every flavor and are left untouched. Web (`home.tsx`
`handleApplyBrandFlavorMerge`) + mobile (`master-data.tsx`
`repointServerMasterDataForMerge`, called from both apply + applySuggestion).
Web+mobile parity.

**Gotcha:** the repoint helpers drop any source equal to the target
case-insensitively (no-op). So a "merge" whose source already matches the target
spelling correctly produces zero changes — this is right, not a bug.

**Why:** the merge path was designed as a "soft" re-point of local state; nobody
extended it to the newer server-backed pools. Any future server-backed pool that
keys on brand/flavor must be added to the merge re-point, or it silently drifts.
