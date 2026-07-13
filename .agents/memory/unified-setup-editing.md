---
name: Unified setup editing
description: How setup edits propagate (profile editor → open form, shared dough/sauce pool → profiles+form) and the guards that keep it safe.
---

Web-only "edit once, updates everywhere" for run setup data.

**The rule:** any out-of-band writer of setup data must actively propagate, never rely on the next load:
- Setup Profiles editor Save → host page overlays the fresh profile onto the OPEN form when brand+flavor matches (`mergeProfileIntoOpenForm` in web storage.ts) — otherwise the next autosave/nav-save writes the stale form back over the profile (the classic open-form clobber).
- Shared dough/sauce pool change (local or remote, detected by a snapshot-diff effect on the react-query list) → `refreshProfilesFromNamedRecipes` rewrites every SAVED profile linked by NAME (targeted merge; never blanks other fields, never creates profiles), and the open form's linked rows refresh via setValue so the normal autosave persists + stamps.

**Why the guards matter:**
- The merge overlay must skip PER_RUN_FIELDS + PROGRESS_FIELDS + brand/flavor, or a profile save wipes a started run's cases-needed/progress.
- The pool snapshot ref must treat the FIRST load as priming only — otherwise every page load looks like "everything changed" and fans out spuriously.
- Only recipes present in BOTH snapshots count as changed (a newly appearing name is not a change), and no-op rewrites are skipped so profile LWW stamps aren't minted for nothing.
- Row comparison (`recipeRowsEqual`) is normalized (trim, drop blank "+ Add" rows, ci ingredient names) so cosmetic differences don't read as drift.

**Drift + promotion:** form rows differing from the linked shared recipe show an indicator; "Update shared recipe" (shown when canManageInventory) promotes via the existing per-id named-recipes upsert and setQueryData — the pool effect then fans the accepted version out to other profiles.

**Drift must be computed inline, NOT useMemo.** `form.watch()` mutates recipe row objects IN PLACE, so the rows array's identity never changes on an lbs edit — a memo keyed on `v.doughRecipe` returns the stale cached result and the drift indicator never appears (caught only by real-browser e2e; unit tests on the compare helpers all passed). Recompute each render (cheap) — the page re-renders on every form change anyway.

**Clone pool rows at every form-hydration site.** Setting rows from the server-pool byName map (or local presets) without `rows.map(r => ({...r}))` shares object identity with the pool's client copy; RHF's in-place edits then mutate the pool copy too and the drift comparison silently sees "equal". Same array-identity gotcha as ingredient-catalog hydration.

**How to apply:** any NEW out-of-band writer of profiles or shared recipe pools must reuse these helpers (or the same pattern) rather than writing storage directly.
