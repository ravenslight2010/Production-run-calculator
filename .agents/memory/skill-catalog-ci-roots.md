---
name: Skill catalog CI roots
description: Environment constraint for validating the repository’s editable and platform-managed skill roots.
---

GitHub checkouts can omit the `.local` skill roots because those directories are platform-injected rather than repository content. Catalog validation should still inspect every root that exists, report absent roots clearly, and reserve blocking status for violations in discovered editable skills.

**Why:** A checker that treats absent platform-managed directories as hard failures passes in the Replit workspace but fails before it can validate the tracked project skills in GitHub CI.

**How to apply:** Keep the root inventory explicit and classify findings by ownership. If a new repository-owned skill root is added, decide separately whether its absence should become required.

Managed-root findings should be documented with per-code counts, not only by
skill path. A newly added finding in an already-known managed skill must remain
visible as an undocumented warning, while editable findings stay blocking.

**Why:** Platform-managed content is intentionally non-blocking, but a
path-only exemption can silently absorb future regressions in the same file.

**How to apply:** Update the managed warning baseline only after reviewing the
current finding and its ownership; preserve the separate editable failure gate.