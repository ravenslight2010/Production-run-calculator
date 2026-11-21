<!-- adapted for Production Run Calculator local Code Agent -->
<!-- offline-friendly; do not require cloud APIs unless the task explicitly needs them -->
---
name: drizzle-best-practices
description: |
---

# Drizzle ORM Best Practices (PostgreSQL)

Comprehensive best practices guide for Drizzle ORM with PostgreSQL. Contains guidance across
8 categories, prioritized by impact to help you write correct, performant, and maintainable
database code.

## Version & API Detection (read this first)

Drizzle is mid-transition to **v1**, and the relations + relational-query APIs differ between
the two major lines. **Check the project's `package.json` before writing code** so you emit the
right syntax:

| Installed `drizzle-orm` | API to use | Install command |
|---|---|---|
| `^1.0.0-rc` or `^1.0.0-beta` | **v1 — the default in this skill.** `defineRelations`, object-syntax relational queries (`where: { … }`, `orderBy: { … }`), validators from `drizzle-orm/zod` | `npm i drizzle-orm@rc` + `npm i -D drizzle-kit@rc` |
| `^0.4x` (e.g. `0.45.2`) | **Legacy.** `relations()` helper, callback/operator relational queries, validators from the separate `drizzle-zod` package | `npm i drizzle-orm` (resolves to 0.45.2) |

The current release candidate is **`drizzle-orm@1.0.0-rc.3`** (the `@rc` tag), which supersedes the
older `@beta` tag the docs still reference in places.

Three things that routinely trip up agents:

- **`@latest` is still `0.45.2`, not v1.** `npm i drizzle-orm` does *not* get you v1 — a new project
  that wants the v1 API must ask for `@rc` explicitly.
- **The SQL-like query builder is unchanged across versions.** `db.select().from(t).where(eq(t.id, 1))`,
  `db.insert()`, `db.update()`, `db.delete()` work identically in 0.45.x and v1. Only the relational
  query API (`db.query`) and relation *definitions* changed. Never rewrite `db.select()` operator
  filters into the relational object syntax.
- **On v1, the relational query API (`db.query`) is driven by `defineRelations`.** Passing a
  legacy `schema` does *not* populate `db.query`. The old `relations()` helper is still importable
  from `drizzle-orm/_relations` so existing relation modules keep compiling during a port, but to
  query relationally on v1 you convert them to `defineRelations`. (Earlier betas exposed a
  `db._query` path; it was removed before `1.0.0-rc.3`.) See `references/relations-defining.md`.

When the version is unstated, default to **v1 (RC)** for new code, but match the existing codebase's
API if you already see legacy `relations()` / callback-style `db.query` patterns in use. Throughout
the reference files, version-specific differences are marked with **"Legacy (v0.45.x)"** callouts.

## When to Apply

Reference these guidelines when:

- Defining table schemas with `pgTable`
- Writing select, insert, update, or delete queries
- Setting up relations between tables using `defineRelations` or the legacy `relations` API
- Configuring `drizzle-kit` for migrations (`generate`, `push`, `pull`)
- Inferring TypeScript types from your schema
- Choosing between the SQL-like API and the relational query API
- Optimizing query performance with prepared statements or batch operations
- Integrating Drizzle with serverless Postgres providers (Neon, Supabase, etc.)

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Schema Design | CRITICAL | `schema-` |
| 2 | Query Patterns | CRITICAL | `query-` |
| 3 | Relations | HIGH | `relations-` |
| 4 | Migrations | HIGH | `migrations-` |
| 5 | Type Safety | MEDIUM-HIGH | `types-` |
| 6 | Performance | MEDIUM | `perf-` |
| 7 | Database Drivers | MEDIUM | `driver-` |
| 8 | Advanced Patterns | LOW | `advanced-` |

## How to Use

Read individual reference files for detailed explanations and code examples:

```
references/engine-postgres.md          # Postgres-specific types, features, and patterns
references/schema-table-definitions.md
references/query-select-patterns.md
references/relations-defining.md
references/_sections.md                # Full index of all references
```

Each reference file contains:

- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Links to official Drizzle documentation

## References

- https://orm.drizzle.team/docs/overview
- https://orm.drizzle.team/docs/sql-schema-declaration
- https://orm.drizzle.team/docs/relations-v2
- https://orm.drizzle.team/docs/perf-queries
- https://orm.drizzle.team/docs/kit-overview
- https://orm.drizzle.team/llms.txt


## Local Code Agent notes
- Prefer repository paths under the configured RUNCALC_REPO / agent checkout.
- Do not touch plant data volumes (e.g. C:\\runcalc\\plant).
- Do not read or write secrets, .env, keys, or production credentials.
- For Production Run Calculator: prefer existing packages (api-server, run-calculator, lib/*) over new frameworks.
