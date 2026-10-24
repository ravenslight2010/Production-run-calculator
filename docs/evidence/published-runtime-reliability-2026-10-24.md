# Published database delays and background-job failures

## Decision

**Background degradation confirmed; underlying trigger inconclusive.** Revision-scoped production logs show pool-acquisition congestion, slow database-backed queue observations, and event-loop stalls during overlapping windows. They do not isolate provider/network delay, new-connection establishment, PostgreSQL execution, or application scheduling as the initiating cause. There is no evidence here of a whole-app HTTP outage.

This completes a read-only investigation, not a remediation or production-readiness certification. The accountable next action is for the production operator and database/provider owner to approve a correlated primary/provider investigation before any capacity, timeout, or production-code change. No Publish, production heal, job replay/purge, load test, schema change, or connection-limit change was performed.

## Agent-owned execution

- Objective: diagnose the published failures retained in [authority evidence A25/A44](../server-live-state-authority.md), separately from workspace continuity/browser results.
- Owner: investigation agent for this report; production operator and database/provider owner for access decisions and any mitigation approval.
- Affected surfaces: server-job execution passes, push-evaluation scheduling, sync-outbox delivery, automatic tracking, queue diagnostics, readiness.
- Evidence: official deployment metadata/build history, public build/readiness GETs, revision-scoped runtime logs, supported deployment metrics, and local source inspection. The production investigation was performed by the required read-only SRE subagent; numerical production findings below are its returned sanitized summaries. No raw payload-bearing logs are committed.
- Variants considered: preceding/current windows; successful/unavailable capacity samples; pool checkout/new-client connection/query timing; event-loop delay; producer/worker/outbox/tracker failures; readiness versus background health. Historical reports are context, not measurements of this build.
- User-controlled decisions: approval for provider-side access/correlation or a separately reviewed mitigation. No secrets or credentials were requested or read.
- Overlap: the separate full-release browser-inventory task neither owns this production diagnosis nor proves production availability.

## Scope and provenance

All times are UTC. Evidence capture was on **2026-10-24**.

| Item | Verified observation |
| --- | --- |
| Official deployment | Public Replit Autoscale deployment; published, successful build |
| Official URL | `https://Lucias-Production-Assistant.replit.app` |
| Public identity capture | `/api/build-info`, 2026-10-24 00:25:06 |
| App build | `app-build:bee65f3c-70bd-4de3-901c-c348214828be` |
| Platform build / scoped log revision | `c799e2cf-ec67-4637-9336-151d468b24e0` |
| Source fingerprint | `bd319653b852c242f755bd44fd6116d35088052d13930627830e847363875442` |
| Runtime build completion | 2026-10-22 20:35:36.890 |
| Official successful-build time | 2026-10-22 20:41:41.809 |
| Runtime Git revision / binding | Unavailable; exact checkout/source equivalence is **not established** |
| Observation anchor | A25/A44 document committed 2026-10-23 23:16:56; not a proven incident onset |
| Current window | 2026-10-23 23:16:56 through 2026-10-24 00:25:06 |
| Equal preceding window | 2026-10-23 22:08:46 through 23:16:56 |

No deployment build falls within these two observation windows. Current capacity records independently carry the same app build, source fingerprint, and platform build as the public identity. This binds those records to the serving artifact, not to this checkout's Git source. No checkout-match receipt or release approval is asserted.

## Bounded operational impact

These are **log-event counts**, not unique failed jobs, terminal job states, missed deliveries, or lost production quantities.

| Signal | Current window | Preceding window |
| --- | ---: | ---: |
| Server-job run-pass failures | 57 | 43 |
| Web-push scheduling failures | 12 | 15 |
| Sync-outbox retry notices | 32 | 31 |
| Automatic-tracking failures | 7 | 3 |
| Queue-monitor unavailable samples | 37 | 41 |
| Queue-monitor slow samples | 17 | 18 |
| Queue-monitor recovery notices | 15 | 15 |

- Server-job failures: 50 `dependency-connection`, 7 `database-timeout`. A failed pass can concern claim/lifecycle work; it does not prove a handler executed or exhausted its durable attempts.
- Push-scheduling failures: 9 database-connection, 3 timeout. This is producer enqueue degradation, not proof of an external push-provider failure or delivery outcome.
- Sync-outbox retries: 26 connection failures, 6 timeouts. The safe log message explicitly retains the cursor for retry; notification propagation may be delayed. This is not evidence that a canonical sync write was lost.
- Automatic-tracking failure messages establish failed ticks only. No safe cause classification or per-run counter discrepancy was established.
- Queue monitoring repeatedly failed and recovered. Actual backlog, unique queued/running work, job age, and terminal outcome totals remain unknown; unavailable snapshots must not be interpreted as an empty queue.

Representative payload-free messages were “Server job background task failed”, “Sync outbox drain failed; cursor retained for retry”, and “Scheduled evaluation queue monitor sample was slow”.

## Distinguishing the timing layers

