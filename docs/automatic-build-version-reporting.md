# Automatic build-version reporting

This applies to new publishes only. The earlier live build cannot be identified
retroactively. GitHub is a backup and is not queried by these commands.

## Automatic publish preparation

After each task merge, post-merge setup refreshes the prepared source record.
If more source changes are made afterward, the agent refreshes it again before
offering the owner a Publish action:

```bash
bash scripts/src/run-release-node.sh pnpm run prepare:publish
```

This captures the actual production source inputs into
`artifacts/api-server/publish-source-record.json`, which travels with the source
snapshot, and keeps an independent expected copy at
`.local/build-identity/expected-source.json`. Neither contains source contents,
credentials, account information, or recipe data. Do not hand-edit either file.

The Replit deployment runs the focused `build:publish` command. It reuses the
prepared record only if the source fingerprint is still current, builds the API
and web app, then seals the version only when both completed outputs match that
record. API and web build scripts also check the fingerprint at their
boundaries. Changing source after preparation fails the build identity check;
refresh the record instead of overriding it. This deployment build intentionally
does not run the full release suite.
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

After the owner clicks Publish, obtain current metadata with Replit's supported
`getDeploymentInfo()` function. Continue only when `success`, `isDeployed`, and
`hasSuccessfulBuild` are true and `primaryUrl` is present. Use that exact
`primaryUrl`; do not construct a domain, use `REPLIT_DOMAINS`, or substitute a
development URL. If metadata is unavailable or the current build is not
successful, stop without preparing deployment evidence.

The deployment metadata supplies the official URL and current build status, but
does not supply a Replit Build UUID or deployed Git revision. The app's public
`/api/build-info` response is compared with the independent
`.local/build-identity/expected-source.json` record; it is not used to create the
expectation. Run one command with the metadata's `primaryUrl`:

```bash
pnpm run release:check -- \
  --prepare-published-evidence \
  --published-url 'https://<primaryUrl-from-current-Replit-metadata>'
```

This command does not publish. It verifies the complete app build against the
independent source record and waits for readiness, captures release readiness
and bounded source-library reconciliation evidence, validates each against the
same app build/source identity, then writes the evidence files only after all
checks pass. A failed, stale, unavailable, mismatched, or unready source leaves the new set
unpromoted and exits nonzero. The source-match receipt and source-based handoff
are written to `.local/build-identity/`; readiness and reconciliation evidence
go to the selected release evidence directory. Existing standard/full release
checks can discover those current files automatically. Use the same `--full`
and `--evidence-dir` options as the release check when preparing evidence for a
non-default full-run evidence directory.

The handoff uses the namespaced application build ID and
`source-sha256:<fingerprint>` identity. The `deploymentId` compatibility field
is not a Replit platform UUID, and the source identity is not described as a Git
revision. The reconciliation capture uses the published app's configured
database and read-only verifier; its existing rate limiter still records the
request count. The raw response is not retained. Rate-limit, concurrent-capture,
or report-validation failures block promotion; resolve the reported condition
and retry rather than accepting partial files.

The endpoint is database-independent and unauthenticated. It returns only safe
version fields, uses `Cache-Control: no-store`, and loads its sealed record once
per server process. Editing the workspace or changing a runtime Git/version
label does not relabel an already built artifact.

## Release approval is separate

An `app-build:…` identifier belongs to this application's artifact set; it is
**not** Replit's internal Build UUID. Optional runtime-reported platform IDs are
not provider-verified proof.

A source-match receipt always says `productionGo: false`. The generated handoff,
readiness, and reconciliation records support the release preparation flow;
they do not replace the expiry, browser, or standard/full release gates. Missing
current proof remains blocked. Do not rewrite historical release reports or
infer the older build's revision.

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