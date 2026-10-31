# Runtime Stall Investigation and Repair Evidence

**Evidence captured:** through 2026-10-21 23:50 CDT / 2026-10-22 04:50 UTC  
**Scope:** API readiness diagnostics, shared PostgreSQL pressure, and bounded disposable workload. No production writes, load tests, schema changes, pool changes, or Publish were performed.

## Result

Concurrent `/api/readyz` requests now share only the in-flight optional diagnostic read. Every request still performs its own `SELECT 1` and audit-protection check; readiness still reports optional background warnings, and audit protection remains a required health gate. Readiness logs now include bounded total, core database-check, optional-diagnostics, and (when enabled) local-model-probe durations. The existing read-only PostgreSQL capacity sample now also reports fixed numeric counts of active waiting backends and active lock-waiting backends; it does not select SQL text, identities, or operational rows.

The change addresses reproducible duplicate diagnostic work under concurrent probes. It does **not** establish that this was the cause of the three reported historical incidents, and it does not resolve the separate observed production database/worker failures.

## Evidence separation

### Confirmed observations

- The task reports monitoring incidents at 2026-10-16 02:23 UTC, 2026-10-20 16:15 UTC, and 2026-10-20 19:59 UTC. Authorized deployment-log searches for those exact windows returned no records.
- Separate retained production logs cited in the task (2026-10-21 11:01–14:17 UTC) recorded event-loop delay up to 24.31 seconds, checkout duration up to 26.9 seconds, up to 19 queued checkouts, and repeated background connection failures. Those records do not identify a cause for the three incidents.
- Prior reports `published-background-db-investigation-2026-10-05.md` and `published-background-db-investigation-2026-10-08.md` document earlier pool saturation and acquisition timeouts. Provider capacity and Autoscale instance counts were not established there.
- A later authorized production-log sample covered 2026-10-21 20:58:48–23:53:30 UTC (997 sanitized log records). Its bounded capacity summaries reported:
  - 257 capacity telemetry windows; pool size never exceeded 10.
  - Maximum recorded checkout p95: 24.1 seconds; largest sample maximum: 33.1 seconds.
  - Maximum recorded waiting p95: 19; largest sample maximum: 25.
  - Maximum event-loop delay sample: 30.4 seconds; largest window p95: 4.4 seconds.
  - 103 sync-outbox retry events (98 connection failures, 5 database timeouts), 208 server-job run failures (189 dependency-connection failures, 19 timeouts), and 43 web-push scheduling failures (32 connection failures, 11 timeouts).
  - Scheduled-evaluation monitoring recorded 107 unavailable samples, 36 slow samples, and 36 recoveries. Capacity sampling returned 13 observed samples and 22 unavailable samples (13 pool-checkout timeouts, 9 capacity-query timeouts).
  - Of 71 readiness log records, 46 showed optional background-worker warnings and 25 showed no warning; all recorded core database and audit checks were successful. Slow queue-monitor samples included stage durations for status aggregation and duplicate-group scanning, but no PostgreSQL lock-wait attribution.
- At 2026-10-22 04:28:42 UTC, the public readiness probe returned HTTP 200 with core checks healthy and no current background-worker warning. The public build was `app-build:2bf9456f-b16e-4644-8caa-ee6a0c7d74fc`, revision `5c3f266fce04010103ef5cc6aa719034722bf199`. This is not the checked-out Git HEAD (`4e6149db5092cb27e0ef5116d532c6ce4e9fd913`), so it does not include or verify this repair. The task edits are uncommitted and are not represented by that HEAD hash; the workload runner's revision field likewise identifies the base revision, not a patch commit.
- Production health and capacity logs from the currently deployed build did not contain the new duration or lock-wait fields. These signals become available only after the changed source is merged and published.

### Reproduced cause and bounded repair

Before the repair, each concurrent readiness request independently ran the database-backed background-operation and cache-maintenance diagnostics. Cache maintenance checks both scopes. This made optional diagnostics multiply with probe concurrency, even though those values are observational and do not gate core readiness.

