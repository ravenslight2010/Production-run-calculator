---
name: Doughball weight + per-tray on server dough pool
description: doughballWeightOz AND doughballsPerTray travel with the server dough recipe pool; import wins over blank, never clobbers a manager-typed positive value.
---

# Doughball weight in the server dough pool

Doughball weight (oz) is now a first-class optional field on server dough recipes (`NamedRecipe.doughballWeightOz` in `@workspace/named-recipes`; additive DB column `doughball_weight_oz` double precision NOT NULL DEFAULT 0 — API emits the field only when > 0, normalize keeps only > 0).

Flow: spec import writes the weight into the dough preset → web push to server pool carries a `weightsByName` backfill map (`addNamedRecipesToServerIfAbsent` 4th param; `fillNamedRecipeDoughballWeights` helper) → other devices picking that dough from the pool hydrate `targetDoughballWeight` on the run form; a self-heal effect fills a 0-weight open form from the pool.

**Why:** before this, dough recipes hydrated from the server pool arrived with 0 oz doughball weight, silently breaking dough math on every device except the importer's.

**How to apply:**
- Backfill NEVER overrides an existing positive weight (manager-typed wins); it only fills unset/0. Keep that invariant in any new write path.
- The 0-sentinel in the DB means "unset" — treat 0 as absent everywhere (API mapping, normalize, form self-heal guard).
- Deferred: a full round-trip regression test (import → server save → fresh fetch → dough pick hydrates form) is not yet written; unit coverage exists in the named-recipes lib.

**Weight/per-tray are PER-FLAVOR values, pool copy is backfill-only.** One dough recipe per family (see dough-family-collapse) serves many flavors with DIFFERENT weights/per-tray, so EVERY pool→profile/form fan-out (refreshProfilesFromNamedRecipes, applyNamedPoolChange, dough pick, drift check, promote) fills only blank fields — never overwrites. In applySpecImport's tie loop, only a recipe's own EXPLICIT spec targets take its weight/tray verbatim; NAME-relinked profiles (the `nameRelinked` set) get backfill-only, or multiple same-named collapsed family variants let the last variant clobber all flavors. Drift check is rows-only (weight/tray differing from pool is normal).

**doughballsPerTray mirrors this exactly** (int > 0, `doughballs_per_tray` col, `fillNamedRecipeDoughballsPerTray`, `traysByName` 5th param, `tags.doughTrays` on the push path). Backfill order is sequential tags → weights → trays with family-guard remap; any NEW per-recipe scalar added to the pool must follow the same pattern at ALL the weight call sites (pick hydration, pool-change snapshot fan-out, drift check, promote, self-heal, phantom-name heal, spec-import commit + applySpecImport hydration) — miss one and devices drift.
