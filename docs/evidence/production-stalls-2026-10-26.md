# Shared-update stalls: bounded investigation, 2026-10-26

## Decision

**Evidence-limited diagnosis with verified prospective instrumentation. Not a
production repair, release GO, provider-outage finding, or permission to Publish.**

This is the original assignment's explicit alternative acceptance path, not a
newly narrowed scope: “Success means a supported explanation and verified safe
repair, or an explicit evidence limitation with useful new collection—not an
unsupported production GO.” The same assignment forbids Publish bypass and
permits adding only bounded diagnostics if historical evidence is unavailable.
Here, historical aggregate samples exist, but historical outbox phase, lock
ownership, workload attribution and the causal link to loop stalls do not.
Those missing historical observations cannot be reconstructed by changing
production settings or publishing from this fork. The delivered fallback is
locally proven collection for those recurrence investigations, not proof that
the underlying production stall is resolved.

Repeated application connection-acquisition failures and long event-loop delays
overlap outbox retries. The measured queue failures occur before successful
checkout. Sparse primary samples show substantial estimated PostgreSQL slot
headroom and one lock waiter, not sustained global capacity exhaustion. No trace
identifies the originating workload or establishes whether JavaScript stalls
caused or followed connection congestion. Increasing pool sizes or timeouts is
not supported.

The safe change adds sampled phase evidence to existing outbox SQL reads. No
canonical data, cursor semantics, SQL, retries, backoff, leases, job effects,
idempotency, deadlines, pool settings, or production configuration was changed.

## Agent-owned execution

- Owner: assigned server-stall investigation; source changes and verification
  stay here. Existing browser-suite, local-release, partial-browser-result,
  station-display, and Packaging-notice tasks are separate and unchanged.
- Inputs: the retained screenshot-task observation, current source, historical
  published-runtime reports, official deployment/build/log/metric callbacks,
  public health/build identity, and existing primary capacity samples.
- Variants: checkout wait versus connection establishment, post-checkout elapsed
  work, success/failure/unknown coverage, lock versus capacity snapshots, loop
  delay, delivery versus read failure, retention gaps, retry recovery, shutdown,
  shared work and unknown leases. There is no client or role-specific change.
- Permissions: bounded read-only production observation authorized; production
  SQL attempted once and rejected. No credentials were requested or read.
  No production SQL mutation, DDL, Publish, cache clearing, replay, load test,
  infrastructure change, or permission workaround was attempted.
- User-controlled decisions: none needed for the diagnostic-only fallback.
  A later publication or migration remains a separate approval boundary.

## Applicable safeguards and verification

Read deployment/SRE/database, evidence-hygiene, sync-invariant, protected
background recovery/effect guidance, phase contract, task-execution rules, and
verify-before-commit. Preserve durable cursor recovery and canonical gap reads;
do not retry arbitrary effects or change job ownership.

Verification uses fixed-clock unit fixtures, the actual pg-pool waiter machinery,
a private disposable PostgreSQL cluster, workspace typechecking, managed API
startup, and public development health. No browser journey was changed, so
desktop, phone, tablet portrait/landscape, Chromium/Chrome, WebKit/Safari, and
physical Android/iOS/PWA compatibility are **not applicable** to this server-only
addition. An API health screenshot is startup evidence only.

## Provenance and production identity

Observation date: 2026-10-26 UTC. Investigation supplied by a read-only SRE helper
and checked against source and minimized automatic log records by the task owner.
No helper files were edited. Retain only timestamps, fixed outcomes, counts,
durations, and public build identity; no raw production logs, SQL payloads,
operators, records, credentials, or connection strings are committed.

Official metadata reports public Autoscale, deployed, successful current build.
At 17:52:58Z, public `/api/healthz` returned 200/`ok`. Public `/api/build-info`
reported:

- platform build `1c16156c-bb64-4dde-8e9d-b01f9ecc95cc`;
- app build `app-build:3e38e309-a61b-476f-91eb-a0900b9d7398`;
- completion 2026-10-24 04:21Z;
- primary samples carry source fingerprint
  `211e36b16b7ee63bc40d56e3ade3b61dd30d75f093ee04e31607f11cfde78be8`.

Official build lookup labels that platform ID **failed**, despite runtime identity
and deployment success metadata. The previous listed successful platform build is
`c799e2cf-ec67-4637-9336-151d468b24e0`, from October 22. No listed build was created
during the October 26 incident window. This contradiction is unresolved: the
runtime-reported artifact is identified, but exact successful revision/source
provenance is not established. Do not relabel the failed record or infer that
this checkout was published.

### Bounded retrieval

All literal log queries used the runtime-reported revision ID, window
**17:10:00–17:30:00Z**, page size 100. Each returned successfully, untruncated,
without a next cursor. Query/count: `timeout` 53, `sync_outbox_drain` 10,
`capacity_telemetry` 28, `background_database_phase` 28,
`scheduled_evaluation_queue_monitor` 17, `event_loop` 19, `lease` 8,
`database_capacity` 4. These searches overlap; do not sum them.