The route now shares the current in-flight result only. It does not cache completed diagnostics, so later probe waves receive fresh data. Database and audit-protection checks are not shared or skipped. The scheduled queue and sync-outbox diagnostics remain in the same readiness response. The new duration fields use bounded numeric values and add no database query or retained request payload.

The read-only capacity query aggregates `wait_event_type` into two bounded counts: active backends waiting on any PostgreSQL event and the subset waiting on a lock. Counts are checked for internal consistency before logging. A separate disposable PostgreSQL test held one session-level advisory lock, blocked a second client, and verified the capacity sample reported at least one active lock waiter; it then unlocked the blocker, awaited the blocked query, released both clients, and verified the pool had no queued checkout.

The existing offline capacity-report parser now allowlists and summarizes these counts. Historical records without the optional fields remain unknown, not zero; the report carries an explicit wait-event sample count.

### Remaining hypotheses and evidence gaps

- Pool checkout waits, queued checkouts, event-loop delays, and background failures are present in overlapping log windows, but bounded samples do not provide per-request or per-instance causal linkage.
- The captured production logs predate the new wait counters and include no lock-wait measurements sufficient to distinguish SQL lock contention from connection acquisition, new-connection establishment, or broader database availability.
- None of the accessible logs covers the exact three historical incident windows.
- The disposable workload does not reproduce the production provider, Autoscale topology, or all scheduled/background workers. No infrastructure sizing, pool-size, timeout, or topology change is justified by this evidence.

## Bounded before/after workload

Targets were set before the formal comparison: reduce median readiness p95 by at least 10%; do not exceed the control's maximum sampled pool waiters; keep median sync and inventory durations within 10% of their respective control medians; preserve every sync write and inventory idempotency assertion.

The same local disposable-PostgreSQL workload ran three times per mode: 4 clients × 4 rounds, at most 12 concurrent requests, 155 counted requests, and 16 readiness probes overlapping sync writes. Each passing run preserved 32 live/scheduled sync writes, 16 inventory adjustments, the inventory consumption-ledger checks, and peak concurrency of 12.

| Measure | Control runs | Repaired runs | Comparison |
|---|---:|---:|---:|
| Readiness p95 (ms) | 105, 164, 89; median **105** | 80, 77, 83; median **80** | **24% lower** |
| Maximum sampled pool waiters | 10, 10, 10; maximum **10** | 4, 4, 4; maximum **4** | Below target |
| Sync phase (ms) | 762, 715, 656; median **715** | 729, 745, 615; median **729** | +2.0%; within 10% |
| Inventory phase (ms) | 187, 193, 181; median **187** | 190, 194, 230; median **194** | +3.7%; within 10% |

All three control and all three repaired runs passed their data-integrity assertions. The 230 ms inventory result is retained rather than hidden; the comparison target applies to medians. Queue depth was sampled every 5 ms during this local test and is a peak count, not a queue-wait duration. The 10% latency bound is a non-regression guard, not a production SLO.

## Verification status

- **PASS** — `pnpm --filter @workspace/api-server run typecheck` (includes API route typecheck).
- **PASS** — `CI=true pnpm run typecheck` (root shared completion checks).
- **PASS** — focused health, database capacity, capacity telemetry, server jobs, background operations, observability, sync outbox, and server auto-track tests: 8 files, 111 tests.
- **PASS** — `pnpm --filter @workspace/scripts run test:sse-capacity-report`: 19 tests, including generated wait-count bounds, historical unknown handling, and sanitization.
- **PASS** — `pnpm --filter @workspace/scripts run test:results`: 28 passed, 1 conditional disposable-database failure-path test skipped by the harness.
- **PASS** — 3/3 control and 3/3 repaired disposable workload runs; no sync loss or duplicate inventory claim.
- **PASS** — final isolated workload plus controlled advisory-lock test; all sync/inventory assertions passed, the lock waiter was observed, and the pool returned to zero waiters.
- **PASS** — `git diff --check`.
- **NOT RUN** — full release suites, production load tests, and deployed-runtime verification. They were not required or authorized for this repair.
- **NOT APPLICABLE** — browser visual/responsive checks; this backend-only change does not alter client behavior.

## Failure ledger

