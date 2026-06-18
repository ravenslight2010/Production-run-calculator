---
name: Isolated task DB can predate schema migrations
description: A fresh task environment's Postgres may lag the current Drizzle schema; reconcile before relying on it.
---
The isolated task environment's database (`heliumdb`) is NOT guaranteed to match
the current Drizzle schema. Encountered a DB where the entire self-contained-auth
migration had never been applied: no `users` table at all, and `user_roles` still
had the OLD Clerk-era shape (`clerk_user_id` PK, `email`, `name`). The running
api-server 500s on sign-up in that state.

**Why:** schema pushes don't automatically replay into every isolated env.
**How to apply:** before building on a table, verify it exists with the expected
columns (`\d table`). `pnpm --filter @workspace/db run push` is interactive
(column-rename resolver) and can block on a TTY; when the env's data is throwaway
(check row counts first), reconciling with direct idempotent SQL that mirrors the
Drizzle definitions is faster and deterministic.

**push-force still prompts:** `push-force` only auto-confirms data-loss
statements, NOT rename-vs-create column conflicts — so it ALSO hangs on a TTY
when a legacy table diverges (e.g. old `user_roles.clerk_user_id` vs new
`user_id`). Fix without a TTY by first dropping the throwaway legacy table
(`DROP TABLE IF EXISTS user_roles CASCADE;`) so there's no ambiguous diff, then
`push-force` applies cleanly. This means a real schema divergence can also break
the automatic post-merge `push-force`.
