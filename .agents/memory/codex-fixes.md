---
name: Codex fixes log
description: Running log of every fix Codex has made. Check this BEFORE making changes to avoid duplicate work.
---

# Codex Fixes Log

This file documents every fix Codex has made to this repository. **Check this before making changes** — if a fix is already listed here, do NOT re-apply it.

## Format

Each entry includes:
- **Date**: when the fix was made
- **File(s)**: paths changed
- **Problem**: what was wrong
- **Fix**: what was changed
- **Context**: why it was needed

---

## 2026-08-30 — Missing /api router mount in app.ts

**File(s):** `artifacts/api-server/src/app.ts`

**Problem:** The previous session's change to add static file serving accidentally deleted the `app.use("/api", router)` line. The router was imported but never mounted, so ALL API routes returned errors (404/generic error handler). Integration tests saw `text/html` on SSE endpoints and missing cache headers on every route.

**Fix:** Restored `app.use("/api", router)` after the token-in-URL middleware and before the static serving block.

**Context:** This was a critical bug — the entire API was unreachable in production. The router must be mounted before any static serving or catch-all routes.

---

## 2026-08-30 — Guard SPA static serving to production only

**File(s):** `artifacts/api-server/src/app.ts`

**Problem:** The static file serving block (`express.static` + SPA catch-all) was unguarded, causing integration tests to fail (SSE endpoints returned `text/html` from the catch-all).

**Fix:** Wrapped the static serving block in `if (process.env.NODE_ENV === "production")` so tests are unaffected.

**Context:** Integration tests import `app.ts` directly. The catch-all `/{*splat}` route intercepted SSE and JSON routes in tests.

---

## 2026-08-30 — Apply DB schema at API boot (Render deploy)

**File(s):** `artifacts/api-server/src/index.ts`, `render.yaml`

**Problem:** Docker Compose had a separate `migrate` one-shot service that created DB tables. Render's blueprint had no migrate step, so a fresh Render Postgres had zero tables. Every API call (sign-up, login, data) failed silently while the static frontend loaded fine.

**Fix:** Added `applyDatabaseSchema()` to `index.ts` that runs `pnpm --filter @workspace/db run push-force` at boot in production (before `app.listen`). Guarded to `NODE_ENV=production` so tests are unaffected. Fails fast (exit 1) if schema push fails.

**Context:** The `api` Docker image is `FROM builder` (full workspace + pnpm + dev deps), so `pnpm --filter @workspace/db run push-force` works at runtime. Schema push is idempotent.

---

## 2026-08-30 — Enable direct Gemini API key fallback

**File(s):** `lib/integrations-openai-ai-server/src/client.ts`

**Problem:** The AI client only worked with Replit's AI_INTEGRATIONS_GEMINI_* proxy vars. Off-Replit deploys (Render) had no AI access.

**Fix:** Added `GOOGLE_API_KEY` as a fallback when Replit's vars aren't set. SDK default base URL (`https://generativelanguage.googleapis.com`) is used for direct Gemini.

**Context:** Enables Render and other non-Replit deploys to use AI features with a standard Gemini API key.

---

## 2026-08-30 — Fix cost-limit to accumulate spend (not count requests)

**File(s):** `lib/rate-limit/src/store.ts`, `artifacts/api-server/src/middlewares/costLimitMiddleware.ts`

**Problem:** The cost limiter was counting requests, not accumulated spend. Each AI call counted as 1 regardless of token cost, so the 300/min budget was actually 300 requests/min, not $3.00/min.

**Fix:** Changed `RateLimitStore.hit` to accept optional `amount` parameter. Cost limiter now passes `cost` as amount, so stored count IS accumulated spend. `X-Cost-Used` reports spend before the refused request.

**Context:** End-to-end integration test (`costLimit.integration.test.ts`) verifies the fix: exhausts budget via 10× optimize (cost 12) + 9× forecast (cost 20) + 1× forecast (429).

---

## 2026-09-03 — Fix web app typecheck: recipe-guide-import declarations

**File(s):** `artifacts/run-calculator/package.json`, `artifacts/run-calculator/src/components/RecipeGuideImportDialog.tsx`

**Problem:** Two pre-existing CI typecheck failures:
1. TS6305: Web app's `pretypecheck` built `inventory-math` and `spec-import` declarations but not `recipe-guide-import`, so `tsc --noEmit` couldn't resolve the lib's declaration output.
2. TS7006: `flavor` parameter in `.some()` callbacks was untyped (implicit any).

**Fix:**
1. Added `pnpm --filter @workspace/recipe-guide-import exec tsc -b --force` to the `pretypecheck` script.
2. Annotated `flavor` as `string` in two `.some()` callbacks in `RecipeGuideImportDialog.tsx`.

**Context:** These errors blocked the Typecheck CI gate, preventing PR merges. The `recipe-guide-import` lib has `composite: true` in its tsconfig, so its declarations must be built before the web app typechecks.

---

## 2026-09-03 — Re-add static file serving for Render deploy

**File(s):** `artifacts/api-server/src/app.ts`

**Problem:** Replit's force-push removed the static file serving block from `app.ts`. Render's single-service deploy needs to serve both API and web UI from the same process.

**Fix:** Restored the `express.static` + SPA catch-all block after the `/api` router mount, guarded to `NODE_ENV=production`.

**Context:** Same proven code that was already deployed and working on Render. Without it, the Render site shows only the API with no web UI.

---

*Last updated: 2026-09-03*

---

## 2026-09-05 — Restore GOOGLE_API_KEY fallback in AI client

**File(s):** `lib/integrations-openai-ai-server/src/client.ts`

**Problem:** The Replit branch's version of the AI client only supported Replit's `AI_INTEGRATIONS_GEMINI_API_KEY` + `AI_INTEGRATIONS_GEMINI_BASE_URL` proxy vars. Render deploys use `GOOGLE_API_KEY` (standard Gemini key), so AI features on Render would break with "AI_INTEGRATIONS_GEMINI_API_KEY and AI_INTEGRATIONS_GEMINI_BASE_URL must be set".

**Fix:** Restored the dual-path client: `replitKey || directKey` where `directKey = process.env.GOOGLE_API_KEY`. When only `GOOGLE_API_KEY` is set, the SDK's default base URL is used. When both are set, the Replit proxy path wins.

**Context:** This is a re-apply of the 2026-08-30 fix that Replit's branch overwrote. Make sure future merges from Replit keep this fallback.

## 2026-09-05 — Fix skill-catalog CI failure on platform-injected skill refs

**File(s):** `.agents/skills/production-go/SKILL.md`

**Problem:** The `Typecheck` CI job's `check:skill-catalog` step failed on `.agents/skills/production-go/SKILL.md` — three inline references to `.local/.../SKILL.md` (review-before-shipping, security-scan, debug-workflow-ports-issues) were flagged as broken local references. `.local/` roots are platform-injected and absent from GitHub checkouts by design (see `.agents/memory/skill-catalog-ci-roots.md`), so those paths cannot resolve in GitHub CI even though they exist in the Replit workspace.

**Fix:** Converted the three references to directory-form paths (`.local/custom_skills/review-before-shipping`, `.local/skills/security-scan`, `.local/skills/debug-workflow-ports-issues`), matching the repo's established convention for platform-injected skill references (see `.agents/skills/README.md`, `skill-creator` skill).

**Context:** Needed so the Replit merge (`PR #17 merge/replit-updates`) can pass the required Typecheck check. If Replit re-introduces `.../SKILL.md` refs into `.local/` paths, the skill catalog check will fail again in GitHub CI.
