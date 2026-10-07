---
name: db-schema-change
description: Route Postgres/Drizzle schema work that needs additive-safety, API/codegen, typecheck, push-force, or data-heal guidance. For a new field or column on an existing table, use schema-change-checklist directly as the canonical procedure; use this router for new tables and other schema changes.
---

# DB Schema Change

Use this entry point for new tables and other schema work. The detailed,
ordered procedure for adding a field or column to an existing table lives in
`.agents/skills/schema-change-checklist/SKILL.md`; go directly to that skill
instead of maintaining a second checklist.

## Route first

- **Adding a field or column to an existing table:** use
  `schema-change-checklist`. Its ordered steps cover the Drizzle schema,
  additive `push-force`, both OpenAPI directions, generated clients, route
  serialization/upserts, consumers, typechecks, and tests.
- **Adding a new table or another schema change:** use this entry point,
  preserve the same additive and contract rules below, and add a focused
  checklist when the change has special data implications.

## Shared guardrails

1. **Prefer additive-only on populated tables.** Production data already
   exists. Adding a table or a nullable/defaulted column is normally safe.
   Dropping or renaming populated tables/columns destroys data; explain that
   impact before taking a destructive approach.

2. **Keep the API contract in sync.** Update both request and response
   OpenAPI shapes when the field crosses the API boundary, then regenerate
   checked-in Zod and React Query clients. Never hand-edit generated output.
   If a raw `jsonb` field breaks an inferred Zod schema, replace the inference
   with an explicit Zod schema rather than leaving the generated types broken.

3. **Run typechecks after the change.** Use `CI=true pnpm run typecheck` at
   the root and the relevant leaf checks. Schema changes ripple into the API
   server and shared libraries.

4. **Push the schema, don't hand-apply SQL.** Use
   `pnpm --filter @workspace/db run push-force` for the dev/CI database;
   plain `push` can hang on an interactive prompt. Verify the resulting
   schema before committing.

5. **Check stored-data impact before editing.** Read the relevant
   `.agents/memory` guidance. If the change repairs or invalidates existing
   profiles, pools, or day-state, route to
   `.agents/skills/data-heal-playbook/SKILL.md`, plan a marker-guarded heal,
   and tell the user what will change live. A schema edit alone is not a data
   repair.
