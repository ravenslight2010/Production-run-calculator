---
name: Managed rebase tree recovery
description: How to detect and repair silent tree corruption after a history-preserving managed rebase.
---

Treat a successful rebase as history completion, not proof that the resulting tree matches the validated pre-rebase integration. Replay can leave duplicated declarations, truncated handlers, weakened policy inventories, or stale evidence fingerprints without retaining conflict markers.

**Why:** A managed rebase completed cleanly while replayed conflict resolutions silently changed the integrated tree. Typechecking, sharded tests, generated-contract checks, and revision-bound evidence checks found regressions that a conflict-marker scan could not detect.

**How to apply:** Preserve the pre-rebase integrated tip as a named baseline, compare the final tree against it by subsystem, restore known-good files instead of hand-reconstructing malformed merges, and separately retain intentional changes from the refreshed base. Re-run evidence fingerprint checks whenever the lockfile changes.