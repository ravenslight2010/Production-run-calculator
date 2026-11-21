---
name: schema-change-checklist
description: >
  Use this skill whenever you are adding a new column or field to an existing database table —
  whether to mixes, production rules, freezer-pull items, or any other server-persisted entity.
  Triggers on: "add a column", "add a field", "new DB column", "extend the schema", "add isPrep",
  "add a boolean/text/integer column", or any task that requires drizzle schema + API changes together.
  Walks through every ordered step so nothing is silently missed.
---

# Schema Change Checklist

## Canonical ownership

This is the canonical, detailed procedure for adding a field or column to an
existing database table. `.agents/skills/db-schema-change/SKILL.md` is only a
compatibility router for broader schema changes; do not duplicate or maintain
an alternative ordered checklist there.

## When to use this skill

Read this skill **before implementing** any task that adds a new column or field to an existing
database table. The `isPrep` incident is the canonical example of what goes wrong without it:
the DB column was added, but `openapi.yaml`, codegen, `toApiItem`, `toDbValues`, and the
`onConflictDoUpdate` SET clause were each missed at different points, causing silent failures
(the field was accepted by the DB but never round-tripped to or from the API).

---

## Ordered checklist

Work through every step in sequence. Do not skip ahead — later steps depend on earlier ones.

### 1. Drizzle schema file

**File pattern:** `lib/db/src/schema/<table>.ts`  
**Example:** `lib/db/src/schema/mixes.ts`

- Add the column using a drizzle column builder (`boolean`, `text`, `integer`, `real`, `jsonb`, …).
- Give it a `.notNull().default(<value>)` so the ADD COLUMN is a single non-interactive DDL statement.
- Do **not** use `.unique()` on a populated table — it triggers a truncate prompt that hangs the
  non-interactive push. Use `uniqueIndex("name").on(col1, col2)` instead (see additive-push-force
  constraint below).
- Do **not** add the new column into a composite `primaryKey({ columns: [...] })` — drizzle-kit
  mis-orders the DDL and emits `ALTER COLUMN SET NOT NULL` before the column exists. Use
  `uniqueIndex` + `onConflictDoUpdate({ target: [...] })` instead.

### 2. Push the schema (additive-push-force)

```bash
pnpm --filter @workspace/db run push-force
```

- `push-force` (not plain `push`) is required everywhere — post-merge scripts and prod migrations
  run without a TTY, so any interactive prompt is fatal.
- After the push, verify with `\d <table>` in psql or via `information_schema.columns` that the
  new column actually landed. A failed push rolls back cleanly (nothing lands), so absence of the
  column after failure means fix the schema and re-push.
- The isolated task DB often lags the Drizzle schema (see
  `.agents/memory/isolated-db-may-predate-migrations.md`). Check `information_schema.columns` first
  if the push behaves unexpectedly.

### 3. openapi.yaml — BOTH request and response schemas

**File:** `lib/api-spec/openapi.yaml`

- Find the `components/schemas/<Entity>` object (e.g. `Mix`) — this is the **response** shape.
  Add the new field here.
- Find any **request** body schemas that write this entity (e.g. `SaveMixesBody`, `MixInput`).
  Add the new field there too.
- Mark the field `nullable: true` or give it a default / mark it optional (`required: [...]`) as
  appropriate so existing clients that omit the field don't break.
- Common miss: adding to the response schema but forgetting the request body schema (or vice versa).

### 4. Codegen — regenerate types and client hooks

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates two output trees from `openapi.yaml`:

| Output | Location |
|---|---|
| TypeScript types (Zod schemas) | `lib/api-zod/src/generated/` |
| React Query hooks + fetchers | `lib/api-client-react/src/generated/` |

- **Do not hand-edit generated files.** If you need a type tweak, fix `openapi.yaml` and re-run
  codegen.
- After running codegen, confirm the new field appears in the generated type file (e.g.
  `lib/api-zod/src/generated/types/mix.ts`).

### 5. `toApiItem` — DB row → API response

**File pattern:** `artifacts/api-server/src/routes/<entity>.ts`  
**Example:** `artifacts/api-server/src/routes/mixes.ts`, function `toApiItem`

- Map the new DB column to the new API field.
- Default carefully: if the DB column is `boolean NOT NULL DEFAULT false`, use `row.newField ?? false`
  (the `??` guards against any legacy `null`s from a pre-migration snapshot).

```typescript
// Example — adding isPrep
function toApiItem(row: MixRow): Mix {
  return {
    ...
    isPrep: row.isPrep ?? false,  // ← add this
  };
}
```

### 6. `toDbValues` — API body → DB insert/update values

In the same route file, update `toDbValues` (or the equivalent inline insert values object):

```typescript
function toDbValues(item: Mix) {
  return {
    ...
    isPrep: item.isPrep ?? false,  // ← add this
  };
}
```

- If `toDbValues` omits a field that exists in the DB, Drizzle uses the column default on INSERT
  and **silently drops the caller's value on UPDATE** — the column stays at its default forever.

### 7. `onConflictDoUpdate` SET clause

In the same route file, find every `.onConflictDoUpdate({ ..., set: { ... } })` call and add the
new field:

