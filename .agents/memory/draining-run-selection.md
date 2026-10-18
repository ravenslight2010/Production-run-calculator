---
name: Draining-run selection (packaging panel)
description: How the packaging "freezer draining" panel picks which ended run to show, and the selection-bug pattern to avoid.
---

The packaging "Finishing — Freezer Draining" panel shows a just-ended run whose
freezer is still emptying AND that still has unpackaged cases, so the operator
can keep logging it.

**Rule:** filter ALL ended runs by eligibility FIRST (ended, not the active run,
`freezerTime>0`, still inside the drain window `now < endedAt + freezerTime*60000`,
and `casesLeft>0` when `casesNeeded>0`), THEN pick the latest `endedAt` among the
eligible ones.

**Why:** the original code picked the most-recently-ended run first and then
bailed if it was ineligible — so a NEWER finished run would hide an OLDER run
that was still draining with cases left. Pick-latest-then-bail is the bug;
filter-then-pick-latest is the fix.

**How to apply:** lives at web+mobile parity — web in `home.tsx` draining panel,
mobile in `packaging.tsx` `drainingRun` IIFE. On web do NOT reuse `lastEndedRun`
for this panel: it intentionally means "most-recently-ended overall" and powers
the ACTIVE/viewed run's own emptying bar elsewhere, so the draining panel needs
its own eligibility-filtered selection.

**Run identity rule:** every automatic drain write must carry the draining run's
ID explicitly. If a shared form is currently showing another run, persist the
drain update to its original run but reject the shared-form mutation.

**Why:** foreground adoption and manual selection can change the selected run
between an old drain tick's calculation and its persistence. Deriving the
target from the mutable selected-run ref moves the old delta into the new run.

**How to apply:** capture the ID from the selected draining entry in the
station path; pass the hook's run ID through the Packaging progress callback;
use the callback's boolean result to fence writes into the shared form.
