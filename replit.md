## Run & Operate

- **Production publication authority:** Only the Replit deployment is authorized to publish the active production app. GitHub is for source backup and CI/testing: pushes, releases, workflow runs, test artifacts, and container builds neither publish the app nor prove what is live. Retained Render and manual Docker production material is legacy and unsupported for current publication; repository edits do not change any external account, service, or deployment settings.

- **Publish version identity:** After the final source edit, run `pnpm run publish:ready` before offering Publish. This single command refreshes the independent source identity and runs the focused API/web publish build; it does not publish or run the full release suites. If any source changes afterward, run it again. Replit's build still rejects a stale identity. After the owner publishes, resolve the official URL through deployment metadata and run `pnpm run check:published-build -- --url <official-url>`; this verifies the live source identity and waits for readiness. If Replit reports a failed build, check whether that exact build is nevertheless live and healthy before asking for another publish. Never derive the expected record from the live response. Source-match receipts do not replace controlled handoff/GO gates. See `docs/automatic-build-version-reporting.md`.

- `pnpm --filter @workspace/api-server run dev` — run the API server on the artifact-configured local workflow port 8080 (`artifacts/api-server/.replit-artifact/artifact.toml`). This development command applies the development schema first, but refuses a confirmed deployed Replit runtime before schema push. `REPLIT_ENVIRONMENT=production` alone does not trigger the refusal because isolated workspaces can carry it. CI may intentionally override the port with `PORT=5000`; do not use the CI port as local startup guidance.
- `pnpm --filter @workspace/run-calculator run prepare:e2e:department` — for a fresh isolated browser-test database, fail closed unless the target is disposable, apply the canonical schema, then start the API; run `test:e2e:department` separately while it stays up
- `pnpm run typecheck` — full typecheck across all packages
- New Replit interactive Bash shells load the project-specific `.config/bashrc`,
  which selects the exact `.nvmrc` Node runtime for the shell and child commands.
  Confirm with `node --version` and `node -p process.execPath`. If selection
  fails, the shell exits with recovery guidance instead of using the module's
  older Node patch; the validation workflows and release runner remain separate.
- **Release evidence handoff:** start at [docs/release-evidence-handoff.md](docs/release-evidence-handoff.md) for the standard/full commands, selected-revision report/checkpoint status, CI artifacts, and production-proof boundary
- `pnpm --filter @workspace/api-server run typecheck:routes` — focused API route check when a generated validator build blocks the full API check; it uses the last successful `@workspace/api-zod` declarations and does not replace the authoritative `typecheck` command
- The Node-pinned release runner serializes validation commands per workspace. Waiting for that local filesystem lock is capped at two hours (the configured post-merge validation timeout); contention reports the owning process and start time, then exits with a retryable error at the limit. `RELEASE_RUNNER_LOCK_WAIT_SECONDS` may shorten, but cannot extend, that cap. Its private temporary lock directory keeps the newest 20 local wait events per workspace (UTC timestamp, elapsed seconds, outcome, owner PID, and owner start time) in a mode-`600` file; command arguments, environment values, and test output are never retained. This does not control Replit-managed task merge locks or interrupt an already-running validation command.
- Run `bash scripts/src/show-release-lock-history.sh` to display up to 20 valid recent wait events for the current workspace. The read-only output omits malformed rows and does not include Replit-managed task-runner waits.
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
- Security-relevant env: `STAFF_SIGNUP_CODE` — transitional code used until a manager rotates or disables it; `INITIAL_MANAGER_USERNAME` + `INITIAL_MANAGER_ACCESS_CODE` — BOTH must match to bootstrap the first manager (fails closed); `SESSION_TTL_SEC` — absolute session lifetime (default 30 days); `SESSION_IDLE_TIMEOUT_SEC` — idle lifetime (default 12 hours). Managers control ongoing onboarding with one-time invitations and can disable accounts or revoke sessions. `ALLOW_QUERY_TOKEN_AUTH=true` explicitly enables query-string bearer-token promotion for a cross-origin development EventSource caller; it is off by default and ignored in production. Avoid enabling it outside that development case because URL tokens can enter browser history and request logs.
- **HTTP security headers:** Express sets MIME-sniffing, referrer, framing, and CSP headers but intentionally omits HSTS because Replit may terminate TLS before requests reach the API. The retained Docker Caddy site adds HSTS only to HTTPS responses when Caddy itself terminates TLS; `SITE_ADDRESS=:80` remains plain HTTP.

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
- **Auth is self-contained username+password** (Clerk removed): the web app uses an httpOnly cookie and other clients may use Bearer authentication; both resolve through the same server-side session, expiry, idle, revocation, password-change, account-disable, and daily-reset fences. Roles are DB rows resolved per request via `requireCapability`.
- **Production onboarding is manager-controlled.** Managers issue one-time invitations and may rotate or disable the transitional staff sign-up code. The separately designated initial-manager username/code remains the only bootstrap path to manager privileges, and public auth endpoints are rate-limited.
- **AI features never edit code or auto-write data.** They are advisory/fail-safe: a "fix" is an explanation, suggestions require per-field user confirmation through existing write paths, and AI output is canonicalized/sanitized server-side before use.

