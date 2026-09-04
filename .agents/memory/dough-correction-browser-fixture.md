---
name: Dough correction browser fixture
description: Responsive live-run browser tests must account for tab-mounted station panels and post-start run hydration.
---

Live-run browser fixtures should establish assertions from the active run after
Start Run and activate the station tab before observing its live countdown or
progress. Pending-form values can be rehydrated when the run starts, while
inactive station panels do not necessarily advance their visible counters.

**Why:** A phone-sized manager journey initially appeared to have no Dough
deficit and no Packaging progress because the live run rehydrated its profile
and the Packaging panel was not mounted while the Dough tab was active.

**How to apply:** Use the live inputs as the correction baseline, assert the
derived values change after both edits, switch to the relevant station tab for
progress evidence, and inspect the actual `/api/sync/today` payloads for
post-pause catch-up regressions.