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
| Database sizes | Production approximately 968 MB; development approximately 83 MB. These are database-size readings, not exact row counts or backup sizes. |
| Local tools and capacity | PostgreSQL 16.10 `pg_dump`, `pg_restore`, and local server utilities are installed. The workspace reports about 181 GB free; this does not establish a safe long-term location for a production dump. |
| Other file storage | A source scan found no app object-storage SDK or direct-upload integration. Saved workbook snapshots and inventory observation photos appear database-backed; this scan is not proof that no external data store exists. |

## Schema-signature differences inspected

- `daily_sync.canonical_revision`: development default `0`; production default `'0'::numeric`.
- `operational_intent_ledger.base_revision` and `canonical_revision`: same numeric-zero default rendering difference.
- `run_templates.revision`: same numeric-zero default rendering difference.
- `proactive_alert_settings.scope`: same field definition, different column ordinal only.

The matching constraint/index/trigger signatures and matching column names/types/nullability indicate no semantic schema difference in those inspected categories. A real archive restore rehearsal is still required; metadata comparison is not a restore test.

## Authentication and sensitive records

The user table includes `password_hash` and session-revocation timestamps. Separate tables hold session token hashes and password-reset code hashes. Carrying these into a development app would expand the credential surface and could allow production credentials or sessions to be reused. The safe default is to copy account identity and role records only, omit password/session/reset material, and require fresh authentication in development. Owner confirmation is still required for this account-field policy.

## Transfer and preservation constraints

- Replit documents the production connection as read-only for Agent/developer access and documents `pg_dump`/`pg_restore` from the Shell using the connection string in the Database tool's Production settings.
- Replit documents production point-in-time recovery and optional scheduled backups; no new backup was created or verified during this preflight.
- The development database is materially smaller and contains existing data. A full restore would replace that data; no destination backup or restore has been performed.
- The Shell has PostgreSQL tools but no production dump was attempted. Do not place a production URL in chat, command history, a committed file, or a general-purpose project secret without explicit approval and a cleanup plan.
- Preserve the current production app and database until the final, owner-approved snapshot and destination verification pass. A live-write cutoff or final copy window is still needed to avoid missing changes after an earlier export.

## Failure ledger

- **Resolved:** the first metadata-signature query failed because PostgreSQL could not resolve text concatenation with a `char` field. The query was corrected with an explicit text cast and rerun; both environments returned successfully. This was a query construction error, not a database failure.
- **Resolved:** the first production metadata attempt was blocked by Replit's authentication gate. After the owner authorized production database access, the read-only metadata checks succeeded.
- **Blocked:** the actual `pg_dump` source connection is available in Replit's Database settings but is not exposed to the Shell or Agent callback in a safe, temporary way in this session. No connection string was requested or accessed.
- **Blocked:** the task requires a fresh development backup, isolated restore rehearsal, explicit approval before replacing existing development data, and an owner-approved account/credential-field policy. These steps remain incomplete; do not switch or republish the app.
