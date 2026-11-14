# Merge & Post-Merge Runbook

Template proven across the PR #106–#117 series.

## Pre-merge checks

1. Confirm all 6 required checks are green; re-run flaky failures once before investigating.
2. For dependency PRs, confirm the evidence manifest was regenerated (see SKILL.md, failure engine 1) or that `dependabot-evidence.yml` already pushed the fix commit.
3. For workflow/action bumps, grep the contract tests for the old SHA:
   - `grep -rn "OLD_SHA" scripts/src/`
   - Remember escaped-slash patterns in `compare-typescript-7.test.mts` (`actions\/upload-artifact@`).

## Merge

- Use squash merge unless the PR history is meaningful.
- If the PR is self-authored: toggle `required_approving_review_count` to 0 via
  `PATCH /repos/{owner}/{repo}/branches/main/protection/required_pull_request_reviews`,
  merge, then restore to 1. Never leave protection weakened.
- Do NOT force-push to `main`. Dependabot branches may be rebased with `--force-with-lease`.

## Post-merge cleanup

1. Delete the merged branch (remote) unless it is dependabot-managed.
2. Comment `@dependabot rebase` on sibling dependabot PRs that touched the same manifest/lockfile regions.
3. If lockfile changed: expect sibling dependabot PRs to conflict; resolve with
   `git checkout --ours pnpm-lock.yaml && pnpm install --lockfile-only`, regenerate evidence
   snapshots, and `git rebase --skip` any now-empty pin commits.
4. Close superseded PRs with a comment naming the PR that replaced them.
5. Verify `main` CI is green after the merge before starting the next one.

## Verification commands

- Evidence manifest: `pnpm --filter @workspace/corpus-harness run snapshots`
- Contract tests: `bash scripts/src/check-workflows.test.sh`
- Security audit: `pnpm audit --prod`
