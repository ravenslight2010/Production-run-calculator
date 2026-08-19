---
name: Workspace declaration staleness
description: Composite workspace packages can expose stale declarations to artifact typechecks despite source exports being current.
---

**Rule:** If an artifact typecheck says a workspace export is missing even though the source file exports it, rebuild that composite library's declarations before changing consumer imports or adding suppressions.

**Why:** TypeScript may redirect workspace imports through the package's persisted composite build metadata. Ignored `dist` declarations can therefore lag behind `src`, making real exports appear absent and causing misleading downstream implicit-any errors.

**How to apply:** Confirm the source export, run `pnpm exec tsc --build lib/<package> --force`, then repeat the artifact typecheck. Keep consumer imports pointed at the package root; do not replace them with deep imports or local duplicate types.