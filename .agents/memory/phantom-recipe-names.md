---
name: Phantom recipe names — every picker's option source must be mergeable
description: A name visible in ANY picker must be offered in the merge tab; legacy local name lists still feed some pickers and sync factory-wide.
---

# Phantom recipe names (visible in a picker, unfindable in Merge)

**Rule:** The merge tab's universe for a category must cover EVERY source that any picker in the app draws options from — server pool, stale link fields (app{n}CheeseRecipeName on runs/profiles/templates/history), AND the legacy local name lists (e.g. `run-calc-cheese-recipe-names`).

**Why:** The dormant local `cheeseRecipeNames` list still feeds the schedule editor's Advanced cheese-recipe `<select>`, and it syncs factory-wide via the day-state list union — so a legacy name lives on every device forever. The merge Cheese tab originally showed only the server pool (+ stale link names), so users saw a phantom in that picker with no way to merge it away. Also note the phantom may exist ONLY in old daily_sync rows / a device's localStorage, not in any current server table — check the client surfaces, not just prod DB.

**How to apply:**
- Cheese mergeUniverse unions: pool (minus mixes) + stale link-field names + local-list names not in the pool. `applyRecipeNameMerge` already rewrites + tombstones the local list, so offering the name is sufficient.
- When adding a new picker, ask "can its option source hold a name the merge tab can't see?" If yes, union it in.
- Debugging "X shows in a picker but not in Merge/Manage Lists": enumerate every options source for that exact picker first (there may be more than one picker for the same field — run card vs schedule editor).

**Second minting path (dough/sauce spec names):** applySpecImport used to register the RAW spec dough/sauce name into the synced option list while the commit glue's placeholder suppression family-matched the same name onto an existing pool recipe — result: an option-list name no recipe anywhere backs. Rule: any spec name written to an option list or a profile name field must first snap onto the server-pool spelling (exact loose-equal, then family match), using pools passed INTO applySpecImport. Corollary: apply-time hydration must fall back to the server pool's components — local presets only mirror what THIS device saved, so "name set, rows empty until reselect" is the symptom of local-preset-only reads. A re-import can't repair such profiles (the prune drops unchanged sheets), hence the one-time heal that merges unbacked names + hydrates empty-row profiles from the pool.
