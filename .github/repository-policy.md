# Stable `main` branch policy

GitHub's live branch protection for `main` is the enforcement boundary for
every delivery path. The current verified contract requires pull requests with
at least one approval, dismisses stale approvals, requires an up-to-date branch,
requires signed commits, and requires the six status checks listed below.
Force-pushes and branch deletion are disabled. Administrator enforcement and
conversation resolution are currently disabled in the live rule; this document
does not describe either setting as enabled.

The required GitHub Actions checks are:

- `API tests (Postgres)`
- `Build (web + API)`
- `Docker image`
- `Security audit (prod deps)`
- `Typecheck`
- `Unit tests (web + libs)`

The local policy verifier extracts the named jobs from `.github/workflows/ci.yml`
and compares them with this six-check contract in both the classic branch-
protection response and every active ruleset that applies to `main` (including
the `~DEFAULT_BRANCH` ruleset target). A required job rename must update this
list in the same change. Jobs in release, browser-evidence, schema-rollback, and
release-concurrency workflows are intentionally outside this required-CI
contract.

Each required check must be reported by the GitHub Actions app (classic
protection `app_id` and ruleset `integration_id` `15368`). The read-only
verifier checks this identity as well as the exact check names above.
`Desktop and phone department journey`, release gates, schema rollback, and
release-concurrency checks remain separate workflows and are not currently
required status checks on `main`.

Development uses the `Replit` branch. Local `main` is a comparison base and
must not be treated as a delivery path. Deliver changes to `main` through a
pull request from a reviewed branch based on the current live `main`.

The legacy `push:main` helper is not a routine delivery path under this policy;
the live rule requires a pull request and status checks. It remains only as a
historical guard for repositories that explicitly permit direct delivery.

## Workflow privilege and isolation contract

Every maintained workflow must declare a top-level least-privilege
`permissions` block with `contents: read`, explicit top-level `concurrency`, and
run-scoped cache and artifact namespaces. Pull-request workflows must not use
implicit `setup-node` caches; any future cache must include
`${{ github.run_id }}` in its key or scope. Artifact names must also include
`${{ github.run_id }}` so reruns and untrusted pull requests cannot collide
with a retained result.

The manual production-promotion handoff is protected by the `production`
environment and has read-only repository and Actions permissions. It consumes
only a named artifact from a caller-selected successful `main` CI run, verifies
the artifact digest and revision, and emits digest-qualified image references.
It has no deployment or package credentials; a later deployment integration
must consume that handoff without substituting tags or rebuilding from source.

Write permissions are exceptions, not defaults. The current approved
exceptions are:

| Workflow/job | Capability | Boundary |
| --- | --- | --- |
| CI / `docker-publish` | `packages: write` | Only a push of `main` publishes immutable image tags. |
| Stable branch protection / `notify` | `issues: write` | Only a scheduled failure updates one maintainer alert issue. |

Each exception is documented beside the permission in its workflow. The
workflow guard rejects undocumented writes, broad `read-all`/`write-all`
defaults, missing concurrency, unscoped caches, and unscoped artifact names.
The guard is static and read-only: it inspects workflow files and runs
actionlint without dispatching any workflow.

Validate the live setting with:

```sh
pnpm run check:github-signed-commit-policy -- \
  --repo ravenslight2010/Production-run-calculator
```

The command is read-only and delegates authentication to the GitHub CLI. Never
put a GitHub token, private signing key, or authenticated remote URL in this
file or elsewhere in the repository. The legacy guarded push helper likewise
reads the workspace `GIT_URL` secret only at push time and never stores it in
Git configuration. The credential-free activation result is retained in
`.github/signed-commit-policy-evidence.md`. If the CLI is not authenticated,
record the check as unavailable; do not substitute a public unauthenticated
response for live private settings.

## Continuous drift detection

The `Stable branch protection check` workflow runs this same read-only checker
each Monday at 06:17 UTC and can also be started with **Run workflow** from the
Actions tab. It uses the workflow's built-in `github.token` with only
`contents: read` for the protection read and `issues: write` only to maintain
the scheduled drift alert. It never changes repository settings and never
prints a token or raw GitHub API response.

When the workflow fails:

1. Open the failed run and read the **Check live main branch protection** step
   or its **Stable branch protection check** job summary.
2. Download the `stable-branch-protection-check-${{ github.run_id }}` artifact if the run needs to be
   retained or shared during investigation. The artifact contains only the
   checker's bounded result and is retained for 14 days.
3. Use the failure's named field (for example,
   `required_status_checks.checks[2]`) to compare the live rule under
   **Settings → Rules → Rulesets** or **Settings → Branches**, depending on
   which GitHub UI manages `main`. A result marked **Ruleset verification
   unavailable** means the CLI could not read ruleset metadata; it is not
   evidence that no ruleset exists.
4. Repair the mismatched setting manually to match the live contract recorded
   in this document, including the exact required check names and GitHub Actions
   app ID `15368`, then use **Run workflow** to confirm the rule converges.

The workflow intentionally does not attempt an automatic repair: branch
protection changes are administrative actions and must be reviewed by a
maintainer before they are applied.

## Source-of-truth contract

The live GitHub rule, not this file or the local guarded-push helper, is the
source of truth. The local helper is an additional early check and may reject
an unsigned commit when its repository-local opt-in is enabled, but it cannot
weaken or replace GitHub enforcement.

The latest bounded activation result is retained in
`.github/signed-commit-policy-evidence.md`. Re-run the read-only verifier after
any administrative change; do not infer private branch protection, Dependabot
alerts, or other security settings from a public unauthenticated API response.
