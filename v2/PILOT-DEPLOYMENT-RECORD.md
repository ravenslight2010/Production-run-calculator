# V2 in-workspace pilot record

**Status: Development pilot running; production publication has not been initiated.**

Captured 2026-11-17, America/Chicago.

## Owner-approved deployment and data boundary

- The owner approved converting this V1-archived workspace into V2 and using the
  project's managed PostgreSQL database under the isolated `v2` schema.
- This is **schema isolation within the same project database**, not a separate
  database. The app launcher maps the managed `DATABASE_URL` to
  `V2_DATABASE_URL` only when `V2_USE_PROJECT_DATABASE=true`; V2 server code
  still requires `V2_DATABASE_URL` and has no implicit fallback.
- The existing V1 schemas and records were not read, imported, or changed. The
  six V2 migrations target objects explicitly in schema `v2`.
- The V2 development schema is installed. It contains 21 tables and one
  enabled manager account. The run and inventory-balance tables contain zero
  rows; no V1 account, session, or inventory data was transferred.
- The production database was not queried or changed. The project is not
  deployed and no publish was started. The deployment run command now refuses
  publication until the production database gates are resolved; the Project
  workflow continues to launch the private development preview.

## Application and worker topology

- `process-compose` supervises separate V2 API and station-worker processes.
  The worker health endpoint binds only to `127.0.0.1:3001`; the API exposes
  sanitized worker status at `/healthz` and reports unavailable workers as
  not-ready.
- The startup script selects the project-pinned Node `24.22.2` before launching
  either process. The API pool is capped at three connections and the worker
  pool at two.
- The development database reports `max_connections=112` and
  `superuser_reserved_connections=4`; two V2 application connections were
  observed during this pilot check. This is PostgreSQL's reported setting, not
  an independently confirmed Replit provider-wide capacity guarantee.
- During repeated health checks, both the V2 API and station-worker sessions
  were observed in `pg_stat_activity` using a superuser role. Disposable
  integration tests separately verify the API through a restricted role.
  Replit's general database documentation says managed application roles are
  not superusers and that custom database roles are not supported, so this
  project-specific observation conflicts with the general guidance. The
  production app role is unknown; resolve the mismatch and verify least
  privilege before publication.
