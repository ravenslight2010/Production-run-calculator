# AGENTS.md — Shared instructions for all coding agents

This repository is worked on by **multiple coding agents** (Codex, Replit Agent, and others). To avoid duplicate work and conflicting fixes, follow these rules.

## Before making any change

1. **Check `.agents/memory/codex-fixes.md`** — this file logs every fix Codex has made. If a fix is already documented there, do NOT re-apply it.
2. **Check `.agents/memory/claude-bugs.md`** — bugs Claude has found (Open) or already fixed (Fixed). Don't re-report an Open bug as new, and don't re-apply a Fixed one.
3. **Check `.agents/memory/`** — other memory files contain design decisions, patterns, and gotchas. Read them before modifying code.
4. **Never force-push to `main`** — always use a feature branch + PR. Branch protection is enabled.

## After making a fix

1. **Update `.agents/memory/codex-fixes.md`** (or `.agents/memory/claude-bugs.md` if you're Claude) with:
   - File path(s) changed
   - What was wrong (the bug/issue)
   - What the fix was (the change)
   - Why it was needed (context)
2. **Push to a feature branch** and open a PR.
3. **CI must pass** before merging.

## Task scope and failure closure

- **Use one durable task per objective.** The owning task includes the complete end-to-end outcome: investigation, implementation, integration and persistence effects, regression coverage, final verification, and every repair that is in scope.
- Before starting, capture the task's scope, affected surfaces, owner, applicable specialist safety checks, and validation matrix. Search the task board for overlap and dependencies; do not duplicate an existing task.
- **Before creating another task, apply this decision checklist:** (1) name the parent or owning task; (2) search active and draft work for overlap; (3) write independent acceptance criteria for a separately completable user outcome; (4) identify the approved exception—independent outcome, explicitly deferred user outcome, or out-of-scope safety, security, data-integrity, or release blocker; and (5) document why the work cannot remain in the owning task. If any answer is missing, route the finding to the owner instead of creating a task.
- For every web-facing task, record a compatibility applicability matrix covering desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari. Each check must have an explicit `not applicable`, `blocked`, or `not run` reason when it is not a pass.
- Responsive browser emulation is automated evidence only; it is not proof of physical Android Chrome or iOS Safari/PWA behavior. This is a web-only product and does not create a native-mobile requirement.
- Keep discoveries for the same objective in the owning task's progress updates and failure ledger. Fix every in-scope finding before completion; do not create a recursive follow-up task for a symptom, test failure, fixture repair, or sub-outcome.
- A separate project task is allowed only for a genuinely independent outcome with separate acceptance criteria, an explicitly deferred user outcome, or an out-of-scope safety, security, data-integrity, or release blocker that cannot responsibly remain in the owning task. Non-blocking out-of-scope observations stay documented in the owning task or an existing matching task; they do not become speculative “one more task” work.
- Completion review must retain the owning task's complete failure ledger and resolve every in-scope `FAIL`, `BLOCKED`, `NOT REACHED`, and `MISSING` entry. Test failures, fixture repairs, cleanup, validation work, and other in-scope sub-outcomes remain in that ledger and must not become recursive tasks.
- Long-running task updates must state the current objective, completed work and status, active blockers with evidence and owner, the next validation milestone and prerequisite, and the accountable owner. Preserve unresolved `FAIL`, `BLOCKED`, `NOT REACHED`, and `MISSING` results until they are closed.
- For web-facing work, completion evidence must include the compatibility applicability matrix and distinguish emulated Chromium/WebKit results from physical Android Chrome and iOS Safari/PWA evidence. Missing device services stay `blocked` or `not run`, never pass.
- This planning rule changes neither task automation settings nor the scope, state, or acceptance criteria of existing tasks.
- Applying this rule to current work must not merge, cancel, rename, re-scope, accept, start, or assign any current draft or active task. Related tasks remain separate under their existing objectives and lifecycle; new in-scope findings return to the matching existing owner.

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
