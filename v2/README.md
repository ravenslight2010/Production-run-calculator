# V2 development area

This directory is an isolated V2 build area. V1 is no longer live; preserve its
source baseline and data while replacing functionality here in stages. V2 is a
separate package in the source workspace, not a V1 artifact, workflow, or
deployment. It must not connect to V1 databases, credentials, or sessions.

See [HANDOFF.md](./HANDOFF.md) for the approved V2 scope, data-transfer
decisions, current implementation status, and the next run-control milestone.

Research record: [portable V1-to-V2 research bundle](research/README.md).
Prepared 2026-11-10; current V1 checks are bound to revision
`dc6e5205f55fa74005373c6d7f06fae8df0f3399`. It preserves evidence and
recommendations, not authorization to implement or cut over.

The first slice contains a pure run-lifecycle model and a PostgreSQL transaction
boundary for start, pause, resume, and complete. That boundary records
idempotency receipts, revisions, audit events, and outbox events atomically.
Run creation, bounded facility-scoped reads, V2-owned staff sign-in/session
routes, a V2-only API host, restrictive browser response headers, an OpenAPI
contract, and a browser sign-in/run-control flow are also present. Managers can
create, disable, and change roles for V2 staff accounts. A guarded first-manager
setup form is available only when `V2_INITIAL_MANAGER_BOOTSTRAP_CODE` is
configured and neither a staff account nor the durable bootstrap marker exists.
Set a unique 32–256 character secret
through the V2 environment secret store before initial setup; remove it after
bootstrap. Do not place it in source, chat, or browser storage. The disposable
PostgreSQL checks exercise concurrent first-manager setup, manager-only account
changes, session revocation, and actual HTTP requests from separate staff
sessions. Browser-side run writes remain disabled offline and until the latest
run state is confirmed from V2.

It is not yet a usable app: station-specific workflows, full inventory,
product/setup import, auto-track worker, PWA recovery, and real browser/device
verification remain incomplete. No separate V2 Replit project or deployment
exists.

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
