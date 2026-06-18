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
