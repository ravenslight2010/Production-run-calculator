---
name: Today-schedule edits must use the live day-state path
description: Why editing TODAY's schedule can never go through the raw scheduled-day PUT, and the guards the today-save path needs.
---

**Rule:** Any UI that edits TODAY's plan (schedule editor, importers, future tools) must apply changes through the live day-state path — stamped run values (`markRunValuesUpdated`), run deletion tombstones (`tombstoneDeleted("runs", id)`), local `setDayState`+`saveDayState`, then `schedulePush` — never a raw `PUT /api/sync/{today}`.

**Why:** For today, the server's additive/protective merge (`protectRunValues` + `writeDayResetAt` preserving resetAt) discards unstamped values, resurrects runs missing tombstones, and keeps stored runs with newer `metaUpdatedAt`. A raw PUT also never updates the tab's in-memory day, so the very next push (e.g. Start Run) re-pushes the stale copy — the user sees their schedule "revert". This was the 2026-07 "schedule reverted when I hit Start Run" bug. Future days are fine with wholesale PUT because their resetAt is adopted wholesale.

**How to apply:**
- Deletions: only treat a live run as user-removed if the editor actually LOADED that run's id (track loaded ids at open time) AND it never started/ended — an editor opened blank must be purely additive.
- Stamp values only when `!deepEqual` vs stored, so untouched runs don't gratuitously win LWW on peers.
- If the current run's stored values changed (or it was removed), `form.reset` + reset field arrays, or autosave writes the pre-edit form back over the change.
- Editors seeded from today's live runs must lock the date input — otherwise live run ids get copied onto another date's row.
- Never leave the day with 0 runs.
