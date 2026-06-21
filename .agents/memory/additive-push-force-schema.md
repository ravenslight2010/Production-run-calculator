---
name: Additive push-force-safe schema changes
description: How to add columns to POPULATED tables so `drizzle-kit push --force` stays fully non-interactive (post-merge/prod safe).
---

# Additive, push-force-safe schema changes

When adding a column (e.g. a `scope` discriminator) to an ALREADY-POPULATED table,
the change must be **purely additive** or `drizzle-kit push --force` will either
prompt (hanging the non-interactive post-merge/prod path) or emit broken DDL.

**Why:** `--force` does NOT suppress drizzle's interactive resolvers, and drizzle
has DDL-ordering bugs around new columns + key changes. The post-merge script and
prod migrations run `push-force` with no TTY, so any prompt or error is fatal.

**How to apply — the safe recipe:**
- New column: `text("scope").notNull().default("live")` — a NOT NULL column WITH a
  default is a safe single `ADD COLUMN ... NOT NULL DEFAULT` (no prompt, no backfill).
- Need uniqueness that includes the new column? Use **`uniqueIndex(...).on(a, scope)`**,
  NEVER `.unique()` (a unique CONSTRAINT triggers a truncate prompt on populated tables).
- Need the new column in the key? Do NOT put a freshly-added column inside
  `primaryKey({ columns: [...] })`. drizzle-kit mis-orders the DDL and emits
  `ALTER COLUMN <new> SET NOT NULL` BEFORE the column exists → `column "<new>" does
  not exist`. Instead drop the old single-col PK implicitly (omit `.primaryKey()`)
  and enforce identity with a `uniqueIndex(oldKey, scope)`. The codebase already has
  no-PK + uniqueIndex tables (e.g. `inventory_consumed_runs`), so this is consistent.
  `onConflictDoUpdate({ target: [colA, scope] })` works against a unique index.
- Altering an EXISTING multi-state PK is fine and does NOT prompt; it's *adding* a PK
  to a no-PK table, or composite-PK with a new column, that breaks.
- Singleton "settings" tables use `integer("id").primaryKey().default(1)` (see
  `proactive_alert_settings`), NOT `serial`. Don't switch an existing int id to
  `serial`: Postgres only special-cases serial in ADD COLUMN, so `ALTER COLUMN TYPE
  serial` fails. To host >1 scoped row on such a table, keep the int PK and assign a
  fixed distinct id per scope (live=1, sandbox=2) plus a `uniqueIndex(scope)`.

**Verify before building:** the isolated task DB often LAGS the Drizzle schema
(see isolated-db-may-predate-migrations). Inspect `information_schema.columns`
first; a failed `push` rolls back fully (clean state), so absence of your new
columns after a failed push means nothing landed — fix the schema and re-push.
