## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server on the artifact-configured local workflow port 8080 (`artifacts/api-server/.replit-artifact/artifact.toml`). CI may intentionally override this with `PORT=5000`; do not use the CI port as local startup guidance.
- `pnpm --filter @workspace/run-calculator run prepare:e2e:department` — for a fresh isolated browser-test database, fail closed unless the target is disposable, apply the canonical schema, then start the API; run `test:e2e:department` separately while it stays up
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
- **Shared pure logic:** `lib/*` — e.g. `inventory-math`, `fill-missing`, `recipe-apply`, `spec-import`, `production-rules`, `allergen`, `voice-commands`, `merge-suggest`, `ai-memory`, `onboarding`, `cheese-recipes`, `cheese-import`. The web app keeps only thin platform glue and tests import the libraries directly.
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

- **Fix task-scoped errors immediately.** Any TypeScript, test, or build error within the approved task scope must be fixed before moving on. Bring an unrelated error into the current task when it blocks required validation or creates a safety, security, data-integrity, or release risk; otherwise de-duplicate it and capture a bounded Draft with evidence and a next action. Do not silently lose errors.
- **Web-only product:** The maintained application is `artifacts/run-calculator`, and it must remain usable in responsive desktop, phone, and tablet browsers.
- **Automatically preserve future improvements:** When a distinct, actionable feature, upgrade, technical-debt item, or meaningful test gap is discussed but deferred, search the project task board for overlap and create a Draft task immediately if none exists. A Draft records the idea only; never accept, assign, or start it automatically. If the idea matters but is too vague to scope honestly, create a bounded discovery or decision Draft instead of inventing requirements. Do not create tasks for casual speculation, temporary conversation details, secrets, personal information, or ideas already covered by an existing task.

## Gotchas

- **Run `pnpm run typecheck:libs` after any `lib/*` change** before leaf typechecks. "Missing `@workspace/db` export" usually means stale lib declarations, not a bad import.
- **Verify artifacts with `typecheck`, not `build`.** `build` needs workflow-provided `PORT`/`BASE_PATH` and can fail from a plain shell even when the code is fine. Don't run `pnpm dev` at the workspace root — use workflows.
- **Run tests via the configured test workflows** (`test`, `test:client`, `test:rules`, `test:inventory-math`); web tests run single-file (`fileParallelism: false`) with big timeouts because validation runs alongside dev workflows. A single test file from bash is fine; the full suite from bash can starve.
- **Don't edit generated code or `artifact.toml`/`.replit` directly.** Regenerate API code via codegen; change artifact/workflow config through the artifact skills.
- **DB schema changes must be additive** on populated tables, and `post-merge.sh` must use `db push-force` (plain push hangs on the TTY rename prompt). See `.agents/memory/additive-push-force-schema.md` and `post-merge-setup.md`.
- **Deep institutional knowledge lives in `.agents/memory/`** — many sharp edges (sync semantics, daily-reset auth boundary, RN font weights, expo-secure-store web crash, etc.) are documented there. Check it before touching an unfamiliar area.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Task generation and automation policy

### Universal task intake

- Generate one durable task per work objective. Include investigation, implementation, integration and persistence impacts, regression coverage, verification, and all in-scope repair work in that task. Do not create a new task for each symptom, test failure, fixture repair, or sub-outcome inside the same objective.
- Before starting, capture the task's scope, affected surfaces, expected owner, applicable specialist safety checks, and validation matrix. Search the task board for overlap and dependencies; do not duplicate an existing task.
- Use one task when the work has one objective and shared ownership. Split work only when the outcomes are genuinely independent, have separate acceptance criteria, and cannot responsibly be closed under the same objective.
- Ask a question only for a genuine product decision, missing access or secret, or destructive action. Otherwise follow existing project patterns and choose the smallest safe behavior.

### Failure closure

