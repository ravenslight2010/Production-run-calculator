---
name: Isolated destructive browser tests
description: How to isolate Playwright suites whose setup deletes shared live-day data.
---

Do not run a Playwright suite that deletes or replaces the current `daily_sync`
row against the normal workspace database. A PostgreSQL connection URL with an
overridden `search_path` is not sufficient isolation for this project:
`drizzle-kit push` introspects `public`, reports no changes, and leaves the
isolated schema empty.

The owner confirms that Replit's development database is separate from published
production. It is still shared development data, not a disposable test database.

**Why:** The browser-testing environment shares the user's development database,
and active clients may be writing the live day. Briefly deleting and restoring
that row can still lose concurrent edits.

**How to apply:** Treat development and published production as separate, but
do not use the shared development database for destructive tests. Create a
uniquely named temporary database, run the normal schema push against its URL,
start temporary API/web endpoints using that URL, run Playwright there, then
terminate its connections and drop the database in a cleanup trap. Keep
connection URLs out of logs. Verify no temporary database or listener remains
afterward.

For browser suites that only need to inspect layout or exercise a newly created
test account, do not inherit a shared configuration with destructive global
setup at all. Give them a dedicated, non-destructive configuration instead.

The managed development API must not run a general Drizzle schema push at
startup. Preserve the append-only audit-log protection step, then launch the
API without automatic schema synchronization. Deliberate schema changes belong
to the approved schema/release process, not a workflow restart.

**Why:** The owner chose no-push startup after a shared development restart
invoked schema push and its before/after schema delta could not be established.
The owner also chose to leave development data unchanged.

**How to apply:** Keep development startup guarded against schema push and test
that ordering. Do not infer safety from a restart log or attempt an automatic
restore; use an isolated disposable database for tests that require schema
creation.