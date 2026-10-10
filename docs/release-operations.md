# Release validation operator guide

This guide is the operating contract for the repository's release checks. A
release check is successful only when the command exits zero **and** the
retained evidence verifier passes for the same git revision.

## Production publication authority

The Replit deployment is the only authorized current publisher of the active
production app. GitHub is used for source backup and CI/testing. GitHub pushes,
releases, workflow runs, successful checks, test artifacts, and Docker image
builds do not publish the active app and do not prove what is live. Branch
protection governs source merges only; it is not publication authority or
production-readiness evidence.

Render and manual Docker production instructions retained in this repository
are legacy references and unsupported for current publication. Repository
changes do not alter any external Render account, service, or deployment
setting. The `Render image smoke` release gate remains a local disposable Docker
test only; it does not contact Render or publish an image. Existing release and
readiness gates remain required and are not replaced by GitHub CI evidence.

For one revision-bound summary of retained reports, incomplete checkpoints,
browser artifacts, and production-proof gaps, start with the
[Release evidence handoff](release-evidence-handoff.md). It is read-only and
does not replace the release runner or its verifier.

For reliability work, also follow the release gates in the
[Sync Reliability Unified Plan](sync-reliability-unified-plan-2026-09-19.md#6-release-gates).
Complete-write protocol changes require causality, convergence, reset, auto-track,
packaging-progress, and atomic inventory-side-effect evidence. SSE topology or
pool-size changes require sanitized deployment and capacity evidence. AI
provider-key tests must not silently change the hard-versus-soft readiness policy.

## Live peer SSE topology requirement

The `/api/sync/events` registry remains process-local. The current checkout now
uses a PostgreSQL outbox with per-scope ordered cursors and `LISTEN/NOTIFY`
wake-ups; each API process drains durable rows, catches up after reconnect, and
reconciles canonical state when a retained cursor has a gap. Notifications are
bounded wake-up hints, not the replay source. This implementation does not by
itself establish supported live peer SSE: the separate cross-process
delivery/replay proof must pass before that support claim is made.

The owner decided on 2026-10-10 not to switch the published service to a VM;
Autoscale remains selected. The owner confirmed immediate peer updates remain
required and approved PostgreSQL outbox plus `LISTEN/NOTIFY` as the shared-fanout
design direction. The owner subsequently confirmed that the database
connection-budget gate passed, allowing implementation to proceed. That
confirmation is not a substitute for retaining deployment-bound capacity
evidence. Live peer SSE remains unsupported until the separate cross-process
delivery/replay proof has passed. Do not treat a successful build,
sticky routing, or the one-Node-command-per-server run configuration as proof
of cross-process delivery.

Before reporting cross-process peer SSE as supported, retain dated, sanitized
evidence tied to the published deployment that establishes the maximum and
current/peak serving-process counts needed for the connection budget, then pass
the cross-process delivery and replay checks. Record deployment type and
bounded build/revision identity when available; do not retain URLs, credentials,
request data, or raw logs. Deployment metadata alone does not prove instance
counts, capacity settings, or the number of Node processes.

The read-only recheck recorded in
[the uptime decision record](uptime-and-operational-backlog-decision-2026-10-02.md#owner-decision-and-current-enforcement)
found the published deployment is Autoscale. A subsequent check on 2026-10-09,
after the owner reported publishing twice, still found an active public
Autoscale deployment with a successful build, despite the checked-in `vm`
target. On 2026-10-10, the owner decided not to switch to VM. The checked-in
target has been returned to `autoscale`, and a metadata recheck still reports
Autoscale with a successful build. The owner approved PostgreSQL outbox plus
`LISTEN/NOTIFY` as a design direction, but did not enable live peer SSE.
Replit documents that Autoscale
can add machines up to a configured maximum and scale down to zero; it has no
always-on minimum. A maximum of one would not satisfy the always-on requirement.
The available deployment metadata did not expose the configured maximum or
current/peak counts. Sanitized probes on 2026-10-09 returned HTTP 200 from
`/api/livez` and `/api/readyz`; these health results do not establish target or
process count. The bounded deployment-log summary contained one "Server
listening" line in the last 48 hours, which also does not establish current or
peak process counts. The active published topology is therefore **NOT
ENFORCED / NOT VERIFIED** for live peer SSE. A sanitized 2026-10-10 capacity-log
review found eight primary-observed samples matching the live build between
14:24 and 14:59 UTC: `max_connections=450`, four known reserved slots, 6–13
client backends, and a per-process pool max of 10. The sampled pool totals were
4–10 with zero waiters. This short window alone does not establish peak
headroom; provider reserves and Autoscale current/maximum serving-process counts
were not visible in that observation. Earlier evidence showed a 10-client pool
with 13 waiting requests. The owner later confirmed that the connection-budget
gate passed, but supporting sanitized capacity evidence has not been retained
in this handoff. Keep live peer SSE unsupported until the separate
cross-process replay/recovery proof passes and deployment-bound capacity
evidence is retained. The sanitized observation
and owner decision are retained in
[`release-evidence/sse-topology-observation-2026-10-09.json`](../release-evidence/sse-topology-observation-2026-10-09.json).

The PostgreSQL outbox and cursor-drain implementation is present in the current
checkout. If the deployment-bound capacity evidence or separate cross-process
proof is unavailable, keep the gap explicit and do not represent live peer SSE
as supported on the current topology.
This deployment constraint is not a `/readyz` check: optional AI and
background-worker warnings remain warnings and do not fail core readiness.

## Release commands

```bash
pnpm run release:check
pnpm --filter @workspace/scripts run check:release-evidence
```

The standard run includes typechecks, security audit, recovery and operational
evidence checks, clean-start startup health, API test shards, the explicitly
listed bounded package-test gates (including `@workspace/spec-import`), and
browser smoke, accessibility, and the bounded WebKit smoke. Full mode is an opt-in command that adds
the complete browser suite. Independent prerequisite, consumer-typecheck,
API/package-test, and browser stages have explicit dependency barriers. The
API/package-test stage runs at most four children by default, with no more than
two API/database shards at once. Each API shard remains serialized internally
and has an eight-minute hard limit with a six-minute warning. Browser stages
remain strictly serial for disposable live-day safety. The full browser suite
has a 90-minute hard limit with an 80-minute warning. This is a bounded
execution budget, not a retry or an evidence-validation bypass: every case
declared by the current full-browser contract must complete, and the retained
report must pass the same revision-bound evidence verifier.

For compatibility work, or as the bounded pre-release browser-engine check, run:

```bash
pnpm --filter @workspace/run-calculator run test:e2e:compatibility
```

This serialized lane reuses the isolated staff lifecycle smoke on desktop,
phone, tablet portrait, and tablet landscape Chromium, then runs the lifecycle
and report cases from the isolated WebKit release smoke at phone and tablet
sizes. The dedicated WebKit command remains the owner of the full WebKit
contract, including failed-pull/reconnect recovery. The compatibility lane
retains traces and failure-only screenshots under
`artifacts/run-calculator/test-results/compatibility` and an HTML report under
`artifacts/run-calculator/playwright-report/compatibility`. The lane is
separate from the existing smoke, accessibility, visual, PWA, WebKit,
physical-device, and full-release commands; it does not replace them.

The GitHub Actions standard and full jobs install WebKit and the Linux runtime
dependencies required by its browser bundle before running the release gates:

```bash
pnpm --filter @workspace/run-calculator exec playwright install --with-deps webkit
```

Keep this step ahead of the release runner. The WebKit smoke depends on runtime
libraries such as libatomic, libstdc++, libGLESv2, and libx264; a browser
download without the dependency install can produce an infrastructure failure
before any smoke case starts. Local runners that already provision the system
libraries only need the browser download:

```bash
pnpm --filter @workspace/run-calculator exec playwright install webkit
```

For a local runner with a known compatible library set, set
`PLAYWRIGHT_WEBKIT_LIBRARY_PATH` to a colon-separated list of library
directories. The TypeScript launcher and the final MiniBrowser wrapper both use
this value instead of probing Nix; when it is absent, the wrapper keeps the
Nix-library fallback for the local runtime.

To run the full mode locally:

```bash
pnpm run release:check:full
```

The standard WebKit config retains `browser-smoke/webkit-result.json`. Full
mode additionally runs only the `phone-webkit` and `tablet-webkit` projects
from the compatibility config and retains their revision-bound results in
`browser-compatibility/webkit-result.json`; its case identities are checked
against the reviewed inventory. The full browser config retains
`browser-full/FINAL-REPORT.md` automatically. These are separate evidence
paths: bounded smoke, compatibility, and accessibility gates cannot overwrite
the full-suite report.
It records the run revision, total/complete/pass/skip/fail/not-run counts,
wall-clock duration, and a sorted per-file duration table. The report is
generated from Playwright's completed test results; a `GO` report requires
every case declared by the
[`full-browser-case-contract.mts`](../scripts/src/full-browser-case-contract.mts)
contract to be enumerated and completed. The main config remains serial with
`workers: 1`, with no retries or reduced test-match coverage. The release report
also records total wall-clock time and per-stage wall-clock durations so the
scheduler's speedup can be compared with the existing per-gate timings.

Each complete, passing full-suite run compares matching file paths with the
prior complete, passing retained full-suite report before replacing it. An
interrupted, timed-out, or incomplete run leaves the last valid baseline
untouched. The report flags a file when it is at least 30 seconds and 25%
slower than its prior duration. This filters normal cold-environment noise
while surfacing a slowdown that can consume the 90-minute budget. New files,
removed files, faster files, and a missing or legacy baseline are not treated
as regressions.

## How to interpret a result

- `PASS` is a product or tooling gate that completed successfully.
- `FAIL` is a completed gate that found a product or validation problem. Fix it
  before retrying.
- `INFRASTRUCTURE TIMEOUT` means the runner or a bounded child exceeded its
  budget. Review the durable log before deciding whether a retry is justified.
- `INFRASTRUCTURE ERROR` means the process was killed, could not start, or the
  environment interrupted it. It is not evidence that the application
  assertion failed.
- A missing gate in the report is an incomplete run, never a pass.
- A missing, empty, stale-revision, or unexpected evidence file is an evidence
  failure, never a pass.
- Standard and full published release checks require a current deployment ID
  and exact deployed source revision before any release gates run. If either is
  missing, or the configured deployment handoff is invalid or stale, the runner
  writes `release-check-checkpoint.md` with only the mode, assessed revision,
  and missing evidence, then exits `BLOCKED / NO-GO`. It does not run gates or
  update the retained release report. The assessed revision identifies the
  checkout and verification inputs; it is not the deployed revision and must
  never be inferred from repository `HEAD`. Supply current published identity
  evidence and rerun without `--resume`; this pre-gate checkpoint has no
  resumable gate state.
- The compatibility lane's Chromium and WebKit projects are responsive browser
  emulations. They are not proof of physical Android Chrome or iOS Safari/PWA
  behavior. Run physical Android Chrome through the dedicated device command
  and any available iOS Safari/PWA service through its separate device lane.
  If a required device endpoint is unavailable, record the check as `BLOCKED`
  or `NOT RUN` with the environment reason; never report emulation as a
  physical-device pass.
- The iOS Safari/PWA lane is separate from responsive browser and PWA
  service-worker evidence:

  ```bash
  pnpm --filter @workspace/run-calculator run check:e2e:ios:pwa:device
  pnpm --filter @workspace/run-calculator run test:e2e:ios:pwa:device
  ```

  It requires `PLAYWRIGHT_REAL_IOS_SAFARI_WS_ENDPOINT`, retains its own
  `test-results/ios-safari-pwa` and `playwright-report/ios-safari-pwa`
  directories, and verifies that the connected runtime identifies as iOS with
  touch support. The lane covers physical web/PWA behavior only; it does not
  imply native iOS application coverage. Missing device services are a
  fail-closed `BLOCKED` readiness result (exit status 2); release records may
  classify an unavailable optional run as `NOT RUN` with the actionable
  environment reason.
- A browser duration alert is an operational review signal, not a coverage or
  serial-execution bypass. It is copied into the release summary for
  investigation; the full suite still must complete the shared case contract
  and pass the revision-bound evidence verifier.

Without an explicit `RELEASE_EVIDENCE_DIR`, standard and full checks retain
their reports, logs, checkpoints, and browser artifacts independently under
`release-evidence/` and `release-evidence-full/`, respectively. If a run
stops after a bounded failure, retry with:

```bash
pnpm run release:check -- --resume
```

Resume is safe only for the same revision and mode. A parallel stage
checkpoints each completed child, so `--resume` reruns failed or not-reached
gates without rerunning passed gates, even when children finish out of order.
A fresh run discards the old checkpoint and starts a new log. An explicit
`RELEASE_EVIDENCE_DIR` continues to select one exact evidence directory for
deliberate single-run use. To reduce local resource use, set
`RELEASE_CHECK_MAX_CONCURRENCY=1` (valid values are 1 through 16); CI sets the
documented default of 4. To diagnose one surface quickly, use its focused
package command, but do not treat that partial check as release evidence. To
verify the default full-mode evidence, use
`pnpm run release:check:full -- --verify-evidence`.

The standalone verifier reads the `Mode:` field in the selected report, so it
automatically applies the full contract when pointed at a full evidence
directory. To select a directory explicitly:

```bash
pnpm --filter @workspace/scripts run check:release-evidence -- \
  --evidence-dir release-evidence-full
```

Passing `--full` forces full-mode verification. A mode mismatch is rejected
with a corrective command rather than treating the directory as valid under
the other contract.

## GitHub Actions evidence

The release-check workflow runs standard mode on pull requests and manual
dispatches. Its separate full-mode job is an explicit `workflow_dispatch`
opt-in (`Run full browser release suite and retain full evidence`) so the
longer browser budget does not extend every pull request. Each selected job
starts with its own disposable database and evidence root:

- Standard mode runs `pnpm run release:check`, verifies `release-evidence/`,
  and uploads `release-evidence-standard-<run-id>`.
- Full mode runs `pnpm run release:check:full`, verifies
  `release-evidence-full/` with the full-mode verifier (including
  `browser-full/FINAL-REPORT.md`), and uploads
  `release-evidence-full-<run-id>`.

The retained artifacts also include the release report, durable log, checkpoint,
clean-start evidence, and startup logs. The roots and artifact names are
deliberately distinct so a full run cannot overwrite or be mistaken for
standard evidence.

Both jobs use fresh Postgres services. They run the reconciliation verifier's
focused fixture suite, but do not query that empty database as if it contained
the retained production repair history. Their reports therefore remain NO-GO
and explicitly require authoritative production reconciliation evidence. The
normal release command remains fail-closed: outside the narrowly identified
disposable CI test database, the production reconciliation verifier and its
retained evidence are mandatory.

### Machine-readable test summaries

Run the safe local routine suite from the workspace root with:

```bash
pnpm run test:results:local
```

The latest report is written to `.local/test-evidence/latest.json`; that path is
git-ignored and is replaced at the start of each local run. It includes the
entire maintained catalog, so optional or manual lanes remain visible as
`NOT_RUN`, and lanes missing a required device connection are `BLOCKED`.
Test counts are populated only for the standard/full WebKit smoke lane and the
full-mode phone/tablet WebKit compatibility lane, when their Playwright JSON
case summaries match the current release revision and run window. The shared
report stores only validated totals (`total`, `completed`, `passed`, `failed`,
`skipped`, and `notRun`), not case names or error text. Direct Vitest lanes,
other browser suites, and the full Chromium suite remain `null` because they do
not currently produce an accepted structured JSON count summary. Missing,
malformed, stale, or mismatched summaries also leave counts `null`; console
output is never parsed.

CI test jobs and the standard/full release jobs upload a run-scoped
`automated-test-results-*` artifact even when a wrapped test command fails.
Download the matching artifact from that GitHub Actions run's **Artifacts**
section; each JSON file includes workflow/job/run identity when available.
CI and local reports record only bounded outcome metadata and never copy test
logs, credentials, request payloads, or recipe data.

These JSON files are summaries, not the standard/full release evidence
contract, production reconciliation evidence, or proof that the application is
production-ready. A lane that was not selected or could not run is never
represented as a pass. Keep using the existing release-evidence artifact and
its verifier for release decisions.

### Bind production reconciliation evidence to the deployed build

New checks use application build IDs and `source-sha256:<64 hex>` identities,
not Git or GitHub identifiers. Local test results use `test-sha256:<64 hex>`,
derived from both production source and verification inputs; changing tests
invalidates old passing evidence even when application source stays unchanged.
Git-bound historical records remain readable through the legacy path.

After the owner completes Publish, retrieve current deployment metadata with
Replit's supported `getDeploymentInfo()` function. Continue only when the
metadata request succeeds, the repl is deployed, the current build succeeded,
and `primaryUrl` is present. Do not infer the URL or revision, or treat
`REPLIT_DEPLOYMENT_ID`, `REPLIT_BUILD_ID`, screenshots, or Git branches as
provider-verified metadata.

Use that exact `primaryUrl` to prepare the source handoff plus readiness and
source-library reconciliation evidence:

```bash
pnpm run release:check -- \
  --prepare-published-evidence \
  --published-url '<primaryUrl from successful current Replit metadata>'
```

The command compares the live complete-release record with the independent
`.local/build-identity/expected-source.json`, captures readiness and bounded
source-library reconciliation evidence from the published app, validates both
against the same source handoff, and promotes the results only after all steps
pass. It does not publish or issue release approval. If Replit metadata is
unavailable, the current build failed, the live app does not match the prepared
source, readiness is not healthy, or reconciliation evidence is missing or
stale, preparation exits nonzero.

The handoff has schema version 2 and kind
`published-source-deployment-handoff`. It carries the application-owned build
ID, source policy, source fingerprint, exact independent expectation and
digest, and an expiry of at most 24 hours. The `deploymentId` compatibility
field contains the namespaced application build ID, **not** a Replit platform
UUID. The deployed identity is `source-sha256:<fingerprint>`, not a Git
revision. The source-match receipt continues to say `productionGo: false`.

The source reconciliation capture is bounded and uses the published app's
configured database connection. Its verifier runs in a read-only transaction;
the existing rate limiter still records its request count. The raw response is
held only long enough to validate/import the minimized evidence and is not
retained. A rate-limit response or concurrent capture blocks preparation; do
not turn a partial capture into release evidence.
The operational report may expose the same value at
`evidence.release.revision`; malformed, absent, or expired revision metadata is
not valid release proof. `REPLIT_GIT_COMMIT` and `GIT_COMMIT` remain
compatibility fallbacks for development-only checks, but production source
evidence never falls back to repository `HEAD`.

Operational reports also expose `evidence.release.deploymentId`,
`evidence.release.deployedRevision`, `identityStatus`, and `identitySource`.
These fields report bounded runtime-environment values only. An
`identityStatus` of `reported-unverified` is informational and is not a
provider-verified deployment handoff; `incomplete` or `unavailable` means the
identity values were absent or invalid. Production release checks must continue
to require the current, validated published-deployment handoff described below.

### Published reconciliation endpoint

The public `GET` uses the running app's own database connection and build
identity; it does not require a manager login, PostgreSQL owner name, request
body, or database credentials. Its `published-app-runtime-connection`
attestation means the evidence came from the database configured for that
published app; it is not an independent PostgreSQL owner-name comparison. The
summary contains only bounded counts and hashes. The verifier runs in a
PostgreSQL `READ ONLY` transaction; the shared rate limiter records only its
request counter in the existing rate-limit table. The endpoint is limited to
five requests per 15 minutes and returns `429` with `Retry-After` when that
limit is reached. A PostgreSQL advisory lock prevents overlapping captures
across API workers; a concurrent capture returns `409`.

The post-publish command uses the fresh source handoff and imports the captured
summary against the configured source report. Do not retain or upload raw
records, database dumps, response logs, or credentials.

For investigation when the aggregate capture reports pool mismatches, the
published app also exposes
`GET /api/profile-data/source-library-reconciliation/diagnostics`. This
rate-limited, uncached, read-only endpoint uses the same published-app database
connection and build identity and returns at most ten stable pool IDs, approved
source names, mismatch types, and differing field names. It never returns live
field values or recipe ingredient rows. The endpoint is public, so do not add
unbounded or raw recipe data to its response. Diagnostics are not release
evidence and must not replace the aggregate capture or its verifier.

### Alternative: capture in the database-owning environment

For an independently owner-attested capture, run this from the environment
that owns the production `DATABASE_URL`. The capture mode validates the handoff
and approved PostgreSQL owner name before querying, refuses fixture query input,
requires the explicit release environment, and runs one PostgreSQL `READ ONLY`
transaction. Its stdout contains only the bounded verifier result, so it can be
piped directly to the importer:

```bash
HANDOFF=/secure/path/published-deployment-handoff.json
pnpm --silent --filter @workspace/scripts exec tsx \
  ./src/verify-source-library-reconciliation-cli.mts \
  --capture-production \
  --environment release \
  --deployment-handoff "$HANDOFF" \
  --report attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json \
| pnpm --filter @workspace/scripts exec tsx \
  ./src/import-source-library-reconciliation-evidence.mts \
  --input - \
  --report attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json \
  --heal-id source-library-reconciliation-2026-08-26-v2 \
  --from-date 2026-08-26 \
  --deployment-handoff "$HANDOFF" \
  --output /secure/path/source-library-reconciliation.json
```

If a file handoff is required, add `--output
/secure/path/source-library-capture.json` to the capture command and pass that
regular file as `--input` to the importer. Do not export query results,
database dumps, or development fixtures.

Import the retained bounded file into a release run with the same validated
handoff:

```bash
pnpm run release:check -- \
  --source-library-environment release \
  --source-library-deployment-handoff /secure/path/published-deployment-handoff.json \
  --source-library-evidence /secure/path/source-library-reconciliation.json
```

CLI release captures and evidence imports reject a missing, malformed,
`unknown`, or stale handoff, and reject an explicit `--revision` that differs
from the handoff. The production revision must come from the controlled
deployment/report path; never substitute the current repository `HEAD`. The
handoff is read only for its bounded deployment identity and SHA and is not
copied into retained evidence; recipe rows, aliases, database responses, and
credentials are never retained. The retained release report records both
`Source-library evidence revision` and `Deployed revision`; for release
evidence those values must match the source identity returned by the controlled
deployment/report path. The release runner validates and passes that identity
through the source verifier's preflight and full verification/import steps, so
an older release-state file or an omitted preflight value cannot silently
qualify.

When a job stops before all gates complete, the workflow writes a separate
NO-GO summary with the uploaded checkpoint-artifact link, the matching resume
command, and the matching fresh-run command. The stopped-summary probe uses the
base repository's read-only workflow token and artifact ID to validate the
artifact metadata and exact expected name, including for a `pull_request` from
a fork. Missing URLs, expired artifacts, malformed metadata, name mismatches,
and inaccessible metadata fail with an accurate non-sensitive diagnostic. The
summary never claims the upload succeeded when no usable artifact URL was
returned. GitHub may not expose that Markdown for cancelled jobs
through an unauthenticated page or check-run API. The summary contract can
therefore be checked without GitHub access:

```bash
pnpm --filter @workspace/scripts run test:release-stopped-summary
```

This is a bounded, fixture-only contract check. It writes only to temporary
files, prints a `non-retained verification only` marker, and must never be
treated as retained release evidence or a GO decision. It verifies the exact
standard and full Markdown with both an artifact URL and an empty artifact URL,
including the explicit upload-failure message, the non-retained-evidence
warning, each mode's resume/regenerate commands, and forked pull-request
artifact access using a safe read-only-token fixture. The fixture never uses a
real GitHub URL or token.

### Live external-fork verification

The repository-level GitHub settings checked on September 3, 2026 were:

- Actions enabled, with all actions allowed;
- default workflow permissions set to read-only; and
- first-time fork contributors requiring approval before their workflows run.

The live download check is **BLOCKED** until a disposable fork owned by a
different GitHub account is available. The authorized account for this
repository has no external fork or organization namespace, and GitHub did not
create a distinct fork when a same-owner fork was requested. Consequently, no
external-fork pull request, stopped-check run, or reviewer artifact download
was claimed from this environment. Once an external fork is available, rerun
the standard pull-request workflow with an intentionally stopped gate, approve
the first-time contributor workflow if GitHub requests it, and verify that the
summary's checkpoint link downloads successfully before deleting the fork and
pull request.

The workflow-lint job runs a separate workflow guard that checks both standard
and full jobs keep their `always()` stopped-summary step after the matching
evidence upload and pass the matching artifact URL and recovery commands. This
workflow-level check is distinct from retained release evidence validation.

## Disposable API concurrency calibration

The release gate inventory does not include the database-pressure calibration
lane. Run it manually when API integration coverage or the CI Postgres service
changes:

```bash
RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB=1 NODE_ENV=test \
  pnpm run check:release-concurrency
```

The command requires `DATABASE_URL` to point at a disposable CI-style Postgres
service, the explicit `RELEASE_CONCURRENCY_APPROVED_DISPOSABLE_DB=1`
acknowledgement, and either CI or a test-environment marker. It runs the same
six API release shards used by the release gate at the documented cap of two
active database shards. Each shard remains internally serialized by
`artifacts/api-server/vitest.config.ts`; the lane does not raise Vitest workers
or reuse release evidence.

The lane writes `release-concurrency-stress.json` and
`release-concurrency-stress.md` under a disposable `tmp/` directory. Set
`RELEASE_CONCURRENCY_EVIDENCE_DIR` to retain them at a chosen path. When
`RELEASE_CONCURRENCY_BASELINE_JSON` points at a prior healthy report, it also
writes `release-concurrency-comparison.json` and
`release-concurrency-comparison.md`. When
`RELEASE_CONCURRENCY_HISTORY_JSON` points at a JSON array of prior healthy
artifacts, it additionally writes `release-concurrency-trend.json` and
`release-concurrency-trend.md`. Reports record:

- setup time: the elapsed time for the same schema push that prepares the
  disposable CI database (the shards then perform their normal per-fixture
  database create, schema push, and teardown);
- peak active shards and the documented cap;
- per-shard result and elapsed time;
- timeout failures and lock/setup failures, including deadlocks, duplicate
  markers, connection exhaustion, and related Postgres symptoms; and
- total wall-clock time.

The manual GitHub Actions workflow
`.github/workflows/release-concurrency-calibration.yml` provisions disposable
Postgres, sets the explicit disposable-database acknowledgement, and retains
the JSON, Markdown, database-setup log, and per-shard logs in the separate
`release-concurrency-calibration-<run-id>` artifact. It looks through prior
successful calibration runs for up to five non-expired healthy reports. Missing,
expired, malformed, unsafe, and unsafe-path artifacts are logged and ignored.
The newest accepted report remains the single baseline, so setup and total
wall-clock time are still compared with the existing alert rule: a slowdown is
meaningful when it is both at least 30 seconds and at least 25% slower than that
baseline. The workflow summary also includes an informational chronological
trend with first/latest/minimum/maximum/average values and the change across
the retained healthy samples. The trend never changes the alert status or
release gates. The workflow is manual-only and is not a release gate.

The archive selection and validation step is implemented in
`scripts/src/fetch-release-concurrency-history.sh`, rather than being kept
inline in the workflow, so it can be exercised with representative fixtures.
Run its fixture-driven regression test with:

```bash
pnpm --filter @workspace/scripts run test:release-concurrency
```

The test covers healthy baseline/history retention, malformed and unsafe
reports, expired artifacts, unsafe archive paths, and the invariant that the
calibration lane does not change the release-gate inventory.


## Bounded API application workload

The API application-load lane is separate from release-shard calibration. It
repeats real live/scheduled sync writes and inventory consume/adjust requests
against an isolated PostgreSQL database; it does not measure release shard
capacity or represent production traffic.

Run `.github/workflows/api-load-workload.yml` through `workflow_dispatch`, or
from a test environment with its dedicated loopback disposable PostgreSQL
service and explicit `API_LOAD_TEST_DISPOSABLE_DB=1` acknowledgement:

```bash
DATABASE_URL=postgresql://postgres:api-load-ci@127.0.0.1:5432/api_load_test_admin \
  NODE_ENV=test API_LOAD_TEST_DISPOSABLE_DB=1 \
  pnpm --filter @workspace/api-server run test:load:isolated
```

The runner accepts only the named loopback `api_load_test_admin` service,
creates a uniquely named `api_load_test_*` child database, applies the schema,
and drops that child database during normal, failed, timed-out, or interrupted
cleanup. It rejects production/deployment contexts and does not forward
inherited secrets into the test process. The profile has at most four clients,
four rounds, four sync attempts per write, 187 API requests, twelve in-flight
requests, and six minutes total runtime. Its
revision-bound result artifact contains only bounded operation counts, elapsed
times, status, and an allowlisted failure classification; it contains no
request bodies or raw logs. Timings are diagnostic data only, not a product
performance target. Reports show `NOT_RUN` unless this opt-in lane was invoked.
It is intentionally absent from routine CI and both standard and full release
gate inventories.

Any non-passing shard, timeout, lock/setup failure, missing shard startup, or
observed cap violation fails the lane with a clear `Concurrency cap unsafe`
diagnostic. This is a calibration signal, not a release GO/NO-GO decision:
never add its output to `release-evidence/` or treat it as retained release
evidence. The normal `release:check` and `release:check:full` commands and
their workflow inventory remain unchanged.

## Startup and port recovery

Clean-start uses disposable ports (`18081`, `18082`, `18180` in release
checks). It performs a preflight ownership check and does not kill unrelated
processes. If it reports a port conflict, record the owner, stop that specific
stale process using the normal workflow controls, or choose unused
`CLEAN_START_*_PORT` values. Do not loop restarts: after two
`DIDNT_OPEN_A_PORT` attempts, inspect the workflow logs, listener address, and
`curl` response, then escalate if the expected `0.0.0.0` port is healthy but
forwarding still fails.

## Evidence and escalation boundary

Evidence is allowlisted and revision-linked. Standard mode requires all
clean-start artifacts and the WebKit smoke JSON; full mode additionally requires
`browser-full/FINAL-REPORT.md`, including its revision-bound duration summary.
Do not manually mark a report GO or delete missing artifacts. Escalate only
after the documented retry/diagnostic path:
the failing gate, revision, retained log path, port owner (if applicable), and
whether the failure is product, infrastructure, or evidence-related.
