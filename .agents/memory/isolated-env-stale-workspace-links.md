---
name: Isolated environment stale workspace links
description: Recover when an isolated workspace is missing local @workspace package symlinks.
---

An isolated task workspace may lack `@workspace/*` links under `node_modules`; run `pnpm install` and `pnpm run typecheck:libs` before treating module-resolution failures as source defects.

**Why:** Missing workspace links produce “cannot find module” and build errors even when the package source is correct.

**How to apply:** Use the repository-pinned pnpm to install dependencies, run `typecheck:libs`, and only investigate code errors that remain afterward.
