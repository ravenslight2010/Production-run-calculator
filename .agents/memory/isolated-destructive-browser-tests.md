---
name: Isolated destructive browser tests
description: How to isolate Playwright suites whose setup deletes shared live-day data.
---

Do not run a Playwright suite that deletes or replaces the current `daily_sync`
row against the normal workspace database. A PostgreSQL connection URL with an
overridden `search_path` is not sufficient isolation for this project:
`drizzle-kit push` introspects `public`, reports no changes, and leaves the
isolated schema empty.

**Why:** The browser-testing environment shares the user's development database,
and active clients may be writing the live day. Briefly deleting and restoring
that row can still lose concurrent edits.

**How to apply:** Create a uniquely named temporary database, run the normal
schema push against its URL, start temporary API/web endpoints using that URL,
run Playwright there, then terminate its connections and drop the database in a
cleanup trap. Keep connection URLs out of logs. Verify no temporary database or
listener remains afterward.