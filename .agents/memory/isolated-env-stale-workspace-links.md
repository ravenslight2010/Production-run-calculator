---
name: Isolated environment stale workspace links
description: Recover when an isolated workspace is missing local @workspace package symlinks.
---

An isolated task workspace may lack `@workspace/*` links under `node_modules`; run `pnpm install` and `pnpm run typecheck:libs` before treating module-resolution failures as source defects.

**Why:** Missing workspace links produce “cannot find module” and build errors even when the package source is correct.

**How to apply:** Use the repository-pinned pnpm to install dependencies, run `typecheck:libs`, and only investigate code errors that remain afterward.

The same check applies to missing exported symbols or properties when package
source already contains them: isolated workspaces can reuse stale declaration
outputs even when their package links are present.

**Why:** A leaf calculator typecheck reported missing API and live-projection
exports that existed in source; rebuilding shared declarations resolved the
errors without changing generated source or application behavior.

**How to apply:** Confirm the source export exists, rebuild shared declarations,
then rerun the leaf typecheck before diagnosing a contract defect.