```typescript
.onConflictDoUpdate({
  target: [mixesTable.id, mixesTable.scope],
  set: {
    ...
    isPrep: values.isPrep,  // ← add this
  },
})
```

- This is the most commonly missed step. An omission means upserts silently keep the old value —
  the field updates correctly on first insert but never changes on subsequent saves.
- There may be multiple `onConflictDoUpdate` calls in a file (e.g. batch loops). Update all of them.

### 8. Typecheck

```bash
pnpm --filter @workspace/api-server run typecheck
```

TypeScript will catch any mismatch between the generated `Mix` type and what `toApiItem` /
`toDbValues` return. Fix any errors before proceeding.

Also run the relevant workspace-level typecheck if the field is consumed outside the route:

```bash
pnpm --filter @workspace/mixes run typecheck   # if the shared lib uses the type
pnpm --filter @workspace/api-zod run typecheck  # should be clean after codegen
```

### 9. Frontend consumers

Search for every place the entity type is used in the web and mobile apps:

```bash
grep -r "\.isPrep" artifacts/run-calculator/src lib --include="*.ts" --include="*.tsx"
grep -r "Mix\b" artifacts/run-calculator/src --include="*.ts" --include="*.tsx" -l
```

- Any component or hook that spreads or destructures the API type now has access to the new field.
- If the new field drives UI behavior, add the rendering/logic here.
- If the frontend sends the field back (e.g. via a save form), confirm the form state type includes
  it and it is included in the POST body.
- The maintained client in this repository is the web app and shared
  libraries. If a separately maintained native client is also in scope, verify
  its current checkout; do not use an archived path as a source of truth.

### 10. Tests

- If the route has integration tests, add a case that writes and reads back the new field.
- Run: `pnpm --filter @workspace/api-server run test`
- For shared-lib changes, also run the relevant workspace test:
  `pnpm --filter @workspace/mixes run test`

---

## Additive-push-force constraint (summary)

| Situation | Safe approach |
|---|---|
| New nullable or defaulted column | `text("x").default("v")` or `text("x").notNull().default("v")` |
| Uniqueness including new column | `uniqueIndex("name").on(colA, colB)` — never `.unique()` |
| Upsert target | `onConflictDoUpdate({ target: [colA, colB], set: { ... } })` — works against a unique index |
| Singleton settings table | `integer("id").primaryKey().default(1)` — never `serial` on an existing column |
| New composite PK with new column | ❌ Never — use `uniqueIndex` instead |

See `.agents/memory/additive-push-force-schema.md` for the full rationale.

---

## Common misses (quick reference)

1. **`onConflictDoUpdate` SET clause** — field omitted → upserts silently keep old value forever.
2. **Request schema in `openapi.yaml`** — added to response but not request → field accepted by DB,
   never sent by client.
3. **Response schema in `openapi.yaml`** — added to request but not response → field saved but never
   returned to the frontend.
4. **Codegen not re-run** — `openapi.yaml` updated but generated types stale → TypeScript doesn't
   catch mismatches, runtime shape mismatch.
5. **`toDbValues` omission** — field mapped in `toApiItem` but missing in `toDbValues` → reads work,
   writes silently drop the value.
6. **Multiple `onConflictDoUpdate` calls** — batch loops may have more than one; only the first is
   updated.
7. **Push vs push-force** — plain `push` prompts on populated tables; always use `push-force` in
   this repo.

---

## Worked example: `isPrep` on the `mixes` table

This is the canonical incident this skill was written to prevent.

| Step | File changed |
|---|---|
| 1. Schema | `lib/db/src/schema/mixes.ts` — added `isPrep: boolean("is_prep").notNull().default(false)` |
| 2. Push | `pnpm --filter @workspace/db run push-force` |
| 3. openapi.yaml | `lib/api-spec/openapi.yaml` — added `isPrep` to `Mix` (response) and `SaveMixesBody` (request) |
| 4. Codegen | `pnpm --filter @workspace/api-spec run codegen` → regenerated `lib/api-zod/src/generated/types/mix.ts` |
| 5. toApiItem | `artifacts/api-server/src/routes/mixes.ts` — `isPrep: row.isPrep ?? false` |
| 6. toDbValues | same file — `isPrep: item.isPrep ?? false` |
| 7. onConflictDoUpdate | same file — `isPrep: values.isPrep` in the SET clause |
| 8. Typecheck | `pnpm --filter @workspace/api-server run typecheck` |
| 9. Frontend | search `artifacts/run-calculator/src` and relevant `lib/*` consumers; separately verify any native client from its current checkout |

---

## Key file locations

| Purpose | Path |
|---|---|
| DB schema files | `lib/db/src/schema/` |
| Drizzle config | `lib/db/drizzle.config.ts` |
| OpenAPI spec | `lib/api-spec/openapi.yaml` |
| Orval codegen config | `lib/api-spec/orval.config.ts` |
| Generated Zod types | `lib/api-zod/src/generated/types/` |
| Generated React Query hooks | `lib/api-client-react/src/generated/` |
| API route files | `artifacts/api-server/src/routes/` |
| Mixes route (worked example) | `artifacts/api-server/src/routes/mixes.ts` |
| Additive push-force memory | `.agents/memory/additive-push-force-schema.md` |
