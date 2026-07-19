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

**Recipe-NAME merges must carry data:** merging recipes inside the four
server-backed pools (cheese/mixes/dough/sauce) deletes the source rows — so the
apply path must BACKFILL the target from the sources first (blank-fill-only,
target's real data never clobbered) via `backfill*FromMergedSources` in each
lib, save the enriched target, THEN delete sources. Component rows match by a
loose key (lowercase, apostrophes stripped, tokens plural-folded + sorted, so
"Pepperoni, Diced" == "Diced Pepperoni"). Without this, merging a real recipe
into a spec-import stub silently lost the real batch data (SMD incident; healed
by `smd-pep-cheese-mix-restore-v1`).

**Importers resurrect merged/renamed names unless the alias is learned in the
SPEC-IMPORT alias store:** the merge suggester's MergeAlias store is separate
from the `SpecImportAlias` store the importers (spec, premix, cheese) actually
canonicalize through. Every brand/flavor merge AND rename must also call
`learnSpecImportAliasesForNameChange` (web `specImportAliases.ts`) or the next
re-import brings the old name back. Three extra holes fixed together:
- renames (unlike merges) never re-pointed the server cheese/mix pools — they
  now call the same repoint helpers, fire-and-forget;
- cheese import took the brand verbatim from the sheet tab → now remapped via
  `remapCheeseRecipeBrands` (recomputes `cheeseImportId`; sheet.brand TEXT is
  kept for brand-prefix stripping);
- spec-import saved-parse REUSE skipped alias canonicalization entirely and the
  tombstone partition then silently DROPPED renamed-brand profiles → reuse now
  remaps aliases BEFORE `partitionTombstonedParse`.
**Recipe-NAME changes learn aliases too (not just brand/flavor):** every
recipe-name change path — the four merge tabs, the local list renames, and
inline pool-row renames in the Mixes/Cheese/Dough/Sauce managers — must call
`learnRecipeNameChangeAliases` (web `specImportAliases.ts`). Kind mapping the
importers actually consult: mixes/cheese → "appType" (context-free row +
brand-scoped row when the survivor's brand is known); dough/sauce →
"recipeName" with the kind in `context`. The builder also RE-POINTS existing
aliases whose canonical was a merged-away source, or the chain gets dropped
wholesale by the sanitizer on the next import. Stale-reference Remove learns
nothing on purpose (no survivor to point at). Inline manager renames skip
fresh-row placeholder names ("New … Recipe") so naming a new row never mints a
bogus alias.

**How to apply:** any new name-change path (merge, rename, dedupe) must learn
spec-import aliases + re-point server pools; any new import path must ground
brand/flavor through the spec-import alias store before dedupe/tombstone logic.

**Why:** the merge path was designed as a "soft" re-point of local state; nobody
extended it to the newer server-backed pools. Any future server-backed pool that
keys on brand/flavor must be added to the merge re-point, or it silently drifts.
