# Repository policy contract

GitHub's live branch protection for `main` must have **required signed commits**
enabled. This is the enforcement boundary for every delivery path; the local
guarded-push helper is an additional early check, not the source of truth.

The protection intentionally leaves pull-request reviews, status checks, admin
enforcement, and push restrictions disabled so approved direct-to-main delivery
continues to work.

The local `push:main` helper may reject an unsigned commit earlier when its
repository-local opt-in is enabled, but this contract does not depend on that
helper. GitHub's live rule is the mandatory boundary for Git clients, API
writes, Actions, and every other path to `main`.

Validate the live setting with:

```sh
pnpm run check:github-signed-commit-policy -- \
  --repo ravenslight2010/Production-run-calculator
```

The command is read-only and delegates authentication to the GitHub CLI. Never
put a GitHub token, private signing key, or authenticated remote URL in this
file or elsewhere in the repository. The credential-free activation result is
retained in `.github/signed-commit-policy-evidence.md`.
