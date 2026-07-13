---
name: Doughball weight on server dough pool
description: doughballWeightOz travels with the server dough recipe pool; import wins over blank, never clobbers a manager-typed positive weight.
---

# Doughball weight in the server dough pool

Doughball weight (oz) is now a first-class optional field on server dough recipes (`NamedRecipe.doughballWeightOz` in `@workspace/named-recipes`; additive DB column `doughball_weight_oz` double precision NOT NULL DEFAULT 0 — API emits the field only when > 0, normalize keeps only > 0).

Flow: spec import writes the weight into the dough preset → web push to server pool carries a `weightsByName` backfill map (`addNamedRecipesToServerIfAbsent` 4th param; `fillNamedRecipeDoughballWeights` helper) → other devices picking that dough from the pool hydrate `targetDoughballWeight` on the run form; a self-heal effect fills a 0-weight open form from the pool.

**Why:** before this, dough recipes hydrated from the server pool arrived with 0 oz doughball weight, silently breaking dough math on every device except the importer's.

**How to apply:**
- Backfill NEVER overrides an existing positive weight (manager-typed wins); it only fills unset/0. Keep that invariant in any new write path.
- The 0-sentinel in the DB means "unset" — treat 0 as absent everywhere (API mapping, normalize, form self-heal guard).
- Deferred: a full round-trip regression test (import → server save → fresh fetch → dough pick hydrates form) is not yet written; unit coverage exists in the named-recipes lib.
