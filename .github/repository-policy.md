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

Each required check must be reported by the GitHub Actions app (app ID `15368`).
The read-only verifier checks this identity as well as the exact check names
above. `Desktop and phone department journey`, release gates, schema rollback,
and release-concurrency checks remain separate workflows and are not currently
required status checks on `main`.

Development uses the `Replit` branch. Local `main` is a comparison base and
must not be treated as a delivery path. Deliver changes to `main` through a
pull request from a reviewed branch based on the current live `main`.

The legacy `push:main` helper is not a routine delivery path under this policy;
the live rule requires a pull request and status checks. It remains only as a
historical guard for repositories that explicitly permit direct delivery.

Validate the live setting with:

```sh
pnpm run check:github-signed-commit-policy -- \
  --repo ravenslight2010/Production-run-calculator
```

The command is read-only and delegates authentication to the GitHub CLI. Never
put a GitHub token, private signing key, or authenticated remote URL in this
file or elsewhere in the repository. The credential-free activation result is
retained in `.github/signed-commit-policy-evidence.md`. If the CLI is not
authenticated, record the check as unavailable; do not substitute a public
unauthenticated response for live private settings.

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
2. Download the `stable-branch-protection-check` artifact if the run needs to be
   retained or shared during investigation. The artifact contains only the
   checker's bounded result and is retained for 14 days.
3. Use the failure's named field (for example,
   `required_status_checks.checks[2]`) to compare the live rule under
   **Settings → Rules → Rulesets** or **Settings → Branches**, depending on
   which GitHub UI manages `main`.
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