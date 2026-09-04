# AGENTS.md — Shared instructions for all coding agents

This repository is worked on by **multiple coding agents** (Codex, Replit Agent, and others). To avoid duplicate work and conflicting fixes, follow these rules.

## Before making any change

1. **Check `.agents/memory/codex-fixes.md`** — this file logs every fix Codex has made. If a fix is already documented there, do NOT re-apply it.
2. **Check `.agents/memory/`** — other memory files contain design decisions, patterns, and gotchas. Read them before modifying code.
3. **Never force-push to `main`** — always use a feature branch + PR. Branch protection is enabled.

## After making a fix

1. **Update `.agents/memory/codex-fixes.md`** (or create your own equivalent) with:
   - File path(s) changed
   - What was wrong (the bug/issue)
   - What the fix was (the change)
   - Why it was needed (context)
2. **Push to a feature branch** and open a PR.
3. **CI must pass** before merging.

## Shared knowledge files

- `.agents/memory/codex-fixes.md` — running log of Codex fixes
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
