---
name: drizzle-best-practices
description: "Review or implement PostgreSQL queries, transactions, relations, result decoding, and inferred types using this project's installed Drizzle ORM. Use for db.select, insert/update/delete, aggregates, Drizzle type errors, or query performance. For schema changes compose with db-schema-change or schema-change-checklist; this skill does not authorize migrations or dependency upgrades."
---

# Drizzle PostgreSQL Practices

Focused adaptation of the licensed uploaded guide. See `SOURCE.md` for provenance
and omissions, and `references/query-review.md` for examples and review cases.

## Establish the actual API

1. Inspect `lib/db/package.json`, the `drizzle-orm` catalog entry in
   `pnpm-workspace.yaml`, and the relevant installed package/lockfile resolution.
   The catalog was `^0.45.4` at adaptation time; re-check it rather than treating
   that historical value as the current installed version.
2. Follow existing driver initialization and relation registration in `lib/db/src/`.
   Do not assume that SQL-builder and relational APIs share filter syntax.
3. Match the installed version. Do not default to a v1 release candidate, introduce
   `defineRelations` or `drizzle-orm/zod` without verifying support, replace the
   driver/provider, or install/upgrade packages to fit an example.
4. Use `package-management` if a separately authorized dependency change is needed.
   This import itself requires no dependency change.

## Query and mutation review

- Select only required columns, apply facility/auth scope in the query, and use
  bounded pagination with deterministic ordering and a stable tie-breaker.
- Parameterize values with Drizzle operators or tagged SQL. Never interpolate
  user text into raw SQL or identifiers. Review authorized dynamic identifiers
  separately; a value placeholder cannot safely select an arbitrary column.
- Preserve left-join nullability. A join is not inherently wrong or inferior to
  a relational query; select the shape and execution plan the caller needs.
- Type annotations and `sql<T>` do not decode runtime data. Check driver-specific
  aggregate, bigint, numeric/decimal, JSON and timestamp representations.
  Avoid lossy Number conversions for values outside a proven safe domain.
- Require deliberate row and facility predicates for update/delete. Preserve
  generation/version predicates, row locks, unique constraints and idempotency.
  Use `.returning()` when the caller needs the changed row, and handle no rows
  explicitly rather than treating a resolved query as successful mutation.
- Group related writes in a transaction; every operation inside it must use
  the transaction handle. Do not perform unrelated network calls while holding
  database locks. Chunking a batch must not silently remove required atomicity.
- A conflict is not permission to overwrite a newer row or weaken a constraint.
  Verify the actual conflict target and installed upsert API. Preserve the
  documented canonical acknowledgement and conflict contract.
- Use existing bounded acquisition/query deadlines and project error mapping.
  Do not log connection strings, payloads, database rows or raw provider errors.
  Retry only a proven transient operation with bounded, safe semantics; never
  blindly retry a partially committed multi-step mutation.

## Schema and publishing boundary

- New fields on existing tables: use `schema-change-checklist`.
- Other schema work: use `db-schema-change`; persisted repairs also require
  `data-heal-playbook` when appropriate.
- Preserve existing ID generators, defaults, sequence ownership, counters and
  migration compatibility. Generic identity-column advice is not permission
  to convert existing serial/identity columns.
- Replit Publish owns production schema application. Do not add startup DDL,
  run direct production migration commands, or bypass the normal Publish flow.
  Development schema operations still require the owning checklist and
  destructive-change approval; upstream examples do not authorize them.

## Verification and specialist routing

Use `api-design` and `error-handling` for changed API contracts or failure mapping.
Use `sync-invariant-check` and `state-accuracy-check` when their surfaces change.
Use `test-gap-triage` for the smallest effective regression layer and
`verify-before-commit` before claiming checks passed.

For query changes, prove relevant scope, empty results, affected-row conflicts,
aggregate decoding and transaction rollback with isolated fixtures. Inspect
supported package scripts before selecting focused library/API typechecks and
integration cases. Never use production writes as a query experiment.

An ORM review is not a production GO, authorization audit, or permission to
run a release suite on an ordinary task.
