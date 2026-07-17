---
name: data-heal-playbook
description: Fix bugs that poisoned stored data (profiles, pools, day-state). Use whenever a bug fix alone is not enough because wrong values are already saved in the database — e.g. an import wrote a wrong number into many profiles. Covers checking for poisoned data, writing a one-time server heal, and verifying it.
---

# Data Fix / Heal Playbook

The production database cannot be edited directly — corrections ship as CODE via one-time boot heals. Whenever you fix a bug that WROTE bad data, always ask: "is bad data already stored?" Fixing the code without a heal leaves the user still seeing the wrong values.

## Process

1. **Fix the code bug first** (the write path). Guard against re-poisoning.
2. **Check for poisoned data in the dev DB** with `psql "$DATABASE_URL"`. Survey how widespread it is (group by value, count). Key tables: `brand_profiles` (values jsonb), `dough_recipes`/`sauce_recipes`/`cheese_recipes` (pools), `daily_sync` (day-state), `saved_spec_sheets` (parses), `import_aliases`/`spec_import_aliases`/`ai_corrections` (learned memory).
3. **Write a one-time heal** in `artifacts/api-server/src/lib/dataHeals.ts`:
   - New function + fresh stable id (e.g. `my-fix-v1`), registered at the end of `runDataHeals()`.
   - ONE `db.transaction`; FIRST claim the marker row in `data_heals` with `onConflictDoNothing` — no row returned = skip (already ran or concurrent instance).
   - Select target rows `.for("update")`.
   - **LWW stamps:** when healing `brand_profiles`, bump `updatedAtMs` = `Math.max(stored + 1, Date.now())` so stale clients can't re-publish the bad value. Same monotonic rule for `daily_sync` runValues stamps.
   - `daily_sync` heals: today-and-future dates only (hard-coded date literal), past days are history.
   - Learned-alias deletes: scope to the FULL key incl. context columns; also delete mirrored `ai_corrections` rows.
4. **Prefer the app's own derivation over guessing values.** If the app derives a value when inputs are present (e.g. dough batch yield derives from rows lbs ÷ doughball weight and the form auto-zeroes it), the heal should ZERO the stored fallback under the exact same condition rather than compute a replacement.
5. **Verify in dev:** restart BOTH API workflows (`API Server` and `artifacts/api-server: API Server`), then check `data_heals` for the marker and re-query the poisoned rows.
6. **Tell the user** the live app gets the cleanup on next publish, and suggest publishing.

## Reference

Full pattern + past gotchas: `.agents/memory/one-time-data-heals.md` and existing heals in `dataHeals.ts` (copy their structure).
