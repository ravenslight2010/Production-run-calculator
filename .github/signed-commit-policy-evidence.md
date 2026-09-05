# Main branch protection validation evidence

Validated on 2026-09-03 through the repository's authorized GitHub integration
using GitHub's branch-protection API.

| Check | Result |
| --- | --- |
| Repository | `ravenslight2010/Production-run-calculator` |
| Branch | `main` |
| API response | `200 OK` |
| Required signed commits | Enabled |
| Required pull-request reviews | Enabled; 1 approval; stale approvals dismissed |
| Required status checks | 8 GitHub Actions checks; strict/up-to-date branch required |
| Enforce for administrators | Enabled |
| Required conversation resolution | Enabled |
| Force pushes | Disabled |
| Branch deletion | Disabled |

Required checks:

- `Typecheck`
- `Unit tests (web + libs)`
- `API tests (Postgres)`
- `Security audit (prod deps)`
- `Docker image`
- `Build (web + API)`
- `Desktop and phone department journey`
- `Release gates and retained standard evidence`

Only the bounded policy fields above were retained. No OAuth token, Git remote
credential, signing key, response header, or authenticated URL was read into or
stored in this repository.

This snapshot is evidence of the activation check, not the enforcement source
of truth. Re-run the read-only branch-protection check against GitHub before
relying on the policy after an administrative change.

# Signed-commit policy validation evidence

Validated on 2026-09-01 through the repository's authorized GitHub integration
using GitHub's read-only branch-protection API.

| Check | Result |
| --- | --- |
| Repository | `ravenslight2010/Production-run-calculator` |
| Branch | `main` |
| API response | `200 OK` |
| Required signed commits | Enabled |
| Required pull-request reviews | Disabled |
| Required status checks | Disabled |
| Enforce for administrators | Disabled |
| Push restrictions | Disabled |

Only the bounded policy fields above were retained. No OAuth token, Git remote
credential, signing key, response header, or authenticated URL was read into or
stored in this repository.

This snapshot is evidence of the activation check, not the enforcement source
of truth. Re-run `pnpm run check:github-signed-commit-policy -- --repo
ravenslight2010/Production-run-calculator` against GitHub before relying on the
policy after an administrative change.
