# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Pizza production line planning, scheduling, and inventory for floor staff (web + mobile).
- **AI issue diagnosis & manager alerts:** any signed-in user can report an issue and get an immediate plain-language AI diagnosis plus a safe workaround; uncaught crashes are auto-captured. Each becomes a server-side "incident" with an AI diagnosis. Managers get an incident list, an unreviewed-count nav badge, and can mark incidents reviewed. The AI never edits code — a "fix" is an explanation plus safe-recovery steps. See `.agents/memory/incident-diagnosis.md`.

## User preferences

- **Keep web and mobile at parity.** Any feature added, removed, or changed must be applied to BOTH `artifacts/run-calculator` (web) and `artifacts/run-calculator-mobile` (Expo). Match formulas exactly across both. Mobile is local-only (AsyncStorage `run-calc-mobile-v2`, additive migration via `normalizeState`/`normalizeSettings`); web is its own app — adapt storage/UI per platform but keep behavior identical.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
