---
name: Integration test DB binding
description: Why integration tests must avoid static imports that transitively pull in @workspace/db
---

In the api-server `*.integration.test.ts` pattern (create throwaway Postgres DB →
push schema → `process.env.DATABASE_URL = testUrl` → dynamic-import the app), the
db pool binds to `process.env.DATABASE_URL` **at module import time**.

**Rule:** the test file must not statically `import` anything that transitively
imports `@workspace/db`. Doing so binds the singleton pool to the original (dev)
DATABASE_URL *before* `beforeAll` repoints it at the throwaway DB.

**Why:** `roles.integration.test.ts` works because it only statically imports
`../lib/auth` (no db). A test that statically imported `../lib/sessionBoundary`
(which imports `@workspace/db`) bound the pool to the dev DB, then failed on
`TRUNCATE ... users` because the isolated dev DB can lag the Drizzle schema (no
`users` table) — see `isolated-db-may-predate-migrations.md`.

**How to apply:** load such helpers via `await import(...)` inside `beforeAll`,
after setting `DATABASE_URL`, exactly like `db`, the router, and
`clearUserValidityCache` are loaded. Only db-free modules (e.g. `lib/auth`
`signToken`) are safe as static imports.
