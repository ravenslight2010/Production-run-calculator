---
name: Workspace lock refresh pruning
description: A local workspace dependency refresh can rewrite unrelated cross-platform optional dependency lock entries.
---

After adding a workspace-only package, review the lockfile diff for unrelated optional-dependency and peer-resolution pruning rather than assuming an offline install will produce a narrowly scoped change.

**Why:** The workspace pnpm runtime can recalculate optional platform packages and peer snapshots for the current environment even when no external package version changed.

**How to apply:** When introducing or linking a workspace package, inspect the lockfile diff separately and distinguish the required importer links from broad environment-driven resolution churn.