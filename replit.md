## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- **Factory data reset:** a manager calls `POST /api/sync/reset` (requires `manage-staff`). In one transaction it clears all `daily_sync` rows for the scope, bumps a per-scope reset epoch, and broadcasts a reset over SSE so every populated client wipes its local copy and reloads — no code change, marker bump, or manual API-down/truncate. Accounts (`users`/`roles`/`user_roles`) are untouched. See `.agents/memory/one-time-data-purge.md`.
- **Source workbook corpus:** the customer's complete source library (19 spec sheets, 13 dough + 15 sauce procedures, cheese/premix/shipping/schedule workbooks) lives in `attached_assets/source-library/{specs,dough,sauce,cheese,premix,shipping,schedule}` — use it for importer tests and audits. Latest audit report: `attached_assets/source-library/AUDIT-REPORT-2026-07-21.md`.
- **Corpus regression harness (no AI):** `test:corpus` workflow runs `lib/corpus-harness` — deterministic parses of the full source-library corpus compared against checked-in JSON snapshots (`lib/corpus-harness/snapshots/*.json`) plus invariant tripwires (grid sanity, dropped rows, mix-vs-cheese routing, near-dup pressure). After an intentional importer behavior change, regenerate snapshots with `pnpm --filter @workspace/corpus-harness run snapshots` and review the diff.
- `pnpm --filter @workspace/scripts run verify-large-spec-import` — manual real-AI check that huge spec imports survive chunking with no data loss; run after any AI model change (needs API server up + manager creds; see script header)
- **Client validation:** `pnpm --filter @workspace/run-calculator run test` runs the client unit suite; `pnpm --filter @workspace/run-calculator run test:e2e:phone` runs the phone-sized Playwright usability smoke suite against the artifact-managed web app.
- **Stable branch delivery:** Develop on `Replit`, which tracks `origin/Replit`, and use pull requests to merge into protected `main`. Local `main` tracks `origin/main` for comparison and diverts ordinary pushes to the backup remote. The legacy `pnpm run push:main` helper targets direct `origin/main` and is expected to be rejected by the live branch rule; do not use it for routine delivery. See `.github/repository-policy.md` and `docs/guarded-github-push.md`.
- Required env: `DATABASE_URL` — Postgres connection string
- Security-relevant env: `STAFF_SIGNUP_CODE` — shared code gating public sign-up (fails closed if unset); `INITIAL_MANAGER_USERNAME` + `INITIAL_MANAGER_ACCESS_CODE` — BOTH must match (exact username, and the access code supplied at sign-up) for a database with no existing manager to bootstrap that account as manager (fails closed if either is unset, i.e. no auto-manager). `INITIAL_MANAGER_ACCESS_CODE` is also independently accepted in place of `STAFF_SIGNUP_CODE` to pass the basic sign-up gate. See `.agents/memory/signup-bootstrap-hardening.md`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- **Web app:** `artifacts/run-calculator` (React + Vite), responsive for desktop, phone, and tablet browsers. The bulk of the UI/logic lives in `src/pages/home.tsx` (Tabs/activeTab system, run identity, packaging, draining panel). Per-run form values are persisted in localStorage.
- **API server:** `artifacts/api-server` (Express 5). Routes in `src/routes/*` (~70 files; AI endpoints prefixed `ai*`). Server validates with Zod schemas from `@workspace/api-zod` and never uses `console.log` (use `req.log` / the singleton `logger`).
- **API contract (source of truth):** `lib/api-spec/openapi.yaml`. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`). Do NOT edit generated files or the OpenAPI `info.title` (it controls generated filenames).
- **DB schema (source of truth):** `lib/db/src/schema/*` (Drizzle), barrelled via `lib/db/src/schema/index.ts`. Push with `pnpm --filter @workspace/db run push`.
- **Shared pure logic:** `lib/*` — e.g. `inventory-math`, `fill-missing`, `recipe-apply`, `spec-import`, `production-rules`, `allergen`, `voice-commands`, `merge-suggest`, `ai-memory`, `ai-review`, `onboarding`, `cheese-recipes`, `cheese-import`. The web app keeps only thin platform glue and tests import the libraries directly.
- **Cheese recipes** are server-backed factory-wide master-data (own `cheese_recipes` table, managed like Mixes but deliberately NOT routed through Mixes — cheese components are per-BATCH lbs, mixes are per-pizza oz). Managers manage them under Manage Lists → Cheese Recipes and import "Cheese Mix Recipe Specs" workbooks (deterministic, no AI). Run applicator "Cheese" cards are pick-only and hydrate rows read-only from the pool. See `.agents/memory/cheese-server-master-data.md`.

## Architecture decisions

- **Contract-first API.** The OpenAPI spec is authoritative; clients consume generated hooks and the server validates with generated Zod schemas. Heavy shaping (e.g. AI prompt building) lives server-side so both clients stay thin and identical.
- **Pure logic lives in `lib/*`, not in the app.** Any non-trivial formula or decision belongs in a shared library; the web app keeps only platform glue (storage, UI).
- **Live day-state sync via `/api/sync`** with additive, non-clobber union merges (echo / lost-update guards). Merges need a synced `mergedAway` tombstone to survive the additive union. Some master-data (production rules, denied merges, change history) is intentionally NOT in sync.
- **Auth is self-contained username+password** (Clerk removed): the web app uses an httpOnly cookie; `requireAuth` gates all `/api` except `/healthz` and `/auth/*`. First registered user becomes a manager. Roles are DB rows resolved per-request via `requireCapability`.
- **Sign-up is gated by a facility access code** (`STAFF_SIGNUP_CODE` env var, timing-safe compare, fails closed if unset) — public self-registration otherwise exposes internal factory data. Public auth endpoints are also rate-limited. See `.agents/memory/signup-bootstrap-hardening.md`.
- **AI features never edit code or auto-write data.** They are advisory/fail-safe: a "fix" is an explanation, suggestions require per-field user confirmation through existing write paths, and AI output is canonicalized/sanitized server-side before use.

## Product

- Pizza production line planning, scheduling, and inventory for floor staff in responsive desktop, phone, and tablet browsers.
- **AI issue diagnosis & manager alerts:** any signed-in user can report an issue and get an immediate plain-language AI diagnosis plus a safe workaround; uncaught crashes are auto-captured. Each becomes a server-side "incident" with an AI diagnosis. Managers get an incident list, an unreviewed-count nav badge, and can mark incidents reviewed. The AI never edits code — a "fix" is an explanation plus safe-recovery steps. See `.agents/memory/incident-diagnosis.md`.

## User preferences

- **Fix all errors immediately.** Any TypeScript, test, or build error encountered during any task — whether directly related to the current work or not — must be fixed before moving on. Do not let errors accumulate.
- **Web-only product:** The maintained application is `artifacts/run-calculator`, and it must remain usable in responsive desktop, phone, and tablet browsers.

## Gotchas

- **Run `pnpm run typecheck:libs` after any `lib/*` change** before leaf typechecks. "Missing `@workspace/db` export" usually means stale lib declarations, not a bad import.
- **Verify artifacts with `typecheck`, not `build`.** `build` needs workflow-provided `PORT`/`BASE_PATH` and can fail from a plain shell even when the code is fine. Don't run `pnpm dev` at the workspace root — use workflows.
- **Run tests via the configured test workflows** (`test`, `test:client`, `test:rules`, `test:inventory-math`); web tests run single-file (`fileParallelism: false`) with big timeouts because validation runs alongside dev workflows. A single test file from bash is fine; the full suite from bash can starve.
- **Don't edit generated code or `artifact.toml`/`.replit` directly.** Regenerate API code via codegen; change artifact/workflow config through the artifact skills.
- **DB schema changes must be additive** on populated tables, and `post-merge.sh` must use `db push-force` (plain push hangs on the TTY rename prompt). See `.agents/memory/additive-push-force-schema.md` and `post-merge-setup.md`.
- **Deep institutional knowledge lives in `.agents/memory/`** — many sharp edges (sync semantics, daily-reset auth boundary, RN font weights, expo-secure-store web crash, etc.) are documented there. Check it before touching an unfamiliar area.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details


# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._