1. The initial disposable PostgreSQL setup used a daemon started by a short-lived shell; the server stopped with that shell. Replaced it with a foreground server attached to a persistent background shell.
2. The first load-summary parser rejected a passing workload because the new readiness requests were not included in the total-request count. Corrected the fixture accounting and upper bound.
3. The first coalescing regression test released its gate before all requests reached diagnostics. Tightened it to wait for every request's independent database checks before asserting one shared read.
4. The first implementation still fetched cache diagnostics again while constructing the response. The regression test found the extra calls; the response now uses the in-flight result.
5. The initial response wiring placed the shared diagnostic in a branch-local variable; health tests caught HTTP 500s. Routed the value through request-local response state.
6. The formal control/repaired switch briefly restored the coalescing function without its in-flight variable declaration. The disposable workload caught `ReferenceError`; the declaration was restored, then health tests and all three repaired workload runs passed.
7. Typecheck rejected `Array.findLast` under the configured library target. Replaced it with a reverse-and-find lookup; package and root typechecks passed.
8. Temporary test-output/error diagnostics used to identify the failure above were removed. The isolated database and generated workload summaries were cleaned up after verification; no production state was changed.

## Rollback and publication boundary

This change has no database schema or persisted-data effect. If it causes a regression, revert the health-route coalescing/timing change, the additive capacity-sample fields, and their tests in the task merge, or restore the prior checkpoint; no database rollback or data heal is required.

The fix is local to this task branch and has not been published. After merge, the owner-controlled Replit Publish is required before production verification. A later read-only check should confirm the published build identity, core/audit readiness, and presence of the bounded `health_check` duration fields. Do not run production load tests.

## Post-publish verification attempt — 2026-10-22

**Capture window:** 2026-10-22 20:19:49–20:23:06 UTC
**Environment:** production, public Replit autoscale deployment
**Evidence handling:** only bounded status, identity, counts, and numeric ranges are retained; raw deployment logs and response bodies were not saved.

- **PASS — deployment metadata:** At 20:20:43 UTC, official deployment metadata reported an active deployment and successful build. The public app build identity was `app-build:54d9849b-b8b4-4a1d-a6cd-a311bdec75a4`.
- **BLOCKED — source identity:** The public build-info response at 20:20:09 UTC reported that build completed at 16:37:05 UTC with source policy `production-source-v3` and fingerprint `4703becbfd4a0340293b4a947b65573927306fd38ff684326d0f1f32e3ce0dac`. The independent expected record, prepared at 20:16:40 UTC, had the same policy but fingerprint `58b298028979cbc73dc3ad11e1c6e5c82c0f06af726d7acff5560678d318023f`. `pnpm run check:published-build -- --url <official-url>` reported “Published source does not match the expected build.” The runtime did not provide a Git revision binding. This does not establish that the live build contains the merged task source.
- **PASS — public readiness sample:** At 20:19:49 UTC, `/api/readyz` returned HTTP 200 and `status: ok`; process, startup, database, and audit-protection checks were all `ok`. The optional background-workers check was `warning` in this sample.
- **PASS with source-binding caveat — bounded health logs:** The scoped revision reader returned no usable records. The documented reader for the currently serving build returned 95 `health_check` records in the 16:37:05–20:23:06 UTC window. All 95 contained a `stageDurationsMs` object; 90 included database-check durations (28–270 ms) and optional-diagnostics durations (73–328 ms). Total `durationMs` values ranged from 0–512 ms. Ninety records reported success and five reported degraded; among the 90 with required-check status fields, database and audit protection were `ok`. Background-worker status was `warning` in 42 and `ok` in 48 records. No local-model-probe duration field appeared in this window.
- **PASS with source-binding caveat — capacity fields:** The current-serving-build log reader returned 44 `database_capacity_sample` records. Thirty observed samples contained both `activeWaitingBackends` and `lockWaitingBackends`; each field ranged from 0–2. Fourteen samples were unavailable and did not supply wait counts. Missing counts remain unknown; they are not treated as zero.
- **BLOCKED — attribution to the merged source:** The health and capacity fields are present in current-serving-build logs, but the source fingerprint mismatch prevents binding those observations to the exact merged source. The revision-scoped log reader also did not provide records; the fallback reader is pinned to the current serving build. No conclusion is made that this change caused any earlier incident.
- **NOT RUN:** No production writes, Publish, or production load tests were performed.

