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

Only the push-to-main browser job references this environment. Pull requests,
including same-repository PRs, run a separate secret-free contract test.
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