Revision-scoped severity-error queries for both listed IDs returned zero entries.
Literal queries without the severity filter returned application warnings and
errors. Empty filtered results therefore do not establish absence of failures.
Provider HTTP/compute metrics were populated in this window and a preceding
comparison window. Discovery supplied no primary-database lock/pool metric.

A single payload-free production SELECT was rejected:
`Production database access requires an authenticated user.`
There was no retry or alternate credential route. That gateway is replica-backed
and would not substitute for live-primary lock history even if authorized.

The normal log refresh at 18:04:43Z also returned current-serving logs. Its four
17:10–17:30 capacity records were projected locally using only allowlisted nested
`build`, `database`, `pool`, and timestamp fields. This **corrected an initially
incomplete helper projection** that inspected only top-level numeric values and
mistakenly described primary fields as missing. This bounded fallback agrees with
the revision-query count and explicitly carries the runtime-reported build tuple.
The fallback is not independent proof of the disputed platform build status.

## Correlation and limits

| Layer | Supported observation | Interpretation boundary |
| --- | --- | --- |
| Queue phase | 10 `status_aggregate` acquisition `connection_timeout` failures, 3.298–25.402 s; largest timeout overrun 24.501 s | Client acquisition includes connection establishment and JavaScript scheduling, not SQL execution. |
| Successful phase baseline | 18 post-checkout successes: nine each for aggregate and duplicate scan | Successes exist alongside failures; not proof that every job progressed. |
| Outbox | 10 retry notices, 17:17:59–17:28:57Z, 3.402–37.299 s; seven connection-related, three timeout-related | Existing normalized reasons do not establish the precise phase of each drain failure. Cursor-retained messages do not prove canonical loss. |
| Pool | Acquisition max 30.229 s; sampled waiter max 20; 430 acquisition-error counter increments across 28 capacity records | Report-window counters, not unique jobs, failed writes, or a provider connection limit. |
| Loop | 19 windows with loop samples; largest p95 3.603 s, p99 8.401 s, individual max 29.108 s | Window overlap, not a causal per-operation trace; monotonic timeout overrun can include delayed callbacks. |
| Workload | In those capacity records, only one complete SSE send and no sync-PUT counter was present | This does not prove no writes/clients existed: boundaries, logging population, background work and missing spans matter. No high-volume foreground-write trigger was demonstrated. |
| Leases | `lease` search matched eight records, no lease-tagged event | No lease loss, concurrent effect execution, or terminal-job outcome established. Existing lease/effect protections remain unchanged. |
| Provider HTTP | Populated incident minutes report zero 5xx and 100% availability | HTTP aggregates do not prove prompt background propagation. |
| Provider compute | Reported p95 CPU at most 5.95%, memory at most 12.95% | Does not establish per-instance scheduling health or rule out short loop stalls/throttling. |
| SSE latency | `/api/sync/events` mean 33.4 s for one incident request, versus 35.1 s for two preceding requests | Long-lived SSE response duration is not delivery latency; small populations cannot support a trend. |

### Primary snapshots (not peak capacity proof)

All four carry the app/platform/fingerprint tuple above. Diagnostic connection
included; provider reserves, policies, and current/maximum Autoscale instances
remain unknown. Zero sampled waiters is not zero waiters between samples.

| UTC capture | Primary observation | Client/active/idle backends | Active waits / lock waits | Estimated ordinary slots remaining |
| --- | --- | --- | --- | --- |
| 17:10:30.580 | Unavailable: `pool_checkout_timeout` | Unknown | Unknown | Unknown |
| 17:15:26.741 | Verified primary, full state visibility | 8 / 1 / 7 | 0 / 0 | 438 |
| 17:20:29.180 | Verified primary, full state visibility | 9 / 3 / 6 | 2 / 1 | 437 |
| 17:25:28.579 | Verified primary, full state visibility | 13 / 2 / 11 | 0 / 0 | 433 |

Observed `max_connections=450`, superuser reserve 4, role reserve 0. A lock
waiter is real at 17:20, but no lock owner, query, duration, or causal link to
outbox was captured. Neither persistent global slot exhaustion nor a provider
outage is supported. Transient contention remains possible.

Automatic current-serving logs also show further connection-related worker
warnings through 18:04Z. This is not a new bounded incident-count population,
but it prevents treating the later successful health response as recovery proof.

## Verified local change

`outboxDatabaseTelemetry.ts` reuses `observeDatabasePhase` around the existing
drain reads only. Fixed stage labels distinguish scope list, cursor/seed read,
and event read. A nine-key monotonic sampler emits at most one normal success,
slow success, and failure per stage per rolling minute per listener. No extra
timer, checkout, SQL, polling, or retry is added. The 900 ms slow-success cutoff
only chooses samples; it does not change any deadline.

