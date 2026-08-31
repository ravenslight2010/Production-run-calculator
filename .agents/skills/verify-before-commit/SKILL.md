---
name: verify-before-commit
description: Verify changes before committing or pushing, and on any change to the repo. Use whenever about to commit, push, or claim a "green build" / "tests pass" / "ready to deploy" for this app. Encodes the local verification discipline for this repo: git status always clean before commit, locked dependency overrides kept in sync, typecheck (not build) because this machine is ARM, rely on CI for the real test gate, and check .agents/memory before touching unfamiliar areas.
---

# Verify Before Commit

Run before every commit, push, or "ready" claim so "works on my (ARM) machine, broken in CI" doesn't happen.

1. **Check `.agents/memory/` first** — before touching any unfamiliar subsystem, read the relevant memory docs (215 files). The repo's operational knowledge lives there (see `replit.md` for the runbook). Don't guess.

2. **Git status must be clean** — `git status`. There should be nothing to commit after your change is committed; no stray build artifacts or secrets. If `test-results/.last-run.json` or other untracked files appear, decide whether to gitignore or remove them — never commit accidental junk.

3. **Typecheck, not build** — verify with `CI=true pnpm run typecheck` (root). Do NOT use `pnpm run build` for verification: the vite build needs workflow-provided `PORT` and `BASE_PATH` env, so it fails outside CI. If any `lib/*` changed, also run the leaf typecheck. Expect exit 0.

4. **Run plain-node logic checks locally** — ARM (aarch64) cannot run vitest/vite/rollup/Playwright because the repo strips non-x64 natives. For pure-logic changes, mirror the function in `node -e` to sanity-check edge cases rather than relying on the test runner.

5. **Keep the lockfile in sync with overrides** — after editing `pnpm-workspace.yaml` (overrides / `allowBuilds` / `onlyBuiltDependencies`), run `CI=true pnpm install --frozen-lockfile` and commit the resulting lockfile change. A stale lockfile fails `pnpm install` (exit 1) and turns CI red.

6. **Do not add/remove tests carelessly** — add tests only alongside real behavior changes (or when explicitly asked). Empty test suites fail CI: pass `--passWithNoTests` if a suite genuinely has nothing to run yet.

7. **Rely on CI for the real test gate** — unit+API tests and Docker build only run correctly on the x64 CI runners and need Postgres. After pushing, watch the `ci.yml` workflow (Typecheck, Unit tests, API tests, Web+API Build, Docker, Security) until green. If the same blocking CI condition recurs for three consecutive turns, report it as blocked.

8. **Only then commit/push** — commit with a clear message covering what and why. Push via `git push "https://x-access-token:${TOKEN}@github.com/ravenslight2010/Production-run-calculator.git" main`, then sync the tracking ref with `git update-ref refs/remotes/origin/main <SHA>`.