**Next action:** The deployment owner must Publish the source represented by the independent expected record. After that owner-controlled Publish, rerun the official source comparison, readiness probe, and bounded log inspection against the newly serving build. Until then, task completion remains blocked.

## Retry — verified published signals, 2026-10-22 21:19 UTC

This retry supersedes the preceding next action. A newer owner-controlled Publish exists; do not ask the owner to publish the older task-copy source merely to match this isolated checkout.

### Identity and authority

- Official deployment metadata again reported a successful, public autoscale deployment.
- Official build `c799e2cf-ec67-4637-9336-151d468b24e0` was created at 20:33:35.741 UTC and recorded successful at 20:41:41.809 UTC. The owning stall-repair task was already merged before that Publish.
- Its official build logs contain two prepared-source records and one sealed-build record. All three report application build `app-build:bee65f3c-70bd-4de3-901c-c348214828be` and source fingerprint `bd319653b852c242f755bd44fd6116d35088052d13930627830e847363875442`. The public `/api/build-info` response captured at 21:19:04.332 UTC independently reports that same application build and fingerprint, completed at 20:35:36.890 UTC.
- **PASS — published-artifact identity and targeted implementation presence:** the official prepared and sealed identities match the running artifact, and its runtime samples contain both sets of targeted telemetry fields described below. This binds the availability finding to the newer published artifact rather than the older task checkout.
- **FAIL — comparison to the isolated task-copy expectation:** `pnpm run check:published-build -- --url <official-url>` still reports a fingerprint mismatch against this checkout's independently prepared `58b298028979cbc73dc3ad11e1c6e5c82c0f06af726d7acff5560678d318023f` expectation. That failed comparison is not relabeled as a source match. The expected record was not regenerated, replaced, or constructed from the runtime response. An authorized source-backup fetch also did not provide this newer Publish's expected record. Official Publish logs supply the separate artifact-identity evidence above.
- **Limitations:** Git binding remains unavailable. This proves the published artifact and the presence of the requested instrumentation, not exact equality with the current checkout, an immutable Git revision, or release GO. No source-match receipt or release approval was created.

### Readiness and bounded runtime evidence

- **PASS — required readiness:** `/api/readyz` at 21:19:04.571 UTC returned HTTP 200, `status: ok`, with process, startup, database, and audit protection all `ok`. Optional background workers reported `warning`; this is not described as all workers being healthy.
- **PASS — health stage fields:** the documented current-serving-build log reader returned 17 `health_check` records for 20:35:36.890–21:19:23.440 UTC. Total duration ranged from 0–353 ms. Sixteen records included database-check durations (29–130 ms) and optional-diagnostics durations (74–321 ms); the remaining record supplied no values for those stages, which remain unknown.
- **PASS — wait-event fields:** eight `database_capacity_sample` records all carried the matching application build identity. Six observed samples contained both `activeWaitingBackends` and `lockWaitingBackends`, each zero in these samples. Two samples were unavailable and did not supply wait counts; those counts remain unknown, not zero. No claim about continuous absence of waits between samples is made.
- **Historical boundary:** absent fields in older samples remain unknown. Neither these readings nor the earlier nonzero readings establish a cause for historical incidents or prove the repair prevented stalls.
- **NOT APPLICABLE — browser compatibility:** desktop, phone, tablet portrait/landscape, Chromium/Chrome, WebKit/Safari, and physical Android/iOS/PWA checks; this is read-only backend telemetry verification with no UI change.
- **NOT RUN — broad tests and release gates:** no application code changed; public probes, official metadata/build-log comparison, sanitized runtime summaries, and a whitespace check are the focused verification. No new Publish, production writes, production load tests, pool changes, or schema changes were performed.

### Failure ledger disposition

The initial old-build mismatch and unavailable revision-scoped log reader remain historical observations. The current-serving reader supplied the requested runtime evidence. The retry's task-copy source mismatch remains a failed checkout comparison, while official prepared/sealed build records and matching runtime telemetry resolve the narrower published-signal verification objective. Full checkout-source matching and release approval have not been asserted.
