---
name: Isolated env may have stale @workspace/* node_modules links
description: Pre-existing "cannot find module @workspace/*" failures in a task env are usually a missing symlink, not a code bug
---

A task's isolated environment can boot with `@workspace/*` packages NOT
symlinked into node_modules. Symptom: esbuild/vitest/tsc all fail with
"Could not resolve / Cannot find package @workspace/<lib>" (and a cascade of
"implicitly any" errors downstream, since the missing types collapse to any).
This shows up as failing `test`, `test:client`, api-server build, and artifact
typechecks at task start — before you've touched anything.

**Why:** the env's node_modules predates the workspace install; the per-artifact
`node_modules/@workspace/<lib>` symlinks are absent.

**How to apply:** confirm it's pre-existing (check the failing imports are in
files you didn't touch / git status shows only your files). Then run
`pnpm install` (relinks workspace packages) and `pnpm run typecheck:libs`
(builds composite libs). Do NOT "fix" it by editing imports or marking packages
external. Note: some libs export `./src/index.ts` directly, so a dist build is
not what's needed — the symlink is.
