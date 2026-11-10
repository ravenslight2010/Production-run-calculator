# V2 development area

This directory is an isolated, code-only starting point for V2. It is not
registered as a workspace, workflow, artifact, or deployment, and it must not
connect to V1 databases or credentials.

See [HANDOFF.md](./HANDOFF.md) for the approved V2 scope, data-transfer
decisions, current implementation status, and the next run-control milestone.

Research record: [portable V1-to-V2 research bundle](research/README.md).
Prepared 2026-11-10; current V1 checks are bound to revision
`dc6e5205f55fa74005373c6d7f06fae8df0f3399`. It preserves evidence and
recommendations, not authorization to implement or cut over.

The first slice now contains a pure run-lifecycle model and a PostgreSQL
transaction boundary for start, pause, resume, and complete. That boundary
records idempotency receipts, revisions, audit events, and outbox events
atomically, and has been tested against a disposable local PostgreSQL instance.
Run creation, bounded facility-scoped reads, a request-scoped HTTP handler, an
OpenAPI contract, and a run-control screen draft are also present. It is not yet
a usable app: the session and CSRF adapters, executable API host, browser-to-API
integration, station state, the auto-track worker, PWA behavior, and
two-session/browser verification are still missing.

The database function is backend-only. A future API must derive facility and
actor identity from verified authorization, compute the request hash itself,
and never expose database credentials or direct SQL access to a browser. The
schema revokes public table access; grant the future API role only schema use
and execute permission for the command function, not direct table writes.
Production deployment validation still requires a separate V2 Replit project
and disposable database; that is not a prerequisite to writing isolated code
here.

Run the current focused checks from the repository root:

```sh
node --test v2/core/*.test.mjs v2/server/*.test.mjs
bash v2/db/run-local-tests.sh
node --check v2/web/app.js
```

The SQL script creates a temporary PostgreSQL cluster under the system temp
directory, binds it to loopback only, runs schema/lifecycle/receipt checks,
server-owned create/read checks, and concurrent retry/conflict checks, then
stops and removes the cluster. It does not read or write either V1 database.
