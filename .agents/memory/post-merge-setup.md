---
name: post-merge setup script
description: Package-manager, non-interactive schema-push, and timeout rules for reliable post-merge recovery.
---

# Post-merge setup (scripts/post-merge.sh)

The post-merge script runs `pnpm install --frozen-lockfile` then a Drizzle schema push.

## Rules

- Use `pnpm --filter db push-force` (the `push-force` script = `drizzle-kit push --force`), NEVER plain `push`.
  - **Why:** post-merge runs non-interactively with stdin closed. Plain `drizzle-kit push` opens an interactive column-rename resolver (`promptColumnsConflicts`) whenever the live DB drifts from the schema (common: isolated task-agent DBs still carry pre-migration columns). With no TTY it renders forever and the setup times out.
- Keep the post-merge timeout generous (set to 180000ms).
  - **Why:** install (~30s, even when "Already up to date") + schema push (~40s) totals ~70s on this monorepo. The original 20000ms ceiling killed the run before push even started. Measured a clean run at ~71s.
- When the root requires a newer pnpm than Replit's system binary, the post-merge hook must install Corepack's shim in the workspace-local bin directory and run install with `CI=true`.
  - **Why:** direct pnpm recursively ran `pnpm add pnpm@...` until process limits were exhausted. Corepack avoided recursion, but pnpm 11 still refused to replace a pnpm-10 modules directory without an explicit non-interactive environment.
  - **How to apply:** run `corepack enable --install-directory "$PWD/.config/npm/node_global/bin" pnpm`, then `CI=true pnpm install --frozen-lockfile`. Replit puts that directory before system pnpm, so reconciled workflows and nested scripts also stay pinned. Do not weaken the repository's required version.

## The `promptColumnsConflicts` stderr is a REAL failure, not noise

- If stderr shows `Interactive prompts require a TTY` / `promptColumnsConflicts`, `push --force` **bailed before applying ANY changes** — the schema did NOT get pushed, even though the script may still exit 0 / report "success". (`--force` only auto-confirms data-loss truncation; it does NOT resolve ambiguous column/table renames.)
  - **Symptom this caused:** auth schema (`users`, `password_reset_requests`, `rate_limit_counters`, `incidents`) silently never existed in the dev DB, so sign-up/login 500'd with `Failed query: ... from "users"`. Production was broken the same way.
  - **Root cause:** a stale pre-migration table the schema redefines with different columns. Here it was the Clerk-era `user_roles` (`clerk_user_id, email, name`) vs the new schema's `user_roles` (`user_id` FK→users.id). drizzle can't tell rename from drop+add → interactive prompt.
  - **Fix:** drop the orphaned/incompatible table in the **dev** DB (direct pg connection; it had 0 rows / was dead Clerk data), then re-run `push-force` → "Changes applied" cleanly and non-interactively thereafter.
- **Verify push actually applied** — look for `[✓] Changes applied`, or query `information_schema.tables`. Do NOT trust the post-merge "success" status alone.
- **Production:** never push to prod directly (see database skill). After fixing dev, tell the user to re-publish; the Publish UI surfaces the rename/drop for confirmation and applies it to prod.

## Restart gotcha

- After a merge's workflow reconciliation, app workflows can fail to rebind ports (EADDRINUSE on api 8080 / web port) from orphaned processes, and api-server's ~20s esbuild build under merge-churn CPU load can overrun the default 60s restart window. Retry `restart_workflow` with a larger `workflow_timeout` (e.g. 120) once ports are free.
