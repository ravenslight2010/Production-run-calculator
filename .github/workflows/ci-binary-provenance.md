# CI binary provenance inventory

Every GitHub Actions workflow that downloads an executable or archive must
verify its GitHub artifact attestation **before** extracting, installing, or
executing it. The verification must be fail-closed and pin all of:

- the expected publisher repository with `--repo`;
- the expected signing workflow with `--signer-workflow`; and
- GitHub's Actions OIDC issuer:
  `https://token.actions.githubusercontent.com`.

The workflow must also use a pinned version and an independent checksum or
equivalent integrity check when the publisher provides one. A publisher that
does not provide a verifiable GitHub artifact attestation must not be added as
a direct CI binary download; use a preinstalled runner tool or a supported
managed action instead.

## Approved binary inventory

| Tool and version  | Download source                                                         | Expected publisher | Expected signing workflow                         |
| ----------------- | ----------------------------------------------------------------------- | ------------------ | ------------------------------------------------- |
| actionlint 1.7.12 | `rhysd/actionlint` release asset `actionlint_1.7.12_linux_amd64.tar.gz` | `rhysd/actionlint` | `rhysd/actionlint/.github/workflows/release.yaml` |

The actionlint workflow verifies the release checksum and then verifies the
asset attestation using the publisher repository, signing workflow, and OIDC
issuer above before `tar` or `install` can run.

## Audit scope

The current `.github/workflows` audit found only the actionlint release
archive. Other `curl` calls are localhost health checks or a Slack webhook;
package-manager installs and setup actions are not direct executable/archive
downloads. The repository check is intentionally conservative and will fail a
future workflow that introduces a recognizable binary/archive download without
the required attestation gate.
