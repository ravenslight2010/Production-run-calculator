---
name: Cheese recipes = server master-data (like Mixes, NOT in Mixes)
description: Cheese moved from local synced day-state presets to a server-backed factory-wide pool; applicator cheese cards are pick-only; deliberately separate from Mixes.
---

Cheese recipes are a factory-wide, server-backed master-data pool (own `cheese_recipes`
table + `@workspace/cheese-recipes` lib + `@workspace/cheese-import` deterministic
importer), managed like Mixes but **deliberately kept separate from Mixes** — do NOT
route cheese through the Mixes tables/UI/importer.

**Why:** the user asked for cheese to behave like Mixes (manager-managed, server pool,
dedicated "Cheese Mix Recipe Specs" importer, per-flavor assignment lines + shredder
setting) but as its own thing. Mix components are per-PIZZA oz; cheese components are
per-BATCH lbs — different units, different importer, different pool.

**How to apply:**
- Managers manage cheese under Manage Lists → Cheese Recipes (`CheeseRecipesManager`,
  web + mobile) and import via the cheese importer (`prepareCheeseImport`/
  `commitCheeseImport`, deterministic, no AI, `MAX_CHEESE_IMPORT_FILES`).
- Run applicator "Cheese" cards are PICK-ONLY: pick a recipe NAME scoped to the run's
  brand/flavor (`cheeseNamesForRun`), which hydrates the rows read-only from the server
  pool (`serverCheeseRowsByName`) and surfaces shredder setting / cellulose
  (`serverCheeseByName`). An applicator whose Type contains "mix" keeps the editable
  RecipeEditor; anything else (incl. blank) is treated as cheese pick-only.
- The GET cheese endpoint is `requireAuth` (everyone picks); POST/DELETE are
  manage-inventory (managers only). Query key `["cheeseRecipes"]`.
- The old local synced `cheeseRecipePresets` day-state map + the editable
  `CheeseRecipeCard`/`RecipeEditor` cheese path are now DEAD but intentionally LEFT in
  place: the sync fields `app{n}CheeseRecipe`/`app{n}CheeseRecipeName` still carry the
  hydrated rows/name downstream to calc + consumption, and removing the synced preset
  map would break the additive live-sync union. Leave them dormant.

**No migration of old local presets to the server.** Since the 2026-07-03 data purge the
apps start empty and users re-import their own spec sheets (see one-time-data-purge.md);
seeding/migrating cheese would resurrect purged data and break web+mobile parity (web did
not migrate either). Users re-populate cheese via the importer.