- Replit documents that Publish migrates supported tables, columns, indexes,
  constraints, views, enums, sequences, and row-level security policies, but
  does not automatically migrate functions, triggers, or grants. Those V2
  objects still need an owner-reviewed production-database step before the
  published app can safely use them. See [Publish database changes](https://docs.replit.com/features/data-and-storage/publish-database-changes)
  and [SQL Database](https://docs.replit.com/features/data-and-storage/sql-database).

## Data and secrets boundary

- No V1 database, data, sessions, credentials, or inventory was used.
- No V1-to-V2 data transfer has happened. V2's initial manager was created
  directly in the V2 schema; no V1 account or opening inventory was transferred.
- The owner created the first manager through the guarded bootstrap flow and
  confirmed signing out and back in through the normal sign-in flow. A
  read-only database check found one enabled manager and the durable bootstrap
  marker; the API now reports first-manager setup unavailable. The one-time
  `V2_INITIAL_MANAGER_BOOTSTRAP_CODE` secret was removed after setup.
- The owner confirmed normal sign-out/sign-in. A separate Chromium integration
  now signs in through the real V2 server and exercises manager product import,
  reviewed opening counts, warehouse assignment, stock receipt/transfer, and
  persistence after reload against disposable PostgreSQL data. The live preview's
  manager inventory and production screens remain unverified by the agent.
- No production migration, production query, database copy, or publish was
  performed. Do not paste database URLs or bootstrap codes into chat.
- The preview's initial unauthenticated session check returns HTTP 401 by design;
  the sign-in page renders and `/healthz` is healthy. The screenshot browser does
  not carry the owner's session; the owner-confirmed sign-in and isolated
  authenticated browser integration are separate evidence.

## Checks completed

These checks use local code, disposable fixtures, or the V2 development schema;
they do not prove production or physical-device behavior.

| Check | Result |
| --- | --- |
| V2 unit and API suite | PASS — 129 tests |
| V2 browser suite | PASS — 7 tests using emulated Chromium sessions |
| V2 PostgreSQL suite | PASS — disposable local PostgreSQL cluster |
| Authenticated manager inventory browser journey | PASS — real V2 server + disposable PostgreSQL; product import, two reviewed counts, warehouse assignment, receipt, transfer, reload |
| V2 build/syntax checks | PASS |
| Process supervisor configuration | PASS — both processes validated |
| Development preview `/healthz` | PASS — API and worker healthy; no run work queued |
| First-manager setup and secret cleanup | PASS — one enabled manager, bootstrap marker set, setup closed, one-time secret absent |
| Normal sign-in | PASS — owner confirmed sign-out followed by successful sign-in |
| Worker process restart | PASS — killed worker was restarted under supervision; API health recovered |
| Runtime | PASS — API and worker use Node 24.22.2 |
| Development DB connection setting | OBSERVED — 112 max, 4 reserved, 2 V2 app connections at check |
| Production deployment | BLOCKED — deployment guard refuses publication pending role and SQL-object review |
| Physical Android/iOS device checks | NOT RUN |

## Compatibility coverage

| Environment | Result |
| --- | --- |
| Desktop Chromium | PASS — automated V2 browser tests |
| Phone-sized Chromium emulation | PASS — automated V2 browser tests |
| Tablet portrait and landscape | PARTIAL — Chromium viewport coverage only; no physical tablet |
| WebKit / Safari | NOT RUN |
| Physical Android Chrome / PWA | NOT RUN |
| Physical iOS Safari / PWA | NOT RUN |

## Failure ledger and remaining actions

- Replit's workflow editor refused changes because the project already has 16
  workflows against its 10-workflow limit. No test workflows were removed; the
  existing `Project` workflow was reused through the validated `.replit` path.
- The workflow-list/status callbacks do not currently expose `Project`, although
  `.replit` defines it and the supervised processes, direct restart, dev-domain
  health check, and preview all confirm it is running. Do not create a duplicate
  workflow; retain the existing config until the workflow registry exposes it.
- The existing `release:standard` workflow has a V1-only inventory check that
  fails with `ENOENT` for `artifacts/api-server/package.json`, whose source is
  now archived under `_archived/v1/`. This was not used as a V2 pass; the V2
  focused test, browser, database, and build checks were run instead. The
  V1-specific release inventory must be retired or pointed at its preserved
  archive before root `release:standard` can be used as V2 evidence.
- The first manual worker-restart assertion expected `active` while no run was
  due; the worker correctly reported `standby`. A follow-up check accepted the
  idle status and confirmed a new worker process and healthy API response.
- The initial process-start smoke command accidentally launched the supervisor
  with a deliberately invalid test database URL and timed out; no real URL or
  database was used. The launcher was then tested with a stub supervisor, and
  the actual preview subsequently started and passed its health check.
- Before publishing, the owner must review the Replit-generated production
  schema changes and apply V2 functions, triggers, and grants through the
  supported production SQL-console/publish process. The agent has no write
  access to the production database.
- Resolve the development-role observation against Replit's general guidance,
  and confirm the actual production app role without exposing its connection
  string. Replit's [database guidance](https://docs.replit.com/features/data-and-storage/sql-database)
  says custom roles are not supported; if the published role is privileged,
  keep V2 unpublished or use an approved external database.
- The configured deployment run script deliberately exits with status 78 and a
  clear message. Restore the production V2 run command only after the database
  role and SQL-object gates are resolved; do not remove this guard to bypass
  them.
- After production database preparation, the owner must initiate publication.
  Then verify the serving revision, worker health, synthetic run start/pause/
  resume/auto-track/complete, app and worker restarts, and connection use. No
  real production run or inventory should be created for that verification.
- Extend authenticated browser coverage to recipe and production-setup imports,
  run completion and shortages, then verify those screens in the live private
  preview. Do not transfer V1 sessions or credentials.
