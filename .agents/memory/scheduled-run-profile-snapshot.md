---
name: Profile is source of truth for not-started runs
description: Profile saves now fan out to today's pending runs and future scheduled runs; started runs keep their snapshot.
---

**Rule (changed 2026-07-20):** the saved brand+flavor profile is the source of truth for every run that has NOT started. Any profile save (Setup Profiles editor, or a nav/autosave that actually changed the profile) fans out via `propagateProfileToPendingRuns` in web home.tsx: today's pending non-current runs get `mergeProfileIntoOpenForm` + `markRunValuesUpdated` + schedulePush; future scheduled days get fetched, overlaid, and PUT back with fresh `runValuesUpdatedAt` stamps so the server LWW merge accepts them. Started/ended runs are never touched (they keep the snapshot taken at start).

**Why:** operators edited a profile after scheduling and the scheduled runs silently kept stale setup — three editors (run Setup tab, profile editor dialog, schedule editor) looked like they "didn't cooperate". The old rule was blank-fill-only sauce backfill; the user chose full overlay for not-started runs (Option A).

**How to apply:**
- Propagation only fires when `saveProfile` actually persisted a change (it returns boolean now) or on an explicit editor save; a per-brand+flavor JSON-signature ref dedups repeat fan-outs.
- The overlay is `mergeProfileIntoOpenForm`, which skips PER_RUN_FIELDS, PROGRESS_FIELDS, brand/flavor — cases needed and progress can't be clobbered; unchanged runs (same ref returned) are never re-stamped.
- Future-day writes must go through the fetch-payload → overlay → PUT with stamps + `epoch=` + `handleStaleSyncWrite` pattern (today's runs stay on the live path — see today-schedule-edit-live-path.md).
- The old blank-fill sauce backfill (`backfillSauceFromProfile`) still exists at rollover pull-up sites and is still the right pattern for STARTED runs.
