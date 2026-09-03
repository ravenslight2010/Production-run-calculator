# Stable `main` branch policy

GitHub's live branch protection for `main` is the enforcement boundary for
every delivery path. Changes to `main` require a pull request with at least one
approval, passing required checks, resolved conversations, and an up-to-date
branch. Stale approvals are dismissed, administrators are included, force
pushes and branch deletion are disabled, and required signed commits remain
enabled.

The required GitHub Actions checks are:

- `Typecheck`
- `Unit tests (web + libs)`
- `API tests (Postgres)`
- `Security audit (prod deps)`
- `Docker image`
- `Build (web + API)`
- `Desktop and phone department journey`
- `Release gates and retained standard evidence`

Each required check must be reported by the GitHub Actions app
(app ID `15368`). The read-only verifier checks this identity as well as the
exact check names above.

Development uses the `Replit` branch, which tracks `origin/Replit`. Local
`main` continues to track `origin/main` as the comparison base; its local push
target is diverted to the backup remote so an ordinary `git push` from the
comparison branch cannot update GitHub's stable branch. Deliver changes to
`main` through a pull request from `Replit`.

The legacy `push:main` helper is not a routine delivery path under this policy;
GitHub will reject direct updates to `main`. It remains only as a historical
guard for repositories that explicitly permit direct delivery.

Validate the signed-commit portion with:

```sh
pnpm run check:github-signed-commit-policy -- \
  --repo ravenslight2010/Production-run-calculator
```

The command is read-only and delegates authentication to the GitHub CLI. Never
put a GitHub token, private signing key, or authenticated remote URL in this
file or elsewhere in the repository. The credential-free activation result is
retained in `.github/signed-commit-policy-evidence.md`.

## Continuous drift detection

The `Stable branch protection check` workflow runs this same read-only checker
each Monday at 06:17 UTC and can also be started with **Run workflow** from
the Actions tab. It uses the workflow's built-in `github.token` with only
`contents: read`; it never changes repository settings and never prints a
token or raw GitHub API response.

When the workflow fails:

1. Open the failed run and read the **Check live main branch protection** step
   or its **Stable branch protection check** job summary.
2. Download the `stable-branch-protection-check` artifact if the run needs to
   be retained or shared during investigation. The artifact contains only the
   checker's bounded result and is retained for 14 days.
3. Use the failure's named field (for example,
   `required_status_checks.checks[2]`) to compare the live rule under
   **Settings → Rules → Rulesets** or **Settings → Branches**, depending on
   which GitHub UI manages `main`.
4. Repair the mismatched setting manually to match this document, including
   the exact required check names and GitHub Actions app ID `15368`, then use
   **Run workflow** to confirm the rule converges.

The workflow intentionally does not attempt an automatic repair: branch
protection changes are administrative actions and must be reviewed by a
maintainer before they are applied.
