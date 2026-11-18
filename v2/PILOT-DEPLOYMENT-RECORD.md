# V2 in-workspace pilot record

**Status: V2 development preview remains available; private production launch is prepared but blocked by Networking port mappings and first-manager bootstrap.**

Updated 2026-11-18, America/Chicago.

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
- The project is unpublished. The deployment run command now starts the
  supervised V2 launcher rather than the earlier unconditional publish guard.
  The app has not been published or cut over.
- The validated `.replit` replacement has restored five extra external port
  mappings. Replit's Networking tool is the authoritative place to remove
  them; keep only local port 5000 mapped externally to 80.

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
- Development health checks previously showed the API and worker sessions using
  a superuser role. A production read-only SQL check now reports `neondb_owner`
  (`rolsuper=false`, with elevated role/database creation and RLS-bypass
  attributes). The owner accepted this role for a private pilot. The API and
  worker now log their connected `current_user` at startup without logging the
  connection string; verify those logs after private publication.
- Production read-only metadata checks found the expected 21 V2 tables, 49
  functions, and 7 triggers. All function and trigger definitions and 324
  table/index/constraint fingerprints match development. Production has no
  PUBLIC schema or table privileges; default PUBLIC EXECUTE remains on the
  functions, but PUBLIC cannot use the schema. Review revoking that latent
  privilege before broadening access.

## Data and secrets boundary

- No V1 database, data, sessions, credentials, or inventory was used.
- No V1-to-V2 data transfer has happened. V2's initial manager was created
  directly in the V2 schema; no V1 account or opening inventory was transferred.
- The owner created the first manager through the guarded bootstrap flow and
  confirmed signing out and back in through the normal sign-in flow. A
  read-only database check found one enabled manager and the durable bootstrap
  marker; the API now reports first-manager setup unavailable. The one-time
  `V2_INITIAL_MANAGER_BOOTSTRAP_CODE` secret was removed after setup.
- Production currently has zero V2 staff accounts, manager accounts, sessions,
  bootstrap markers, runs, and inventory balances. No production bootstrap
  secret is configured; the owner must create a fresh one-time code for the
  private pilot and remove it after manager creation.
- The owner confirmed normal sign-out/sign-in. A separate Chromium integration
  now signs in through the real V2 server and exercises manager product import,
  reviewed opening counts, warehouse assignment, stock receipt/transfer, and
  persistence after reload against disposable PostgreSQL data. The live preview's
  manager inventory and production screens remain unverified by the agent.
- Production reads in this pass were read-only metadata and aggregate counts.
  No production rows were written, copied, or published. Do not paste database
  URLs or bootstrap codes into chat.
- The preview's initial unauthenticated session check returns HTTP 401 by design;
  the sign-in page renders and `/healthz` is healthy. The screenshot browser does
  not carry the owner's session; the owner-confirmed sign-in and isolated
  authenticated browser integration are separate evidence.

## Checks completed

These checks use local code, disposable fixtures, or the V2 development schema;
they do not prove production or physical-device behavior.

| Check | Result |
| --- | --- |
| V2 unit and API suite | PARTIAL — 136 tests passed; one deployment-port configuration assertion failed |
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
| Production object metadata | PASS — definitions match development; PUBLIC schema/table privileges absent |
| V2 production dependency audit | PASS — no known vulnerabilities in V2 production dependencies |
| Production runtime role | BLOCKED — not yet verified in API/worker startup logs |
| Private deployment | BLOCKED — five external port mappings remain; no production first manager/bootstrap secret |
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
- The project owner must remove external mappings for 5173, 8081, 4200, 3001,
  and 5000 in Tools → Networking, leaving only local 5000 → external 80. The
  current V2 deployment test fails until those mappings are gone.
- Production SQL metadata matches development, but the app runtime identity is
  not proven until the private app starts and emits the new API/worker identity
  log. The owner accepted `neondb_owner` for a private pilot only.
- Before publication, the owner must configure a fresh one-time production
  manager bootstrap code securely. After private publish, create the first
  manager, then remove the code. Do not copy V1 data as part of this step.
- After Networking and bootstrap preparation, the owner must initiate a private
  publication. Then verify the serving revision, worker health, synthetic run start/pause/
  resume/auto-track/complete, app and worker restarts, and connection use. No
  real production run or inventory should be created for that verification.
- Extend authenticated browser coverage to recipe and production-setup imports,
  run completion and shortages, then verify those screens in the live private
  preview. Do not transfer V1 sessions or credentials.
