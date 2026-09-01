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