## Product

- Pizza production line planning, scheduling, and inventory for floor staff in responsive desktop, phone, and tablet browsers.
- **Issue reporting & manager review:** any signed-in user can submit an issue report, and uncaught crashes are captured as incidents. Reports are recorded for manager review without generated diagnoses, workarounds, or notification delivery. Managers can review and manage incident workflow. See `.agents/memory/incident-diagnosis.md`.

## User preferences

- **Fix task-scoped errors immediately.** Any TypeScript, test, or build error within the approved task scope must be fixed before moving on. Bring an unrelated error into the current task when it blocks required validation or creates a safety, security, data-integrity, or release risk; otherwise de-duplicate it and capture a bounded Draft with evidence and a next action. Do not silently lose errors.
- **Web-only product:** The maintained application is `artifacts/run-calculator`, and it must remain usable in responsive desktop, phone, and tablet browsers.
- **Automatically preserve future improvements:** When a distinct, actionable feature, upgrade, technical-debt item, or meaningful test gap is discussed but deferred, search current work for overlap and submit a task only when no existing task covers it and it meets the follow-up rules below. The task platform's settings determine whether a submitted task immediately becomes Active or remains a Draft; repository guidance does not change those settings. If the idea matters but is too vague to scope honestly, use a bounded discovery or decision plan instead of inventing requirements. Do not create tasks for casual speculation, temporary conversation details, secrets, personal information, or ideas already covered by existing work.

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

This section is the project-specific application of the shared task-scope rule in `AGENTS.md`. It is authoritative for planning and closing work, but does not change task automation settings or rewrite, merge, or re-scope existing tasks.

### Task-agent startup and evidence access

