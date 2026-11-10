# V2 development area

This directory is an isolated, code-only starting point for V2. It is not
registered as a workspace, workflow, artifact, or deployment, and it must not
connect to V1 databases or credentials.

The first slice now contains a pure run-lifecycle model and a PostgreSQL
transaction boundary for start, pause, resume, and complete. That boundary
records idempotency receipts, revisions, audit events, and outbox events
atomically, and has been tested against a disposable local PostgreSQL instance.
It is not yet a usable app: authenticated HTTP routes, run creation and reads,
station state, the auto-track worker, the web/PWA, and device-level verification
are still missing.

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
node --test v2/core/*.test.mjs
bash v2/db/run-local-tests.sh
```

The SQL script creates a temporary PostgreSQL cluster under the system temp
directory, binds it to loopback only, runs schema/lifecycle/receipt checks plus
two concurrent-command checks, then stops and removes the cluster. It does not
read or write either V1 database.
