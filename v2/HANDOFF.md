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

- V1 is no longer live. Preserve its source baseline and data while developing
  V2 under `v2/`; do not move shared V1 code until dependency ownership is mapped.
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

The source is under this `v2/` directory and is registered as its own workspace
package. It is not deployed, and no separate V2 Replit project or artifact has
been created.

- `core/run-lifecycle.mjs` contains the server-time, revision-checked lifecycle
  model for start, pause, resume, and completion.
- `core/run-command-service.mjs` validates authenticated command context,
  authorizes the action, computes the request hash, and calls the database
  transaction boundary.
- `core/run-service.mjs` provides authorized creation, detail reads, and bounded
  facility-scoped run lists through database functions.
- `db/0001-run-control.sql` and `db/0002-staff-auth.sql` define the V2 run and
  staff-auth schemas. Their local checks use a disposable PostgreSQL cluster,
  including run creation, canonical timestamps, scoped reads, command
  retry/concurrency, role-scoped identity, opaque session lookup, revocation,
  and HTTP requests through a restricted API role.
- `server/auth-adapter.mjs` provides V2-owned Argon2id password verification,
  rate-limited sign-in service logic, opaque hashed sessions, CSRF verification,
  and run-action authorization.
- `server/auth-api.mjs` provides JSON sign-in, session-read, and sign-out routes.
  Sign-in sets an HttpOnly session cookie and a separate CSRF cookie; tokens and
  credentials are not returned in JSON.
- `server/run-api.mjs` is a request-scoped HTTP handler factory with bounded
  JSON input, safe errors, and required authentication and CSRF adapters.
- `server/api.mjs` serves the V2 web page/assets and composes authentication,
  health, and run routes with restrictive browser headers, request IDs, and
  bounded, payload-free request logs.
- `server/main.mjs` starts the API with `pg`, a bounded pool, startup database
  probe, `/healthz`, and graceful shutdown. It requires `V2_DATABASE_URL` and
  never reads V1 `DATABASE_URL`; it does not run migrations automatically.
- `api/openapi.yaml` records the health, authentication, and run-control routes.
- `web/` now connects the username/password sign-in, session check, sign-out,
  and run controls to the V2 API. It keeps run data hidden until the server
  confirms a session, disables writes while offline or until a fresh run-list
  read completes, and binds saved uncertain actions to their original staff
  account.
- A disposable PostgreSQL-backed HTTP integration test creates two separate
  staff sessions, verifies both see the same run, applies a lifecycle command
  from one session, and confirms the other session receives the new revision
  and a conflict for a stale command.
- There is no controlled manager/account provisioning, station workflow,
  inventory/import implementation, auto-track worker, PWA recovery, or real
  browser/device verification yet.
- There is no production data connection, V1 data migration, or separate V2
  Replit project.

## Next implementation milestone

Continue the first usable run-control slice in this order:

1. Add a controlled first-manager bootstrap and manager-only account/role
   management. Do not add public registration or copy V1 hashes, accounts,
   sessions, or data without the separate cutover process.
2. Verify the sign-in and run-control interface in a real browser at phone and
   desktop sizes, including background/foreground recovery and retained actions.
3. Keep a separate-project VM, database, restart, publish, and capacity pilot as
   a pre-release gate.

## Focused checks

Run from the source repository root:

```sh
pnpm --filter @workspace/lucia-v2 test
pnpm --filter @workspace/lucia-v2 test:db
node --check v2/server/main.mjs
node --check v2/web/app.js
```

The PostgreSQL script creates and removes its own temporary local cluster. Do
not point it at V1 or any shared development or production database. Password
hash transfer remains a separate cutover decision; this work has not copied any
V1 accounts, credentials, sessions, or data.