Replit documents [`replit.md`](https://docs.replit.com/features/project-setup/replit-dot-md) as project instructions and [project skills in `.agents/skills/`](https://docs.replit.com/features/agent/skills) as available during background task execution. Its [task-system guidance](https://docs.replit.com/core-concepts/agent/task-system) says background tasks run in an isolated project copy that inherits `replit.md`, Agent memory, and installed skills at launch, but do not receive real-time updates. Re-read current task records and rules at startup; do not assume a running task saw later changes. Replit's published docs do not name `AGENTS.md` as an automatic task-agent entry point, so this file explicitly directs agents to read it for shared repository rules.

Before substantive work in either the main workspace or an isolated task copy:

- Read the current task record, scope, and dependencies; read the task rules in this file and `AGENTS.md`, plus applicable project skills in `.agents/skills/` and any Replit-provided skills required by the task.
- Check only explicit, genuine task prerequisites and overlap; do not wait for unrelated active tasks or infer ordering from acceptance time, task number, or creation time.
- Before asking the user for evidence, first retrieve it through available authorized workspace, Replit, deployment, or connected-service access. Ask only for a decision, permission, or access grant the user controls; if an expected source is inaccessible, report the exact blocker rather than shifting retrieval work to the user.
- Keep all in-scope investigation through final verification in the owning task. Apply the separate-task exceptions below and the applicable Replit follow-up skill; do not split symptoms, failures, or validation into child tasks.

### Universal task intake

- Generate one durable task per objective. Its description must own the outcome end to end: investigation, implementation, integration and persistence effects, regression coverage, verification, and error repair.
- **Put the complete execution contract in every task description.** Every Draft, accepted task, and follow-up must include `## Agent-owned execution` and `## Applicable safeguards and verification`. Name the objective and owner, affected surfaces, task-specific evidence/access paths, user-controlled decisions or permissions (`None expected` when none are known), applicable specialist skills, validation checks, and any conditional web or release requirements.
- Before authoring or executing any task or follow-up, read `.agents/skills/task-execution-rules/SKILL.md` and carry its applicable contract into the description. This composes with Replit's task/follow-up workflows; do not edit their platform-managed skills.
- Before starting, read the current task record and dependencies; capture the scope, affected surfaces, owner, applicable safety checks, validation matrix, available evidence sources, and user-controlled inputs. Search current work for overlap and genuine prerequisites; do not duplicate an existing task.
- **Use available evidence before asking the user.** Check the task record, repository, configured workflows, and authorized Replit, deployment, and connected-service capabilities. Ask only for a genuine product decision, approval, or specific access permission the user controls. State what was checked and exactly what is unavailable. Never ask for secrets in chat or evidence the agent/app can retrieve.
- **Triage every error found during work.** Record each concrete error in the owning task's failure ledger and fix it there when safe and authorized, even if outside the original scope. Never silently ignore or defer a known error. If a safe fix requires a user decision/access grant, destructive or irreversible action, or cannot responsibly be completed within this task, record the evidence, exact risk/blocker, accountable owner, and next action.
- Do not create a follow-up for a discovered error, test failure, fixture repair, cleanup, validation step, or other sub-outcome. Before creating another task, name its parent or owning task, search current Drafts and active work for overlap, state separate acceptance criteria, identify a genuinely independent outcome, an explicitly deferred user outcome, or a separate safety/approval need, and explain why it cannot safely remain in the owning task. If any item is missing, keep the error in the owning task's failure ledger.
- If another active task already owns a repair on the same surface, prevent conflicting duplicate edits: keep the discovered error in the current failure ledger and resolve it with that owner through existing work, without creating a recursive follow-up.
- Every eligible child plan must state its parent, evidence, explicit priority and rationale, separate acceptance criteria, why it cannot safely remain in the owning task, and the result of checking current work for overlap.
- High- and medium-priority independent outcomes may be proposed; low-priority ones need a concrete benefit and bounded scope. Optional work is not categorically excluded; physical-device-only work is excluded.
- **Use dependencies only for genuine technical or user-outcome prerequisites.** Unrelated active tasks do not block execution; acceptance time, task number, and creation time do not establish task priority or dependency.
- Platform settings determine whether a submitted task immediately becomes Active or remains a Draft. Priority is recorded in the plan, not enforced as native task metadata; the repository checker validates policy wording, not runtime task creation.
- Completion review must retain the owning task's complete failure ledger. Resolve every safely actionable error and every required check; anything still `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING` requires evidence, reason, owner, and next action. Never report a partial check as a pass or call unresolved required work complete.
- For long-running tasks, keep progress updates current with the objective, completed work/status, active blockers with evidence and owner, next validation milestone/prerequisite, and accountable owner.
- For web-facing tasks, include a compatibility applicability matrix for desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari. Mark non-passes `not applicable`, `blocked`, or `not run`; distinguish browser emulation from physical Android Chrome and iOS Safari/PWA evidence. This web-only product does not create a native-mobile requirement.
- For release tasks, include the release-scope/gate matrix, run independent valid gates, classify and repair findings in the owning release task, preserve unresolved evidence blockers, and finish with one standard/full evidence decision. Do not apply full release checks to unrelated ordinary tasks.
- Follow applicable project/repository safety rules: retain approval and final merge review for schema/data-heal, auth/security/sync, production/destructive, external integration/secret, and irreversible-data changes. Do not use a task description to claim that platform behavior or permissions changed.
- Task communication should identify tasks by ref and title, use user-facing status language, and avoid exposing internal implementation details.

### Failure closure

- Run every valid check for the changed surface, not only the check most likely to pass. Record all observed results as `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING`.
- Triage every concrete error discovered during work and record it in the owning task's failure ledger. Fix it there when safe and authorized, even if outside the original scope; do not silently ignore or defer a known error.
- If a safe fix requires a user decision/access grant, destructive or irreversible action, or cannot responsibly be completed in the owning task, preserve the evidence, exact risk/blocker, accountable owner, and next action. Never report it as resolved or claim the task is complete while required work remains.
- Do not create a follow-up for a discovered error, test failure, fixture repair, cleanup, validation step, or other sub-outcome. Before creating another task, name its parent or owning task, search current Drafts and active work for overlap, state independent acceptance criteria for a separate outcome, identify a genuinely independent outcome, an explicitly deferred user outcome, or a separate safety/approval need, and explain why it cannot safely remain in the owning task. If any item is missing, keep the error in the owning task's failure ledger.
- Every eligible child plan must state its parent, evidence, explicit priority and rationale, separate acceptance criteria, why it cannot safely remain in the owning task, and the result of checking current work for overlap.
- High- and medium-priority independent outcomes may be proposed; low-priority ones need a concrete benefit and bounded scope. Optional work is not categorically excluded; physical-device-only work is excluded.
- Completion review must retain the owning task's full failure ledger and resolve every safely actionable error and required check. Every unresolved `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING` result needs evidence, reason, owner, and next action.
- Completion evidence must name the changed surface, focused checks, broader affected checks, known failures, data/authorization/sync implications where applicable, and the exact remaining action for anything not completed.
- Web-facing completion evidence must include the compatibility applicability matrix and separate emulated Chromium/WebKit results from physical Android Chrome and iOS Safari/PWA results. Missing device services are `blocked` or `not run`, never a pass.

### Long-running task progress

- When an approved task spans more than one investigation or validation cycle, post a progress update in the owning task instead of opening a task for each failure or discovery. Every update must show:
  - **Current objective:** the user outcome this task still owns;
  - **Completed work:** repairs and evidence that are complete, with their result status;
  - **Active blockers:** each unresolved blocker, its evidence, and the owner responsible for the next action;
  - **Next validation milestone:** the next concrete check or decision point, including its prerequisite when one exists; and
  - **Owner:** the person or team accountable for moving the objective to completion.
- Keep the update current as work progresses: move completed items out of the blocker list, preserve unresolved `FAIL`, `BLOCKED`, `NOT REACHED`, and `MISSING` statuses, and do not describe a partial result as complete.
- Every discovered error stays in the owning task's failure ledger until safely fixed or explicitly blocked with evidence and a next action. Do not create recursive follow-up tasks for errors or other sub-outcomes. Create another task only for a genuinely independent outcome, explicit deferral, or separate safety/approval need that cannot safely remain here.
- For release work, list independent evidence work separately from checks that depend on it. Continue every independent check that is valid and safe; mark a dependent check `BLOCKED` or `NOT REACHED`, name the failed prerequisite, and keep it unresolved until its evidence exists. Progress reporting never changes the release gate or turns unresolved evidence into a pass.

### Safe decomposition and parallel work

- Use internal work breakdown and parallel helpers for independent repair domains within one objective. Do not turn those internal work units into sibling project tasks unless they meet the separate-objective rule.
- For genuinely separate project tasks, add explicit dependencies when they share a surface, need a prior migration/heal, consume another task's output, or would otherwise race. Avoid creating project-task dependencies just to organize in-scope work.
- Prefer one durable end-to-end task over many implementation fragments. Parallelize only concrete work that can be safely owned and validated without expanding the objective boundary.
- Never claim success by weakening assertions, skipping applicable tests, masking secrets, using unsafe destructive data, treating missing evidence as a pass, or relabeling a timeout as success.

### Current task ownership audit

This audit preserves every current draft and active task as a separate work item. It does not merge, cancel, rename, re-scope, accept, start, assign, or change the lifecycle or acceptance criteria of any task.

- **Release evidence objective:** “Restore complete full-mode release evidence after browser regressions are fixed” owns the final release-evidence rerun and decision. “Stabilize Mix Plan browser coverage for full release” owns Mix Plan browser reliability. “Automate the deployed revision handoff for source evidence” owns revision handoff automation. “Add a production-binding contract test for source reconciliation” owns the production-binding regression contract. Fix newly discovered errors in the task where found when safe and authorized, including errors outside its original scope. If an active task already owns the same repair, avoid conflicting edits and resolve it through existing work without a recursive follow-up.
- **Incomplete-name data-safety objective:** “Keep manager recipe libraries safe with incomplete names” owns manager-library runtime safety. “Confirm every setup recipe picker keeps valid choices after bad master data” owns picker regression evidence. “Prevent incomplete learned aliases from being saved again” owns write-path prevention. “Repair legacy learned aliases before they reach manager screens” owns legacy-data repair. Fix newly discovered errors in the task where found when safe and authorized, including errors outside its original scope. If an active task already owns the same repair, avoid conflicting edits and resolve it through existing work without a recursive follow-up.
- **Task-scope policy objective:** “Enforce task scope policy” owns the intake, closure, and policy-drift enforcement described here.

Future current-task reviews preserve each task's existing scope and lifecycle. Each task fixes safely actionable errors it discovers regardless of original scope; check overlap first to prevent conflicting edits, and resolve any already-owned repair through the existing task without creating a recursive follow-up.

### Production and release branch

- For production-readiness work, establish the complete release-scope and gate matrix first. Run independent gates as far as safely valid instead of stopping at the first unrelated failure, and keep every result in the owning release objective's blocker ledger.
- Classify each result as product defect, test or fixture defect, environment/workflow problem, data or reconciliation issue, security/authorization issue, release-evidence problem, or missing evidence. Repair all domains that belong to the release objective under the same durable task using internal work breakdown.
- **Evidence ownership:** Do not block on the owner uploading production or CI evidence that this workspace or its connected services can generate or retrieve. First investigate the authorized Replit, deployment, and CI access paths. If evidence should exist but cannot be accessed, treat that as an engineering/platform access blocker and resolve or document the exact boundary within the owning task. Ask the owner only for a decision or access grant they control—not an artifact they cannot obtain.
- Keep production reconciliation, destructive release tests, and live data heals in separate trust lanes with explicit ownership. Create a separate project task for one of those lanes only when it is a genuinely independent outcome with separate acceptance criteria, an explicitly deferred user outcome, or an out-of-scope safety, security, data-integrity, or release blocker that cannot safely be absorbed.
- The owning release task performs the final standard/full evidence rerun from one clean revision, verifies retained evidence, and issues exactly one `GO` or `NO-GO` decision. A GO task cannot finish with unresolved required evidence or blockers.

### Approval, execution, and reporting

- Do not delay a task because an unrelated task was accepted earlier or has a lower task number. Follow only explicit, genuine `dependsOn` prerequisites; repository guidance does not change platform acceptance/start settings or claim to stop a launched agent.
- Keep manual approval and final merge review for:
  - database schema changes and data heals;
  - authentication, authorization, sync, or security changes;
  - production, release, or destructive operations;
  - external integrations, secrets, or irreversible data changes.
- When a task is approved, read its task record and genuine prerequisites, then execute the full plan, triage and fix errors found when safe and authorized, add regression coverage, and report concrete verification evidence. Preserve any unsafe or approval-blocked issue with its evidence and next action; do not claim it is complete.

### Examples

- **Normal feature:** implement the feature, run its unit/type/browser checks, repair safely actionable discovered errors even outside the original feature scope, and complete one task with the full verification record.
- **Shared surface:** keep all changes needed for one sync objective in one task; use internal sequencing when they touch the same contract instead of creating a task per failing test.
- **Release checkpoint:** harvest browser, source-data, and signing-key failures into one release objective, repair them through internal work breakdown, and finish with one final evidence decision.

# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._
