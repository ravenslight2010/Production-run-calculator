---
name: Mix Plan snapshot refresh
description: Server-authoritative Mix Plan snapshots must invalidate on run ingredient/value edits, not only run identity or lifecycle changes.
---

The Mix Plan snapshot cache must be refreshed when a mounted run changes the ingredients or quantities that feed its plan, not just when the run is added, renamed, started, or ended.

**Why:** A lifecycle-only invalidation signature can leave the UI showing a server snapshot computed from the previous run values while the local run form already reflects the edit.

**How to apply:** Include the canonical run input values in the Mixes-tab refresh dependency, and keep browser coverage for in-place edits and second-run additions.

Scheduled profiles are partial persisted records. The server mirror must supply
zero defaults for omitted numeric form fields before calling shared summary math;
otherwise an omitted field such as casesPerLayer turns valid scheduled totals into
NaN/null JSON.

**Why:** The browser form starts from DEFAULT_VALUES, while a saved profile stores
only edited fields. The server cannot assume the profile is a complete form snapshot.

**How to apply:** Normalize casesNeeded, pizzasPerCase, and casesPerLayer at the
server snapshot boundary, then keep future-day browser cases in the authoritative lane.

Browser fixtures that edit localStorage must stamp run metadata/value freshness and
write the same complete fixture to canonical daily_sync before a reload or live
Mixes assertion; resetAt remains the daily auth boundary.

**Why:** The server-authoritative plan cannot observe an unstamped browser-only
edit, and generic sync-status text can be stale while a specific lifecycle write
is still queued.

**How to apply:** Reuse the fixture stamp helper, then wait for the exact
run field (startedAt or endedAt) in localStorage and canonical daily_sync before
asserting the plan.