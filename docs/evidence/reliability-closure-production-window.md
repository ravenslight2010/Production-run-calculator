# Production stall observation — read-only

**Root cause — inconclusive.** Current revision-bound evidence confirms recurrent pool-acquisition failures, slow post-checkout operations, and event-loop delays in one ten-minute window. Their same-process overlap is correlation, not proof of cause; primary-side database timing and replica provenance remain unavailable.

**Capture/status —** Captured 2026-10-31T01:08:29.466Z. Requested window: **2026-10-31T00:58:29.466Z–01:08:29.466Z UTC**. Deployment is public Autoscale, successfully published at the official primary URL; current build status is success. Platform build/revision: `42763954-0c35-47c4-8b4b-6ea38c26deb1`, created 2026-10-30T15:38:15.271Z, updated 15:45:55.440Z. Build detail exposed no Git/source mapping.

**Evidence/impact —** Revision-filtered info-log queries were successful, non-truncated, with no remaining cursor. Among 52 complete phase records: 37 success, 8 `connection_timeout`, 7 `checkout_timeout`; acquisition max 23,899 ms, successful post-checkout max 27,101 ms. Sixteen capacity reports showed pool waiters up to 13 (pool total up to 10, idle as low as 0); acquisition histogram max 35,599 ms. Ten event-loop samples reached 19,915 ms max and 7,202 ms p95. Phase and capacity intervals overlapped 64 times on the same process; 54 overlapping event-loop histogram pairs included those delays. Queue monitor also recorded 3 slow samples (max 33,100 ms), 7 unavailable transitions, and 3 recoveries. These client/runtime measurements do not isolate database execution.

Aggregate metrics: 7 requests, latency p95 335.4 ms, 4xx 0; 5xx and application-error metric queries returned empty points (not zero). Latest instance gauge was 0 despite logs, so it does not establish topology. Endpoint metrics covered only `/__ready` (6 requests).

**First-capture access gaps —** Supported production `executeSql` aggregate access was denied with `Production database access requires an authenticated user.` At that time, no primary/replica flag, backend/lock aggregates, provider connection-setup timing, or server SQL timing was obtained. The later in-app observation below is a separate point-in-time sample, not the unavailable historical series. Neither the captures nor the earlier Oct 15–20 degraded periods establish a causal link.

This observation does not certify the repaired workspace revision or identify a causal fix. No deployment or infrastructure trial was enabled.

## Additional same-day serving-log slice

**Capture —** Published deployment logs read at 2026-10-31; revision still has
no Git/source mapping in deployment metadata. A sanitized, structured-log-only
rollup covers **2026-10-31 01:24:46–01:34:46 UTC**. The output below excludes
correlation IDs, host/process identifiers, requests and response bodies, and
record-level data.

**Observed —** The 107 structured rows in this window include 56 sampled
database-phase records for four bounded-queue/outbox stages: 46 successes and
10 connection- or checkout-timeout outcomes. `outbox_scope_list` had 5
connection timeouts and 1 checkout timeout among 23 samples; `outbox_cursor_read`
had 1 checkout timeout among 17 samples; `status_aggregate` had 3 connection
timeouts among 10 samples. Successful post-checkout phase times reached 30.1 s,
while measured acquisition phases reached 22.6 s. These are logger-observed
client/runtime phases, not isolated database execution time.

In the most recent capacity interval, the pool was at its 10-client limit at
the 95th percentile, waiters reached 15, and 20 pool acquisition errors were
recorded in that 60-second sample. Scheduled-queue snapshots separately logged
multiple 9.8–11.3 s slow samples; the displayed aggregate and duplicate-group
query durations together account for the measured snapshot. This supports pool
contention and slow queue/outbox work as **current contributing symptoms**.
It does not show which workload initiated contention, prove that database
execution rather than connection setup or application scheduling was the
primary cause, or establish whether each sync intent failed or later recovered.

**Decision —** Continue to treat the 30-second sync/recovery symptoms as a
production investigation, not as a confirmed single-code defect. Do not
increase pool size, add concurrency, raise timeouts, drop/rewrite queues, or
enable a production trial on this evidence alone. The separate authenticated
production aggregate-query gate remains blocked. No live writes, app restart,
provider changes, database changes, or publish action were performed for this
log review.

## Later same-day serving-log slice

**Capture —** A second sanitized rollup covers **2026-10-31 01:35:12–01:49:11
UTC** from the same published deployment. It contains 81 direct database-phase
records: 67 successes and 14 acquisition/checkout timeouts. The timeouts were
observed in `status_aggregate` (4), `outbox_scope_list` (7), and
`outbox_cursor_read` (3). The longest observed acquisition phase was 31.3 s.

Across 26 bounded capacity reports, the highest reported acquisition p95 was
32.2 s; samples also reached a 10-client pool, zero idle clients, and 14
waiters. The largest reported event-loop delay was 21.1 s. Scheduled-queue
monitoring recorded 9 slow snapshots, 4 samples unavailable due to database
connection failure, and 3 recoveries. A database-timeout job failure and a
database-connection alert-scheduler failure were also recorded.

**Later database-capacity point —** An in-app, read-only sample at
2026-10-31 01:50:20 UTC identified the primary and reported complete database
state visibility: 450 maximum connections, 436 ordinary slots estimated
available, 10 client backends (1 active, 8 idle), and no active or lock-waiting
backends. At that same point, the application pool had a maximum of 10, with 7
clients total, 5 idle, and no waiters. This point-in-time reading did not show
global database connection or lock exhaustion; it does not exclude earlier
pressure within an individual application pool or explain the separate
30-second samples. Provider-reserved slots and autoscale instance counts remain
unknown.

That readiness response reported process, startup, database, audit protection,
and dependency checks as healthy, but `backgroundWorkers` as warning. Its
scheduled-evaluation queue sample was unavailable; the last five-minute
aggregate showed 6 terminal job failures and 2 recent server-job-run failures
against a threshold of 3. The same response reported no pending sync-outbox
events. These aggregate checks are not tied to the owner’s specific run; a
healthy outbox does not prove that the client adopted the intended snapshot.

This further corroborates **database connection/pool contention as a plausible
contributor to the reported 30-second stalls**, not as a proven primary cause.
The window contains no request or run identifier linking these events to the
owner’s resume action; the single auto-track tick is not evidence that a
particular run’s tracking claim succeeded. These remain server-side sampled
client/runtime durations, not primary-database query or lock measurements.
Production aggregate-query access is still blocked, so no workload or
primary-versus-replica attribution is available. No database, application,
provider, or published configuration was changed.
