---
name: DB integration test harness
description: How to integration-test code that uses the @workspace/db singleton against a real, disposable Postgres.
---

# Real-DB integration tests (api-server)

`@workspace/db` binds its `pool`/`db` to `process.env.DATABASE_URL` **at import
time**. To integration-test route logic that uses that singleton (e.g. inventory
auto-deduct `drawDown`/`consumeRun`), the test must spin up an isolated DB and
point the env var at it *before* importing the module-under-test.

Pattern (see `artifacts/api-server/src/routes/inventory.integration.test.ts`):

1. In `beforeAll`: open an admin `pg.Pool` on the dev `DATABASE_URL`, then
   `CREATE DATABASE "helium_test_<ts>_<rand>"` (the Replit Postgres role is
   superuser w/ createdb).
2. Build the real schema in it by spawning `pnpm --filter @workspace/db run
   push-force` with `env.DATABASE_URL` = the throwaway DB URL (no hand-written
   DDL → no drift from `lib/db/src/schema`).
3. Set `process.env.DATABASE_URL` to the throwaway URL, THEN `await import(...)`
   `@workspace/db` and the route module (dynamic import is mandatory — static
   imports would bind the singleton to the dev DB first).
4. `beforeEach`: `TRUNCATE ... RESTART IDENTITY CASCADE` for isolation.
5. `afterAll`: `pool.end()` (release connections) → `DROP DATABASE ... WITH
   (FORCE)` → restore original `DATABASE_URL`.

**Why a real DB, not pglite:** FOR UPDATE concurrency can only be exercised with
multiple real connections. The concurrency test fires two `consumeRun`s (or N
`drawDown`s) via `Promise.all`; the lock serializes them so total drawn caps at
available and no lot goes negative.

**How to apply:** reuse this harness for any other DB-backed route test (e.g. the
manual stock-correction/adjust path). `pg` + `@types/pg` are devDeps of
api-server purely for this harness.
