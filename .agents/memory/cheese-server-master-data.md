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

**Dormant-preset trap:** any UI that lists cheese/dough/sauce/mix recipe NAMES must read
the LIVE server pools, not the dormant local presets. The spec-import "Use my existing
recipe" picker (web-only reuse feature) regressed to offering only the one-time local seed
("Aldo's...") because it read `existingRecipeNamesForImport` (local presets). Fix: source
the picker from the server pools (`serverCheeseNames`/`serverMixNames`/`serverDoughNames`/
`serverSauceNames`), unioned with local names for back-compat. When wiring a new name
picker, ask whether the pool is server-backed now — most are.

**No migration of old local presets to the server.** Since the 2026-07-03 data purge the
apps start empty and users re-import their own spec sheets (see one-time-data-purge.md);
seeding/migrating cheese would resurrect purged data and break web+mobile parity (web did
not migrate either). Users re-populate cheese via the importer.

**Dual weight columns (2026-07-12).** Cheese components carry BOTH `lbs` (per-batch,
curated via the Cheese Mix Recipe Specs workbook or hand edits) and optional
`ozPerPizza` (from pizza spec sheets). Mix components similarly gained optional
`perBatchLbs` (reference-only — plan math still uses per-pizza oz). Rules:
- Spec-sheet cheese amounts arrive in the parsed rows' `lbs` field (parser quirk) but
  are TRUE per-pizza ounces; `collectSpecImportCheeseRecipes` surfaces them as
  `ozPerPizza` and `specCheeseDraftToRecipe` writes them to the oz column with lbs=0.
- On commit, spec imports refresh ONLY the oz column of name-matched pool recipes via
  pure `applyCheeseOzPerPizza` (ci name+ingredient match) — curated batch lbs must stay
  byte-identical. Guard test: specImportCheeseUpdateGuard.test.ts.
- Applicator card hydration (`serverCheeseRowsByName`) falls back to oz values only when
  a recipe has NO component with lbs>0, so spec-created recipes still show their ratio.
- Any new write path into cheese components must never copy oz values into `lbs`.

## Duplicate-name protection (applies to any name-keyed server pool)
Rule: a name-keyed master-data pool whose POST accepts client-minted ids MUST enforce name uniqueness server-side — client-side "add if absent" dedupes against a stale pool snapshot, so multi-file imports and racing devices insert exact same-name rows the merge UI can't even show (identical names collapse).
**Why:** cheese_recipes accumulated ×7/×5 exact-name dupes from a single multi-file import; POST deduped by id only.
**How to apply:** in the write route, run read-check-insert in ONE transaction under a per-scope pg_advisory_xact_lock; skip NEW ids whose trimmed ci name already exists (existing ids may still rename/update). Heal deletes must be scoped by (id, scope) — the upsert key allows the same id in two scopes. Keeper rank for dedupe heals: lbs>0 components > more components > oldest.