| Layer | Evidence in current window | What it does / does not establish |
| --- | --- | --- |
| Application pool acquisition | 66 targeted capacity telemetry records; largest per-window acquisition p95 26.6 s, largest sample 32.0 s | Includes waiting/new-client establishment and JS scheduling; not SQL execution time. Queueing is real, but its initiating cause is unknown. |
| Pool demand | 14 capacity samples reported pool max 10; sampled waiters reached 12 | Per-process pool congestion, not proof that PostgreSQL ran out of global slots. |
| Event loop | 53 telemetry records contained event-loop samples; largest per-window p95 9.1 s, largest delay 26.6 s | Stalls overlap the failures, but no per-request/per-instance causal chain identifies whether they caused or followed congestion. |
| Queue query stages | 17 slow samples; status aggregation up to 25.4 s, duplicate-group scan up to 18.3 s | Client-side wall durations include pool acquisition, network/round trip and application scheduling; they are **not isolated PostgreSQL query execution durations**. |
| Capacity sampling | 11 observed, 3 unavailable: 2 `capacity_query_timeout`, 1 `pool_checkout_timeout` | Separates failed checkout from a post-checkout query deadline for this diagnostic only; does not classify every worker failure. |
| Provider/new connections | No exact checkout-wait or new-client-timeout signature matches in targeted literal searches | Normalized connection/timeout reasons cannot name a provider or distinguish all connection phases. No provider incident or push-provider latency was verified. |

The preceding window had acquisition p95 up to 13.1 s but a larger individual maximum of 37.3 s, and event-loop maximum 29.7 s. Tails are mixed; do not call this a clean worsening trend.

### Primary capacity and lock evidence

All 11 successful capacity samples verified `pg_is_in_recovery() = false` and complete state visibility. Their ranges were:

- PostgreSQL `max_connections`: 450; superuser reserve: 4; role reserve: 0.
- Client backends: 8–13; active: 1–2; idle: 6–11.
- Active waiting backends: 0–1 (one waiter in two samples).
- Lock-waiting backends: **0 in all 11 observed samples**.
- Estimated ordinary slots remaining: 433–438, including the diagnostic connection.

The three unavailable samples supply no backend/wait/replica values. These sparse primary observations argue against continuous global PostgreSQL slot exhaustion or sustained lock contention in the captured samples, but cannot rule out transient contention between them. The remaining-slot estimate is not provider-wide headroom: proxy policies, provider reserves/limits and current/maximum Autoscale instances remain unknown. A platform instance-count metric returned zero despite successful GETs, so it is not usable topology evidence.

The latest capacity sample at 00:25:00.818 reported pool total 9, idle 2, waiting 0. A recovered sample does not erase earlier failed passes.

### Source interpretation boundary

Inspected checkout paths: `lib/db/src/index.ts`, API `src/lib/{backgroundOperations,capacityTelemetry,databaseCapacity,serverJobs,webPush}.ts`, and `src/routes/health.ts`. None is proven identical to the serving build. In this checkout:

- Pool acquisition has a 900 ms cancellation-safe deadline and default max 10. A wall duration over 900 ms does **not** establish a changed production setting: a blocked event loop can delay the JS timeout callback.
- Acquisition telemetry wraps `pool.connect`; queue-stage timing wraps the awaited database operation. Neither isolates server-side SQL execution.
- Workers use bounded concurrency/backoff and a protected single retry; job transitions, leases and effect fences remain distinct from producer scheduling.
- Readiness gates core database/audit protection but reports optional background warnings without necessarily returning 503.

These explain signal semantics, not a source-matched production bug. Earlier [October 8 evidence](published-background-db-investigation-2026-10-08.md) distinguished checkout and new-client timeout messages and a date-amplifying producer. The current checkout already schedules by scope/time bucket; do not reapply that old repair. [October 21 evidence](runtime-stalls-investigation-2026-10-21.md) independently documented similar stalls; it does not prove this window's cause.

## Readiness and metrics are a separate outcome

At approximately 00:25:06, public `/api/readyz` returned HTTP 200 in about 0.48 s, all checks including workers `ok`. That proves only that sampled probe.

Supported metrics for current versus preceding windows reported 55 versus 58 requests, overall p95 299 versus 341 ms, CPU p95 about 2.85%, and memory about 12.9% in the current window. Low aggregate CPU does not rule out brief event-loop stalls.

`http_availability` (`aggregation=avg`, `resultShape=value`) reported 100% in each window: this is uptime-check success, not worker success or universal availability. `http_response_5xx_count` returned an empty points array, **not zero**. The endpoint breakdown contained only `/__ready`, 41 current / 42 preceding requests with zero observed 5xx; it does not establish application-route or background-job success. No isolated browser pass certifies this production deployment.

## Evidence retrieval and limitations

The SRE investigation used `getDeploymentInfo`, official build history, public identity/readiness GETs, `getDeploymentLogs` scoped to the platform build above, and supported deployment/endpoint metrics. Revision-scoped logs succeeded; no current-serving fallback was needed.

