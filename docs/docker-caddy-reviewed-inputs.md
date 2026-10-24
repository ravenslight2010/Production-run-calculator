# Reviewed inputs for the Docker/Caddy check

The API build requires the exact reviewed reconciliation report, including its
SHA-256. A Git checkout intentionally does not contain these operational bytes.
The build must not substitute a fixture or bypass verification.

## CI boundary

The repository's `docker-caddy-reviewed-inputs` GitHub environment has a custom
branch policy allowing only the `main` branch (not tags). Main is protected.
Its encrypted environment secret `SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64`
contains the gzip/base64 transport of the reviewed report. Compression/encoding
is not encryption; GitHub's encrypted secret storage is the protection.

The push-to-main Docker browser job and the explicitly main-guarded build-input
steps in CI, department-navigation and standard/full release jobs reference
this environment. Non-main jobs select `unprivileged-ci` and do not execute
the secret-bearing restore step. No secret or environment was provisioned by
this task. The canonical main-only branch policy independently prevents a PR
from requesting the protected environment instead.
The Docker workflow's PRs run a separate secret-free contract test; other PR
jobs retain their existing checks but receive no protected report.
Do not use `pull_request_target`, grant a fork access, or broaden the branch
policy to make an untrusted run pass. This CI environment is not permission
to deploy or publish the application.

The restore script validates strict encoding, bounded decompression, and the
reviewed SHA-256 pin before writing the report and checksum with mode `0600`.
It rejects symlinks and conflicting existing contents. The secret is passed
only to the restore step. It is not printed, uploaded, or placed in a CI cache.
Docker builds consume the restored files as before; no image/cache export or
push is configured. An always-run cleanup step removes only verified inputs;
the hosted runner's disposable filesystem owns the remaining local layers.

## Provisioning and rotation

The owner approved protected CI access on 2026-10-22. The initial environment
and secret were provisioned using authenticated GitHub access, and the branch
policy and secret existence were checked without reading secret contents.

To rotate, first obtain approval for the new exact reviewed bytes and update
the script's pin through normal code review. Use an authenticated GitHub CLI
session to pipe `gzip -n -c REPORT | base64 -w0` directly to
`gh secret set SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64 --env
docker-caddy-reviewed-inputs --repo OWNER/REPO`. Never put the encoded value
in command arguments, logs, repository files, or artifacts. Keep the
environment restricted to protected main-branch code.

Missing, corrupt, or stale inputs fail explicitly. The workflow does not
fall back to workspace leftovers or synthetic data. A locally reproduced
fresh-checkout run is not evidence that a GitHub-hosted run has executed.

To revoke this access, delete this environment secret (or this dedicated CI
environment), not the repository's existing deployment environment. Subsequent
protected browser jobs will fail on the missing input rather than bypass it.

## Approved offline/private-directory delivery

On 2026-10-24 the owner selected restricted CI/build delivery rather than
tracking the two runtime audit files in Git. The existing protected-main
environment remains the CI transport; this approval does not broaden its
branch policy, permit PR-code access, or authorize publishing customer data.

An authorized local builder can also stage the exact pair from an existing
private directory, without creating or changing any secret:

```sh
node scripts/src/restore-reviewed-build-inputs.mjs --from-directory /private/reviewed-inputs
```

The directory must contain only the required named pair for this operation:
`source-library-reconciliation-2026-08-26.json` and
`source-library-reconciliation-2026-08-26.sha256`. Unrelated files are not read
or copied. The production SHA-256 pin cannot be overridden through CLI options
or environment variables. The loader validates both files before writing,
rejects oversized/non-regular/symlink files, preserves restrictive destination
permissions, and fails without overwriting conflicting inputs. CLI failures
do not print source paths or report contents. Builds still apply the original
fingerprint, approval-manifest and packaging checks.

No public-history download fallback is provided. Upstream repository metadata
is public and matching files exist in historical Git objects; keeping these
files out of this branch does not remove or privatize historical copies.
Assessing/removing historical exposure requires a separate owner-approved
history/publication operation, not a credential or history mutation here.

This does not solve the incompatible expectation that an untrusted PR both
receives no protected data and performs a build that requires those exact data.
The existing environment permits only `main`; ordinary PR build/release jobs
do not receive it. Do not silently skip checks, substitute operational evidence
with fixtures, expose the protected input, or claim those PR builds pass.
A decision to separate unprivileged code checks from protected packaging, or
to authorize a different reviewed-code delivery boundary, must be explicit.
