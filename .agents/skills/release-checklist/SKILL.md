---
name: release-checklist
description: Pre-publish verification for this app. Use before suggesting a deploy/publish, or when the user asks to publish. Runs the right tests, typechecks, workflow restarts, and reminds what data heals will apply live.
---

# Release Checklist

Run before suggesting a publish so "works in preview, broken live" doesn't happen.

1. **Typecheck** — `pnpm run typecheck:libs` first if any `lib/*` changed, then leaf `npx tsc -p tsconfig.json --noEmit` in changed artifacts. Verify with typecheck, NOT `build` (build needs workflow-provided env).
2. **Tests via workflows** — run the test workflows relevant to what changed (`test`, `test:client`, `test:rules`, etc.). A single test file from bash is fine; full suites from bash can starve.
3. **Restart BOTH API workflows** — `API Server` (port 5000) AND `artifacts/api-server: API Server` (8080; the browser hits this one). Verify via the public `$REPLIT_DEV_DOMAIN`, not localhost.
4. **Real check in the preview** — screenshot or e2e the changed surface; the web workflow is `artifacts/run-calculator: web`.
5. **Pending data heals** — check whether `artifacts/api-server/src/lib/dataHeals.ts` gained a heal since the last publish. If so, tell the user (plain language) that the live app's stored data will be corrected automatically on this publish.
6. **Schema changes** — if `lib/db/src/schema/*` changed, confirm the change is additive (populated tables) and was pushed in dev.
7. Then `suggest_deploy`.

Skip steps that don't apply (e.g. no schema change) — don't re-run unrelated suites for a tiny fix.
