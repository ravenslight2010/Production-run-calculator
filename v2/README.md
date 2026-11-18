# V2 development area

This directory is the V2 application source. V1 is archived and no longer live;
preserve its source baseline and data while replacing functionality here in
stages. The owner approved converting this workspace to V2 and using the
project-managed database with V2 objects restricted to schema `v2`. This is
schema isolation, not a separate physical database. V2 must not access V1
schemas, credentials, or sessions.

See [HANDOFF.md](./HANDOFF.md) for the approved V2 scope, data-transfer
decisions, current implementation status, and the next implementation steps.

Research record: [portable V1-to-V2 research bundle](research/README.md).
Prepared 2026-11-10; current V1 checks are bound to revision
`dc6e5205f55fa74005373c6d7f06fae8df0f3399`. It preserves evidence and
recommendations, not authorization to implement or cut over.

The V2 source includes server-owned run lifecycle and production-station
routes, plus controlled manager setup. Line, Dough, Cheese, Pepperoni, Sauce,
Frontline, and Packaging have station-specific inputs and progress, validated
calculations, shared timers, manual correction, and server-clock automatic
progress. A database-backed worker advances due progress without an open
browser; clients only refresh canonical state and never submit auto-track
ticks. Run and station updates use revisions, idempotency receipts, events,
and outbox records.

In Replit preview and the configured VM target, `process-compose` supervises the
API and station worker as separate processes. The launcher selects the exact
Node version from `.nvmrc`; the worker health listener is loopback-only.

A secret-guarded first-manager setup is available only when
`V2_INITIAL_MANAGER_BOOTSTRAP_CODE` is configured and neither a staff account nor
the durable bootstrap marker exists. Managers can create, disable, and change
roles for V2 staff accounts; account changes revoke affected sessions. Use a
unique 32–256 character secret from the environment secret store, then remove it
after bootstrap. Never place it in source, chat, or browser storage.

The browser provides a read-only cached view while disconnected and refreshes
from the server before writes resume. Disposable PostgreSQL checks cover
bootstrap, manager account changes, station updates, setup import retries,
warehouse inventory reconciliation, and run-completion consumption. Browser
tests cover desktop and phone-sized station views, manual conflicts, offline
reload/recovery, automatic progress, timer conflicts, and manager import
workflows. The disposable database suite also runs an authenticated Chromium
journey against the real V2 server for product import, reviewed opening counts,
warehouse assignment, receipt, transfer, and reload persistence.

Manager-only setup imports and inventory also run against the V2 database. The
first import format is V2 CSV for products, recipes, production setup, and
reviewed physical opening counts. Managers can reopen staged imports, apply or
safely undo them, manage multiple warehouses in the one facility, and review a
paginated append-only movement history. Runs require an imported product and
linked production setup, and a manager-designated warehouse with an applied
opening count. Each run freezes its recipe and warehouse. Completion deducts
actual server-recorded station batches and packed cases once; it records any
shortage without blocking run completion or allowing negative stock. No V1
balances, stock history, credentials, or sessions are copied.

V2 remains incomplete as a production replacement: the live preview's full
manager inventory journey, recipe and production-setup imports, run-completion
and shortage UI, production database functions/triggers/grants, and
physical-device behavior remain unverified. No production publish has been
initiated. The deployment run command intentionally blocks publication until
the production database gates are resolved; the Project workflow still launches
the private development preview.

Database functions are backend-only. The API must derive facility and actor
identity from verified V2 authorization, compute request hashes itself, and
never expose database credentials or direct SQL access to a browser. Disposable
database tests verify an API role with execute-only access. The current Replit
development preview maps the managed project database through the explicit V2
launcher; its application connection was observed using a superuser role, which
conflicts with Replit's general documentation that application roles are not
superusers and that custom roles are not supported. Both API and worker sessions
were observed with that privilege in development. Verify this project-specific
discrepancy and the actual production role before publishing; do not expose a
connection string. The V2 server requires
`V2_DATABASE_URL`, runs no migrations at startup, and refuses to start if it
cannot connect. The Replit launcher may map the managed `DATABASE_URL` only
when `V2_USE_PROJECT_DATABASE=true`; keep V2 SQL confined to schema `v2` and
preserve all V1 schemas and records. No V1 sessions or data have been copied.
Authentication uses the Node 24.22.2 built-in Argon2id implementation with a
bounded number of concurrent password hash and verification operations; only
salted password hashes are stored in the V2 database.
Production validation now uses this workspace's Reserved VM target after the
owner reviews the deployment and production-database changes. Replit Publish
does not automatically migrate SQL functions, triggers, or grants; verify those
objects through the supported production database process before relying on
them.

Run the current focused checks from the repository root:

```sh
pnpm --filter @workspace/lucia-v2 test
pnpm --filter @workspace/lucia-v2 test:browser
pnpm --filter @workspace/lucia-v2 test:db
node --check v2/server/main.mjs
node --check v2/web/app.js
```

The database script creates a temporary PostgreSQL cluster under the system temp
directory, binds it to loopback only, applies the V2 schema through `0007`, runs
lifecycle, import, opening count, run-consumption, ledger, reconciliation, and
concurrency checks, and exercises manager-authenticated imports and warehouse
operations over HTTP through a restricted V2 API role. It also launches
Chromium (`CHROMIUM_PATH` or `chromium` on `PATH`) to sign in through the real
V2 interface and run a manager inventory workflow against that disposable
database. Setup-catalog imports are covered by synthetic SQL/API lifecycle
checks and a separate responsive Chromium manager journey. The script then
stops and removes the cluster. It does not read or write either V1 database.
`pg@8.23.1` is the V2 package's pinned PostgreSQL driver (MIT); the production
dependency audit reported no known vulnerabilities when checked.
