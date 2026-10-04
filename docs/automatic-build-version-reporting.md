# Automatic build-version reporting

This applies to new publishes only. The earlier live build cannot be identified
retroactively. GitHub is a backup and is not queried by these commands.

## Agent-assisted publish preparation

After finishing changes and the applicable release checks, but **before**
offering the owner a Publish action, run from the repository root:

```bash
bash scripts/src/run-release-node.sh pnpm run prepare:publish
```

This captures the actual production source inputs into
`artifacts/api-server/publish-source-record.json`, which travels with the source
snapshot, and keeps an independent expected copy at
`.local/build-identity/expected-source.json`. Neither contains source contents,
credentials, account information, or recipe data. Do not hand-edit either file.

Root builds reuse that record only if the source fingerprint is still current.
API and web build scripts check the fingerprint at their boundaries. They
record completed compiled-output fingerprints and seal the version only when
both stages match the prepared record. Changing source after preparation fails
the build identity check; run preparation again instead of overriding it.
Development API builds report `buildMode: development` and cannot pass the
published-source check.

The fingerprint policy includes application-owned production sources, assets,
build scripts/configuration, workspace library sources/migrations, package
manifests, and lockfile. It excludes tests, fixture/evidence data, secrets,
dependency installations, and generated build/identity outputs. A full Git
revision is attached only if the captured bytes and executable modes match
one immutable Git commit tree.
Otherwise the fingerprint remains usable but the Git binding is unavailable.

## After the owner publishes

Obtain the official published URL using deployment metadata, not a guessed
domain or a development-domain environment variable. Then run:

```bash
bash scripts/src/run-release-node.sh pnpm run check:published-build -- \
  --url 'https://<official-published-host>'
```

Use `--expected-file <path>` to select a previously captured independent source
record and `--output <path>` to choose a receipt location. By default the receipt
is `.local/build-identity/published-source-match.json`.

The command performs one public, bounded, timeout-protected GET to
`/api/build-info`. Missing/old-server metadata, redirects, invalid responses,
partial/development builds, or mismatched source/build/Git fields exit nonzero.
A successful check emits a 24-hour source-match receipt without retaining the
target URL or response body. Never derive the expected record from the response
being verified.

The endpoint is database-independent and unauthenticated. It returns only safe
version fields, uses `Cache-Control: no-store`, and loads its sealed record once
per server process. Editing the workspace or changing a runtime Git/version
label does not relabel an already built artifact.

## Release approval is separate

An `app-build:…` identifier belongs to this application's artifact set; it is
**not** Replit's internal Build UUID. Optional runtime-reported platform IDs are
not provider-verified proof.

A source-match receipt always says `productionGo: false`. It is an additional
version-comparison check in the release preparation flow, not a replacement for
the controlled deployment handoff, full deployed revision, production source
reconciliation, readiness evidence, expiry, browser checks, or standard/full
release gates. Missing legacy identity requirements remain blocked. Do not
rewrite historical release reports or infer the older build's revision.

## Local checks

```bash
bash scripts/src/run-release-node.sh pnpm run test:build-identity
bash scripts/src/run-release-node.sh pnpm run test:build-identity:integration
```

The filesystem and HTTP tests use temporary fixtures only. There is no publish,
GitHub push, production sign-in, or production database operation.
These identity contracts are also a mandatory prerequisite in both standard
and full release runs; the published HTTP comparison runs after an owner publish.

The build-integration regression runs the real API and web build scripts in a
temporary source workspace, leaving running application outputs untouched. It
checks matching completed-stage identities, finalized PWA files, missing/failed
counterpart rejection, and the actual bundled public getter while database
startup fails against a disposable loopback target. The documented CLI compares
that local target with an expectation prepared before building, and must still
report `productionGo: false` with the unresolved controlled-handoff requirement,
explicit unavailable Git binding, and 24-hour expiry intact.

The integration test has a four-minute test budget (one-minute API/failed-build
commands and a two-minute successful web build); its mandatory standard/full
release prerequisite has a five-minute outer budget. Child environments do not
inherit database, provider, authentication, or deployment credentials. Installed
third-party tools are read-only links, workspace library sources are copied, and
all generated outputs, receipts, and runtime dependencies are disposable.
Build/runtime logs remain transient; retained output contains only allowlisted
fixture outcomes, never source payloads, target URLs, credentials, or production
readiness claims. This process check does not replace any browser or release gate.