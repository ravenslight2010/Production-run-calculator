# Main branch protection validation evidence

Validated on 2026-09-14 through the repository's authorized GitHub integration
using GitHub's branch-protection API. This is a bounded, revision-stamped
snapshot; GitHub's live rule remains the enforcement source of truth.

| Check | Result |
| --- | --- |
| Repository | `ravenslight2010/Production-run-calculator` |
| Branch | `main` |
| API response | `200 OK` |
| Required signed commits | Enabled |
| Required pull-request reviews | Enabled; 1 approval; stale approvals dismissed |
| Required status checks | 6 GitHub Actions checks; strict/up-to-date branch required |
| Enforce for administrators | Disabled |
| Required conversation resolution | Disabled |
| Force pushes | Disabled |
| Branch deletion | Disabled |

Required checks, as returned by the live rule:

- `API tests (Postgres)` — GitHub Actions app `15368`
- `Build (web + API)` — GitHub Actions app `15368`
- `Docker image` — GitHub Actions app `15368`
- `Security audit (prod deps)` — GitHub Actions app `15368`
- `Typecheck` — GitHub Actions app `15368`
- `Unit tests (web + libs)` — GitHub Actions app `15368`

The local `gh` CLI authentication check was unavailable in this workspace
(`gh auth status` reported no authenticated host). The live fields above were
therefore verified through the authorized GitHub integration rather than
claimed as a successful local CLI run. The repository workflow still performs
the CLI-based read when GitHub supplies its workflow token.

Only the bounded policy fields above were retained. No OAuth token, Git remote
credential, signing key, response header, or authenticated URL was read into or
stored in this repository.

Re-run the read-only check after any administrative change:

```sh
pnpm run check:github-signed-commit-policy -- \
  --repo ravenslight2010/Production-run-calculator
```