Event-specific log queries used the exact windows above, `minSeverity=info`, literal event filters and `pageSize=100`. Queries used for reported counts were successful, nontruncated and had no cursor. The targeted database-capacity query returned 14 records. Targeted event-loop and event-specific queries supplied the telemetry summaries. Broad `connection` (first page had a cursor), broad capacity-telemetry and health queries (truncated) were excluded from totals. Both exact timeout-signature searches returned zero matches, nontruncated, no cursor:

- `timeout exceeded when trying to connect`
- `Connection terminated due to connection timeout`

The log callback returned serialized text instead of its documented array; the investigation recovered by parsing allowlisted fields. Severity `error`/`warning` filters returned empty results although `info` queries contained Pino levels 40/50. Therefore severity-filter emptiness and aggregate log-error metrics are not reliable negative evidence. Raw production payloads, identities, SQL text and secrets were not retained. No direct production SQL query was needed: app-owned primary samples already provided aggregate capacity/wait evidence.

## Safe mitigation and approval request

**Immediate recommendation: retain the existing bounded retry/backoff, cursor retention, idempotency and lease/effect fences.** Do not expand retries, increase pool/connection limits, extend timeouts, purge queued work, replay jobs or switch operational authority to clients based on this evidence.

The production operator/database owner should approve a **read-only, same-window correlation** of primary/provider connection-setup/round-trip latency, server-side query/lock durations, and independently timestamped current/maximum Autoscale instances plus provider limits/reserves. If those signals are unavailable, explicitly approve a separately reviewed, bounded phase-timing instrumentation change before another production observation. Any merge or Publish remains separately controlled. The investigation cannot responsibly select pool sizing, a provider workaround or a SQL optimization without that missing attribution.

Success for that next decision: identify the limiting phase with build/time-bound evidence and select a reversible mitigation with a measured acceptance target. Idle successful passes must not mask concurrent failures; preserve paired durable job/attempt transitions, renewable leases, single-claim effects and outbox cursor ownership.

## Applicable safeguards and verification

- **PASS:** official successful deployment/build identity and independently matching app-owned capacity identities; bounded scoped logs and metric interpretation; source-path inspection; sanitized report.
- **PASS:** repository whitespace check (`git diff --check`), recorded after the report edits.
- **INCONCLUSIVE:** initiating cause and provider attribution. Evidence above; owner production operator/database owner; next action the explicit read-only correlation approval.
- **UNKNOWN:** unique affected jobs/deliveries/runs, backlog, true server execution latency, transient locks outside samples, provider quota and Autoscale topology. Do not label these zero or repaired.
- **COMPLETION VALIDATION:** the configured `bash scripts/src/run-release-node.sh pnpm run typecheck` failed twice on invalid local generated build metadata. Regenerating the prepared source alone did not fix it: Vite was reading a separate stale web-stage record using the older source policy. Preserved that ignored stale stage record under a non-active filename. The focused `check:vite-config-loading` now passes for all three configs and both Vite configs across bundle/runner/native loaders. Required completion typecheck must still rerun; the earlier failures are not passes. No build or Publish was performed.
- **NOT RUN:** production remediation, load/capacity tests, direct production SQL, authenticated operational actions, Publish, local application unit/browser tests and full release gates. Only documentation changed; no runtime check was invalidated by these edits.
- **NOT APPLICABLE:** workflow restart, application screenshot, desktop/phone/tablet portrait/landscape, Chromium/Chrome, WebKit/Safari, physical Android Chrome/iOS Safari/PWA and native-mobile testing. This is backend read-only investigation, not a UI or runtime change.

### Failure ledger and disposition

| Finding | Disposition / accountable next action |
| --- | --- |
| Published worker/scheduler/outbox/tracker failures and long waits | **CONFIRMED, NOT REPAIRED.** Investigation result, not unresolved implementation. Production operator/database owner owns correlation/mitigation approval above. |
| Initiating cause and unique operational loss unavailable | **INCONCLUSIVE / UNKNOWN.** No destructive probe or speculative repair justified; same owners and approval request. |
| Serialized logs broke initial array parsing | **RECOVERED:** parsed bounded allowlisted fields; complete event queries used for counts. |
| Severity filters omitted observed error-level app records | **LIMITATION:** queried at info and classified app event fields; no negative health claim from severity filters. |
| Truncated broad queries | **EXCLUDED:** complete targeted queries supplied retained summaries, not first-page totals. |
| Metric returned zero instances despite live GETs; 5xx metric had no points | **UNRELIABLE / MISSING:** topology and 5xx count stay unknown. |
| Serving build lacks Git binding | **MISSING exact source match:** artifact identity retained; no checkout bug or release receipt asserted. |
| Required completion typecheck rejected local prepared-source metadata twice | **LOCAL SETUP REPAIRED:** prepared-source regeneration alone was insufficient; preserved the separate stale old-policy web-stage record outside its active filename. Focused Vite loader checks pass; required full typecheck rerun remains the completion gate. No application logic or validation assertion changed. |

No code, authorization, schema, persisted data, retry/lease contract or operational authority was changed. The bounded diagnosis and explicit approval request are the deliverable; production reliability has not been certified.
