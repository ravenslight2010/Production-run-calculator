# Production-to-Development Copy Preflight

**Checked:** 2026-11-10  
**Purpose:** Bound the risks and access needed before copying the published production dataset into development.  
**Data handling:** Metadata only. No customer rows, credentials, or database dump were read, exported, or retained.

## Findings

| Check | Result |
|---|---|
| Published deployment | The deployment service reports the current published app is active on Autoscale with a successful build. The live app was not changed. |
| Production and development database access | The authenticated production read-only SQL path and the development SQL path both respond. No SQL writes were issued. |
| Public tables | 98 in production and 98 in development; the table-name sets match. |
| Column structure | All table/column names, types, and nullability match. Four column-signature hashes differ because PostgreSQL rendered numeric-zero defaults differently or column order differs; the inspected definitions are semantically equivalent. |
| Constraints and indexes | 97 constraints and 185 indexes in each environment; normalized signatures match. |
| Triggers and extensions | Two non-internal triggers and `plpgsql` in each; signatures match. |
| Other public objects | 39 sequences, 14 foreign keys, and 5 routines in each environment; no public views or row-security policies. |
| Database sizes | Production approximately 968 MB; development approximately 83 MB. These are database-size readings, not exact row counts or backup sizes. |
| Local tools and capacity | PostgreSQL 16.10 `pg_dump`, `pg_restore`, and local server utilities are installed. The workspace reports about 181 GB free; this does not establish a safe long-term location for a production dump. |
| Other file storage | A source scan found no app object-storage SDK or direct-upload integration. Saved workbook snapshots and inventory observation photos appear database-backed; this scan is not proof that no external data store exists. |

## Schema-signature differences inspected

- `daily_sync.canonical_revision`: development default `0`; production default `'0'::numeric`.
- `operational_intent_ledger.base_revision` and `canonical_revision`: same numeric-zero default rendering difference.
- `run_templates.revision`: same numeric-zero default rendering difference.
- `proactive_alert_settings.scope`: same field definition, different column ordinal only.

The matching constraint/index/trigger signatures and matching column names/types/nullability indicate no semantic schema difference in those inspected categories. A real archive restore rehearsal is still required; metadata comparison is not a restore test.

Production also has a separate `_system.replit_database_migrations_v1` table owned by the provider database role, plus its sequence; development has no corresponding table. Its columns describe build/deployment migration metadata. This is environment-specific platform state, not an application record, so the copy will leave the development database's own `_system` metadata untouched and copy the application's `public` schema only.

## Authentication and sensitive records

The `users` table includes password hashes and session-revocation timestamps; separate tables hold session token hashes and password-reset code hashes. The owner approved copying password hashes, so production passwords will also work in development and development access should remain restricted. The owner separately chose to copy every other application table exactly; `auth_sessions` and `password_reset_requests` data remain excluded, while their schema stays in place.

## Transfer and preservation constraints

- Replit documents the Agent's production database access as read-only, but manual `pg_dump` exports from Shell use the production primary connection string in Database > Production > Settings. The connection may report a read-write default; the helper now wraps its metadata `SELECT`s in explicit `BEGIN READ ONLY` transactions and uses the primary connection only for `pg_dump`. No production SQL writes are issued.
- Replit documents production point-in-time recovery and optional scheduled backups; no new backup was created or verified during this preflight.
- The development database is materially smaller and contains existing data. A full restore would replace that data; no destination backup or restore has been performed.
- The owner chose a masked, one-time Shell prompt for the production connection string. Do not place the URL in chat, command history, a committed file, or a general-purpose project secret.
- The owner approved replacing development only after backups and a disposable restore rehearsal; selected copying account password hashes; chose a masked, one-time Shell prompt; and chose to copy all other table data exactly. The task's existing exclusions still apply to `auth_sessions` and `password_reset_requests`; environment Secrets and deployment credentials are not database rows and will not be copied.
- A full-schema restore into a target containing existing public-schema objects can fail while dropping the `public` schema. A disposable test confirmed this is a real limitation. The safer plan is to retain the already-matched development schema, clear only its public application tables, and load the production public-table data in one transaction. A synthetic local test of this data-only path passed: normal rows and sequence state copied, the two approved-exclusion tables stayed empty, and a development-only table remained untouched.
- A one-time transfer helper is prepared in `.local/production-copy/transfer.mjs` (excluded from Git and deployment). It accepts the production URL through a hidden terminal prompt, creates mode-restricted temporary archives, restores both archives locally, rehearses the data-only import, compares all public-table row counts and inventory aggregates in the transaction, then requires the exact runtime phrase `REPLACE DEVELOPMENT DATA`. It leaves the development API stopped after a successful copy because the owner chose to preserve queued work and notification state.
- Unit checks for URL parsing, `.pgpass` escaping, archive filters, sequence recovery, and read-only transaction wrapping pass (6 tests under Node 24.22.1). The pinned release-runner invocation was blocked by its shared validation lock. An isolated local PostgreSQL check confirmed `BEGIN READ ONLY` reports `on` and rejects an `UPDATE`; prior synthetic restore checks cover transactional data-only restore, sequence state, excluded rows, row-count assertions, and inventory aggregates. No production rows were used in these tests.
- Preserve the current production app and database until the final, owner-approved snapshot and destination verification pass. A live-write cutoff or final copy window is still needed to avoid missing changes after an earlier export.

## Failure ledger

- **Resolved:** the first metadata-signature query failed because PostgreSQL could not resolve text concatenation with a `char` field. The query was corrected with an explicit text cast and rerun; both environments returned successfully. This was a query construction error, not a database failure.
- **Resolved:** an initial comprehensive fingerprint differed because `information_schema.specific_name` contains database-local OIDs. Comparing normalized routine identity arguments and function definitions produced matching public-schema fingerprints.
- **Resolved:** the first full-schema rehearsal hit the default `public` schema, and a second test showed that cleaning `public` fails when development-only objects depend on it. The import was changed to a transaction that preserves the destination schema and changes only public application data.
- **Resolved:** the first production metadata attempt was blocked by Replit's authentication gate. After the owner authorized production database access, the read-only metadata checks succeeded.
- **Resolved:** the first Shell attempt correctly identified `neondb` but stopped because the helper incorrectly required the production connection's default transaction mode to be read-only. Replit's docs say manual exports use the primary production connection. The check ran before any dump; no production or development rows were changed. The helper now runs source metadata queries in explicit read-only transactions and uses `pg_dump` only for the production export.
- **Blocked:** the first pinned-release-runner test attempt could not acquire its shared validation lock. The owning process was still running; it was not terminated. Retry the pinned-runtime tests once that lock is free.
- **Blocked:** the helper has not been run with real databases. No production or development archive has been created, no application data has been copied, and no production writes or deployment changes have been made.
- **Current state:** only the development API workflow is stopped for the copy window. The published production app remains active and unchanged; keep the development API stopped until copied queue and notification records are reviewed.
