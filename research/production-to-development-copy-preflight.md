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

The user table includes `password_hash` and session-revocation timestamps. Separate tables hold session token hashes and password-reset code hashes. Carrying these into a development app would expand the credential surface and could allow production credentials or sessions to be reused. The safe default is to copy account identity and role records only, omit password/session/reset material, and require fresh authentication in development. Owner confirmation is still required for this account-field policy.

## Transfer and preservation constraints

- Replit documents the production connection as read-only for Agent/developer access and documents `pg_dump`/`pg_restore` from the Shell using the connection string in the Database tool's Production settings.
- Replit documents production point-in-time recovery and optional scheduled backups; no new backup was created or verified during this preflight.
- The development database is materially smaller and contains existing data. A full restore would replace that data; no destination backup or restore has been performed.
- The Shell has PostgreSQL tools but no production dump was attempted. Do not place a production URL in chat, command history, a committed file, or a general-purpose project secret without explicit approval and a cleanup plan.
- The owner approved replacing development only after backups and a disposable restore rehearsal; selected copying account password hashes; chose a masked, one-time Shell prompt; and chose to copy all other table data exactly. The task's existing exclusions still apply to `auth_sessions` and `password_reset_requests`; environment Secrets and deployment credentials are not database rows and will not be copied.
- A full-schema restore into a target containing existing public-schema objects can fail while dropping the `public` schema. A disposable test confirmed this is a real limitation. The safer plan is to retain the already-matched development schema, clear only its public application tables, and load the production public-table data in one transaction. A synthetic local test of this data-only path passed: normal rows and sequence state copied, the two approved-exclusion tables stayed empty, and a development-only table remained untouched.
- A one-time transfer helper is prepared in `.local/production-copy/transfer.mjs` (excluded from Git and deployment). It accepts the production URL through a hidden terminal prompt, creates mode-restricted temporary archives, restores both archives locally, rehearses the data-only import, compares all public-table row counts and inventory aggregates in the transaction, then requires the exact runtime phrase `REPLACE DEVELOPMENT DATA`. It leaves the development API stopped after a successful copy because the owner chose to preserve queued work and notification state.
- Unit checks for URL parsing, `.pgpass` escaping, archive filters, and sequence recovery pass. Isolated PostgreSQL tests also pass for the transactional data-only restore, sequence state, excluded rows, row-count assertions, and inventory aggregate assertions. These tests use synthetic data only.
- Preserve the current production app and database until the final, owner-approved snapshot and destination verification pass. A live-write cutoff or final copy window is still needed to avoid missing changes after an earlier export.

## Failure ledger

- **Resolved:** the first metadata-signature query failed because PostgreSQL could not resolve text concatenation with a `char` field. The query was corrected with an explicit text cast and rerun; both environments returned successfully. This was a query construction error, not a database failure.
- **Resolved:** an initial comprehensive fingerprint differed because `information_schema.specific_name` contains database-local OIDs. Comparing normalized routine identity arguments and function definitions produced matching public-schema fingerprints.
- **Resolved:** the first full-schema rehearsal hit the default `public` schema, and a second test showed that cleaning `public` fails when development-only objects depend on it. The import was changed to a transaction that preserves the destination schema and changes only public application data.
- **Resolved:** the first production metadata attempt was blocked by Replit's authentication gate. After the owner authorized production database access, the read-only metadata checks succeeded.
- **Blocked:** the actual `pg_dump` source connection is available in Replit's Database settings but is not exposed to the Agent Shell in a safe, temporary way. The owner chose a masked Shell prompt; no connection string was requested or accessed.
- **Blocked:** the helper has not been run with real databases. No production or development archive has been created, no application data has been copied, and no production writes or deployment changes have been made.
- **Current state:** only the development API workflow is stopped for the copy window. The published production app remains active and unchanged; keep the development API stopped until copied queue and notification records are reviewed.
