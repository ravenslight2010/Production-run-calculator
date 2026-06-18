---
name: post-merge setup script
description: Why scripts/post-merge.sh must use push-force and needs a generous timeout.
---

# Post-merge setup (scripts/post-merge.sh)

The post-merge script runs `pnpm install --frozen-lockfile` then a Drizzle schema push.

## Rules

- Use `pnpm --filter db push-force` (the `push-force` script = `drizzle-kit push --force`), NEVER plain `push`.
  - **Why:** post-merge runs non-interactively with stdin closed. Plain `drizzle-kit push` opens an interactive column-rename resolver (`promptColumnsConflicts`) whenever the live DB drifts from the schema (common: isolated task-agent DBs still carry pre-migration columns). With no TTY it renders forever and the setup times out.
- Keep the post-merge timeout generous (set to 180000ms).
  - **Why:** install (~30s, even when "Already up to date") + schema push (~40s) totals ~70s on this monorepo. The original 20000ms ceiling killed the run before push even started. Measured a clean run at ~71s.

## Known non-fatal noise

- Even with `--force`, stderr still prints the `Interactive prompts require a TTY` / `promptColumnsConflicts` stack against the drifted dev DB. The script still exits 0 and setup reports success — this line is expected, not a failure.

## Restart gotcha

- After a merge's workflow reconciliation, app workflows can fail to rebind ports (EADDRINUSE on api 8080 / web port) from orphaned processes, and api-server's ~20s esbuild build under merge-churn CPU load can overrun the default 60s restart window. Retry `restart_workflow` with a larger `workflow_timeout` (e.g. 120) once ports are free.
