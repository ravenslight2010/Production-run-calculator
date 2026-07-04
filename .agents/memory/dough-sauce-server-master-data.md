---
name: Dough/Sauce server master-data
description: Dough & Sauce recipes are now server-backed factory-wide pools (like Cheese/Mixes), not just local presets.
---

Dough and Sauce recipes follow the same server-master-data pattern as Cheese
(`cheese-server-master-data.md`): shared model in `@workspace/named-recipes`,
own DB tables `dough_recipes` / `sauce_recipes` (id+scope composite unique,
additive push-force), OpenAPI `/dough-recipes` + `/sauce-recipes` (GET
requireAuth, POST/DELETE `requireCapability("manage-inventory")`), query keys
`["doughRecipes"]` / `["sauceRecipes"]`. Managed under Manage Lists as flat
name-keyed lists (no brand grouping). Run applicator pickers offer the
server names unioned with legacy local presets, preferring server rows and
falling back to local.

**Why:** dough/sauce used to be local-only presets, so recipes one manager
built never reached other devices; server-backing makes them factory-wide like
Cheese/Mixes.

**How to apply / gotchas:**
- Note "Sauce Recipe" in the UI == the internal "frontline" recipe system
  (`frontline-is-sauce.md`); mobile sauce presets live in
  `state.frontlineRecipePresets`, dough in `state.doughRecipePresets`, both
  `Record<name, RecipeRow[]>` (flat arrays, NOT `{rows}` like web dough).
- `namedRecipeFromDraft({name, components, idPrefix})` returns `NamedRecipe | null`;
  always `.filter((r): r is NamedRecipe => r !== null)` after mapping.
- One-time migration pushes pre-existing local presets to the server once
  (marker `run-calc-dough-sauce-server-migrated-v1`, manager-only, re-arms on
  failure). Web runs it in home.tsx via `pushLocalDoughSauceToServer` (reads
  localStorage — synchronous). Mobile runs it in a `master-data.tsx` effect
  because RunContext has no react-query/useMe.
- Spec-import: web calls `pushLocalDoughSauceToServer()` after `store.apply`
  (local is synchronous). Mobile's `store.apply`/`applySpecImport` is async
  React state, so mobile instead collects dough/sauce from
  `prepared.parsed.recipes` filtered by `kind` inside `commitSpecImport`
  (mirrors the cheese block). End state is equivalent; migration covers legacy
  locals. This platform divergence is intentional — do not "fix" mobile to read
  local presets right after apply (they aren't written yet).
- The dev DB tables must be pushed (`db push-force`) and BOTH api-server
  workflows restarted after adding the routes, or clients get 404
  (`dual-api-workflows.md`).
