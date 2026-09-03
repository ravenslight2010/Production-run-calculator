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
