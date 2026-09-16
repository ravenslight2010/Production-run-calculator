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

## Pinned service images

Workflow service containers are also pinned by manifest digest so a mutable
registry tag cannot change the runner environment between workflow runs:

| Image | Digest-pinned release |
| ----- | --------------------- |
| `postgres:16` | `sha256:f1c3376c26f2609ab9f29f71f824103fe2fcd8ee0346485cb6122a4f93df6f94` |
| `postgres:16-alpine` | `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685` |

## Audit scope

The current `.github/workflows` audit found only the actionlint release
archive. Other `curl` calls are localhost health checks or a Slack webhook;
package-manager installs and setup actions are not direct executable/archive
downloads. The repository check is intentionally conservative and will fail a
future workflow that introduces a recognizable binary/archive download without
the required attestation gate.

## Published container image evidence

The trusted `docker-publish` job in `ci.yml` publishes exactly three images:
the API runtime, API migration, and web images. Each image is labeled with
`org.opencontainers.image.revision=${{ github.sha }}` and the Buildx output
digest is checked after publication by pulling the immutable
`image@sha256:digest` reference. The check requires both the pulled
`RepoDigest` and the revision label to match the current `github.sha`.

The check writes only image names, immutable digests, the expected/observed
revision, and bounded pass/fail fields to
`release-evidence-container-images.txt`. The file is retained as
`release-evidence-container-images-${{ github.run_id }}` for 14 days; registry
credentials are never written to the report.

Production image promotion is a separate manual workflow protected by the
`production` environment. The operator supplies the trusted publisher run ID,
reviewed revision, and publisher artifact digest. The workflow verifies that
the source run was a successful push of `main` through `ci.yml`, downloads only
that run-scoped artifact, compares GitHub's artifact digest, and validates all
three image records before producing a handoff. It also requires the exact
publisher job to have succeeded and hashes the downloaded archive bytes before
extracting its single bounded evidence file. The handoff contains only
`repository@sha256:digest` references for the API, migration, and web images.
It does not deploy, rebuild, accept tags, or receive registry/deployment
credentials.
