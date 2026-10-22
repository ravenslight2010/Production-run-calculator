# AGENTS.md — Shared instructions for all coding agents

This repository is worked on by **multiple coding agents** (Codex, Replit Agent, and others). To avoid duplicate work and conflicting fixes, follow these rules.

## Before making any change

1. **Check `.agents/memory/codex-fixes.md`** — this file logs every fix Codex has made. If a fix is already documented there, do NOT re-apply it.
2. **Check `.agents/memory/claude-bugs.md`** — bugs Claude has found (Open) or already fixed (Fixed). Don't re-report an Open bug as new, and don't re-apply a Fixed one.
3. **Check `.agents/memory/`** — other memory files contain design decisions, patterns, and gotchas. Read them before modifying code.
4. **Never force-push to `main`** — always use a feature branch + PR. Branch protection is enabled.
5. For Replit main-workspace and isolated task agents, follow the [task-agent startup and evidence-access instructions](replit.md#task-agent-startup-and-evidence-access) before substantive work.

## After making a fix

1. **Update `.agents/memory/codex-fixes.md`** (or `.agents/memory/claude-bugs.md` if you're Claude) with:
   - File path(s) changed
   - What was wrong (the bug/issue)
   - What the fix was (the change)
   - Why it was needed (context)
2. **Push to a feature branch** and open a PR.
3. **CI must pass** before merging.

## Task scope and failure closure

- **Use one durable task per objective.** The owning task covers the end-to-end outcome: investigation, implementation, integration and persistence effects, regression coverage, verification, and repairs discovered while doing the work. The original scope is not a reason to ignore a concrete error.
- Before narrowing or splitting a broad objective, inventory material input types, formats/locales, layouts, platforms, lifecycle states, and failure paths; put relevant variants in its acceptance and test matrix.
- Variants of the same user outcome belong in the owning task, not separate follow-ups. Different tests, false-positive risks, or implementation steps alone do not justify a split. Cover known/common cases within approved access; document genuine exclusions without claiming exhaustive coverage. A separate task still needs an independent user outcome, explicit user deferral, or distinct authorization/safety boundary—not merely a newly written out-of-scope clause.
- Before starting, capture the task's scope, affected surfaces, owner, applicable specialist safety checks, validation matrix, available evidence sources, and user-controlled decisions or permissions. Search current work for overlap and genuine prerequisites; do not duplicate an existing task.
- Every Draft, accepted task, and follow-up description must include `## Agent-owned execution` and `## Applicable safeguards and verification` sections. They must name the objective, task-specific evidence and access paths, user input (`None expected` when none is known), applicable specialist guidance, validation checks, and any conditional web or release requirements.
- Before authoring or executing any task or follow-up, read `.agents/skills/task-execution-rules/SKILL.md` and carry its applicable contract into the description. This composes with Replit's task/follow-up workflows; do not edit their platform-managed skills.
- **Use available evidence before asking the owner.** Check the task record, repository, configured workflows, and authorized Replit, deployment, and connected-service capabilities available in the current session. Ask only for a genuine product decision, approval, or specific access permission the user controls. State what was checked and exactly what is unavailable; never ask for secrets in chat or for evidence the agent/app can retrieve.
- **Triage every error found during work.** Record each concrete error in the owning task's failure ledger and fix it there when safe and authorized, even if it was outside the task's original scope. Never silently ignore or defer it. If a safe fix requires a user decision/access grant, destructive or irreversible action, or cannot be completed responsibly within this task, record the evidence, exact risk/blocker, accountable owner, and next action.
- **Before creating another task, apply this decision checklist:** name its parent or owning task; search current Drafts and active work for overlap; state separate acceptance criteria; identify a genuinely independent outcome, an explicitly deferred user outcome, or a separate safety/approval need; and explain why it cannot safely remain in the owning task. If any item is missing, keep the error in the owning task's failure ledger.
- Keep in-scope symptoms, errors, test failures, fixture repairs, cleanup, and validation in the owning task; do not create recursive child tasks for them. A separately tracked outcome must be genuinely independent, explicitly deferred, or require separate safety/approval handling. High- and medium-priority independent outcomes may be proposed; low-priority ones require a concrete benefit and bounded scope. Optional work is not categorically excluded; physical-device-only work is excluded.
- If another active task already owns a repair on the same surface, prevent conflicting duplicate edits: keep the discovered error in the current failure ledger and resolve it with that owner through existing work, without creating a recursive follow-up.
- Every eligible child plan must state its parent, evidence, explicit priority and rationale, separate acceptance criteria, why it cannot safely remain in the owning task, and the result of checking current work for overlap.
- **Use dependencies only for genuine technical or user-outcome prerequisites.** Unrelated active tasks do not block execution; acceptance time, task number, and creation time do not establish task priority or dependency.
- Platform settings determine whether a submitted task immediately becomes Active or remains a Draft. Priority is recorded in the plan, not enforced as native task metadata; repository checks protect authoring guidance, not runtime task creation.
- For every web-facing task, record a compatibility applicability matrix covering desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari. Each check must have an explicit `not applicable`, `blocked`, or `not run` reason when it is not a pass.
- Responsive browser emulation is automated evidence only; it is not proof of physical Android Chrome or iOS Safari/PWA behavior. This is a web-only product and does not create a native-mobile requirement.
- Completion review must retain the owning task's complete failure ledger and resolve every safely actionable error and every required `FAIL`, `BLOCKED`, `NOT REACHED`, and `MISSING` result. Anything left unresolved needs its evidence, reason, owner, and next action; test failures, fixture repairs, cleanup, and validation are not recursive tasks.
- Long-running task updates must state the current objective, completed work and status, active blockers with evidence and owner, the next validation milestone and prerequisite, and the accountable owner. Preserve unresolved `FAIL`, `BLOCKED`, `NOT REACHED`, and `MISSING` results until they are closed.
- For web-facing work, completion evidence must include the compatibility applicability matrix and distinguish emulated Chromium/WebKit results from physical Android Chrome and iOS Safari/PWA evidence. Missing device services stay `blocked` or `not run`, never pass.
- These are task instructions, not platform controls. They preserve current Draft and active tasks as separate work items; they do not merge, cancel, rename, or re-scope them. Do not change existing task acceptance, assignment, status, or lifecycle without the user's request.

## Shared knowledge files

- `.agents/memory/codex-fixes.md` — running log of Codex fixes
- `.agents/memory/claude-bugs.md` — Claude's bug tracker (Bugs Found / Bugs Fixed)
- `.agents/memory/*.md` — design decisions, patterns, gotchas (200+ files)
- `AGENTS.md` — this file (shared instructions)

## Shared skills and tests

The repo contains a **shared skill catalog** and **test suites** that ALL agents should use. Do not re-create these — they are authoritative.

### Skills (`.agents/skills/`)

These are project-owned skills that encode how to do key tasks correctly. **Read the relevant skill before doing work in its area.** Key ones:

- `verify-before-commit` — verify before claiming work is done
- `db-schema-change` — safe database schema change process
- `schema-change-checklist` — pre/post schema change checklist
- `release-checklist` — pre-publish verification
- `data-heal-playbook` — fixing bugs that poisoned stored data
- `import-bug-investigation` — debugging spec/premix/cheese/shipping import bugs
- `wrong-number-triage` — tracing wrong numbers on screen
- `customer-import-audit` — audit after importing a new customer
- `test-gap-triage` — finding untested code
- `state-accuracy-check`, `sync-invariant-check`, `spec-import-guard`, `operational-browser-verification`, `rollback-recovery`, `production-go` — domain-specific checks

### Tests

The test suites below are part of the repo and run in CI. **Do not delete or weaken them.** When you change code in their area, run them:

- `artifacts/api-server/src/routes/cacheControl.integration.test.ts` — no-store cache headers on at-risk GET endpoints
- `artifacts/api-server/src/lib/rateLimitCost.test.ts` + `artifacts/api-server/src/middlewares/costLimitMiddleware.test.ts` — AI cost limiting
- `artifacts/api-server/src/routes/signupAccessCode.integration.test.ts` — sign-up bootstrap hardening
- `artifacts/api-server/src/routes/*.integration.test.ts` — API integration tests (Postgres-backed)
- `lib/*/src/*.test.ts` — shared library unit tests

Run tests with: `pnpm --filter @workspace/api-server test` (API), `pnpm --filter @workspace/run-calculator test` (web), `pnpm -r --filter "./lib/**" --if-present test` (libraries).

To run in production with the same Postgres-backed integration tests, ensure `DATABASE_URL` is set.

## Key facts

- **Render deploy**: serves both API and web UI from a single service. Static file serving is in `app.ts` (guarded to `NODE_ENV=production`).
- **Schema at boot**: `applyDatabaseSchema()` in `index.ts` runs `drizzle push-force` at startup.
- **Branch protection**: `main` is protected — no force pushes, PRs required, CI must pass.
- **Replit pushes to branches**, not directly to `main`.
