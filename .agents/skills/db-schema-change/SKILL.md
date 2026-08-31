---
name: db-schema-change
description: Handle any change to the Postgres schema under lib/db/src/schema/*. Use whenever modifying, adding, or removing a Drizzle table/column, or when a migration/db push is needed. Encodes the rules for this app: additive-only on populated tables, use db push (plain push hangs; push-force), re-run lib typechecks after touching the schema, and consult the relevant .agents/memory docs (e.g. data-heal-playbook) because schema changes affect stored data.
---

# DB Schema Change

Apply before and after any edit under `lib/db/src/schema/*`.

1. **Prefer additive-only on populated tables** — production data already exists. Adding a table, or adding a nullable/`withDefault` column, is safe. Dropping or renaming columns/tables on populated tables destroys data — design for additive first, and if a destructive change is truly required, say so in plain language to the user before doing it.

2. **Update/regenerate zod schemas as needed** — the API contract derives zod schemas from the Drizzle schema (`createInsertSchema` / `createSelectSchema`). If a raw jsonb field breaks an inferred schema (v3/v4-type errors seen in `auditLog.ts` / `syncConflictLog.ts`), replace it with an explicit zod schema rather than leaving inferred types broken.

3. **Run typechecks after the change** — `CI=true pnpm run typecheck` at root, plus any leaf typecheck under the touched package. DB schema changes ripple into the API server and shared libs, so a root typecheck is required.

4. **Push the schema, don't hand-apply SQL** — use the db push flow for dev. `db push` plain can hang; use `db push-force` for the dev/CI database. Confirm the change is pushed in dev before committing. (No local Postgres: true verification happens in the CI `test-db` job with the Postgres service container.)

5. **Consult `.agents/memory` first** — this repo stores operational knowledge about how schema changes interact with stored data (see `data-heal-playbook`, `replit.md`). If a schema change invalidates already-saved rows (profiles, pools, day-state), a bug-fix alone is not enough — plan a data heal and tell the user what will change live.

6. **Keep the OpenAPI contract in sync** — if the change alters request/response shapes, update `lib/api-spec` so the web app and API server agree. Additive columns usually need an API-visible shape only if the client consumes them.
