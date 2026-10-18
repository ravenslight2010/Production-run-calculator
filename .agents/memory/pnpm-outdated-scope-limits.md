---
name: pnpm outdated scope limits
description: How to interpret recursive pnpm outdated JSON when preparing workspace upgrade inventories.
---

Treat `pnpm outdated -r --format json` as a registry/version signal, not a complete source of direct workspace scope or lockfile state. Its `dependentPackages` array can omit workspace members that still directly declare the package, and its `wanted` field can equal the current lock resolution while a newer eligible release exists.

**Why:** A current workspace inventory returned only two of four direct `pg` importers and only one of two React Query importers; all outdated rows also had `wanted` equal to `current`.

**How to apply:** Cross-check package manifests and the normal dependency document's importer entries before assigning affected areas or concluding that no in-range update is available. Verify release timestamps separately against `minimumReleaseAge`.