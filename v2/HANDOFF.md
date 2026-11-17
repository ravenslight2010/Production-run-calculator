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
- `db/0001-run-control.sql`, `db/0002-staff-auth.sql`, and
  `db/0003-production-stations.sql` define V2 run, staff-auth, and station
  state. Local checks use a disposable PostgreSQL cluster, including run
  creation, canonical timestamps, scoped reads, station timers and automatic
  progress, manual corrections, stale-revision conflicts, idempotent retries,
  role-scoped identity, opaque session lookup, and HTTP requests through a
  restricted API role.
- `db/0004-import-inventory.sql` adds products, recipes and production setups,
  one-facility/multiple-warehouse stock, an append-only movement ledger, and
  reviewed opening counts. Stock changes are blocked until each warehouse has
  an applied physical opening count; no V1 stock or movement history is copied.
- `db/0006-run-inventory-linkage.sql` adds the manager-designated production
  warehouse, validates inventory units in standard recipe/setup imports, and
  freezes the selected product, setup, linked recipes, packaging quantities,
  and warehouse on each newly created run. Run completion calculates actual
  server-recorded batch and packed-case use, appends the movements and receipt
  atomically, and records shortages without blocking completion or allowing
  negative stock.
- `core/import-csv.mjs` accepts bounded V2 CSV templates for products, recipes,
  production setup, and opening counts. Imports are staged with server-computed
  idempotency, reopenable for manager review, and guarded for safe undo.
- `server/inventory-api.mjs` exposes manager-only, facility-scoped inventory
  functions. It derives actor/scope from the V2 session, enforces CSRF on writes,
  rate-limits CSV staging, and returns safe errors. Managers can designate only
  an active warehouse with an applied opening count for new production runs.
- `core/run-service.mjs` returns the product catalog with compatible imported
  production setups and the designated production warehouse. Run creation
  requires both selections and rejects a server response without the frozen
  recipe/warehouse plan.
- `core/run-command-service.mjs` sends run completion through the database
  wrapper that atomically records exact-once inventory use with the lifecycle
  transition. The completed run exposes a validated inventory receipt,
  including any unfulfilled quantities.
- The manager workspace in `web/` reviews import history and rows, manages
  warehouse stock/transfers, reopens physical counts, and shows the actor,
  reason, and timestamp for paginated ledger entries.
- `server/auth-adapter.mjs` provides V2-owned Argon2id password verification,
  rate-limited sign-in service logic, opaque hashed sessions, CSRF verification,
  and run/station action authorization.
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
- `core/station-auto-track-worker.mjs` advances due station counters on the
  server without an open browser. Database-backed leases coordinate instances,
  while the existing station transaction remains responsible for pause-aware
  time, idempotency, target caps, and fractional carry. Worker state is exposed
  from `/healthz`; retry and shutdown behavior is covered by local checks.
- `api/openapi.yaml` records health, authentication, manager setup, run control,
  production stations, imports, and inventory routes.
- `web/` now connects the username/password sign-in, session check, sign-out,
  run controls, and the Line, Dough, Cheese, Pepperoni, Sauce, Frontline, and
  Packaging station workflows to the V2 API. Station edits, timers, and
  automatic progress use server revisions and canonical responses. The browser
  retains a cached read-only run view offline, refreshes on wake/reconnect, and
  keeps uncertain manual station actions bound to their original staff account.
  Safe timer intents retry a bounded number of times against the latest server
  revision when automatic progress wins a race; manual edits remain visible for
  explicit review. Manager
  tools add reviewed setup imports and multi-warehouse inventory; their writes
  require manager authorization, a confirmed server state, and CSRF.
- Disposable PostgreSQL checks cover guarded first-manager setup and staff
  changes, separate-session run/station conflicts, manager and non-manager
  inventory access, import retries and reopening, review/application,
  warehouse scoping,
  physical-count gating, concurrent stock changes, and balance-to-ledger
  reconciliation. The same check exercises separate staff sessions on run
  revisions and stale-command conflicts. Migration `0006` is tested for frozen
  recipe/warehouse snapshots, per-batch and per-packed-case demand, exactly-once
  completion, stock shortages, and nonnegative on-hand balances.
- V2 now has one-time, secret-guarded first-manager setup plus manager-only
  staff creation, disablement, role changes, and account-session revocation.
  The setup path never imports V1 credentials or sessions.
- Browser automation covers manual-edit conflicts between sessions, offline
  reload and reconnection, plus server-driven station timers and automatic
  progress across desktop and phone-sized Chromium contexts. This is emulated
  browser evidence, not physical-device coverage. Manager inventory screens
  have not been exercised in a real browser.
- The current source includes a database-leased station worker in the V2 server;
  browsers only refresh canonical state and never submit automatic-progress
  ticks. This keeps server-worker timing separate from user timer/manual actions.
  The separate-project pilot must still verify process supervision,
  aggregate connection limits, and whole-deployment restart behavior.
- Production deployment, a separate V2 project, full manager inventory browser
  verification, and physical-device verification remain future work.
- There is no production data connection, V1 data migration, or separate V2
  Replit project.

## Remaining V2 validation

1. Verify the complete manager inventory UI in an authenticated browser using a
   disposable V2 database, including product/recipe/setup imports, opening
   counts, production warehouse selection, movements, transfers, run completion,
   shortages, and mobile/tablet layouts.
2. Verify station calculations against approved floor examples and test station
   workflows, wake/reconnect, and multi-device operation on real phones/tablets.
3. Keep a separate-project VM/database/restart/capacity pilot as a pre-release
   gate.

## Focused checks

Run from the source repository root:

```sh
pnpm --filter @workspace/lucia-v2 test
pnpm --filter @workspace/lucia-v2 test:browser
pnpm --filter @workspace/lucia-v2 test:db
node --check v2/server/main.mjs
node --check v2/web/app.js
```

The PostgreSQL script creates and removes its own temporary local cluster. Do
not point it at V1 or any shared development or production database. Password
hash transfer remains a separate cutover decision; this work has not copied any
V1 accounts, credentials, sessions, or data.
