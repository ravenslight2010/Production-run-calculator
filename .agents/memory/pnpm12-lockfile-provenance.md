---
name: pnpm 12 lockfile provenance
description: How to interpret two-document pnpm lockfiles and preserve revision-bound evaluation history.
---

pnpm 12 records its own pinned binary in a first, environment YAML document. The project's application dependency graph is in the last YAML document. Consumers that extract package or snapshot inventory must read the last document, not the first occurrence of a section. Security tools that audit everything installed must account for both.

**Why:** A first-section reader can silently inspect pnpm's platform binaries instead of the application packages. The lockfile's byte hash also changes as soon as the manager pin changes, even if no application dependency version moves. Retained historical evaluation reports record the lockfile that existed when they ran; rewriting their dependency hash would misrepresent their provenance.

**How to apply:** Update current canonical snapshots bound to lockfile bytes after a manager change. In comparisons to retained historical reports, allow their old lock hash to remain historical while checking the other measured content; never replace the historical report's hash with the current one.