# V2 project handoff

This file carries the approved V2 decisions and current implementation status
when the V2 source is moved into a separate Replit project. It supplements the
code; it does not contain credentials or production data.

Research record: [portable V1-to-V2 research bundle](research/README.md),
prepared 2026-11-10 and checked against V1 revision
`dc6e5205f55fa74005373c6d7f06fae8df0f3399`. It is evidence and planning
context, not additional implementation or cutover approval.

## Product scope

The first usable V2 release is a web/PWA production tool with:

- Run control and every production station.
- Importing, synchronization, and automatic tracking.
- Full inventory workflows.
- Multiple devices able to work on the same active run from the first release.
- Read-only operation while disconnected; writes resume after reconnecting.

## Architecture and deployment boundary

- Keep the published V1 project, its runtime, deployment configuration, and
  database untouched while developing V2.
- V2 must be a separate Replit project for an independent database and
  deployment. A second artifact in the V1 project is not isolation: artifacts
  in one project share backend, database, secrets, and publishing lifecycle.
- The approved starting architecture is one V2 deployment with supervised API
  and worker processes using one V2 database. Validate it in the separate V2
  project before publishing.
- The server owns canonical run state. Lifecycle commands use revisions and
  stable idempotency keys; their state change, receipt, event, and outbox entry
  are committed atomically.
- Browser identity and permissions must come from verified server
  authentication. Never accept facility or actor identity from the browser.
- Do not use V1 credentials or connect V2 code to the V1 production database.

## V1 data at cutover

- Carry setup and master data, plus staff identities and roles.
- Require staff to sign in again. Do not transfer sessions or reset tokens.
- Do not carry historical production runs into V2.
- Establish opening inventory from a new physical count, not V1 balances.
- A previously requested full production-to-development preservation copy is
  separate from V2 cutover. No data copy was completed as part of this V2 work.

## Current V2 source status

The source is under this `v2/` directory. It is not yet a runnable or deployed
application, and no separate V2 Replit project or artifact has been created.

- `core/run-lifecycle.mjs` contains the server-time, revision-checked lifecycle
  model for start, pause, resume, and completion.
- `core/run-command-service.mjs` validates authenticated command context,
  authorizes the action, computes the request hash, and calls the database
  transaction boundary.
- `core/run-service.mjs` provides authorized creation, detail reads, and bounded
  facility-scoped run lists through database functions.
- `db/0001-run-control.sql` and `db/run-local-tests.sh` define and test the
  initial V2 schema and lifecycle transaction against a disposable local
  PostgreSQL cluster, including run creation, canonical timestamps, scoped
  reads, and command retry/concurrency checks.
- `server/run-api.mjs` is a request-scoped HTTP handler factory with bounded
  JSON input, safe errors, and required authentication and CSRF adapters.
- `api/openapi.yaml` records the local V2 run-control API contract.
- `web/` contains the run-control screen draft and uses the matching API routes,
  but no executable API host or real session/CSRF adapter is connected yet.
- There is no production data connection, V1 data migration, browser/device
  verification, or separate V2 Replit project.

## Next implementation milestone

Complete the run-control slice in this order:

1. Add the V2 session, permission, and CSRF adapters plus an executable API host
   that uses a V2-only database connection.
2. Wire the run services and HTTP handler to that host without importing V1
   runtime, database credentials, or session state.
3. Connect `web/` end to end and handle conflicts, uncertain responses,
   reconnects, and foreground refreshes without inventing success.
4. Test run creation and lifecycle transitions against disposable PostgreSQL;
   verify two independent browser sessions converge on the same server revision.
5. Keep a separate-project VM, database, restart, publish, and capacity pilot as
   a pre-release gate.

## Focused checks

Run from the source repository root:

```sh
node --test v2/core/*.test.mjs v2/server/*.test.mjs
bash v2/db/run-local-tests.sh
node --check v2/web/app.js
```

The PostgreSQL script creates and removes its own temporary local cluster. Do
not point it at V1 or any shared development or production database.
