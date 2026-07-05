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

**Fixed:** brand merges now re-point cheese recipes via a pure helper
(`repointCheeseRecipesForBrandMerge` in `@workspace/cheese-recipes`), wired into
the web + mobile brand-merge apply paths (best-effort, upsert only changed rows,
refresh the `["cheeseRecipes"]` query). Web+mobile parity.

**Still latent (not yet handled):**
- **Flavor** merges → cheese recipes' `flavors[]` (recipe stays under the right
  brand, so far less visible — the reported bug was brand-level).
- **Mixes** are also brand+flavor-keyed server master-data with the identical
  gap for both brand and flavor merges.

**Why:** the merge path was designed as a "soft" re-point of local state; nobody
extended it to the newer server-backed pools. Any future server-backed pool that
keys on brand/flavor must be added to the merge re-point, or it silently drifts.
