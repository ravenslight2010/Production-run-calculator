# V2 development area

This directory is an isolated V2 build area. V1 is no longer live; preserve its
source baseline and data while replacing functionality here in stages. V2 is a
separate package in the source workspace, not a V1 artifact, workflow, or
deployment. It must not connect to V1 databases, credentials, or sessions.

See [HANDOFF.md](./HANDOFF.md) for the approved V2 scope, data-transfer
decisions, current implementation status, and the next implementation steps.

Research record: [portable V1-to-V2 research bundle](research/README.md).
Prepared 2026-11-10; current V1 checks are bound to revision
`dc6e5205f55fa74005373c6d7f06fae8df0f3399`. It preserves evidence and
recommendations, not authorization to implement or cut over.

The V2 source includes server-owned run lifecycle and production-station
transactions, authenticated run creation and reads, V2-owned sign-in/session
routes, and controlled manager setup. Line, Dough, Cheese, Pepperoni, Sauce,
Frontline, and Packaging have station-specific inputs and progress, baseline
validated calculations, shared timers, manual correction, and server-clock
automatic progress. Run and station updates use revisions, idempotency receipts,
events, and outbox records.

A secret-guarded first-manager setup is available only when
`V2_INITIAL_MANAGER_BOOTSTRAP_CODE` is configured and neither a staff account nor
the durable bootstrap marker exists. Managers can create, disable, and change
roles for V2 staff accounts; account changes revoke affected sessions. Use a
unique 32–256 character secret from the environment secret store, then remove it
after bootstrap. Never place it in source, chat, or browser storage.

The browser provides a read-only cached view while disconnected and refreshes
from the server before writes resume. Disposable PostgreSQL checks cover
bootstrap, manager account changes, and concurrent station updates from separate
staff sessions. Browser tests cover desktop and phone-sized views, manual
conflicts, offline reload/recovery, automatic progress, and timers across
sessions.

V2 remains incomplete as a production replacement. Approved setup-data import,
full warehouse inventory, a supervised worker for automatic progress while no
browser is connected, production deployment, and physical-device verification
remain separate work. No separate V2 Replit project or deployment exists.

Database functions are backend-only. The API must derive facility and actor
identity from verified V2 authorization, compute request hashes itself, and
never expose database credentials or direct SQL access to a browser. The schema
revokes public table access; the API role receives execute permission for
approved functions, not direct table writes. The V2 host requires
`V2_DATABASE_URL`; it never falls back to `DATABASE_URL`, runs no migrations at
startup, and refuses to start if it cannot connect to its configured database.
No V1 sessions or data have been copied.
Authentication uses the Node 24.22.2 built-in Argon2id implementation with a
bounded number of concurrent password hash and verification operations; only
salted password hashes are stored in the V2 database.
Production deployment validation still requires a separate V2 Replit project
and disposable database; that is not a prerequisite to writing isolated code
here.

Run the current focused checks from the repository root:

```sh
pnpm --filter @workspace/lucia-v2 test
pnpm --filter @workspace/lucia-v2 test:browser
pnpm --filter @workspace/lucia-v2 test:db
node --check v2/server/main.mjs
node --check v2/web/app.js
```

The database script creates a temporary PostgreSQL cluster under the system temp
directory, binds it to loopback only, runs schema/lifecycle/receipt checks,
server-owned create/read checks, concurrent retry/conflict checks, and HTTP
integration through a restricted V2 API role, then stops and removes the
cluster. It does not read or write either V1 database.
`pg@8.23.1` is the V2 package's pinned PostgreSQL driver (MIT); the production
dependency audit reported no known vulnerabilities when checked.