Callbacks and canonical gap reconciliation are deliberately outside the SQL
observation. A successful event read followed by a failed handler is not logged
as failed SQL. Diagnostic errors cannot alter results or original error identity;
late completions after listener stop emit no outbox evidence. The offline summary
accepts the three new fixed stages and still treats unobserved/multiple-checkout
coverage as unknown. Record counts are sampled evidence, not failure rates.

### Verification ledger

| Check | Result |
| --- | --- |
| Initial four-file telemetry/outbox unit set | PASS: 38 tests |
| Final changed tests plus background operations, server jobs, and web-push scheduler | PASS: five files / 71 tests |
| Offline phase-summary CLI safety checks | PASS: two Node tests; malformed/oversized input fails closed without echoing records |
| Workspace `pnpm run typecheck` through pinned release runner | PASS, including generated API check, libraries, API route check, web, scripts, and sandbox |
| Disposable PostgreSQL 16 loopback fixture, 18:04:38–39Z | PASS: max-one pool held, 60 ms checkout failure observed as acquisition; pending waiters zero; statement-timeout read observed post-checkout; next SELECT succeeds |
| Controlled loop fixture | PASS: 120 ms synchronous stall produced 133 ms histogram maximum after warmup |
| Managed API startup | PASS: ready in ~200 ms; listener connected; sampled scope/cursor success evidence present |
| Development `/api/healthz` | PASS: HTTP 200; process/startup/database/audit/dependencies/background checks `ok`; API health screenshot |
| Production effectiveness of new outbox stages | NOT RUN: not published; no production-repair or release claim |

The disposable cluster used a unique temporary data/socket directory and loopback
port; no application schema or data was loaded. It was stopped and removed in
the command's cleanup trap. The 60 ms deadline is fixture-only. These cases prove
phase distinction and waiter cleanup, not reproduction of the production cause.

### Complete failure / limitation ledger

- Superseded local typecheck failure: test log fields were `unknown`
  (`TS18046`). Added a type guard; full workspace typecheck then passed. The
  concurrent web checker was cancelled by that first failure, not independently
  diagnosed as broken.
- Superseded disposable-rehearsal setup error: eval import resolved relative
  to `scripts/`, not its source subdirectory. Corrected the relative path; the
  subsequent rehearsal passed. No project source workaround.
- Toolchain notices: npm emits unrecognized pnpm-only project-setting warnings
  during temporary pinned-manager provisioning. Checks reached project code and
  passed; package/toolchain policy unchanged.
- SQL access: **BLOCKED**, authenticated gateway unavailable. Owner: production
  access owner. No extra SQL is required for the accepted evidence-limited
  outcome; use existing primary samples, never infer missing lock history.
- Exact release provenance: **MISSING/CONTRADICTORY**, official platform status
  conflicts with runtime. Owner: release/platform operator; independently
  reconcile runtime/build history without republishing an older task copy.
- Historical cause, lock ownership, event-loop initiator, lease/workload causal
  chain: **MISSING**, not recoverable from present aggregate evidence. Owner:
  application operations; collect the bounded future capture below if repeated.
- Existing development startup warning: identity-sequence read-only check
  unavailable. A single read-only diagnostic classified it as an identity
  metadata-contract mismatch, not a new outbox or pool failure. No sequence was
  advanced, reset, or migrated. Owner: database/migration maintainer; reconcile
  migration-backed identity expectations and development schema under explicit
  schema/migration safeguards. Do not weaken this check to make startup look clean.
- Existing development master-data scan reports one error in each scope and
  additional warnings. Only aggregate scan counts were inspected; records were
  not exported or edited. Owner: authorized data-health manager; review scoped
  findings through the existing data-health workflow before any data repair.
- API-only `/` probe and browser favicon return 404; API lives at `/api/*` and
  the web workflow is separate/not started. `/api/healthz` is verified; no routing
  or frontend changes justified. No general “clean logs” claim.

## Bounded future collection

After a separately owner-authorized normal publication, verify the serving
artifact and retain only a ten-minute, at-most-200-record sanitized capture.
Read fixed `background_database_phase` outbox stages, `sync_outbox_drain`,
`capacity_telemetry`, `database_capacity_sample`, queue-monitor and worker
outcome events. Keep nested build/primary evidence and observation intervals.
Record truncation/cursors; narrow the window instead of calling a partial sample
complete. Sampled outbox success/failure records must not be counted as rates.

Correlate acquisition and post-checkout intervals with overlapping loop windows,
primary waits and worker lifecycle evidence. If primary/lease/workload evidence
is still missing, leave it unknown. Never collect raw query text, parameters,
payloads, actor/scope identities, lease tokens, or customer records. No live load,
cache clearing, work replay, pool/timeout adjustment, or direct production
migration is authorized by this handoff. A new observation is not a release GO.