- Run every valid check for the changed surface, not only the check most likely to pass. Record all observed results as `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING`.
- Fix every failure within the approved task scope before completion. Do not stop at diagnosis, silently defer an in-scope defect, or report a partial check as a complete check.
- A genuinely out-of-scope failure must be de-duplicated against the task board and captured as a bounded Draft with an owner, evidence, and next action. Bring it into the current task when it blocks required validation or creates a safety, security, data-integrity, or release risk.
- Keep newly discovered in-scope failures in the owning task's failure ledger and close them before completion. A new project task requires a genuinely independent objective, an explicitly deferred user outcome, or an out-of-scope safety, security, data-integrity, or release blocker that cannot responsibly be absorbed.
- Do not create recursive or speculative “one more task” work. A separate task must have independent acceptance criteria, an owner, and a documented reason it cannot remain in the current objective.
- Completion evidence must name the changed surface, focused checks, broader affected checks, known failures, data/authorization/sync implications where applicable, and the exact remaining action for anything not completed.

### Long-running task progress

- When an approved task spans more than one investigation or validation cycle, post a progress update in the owning task instead of opening a task for each failure or discovery. Every update must show:
  - **Current objective:** the user outcome this task still owns;
  - **Completed work:** repairs and evidence that are complete, with their result status;
  - **Active blockers:** each unresolved blocker, its evidence, and the owner responsible for the next action;
  - **Next validation milestone:** the next concrete check or decision point, including its prerequisite when one exists; and
  - **Owner:** the person or team accountable for moving the objective to completion.
- Keep the update current as work progresses: move completed items out of the blocker list, preserve unresolved `FAIL`, `BLOCKED`, `NOT REACHED`, and `MISSING` statuses, and do not describe a partial result as complete.
- In-scope discoveries stay in the owning task's failure ledger and use the same owner and milestone. Do not create recursive follow-up tasks for them. Create another task only for a genuinely independent objective, a deliberately deferred outcome, or an out-of-scope safety, security, data-integrity, or release blocker that cannot responsibly remain here.
- For release work, list independent evidence work separately from checks that depend on it. Continue every independent check that is valid and safe; mark a dependent check `BLOCKED` or `NOT REACHED`, name the failed prerequisite, and keep it unresolved until its evidence exists. Progress reporting never changes the release gate or turns unresolved evidence into a pass.

### Safe decomposition and parallel work

- Use internal work breakdown and parallel helpers for independent repair domains within one objective. Do not turn those internal work units into sibling project tasks unless they meet the separate-objective rule.
- For genuinely separate project tasks, add explicit dependencies when they share a surface, need a prior migration/heal, consume another task's output, or would otherwise race. Avoid creating project-task dependencies just to organize in-scope work.
- Prefer one durable end-to-end task over many implementation fragments. Parallelize only concrete work that can be safely owned and validated without expanding the objective boundary.
- Never claim success by weakening assertions, skipping applicable tests, masking secrets, using unsafe destructive data, treating missing evidence as a pass, or relabeling a timeout as success.

### Production and release branch

- For production-readiness work, establish the complete release-scope and gate matrix first. Run independent gates as far as safely valid instead of stopping at the first unrelated failure, and keep every result in the owning release objective's blocker ledger.
- Classify each result as product defect, test or fixture defect, environment/workflow problem, data or reconciliation issue, security/authorization issue, release-evidence problem, or missing evidence. Repair all domains that belong to the release objective under the same durable task using internal work breakdown.
- Keep production reconciliation, destructive release tests, and live data heals in separate trust lanes with explicit ownership. Create a separate project task only when the work is a genuinely independent objective or cannot safely be absorbed.
- The owning release task performs the final standard/full evidence rerun from one clean revision, verifies retained evidence, and issues exactly one `GO` or `NO-GO` decision. A GO task cannot finish with unresolved required evidence or blockers.

### Approval, execution, and reporting

- Automatically approve and start ordinary, bounded UI, test, and bug-fix tasks when the task workflow permits it.
- Keep manual approval and final merge review for:
  - database schema changes and data heals;
  - authentication, authorization, sync, or security changes;
  - production, release, or destructive operations;
  - external integrations, secrets, or irreversible data changes.
- When a task is approved, execute the full plan, fix in-scope failures, add regression coverage, and report concrete verification evidence. Preserve actionable out-of-scope work without claiming it is complete.

### Examples

- **Normal feature:** implement the feature, run its unit/type/browser checks, repair newly discovered in-scope failures, and complete one task with the full verification record.
- **Shared surface:** keep all changes needed for one sync objective in one task; use internal sequencing when they touch the same contract instead of creating a task per failing test.
- **Release checkpoint:** harvest browser, source-data, and signing-key failures into one release objective, repair them through internal work breakdown, and finish with one final evidence decision.

# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._
