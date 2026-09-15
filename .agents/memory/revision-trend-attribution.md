---
name: Revision trend attribution
description: Prevents repeated-evidence trends from propagating an old failure into later clean revisions.
---

Classify every retained revision from that revision's own measurements. Never use a
historical report's aggregate pass/fail field to decide whether the historical revision
itself regressed. Deduplicate reruns by revision before applying history limits.

**Why:** Aggregate status can include older retained failures. Reusing it as the next
report's per-revision status causes one old regression to be attributed to every later
revision, even after the original sample ages out.

**How to apply:** For any revision-aware CI trend, validate and recompute local status from
the sample's raw bounded metrics, deduplicate revision IDs, then derive the new aggregate
from those local statuses.