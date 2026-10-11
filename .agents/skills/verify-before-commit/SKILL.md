---
name: verify-before-commit
description: Verify local repository state and supported checks before committing or pushing changes, and before claiming changed-code typechecks or tests are green. Use release-checklist for full pre-publish verification and production-go for the final production GO/NO-GO decision.
---

# Verify Before Commit

Run before every commit or push, and before claiming local verification for a code change is green, so "works on my (ARM) machine, broken in CI" doesn't happen. For full pre-publish gates, use `release-checklist`; for the final production GO/NO-GO decision, use `production-go`.

1. **Check `.agents/memory/` first** — before touching any unfamiliar subsystem, read the relevant memory docs (215 files). The repo's operational knowledge lives there (see `replit.md` for the runbook). Don't guess.

2. **Git status must be clean** — `git status`. There should be nothing to commit after your change is committed; no stray build artifacts or secrets. If `test-results/.last-run.json` or other untracked files appear, decide whether to gitignore or remove them — never commit accidental junk.

3. **Typecheck, not build** — verify with `CI=true pnpm run typecheck` (root). Do NOT use `pnpm run build` for verification: the vite build needs workflow-provided `PORT` and `BASE_PATH` env, so it fails outside CI. If any `lib/*` changed, also run the leaf typecheck. Expect exit 0.

4. **Run plain-node logic checks locally** — ARM (aarch64) cannot run vitest/vite/rollup/Playwright because the repo strips non-x64 natives. For pure-logic changes, mirror the function in `node -e` to sanity-check edge cases rather than relying on the test runner.

5. **Keep the lockfile in sync with overrides** — after editing `pnpm-workspace.yaml` (overrides / `allowBuilds` / `onlyBuiltDependencies`), run `CI=true pnpm install --frozen-lockfile` and commit the resulting lockfile change. A stale lockfile fails `pnpm install` (exit 1) and turns CI red.

6. **Do not add/remove tests carelessly** — add tests only alongside real behavior changes (or when explicitly asked). Empty test suites fail CI: pass `--passWithNoTests` if a suite genuinely has nothing to run yet.

7. **Rely on CI for the real test gate** — unit+API tests and Docker build only run correctly on the x64 CI runners and need Postgres. After pushing, watch the `ci.yml` workflow (Typecheck, Unit tests, API tests, Web+API Build, Docker, Security) until green. If the same blocking CI condition recurs for three consecutive turns, report it as blocked.

8. **Only then commit/push** — commit with a clear message covering what and why.
   For the legacy guarded helper, configure the workspace `GIT_URL` secret and
   run `pnpm run push:main -- --message "Describe the change"`; it keeps the
   fetch URL credential-free and injects the secret only for the push
   subprocess. Never put a token in a remote URL, command, or repository file.
