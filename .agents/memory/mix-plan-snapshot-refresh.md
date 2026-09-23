---
name: Mix Plan snapshot refresh
description: Server-authoritative Mix Plan snapshots must invalidate on run ingredient/value edits, not only run identity or lifecycle changes.
---

The Mix Plan snapshot cache must be refreshed when a mounted run changes the ingredients or quantities that feed its plan, not just when the run is added, renamed, started, or ended.

**Why:** A lifecycle-only invalidation signature can leave the UI showing a server snapshot computed from the previous run values while the local run form already reflects the edit.

**How to apply:** Include the canonical run input values in the Mixes-tab refresh dependency, and keep browser coverage for in-place edits and second-run additions.