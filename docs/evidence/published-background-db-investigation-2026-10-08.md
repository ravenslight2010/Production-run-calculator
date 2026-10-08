# Published background database and scheduled-job investigation

## Scope and identity

- Captured: 2026-10-08, approximately 02:57–03:02 UTC.
- Environment: published Replit production deployment, public Autoscale app.
- Live `/api/build-info` identity:
  - App build: `app-build:f823261f-3a18-48eb-bd2c-3c3e9669d2ca`
  - Published source fingerprint: `876c19a1059bb44730c0da96b9e5812fccbd2d1de2a8113f7d5fa1811b78f71f`
  - Published Git revision: `370105ec67ba614f009a18e724007619afb4eb2f` (`gitBinding: verified`)
  - Platform deployment: `411f3a0b-be0f-499a-9b85-b35deec43e5d`
  - Platform build: `349a8e3f-6755-4f23-8f1e-f1757bfbdd4b`
  - Build mode: `release`
- The workspace's independent prepared-source record did not match the published
  fingerprint. A public published-build check was therefore blocked; no local
  source fingerprint was substituted for the live identity.
- The checkout at evidence capture was `988a2006f8a691f3882647912d4b69e2f2c7be28`;
  its prepared-source record fingerprint was
  `7e809ada3a9445d75eaa848bdf42c73bf86971bc063e18cf4b12be776309fe86`. The
  published Git revision is present in the checkout. Before this task's
  correction, `webPush.ts`, the server-job lifecycle, background-operation,
  DB-pool configuration, and lockfile files relevant to this finding matched
  that revision. Thus the historical-date producer attribution is confirmed
  even though the entire workspace source is not the same build.
- Methods: public build/readiness GETs; filtered deployment logs over a bounded
  six-hour window; aggregate-only read queries against the production read
  replica. No production app credentials or authenticated diagnostic session
  were used. All timestamps are UTC.

## Findings

1. **The published scheduler amplifies queue creation by date.** The
   build-bound `web-push` producer selects every `daily_sync` row and enqueues a
   job for each scope/date row. Its idempotency key contains the date and
   one-minute time bucket; scope is stored separately on the job. The production
   aggregate contained 70 rows: 66 dates before the UTC date, 1 on the UTC date,
   and 3 future dates. Among the 17,951 scheduled
   evaluations created in the preceding 24 hours, 16,852 had dates before the
   UTC date, 351 were for the UTC date, and 748 were future-dated. This confirms
   per-date job creation as a queue amplifier. The app's operational day is
   local/client-based, so a date before UTC midnight can still be a live local
   day; these aggregates do not identify exactly how many rows were truly
   historical for the facility. The job-creation pattern does not prove that
   those writes caused every database timeout.
2. **The backlog remains large and is concentrated in dates before UTC today.**
   At
   about 02:58 UTC, the aggregate status query found approximately 116.6k queued
   and 2 running scheduled evaluations, along with 448 succeeded, 321 failed,
   and 50 cancelled. In the queued date/age grouping, about 109.2k jobs referred
   to dates before the UTC date, including 104,348 created more than six hours
   earlier. This is a UTC-relative classification, not a claim that every one
   is outside the facility's live local day. The oldest queued creation
   timestamp was 2026-10-01 00:53 UTC. The date/age and status aggregates were
   separate read statements, so small count differences from concurrent worker
   activity are expected. No job rows or input/result values were returned or
   retained.
3. **The logs distinguish pool checkout waits from new-connection timeouts.**
   In the bounded six-hour deployment-log result, 35 entries contained
   node-postgres `pg-pool@3.14.0`'s exact
   `timeout exceeded when trying to connect` checkout-wait message. Another 66
   contained `Connection terminated due to connection timeout`, the separate
   new-client connection deadline. The source for the published lockfile
   version confirms those originate from different paths: the first times out
   a request waiting for an existing pooled client; the second wraps failure to
   establish a new client within `connectionTimeoutMillis`. This corrects any
   assumption that all current timeout logs represent one failure mode. The
   matching published DB configuration sets `connectionTimeoutMillis` to 900 ms
   and defaults each process pool to 10 clients unless `DATABASE_POOL_MAX`
   overrides it; the deployed override value was not observable.
4. **Connection refusals and database connection-limit errors were not observed
   in the same filtered six-hour log sample.** The read-only `server_job_attempts`
   aggregate showed 9 exact checkout-wait attempts (5 retrying, 3 cancelled,
   1 failed), and zero exact new-client-timeout, refusal/setup-code, or
   connection-limit-message attempts. These bounded results do not establish
   database headroom: the Replit production SQL tool reads a replica, not the
   app's live primary connection pool, and no effective Autoscale instance
   count, production pool maximum, current pool wait queue, or primary database
   connection ceiling was available. Therefore the underlying reason for pool
   exhaustion and any relationship to new-client timeouts remain unconfirmed.
5. **Optional background-worker degradation does not block core readiness in
   the published build.** `/api/readyz` returned HTTP 200 with status `ok`;
   `process`, `startup`, `database`, and `auditProtection` were `ok`, while
   `backgroundWorkers` was `warning`. An unauthenticated request to the
   manager-protected `/api/background-operations/diagnostics` route returned
   401; no manager session was obtained, and no credentials were requested or
   used.

## Correction and verification boundary

The checked-out scheduler now enqueues one job per distinct scope/time bucket
instead of one job per scope/date/time bucket. Each new job enumerates that
scope's dates and evaluates them in separate commits, preserving local-day
behavior and the former transaction size. The handler still accepts legacy
date-targeted jobs already in the queue. Focused regression coverage confirms
one enqueue per distinct scope and idempotency by scope/time bucket. Existing
queued production jobs were not cancelled, deleted, or rewritten. This
correction is in the checkout only: the published build identified above still
contains the per-date producer and must be republished by the owner before new
scheduled work is coalesced.

No pool-size, database, deployment, readiness, or production-data change was
made. Do not increase pool capacity until the effective per-process limit,
Autoscale maximum/current instance count, and actual database ceiling/reserve
are known. The logs prove both timeout classes occurred; they do not prove that
historical scheduling alone caused either one.


## Post-publish verification follow-up

- Captured: 2026-10-08, after the published build completed at 10:20:28.789 UTC;
  the aggregate query snapshot was 10:41:14.611 UTC.
- The active deployment reported a successful release build:
  - App build: `app-build:a3d3e838-87ab-4ad7-9301-8dc2d534daf1`
  - Published source fingerprint:
    `a0028555380e99766d502dccbe8754327fb75b7e39d08c3147270c1132029b18`
  - Published Git revision: `d173e1f8bbb0ea67f105b031e9c03d80f3b9cfa6`
    (`gitBinding: verified`)
  - Platform build: `7217e2f3-be6b-4544-ae39-4f2086beb132`
- The current checkout's independently computed source fingerprint and its
  prepared publish record both reported
  `5f6017a6a8addfa59e2ba3bde0492f9f49f1f373d9ff970717bdf44ae9028071`.
  This does not match the live fingerprint, so the checkout was not used as
  proof of the deployed implementation.
- A production read-replica aggregate-only `SELECT`, scoped to jobs created
  since the reported build completion, found 70 `daily_sync` rows in one scope
  (70 dated rows at most in that scope). During the 20m 45s observation window,
  63 scheduled-evaluation jobs were created. Their numeric idempotency-key
  suffixes formed 6 scope/time-bucket groups; the largest group contained 37
  jobs, and 3 groups contained more than one job. 59 of the 63 keys did not
  match the current checkout's scope/time-bucket key format. This violates the
  required one-job-per-scope/time-bucket condition.
- At the aggregate snapshot, scheduled-evaluation statuses were 115,944 queued,
  2 running, 29 succeeded, 8 failed, and 10 cancelled. This single snapshot
  does not establish the net backlog trend because workers may process jobs
  concurrently; it does establish that the newly published service continued
  producing multiple jobs for some scope/time buckets.
- Readiness shortly after publish returned HTTP 200 with `status: ok` while
  `backgroundWorkers` was `warning`; database, startup, and audit protection
  were `ok`. The subsequent readiness check returned HTTP 200 with all checks
  `ok`.
- No production job rows, scopes, inputs, or results were returned. No existing
  production jobs were deleted, cancelled, or rewritten; no production writes
  were performed.

**Initial post-publish outcome:** This first observation window did not meet the
scheduler criterion: the aggregate showed multiple scheduled-evaluation jobs
per scope/time bucket. A later platform build and observation window are recorded
below; this initial result is retained as rollout evidence and is not replaced
by the later sample.


## Second post-publish verification

- Captured: 2026-10-08, from the reported build completion at 15:56:34.756 UTC
  through the aggregate query snapshot at 16:19:17.425 UTC (22m 42.669s).
- The platform reported a new successful build:
  - App build: `app-build:a3d3e838-87ab-4ad7-9301-8dc2d534daf1`
  - Platform build: `91ef316e-f1ae-4b6a-afcc-2cd753f5d0c6`
  - Published source fingerprint:
    `a0028555380e99766d502dccbe8754327fb75b7e39d08c3147270c1132029b18`
  - Published Git revision: `d173e1f8bbb0ea67f105b031e9c03d80f3b9cfa6`
    (`gitBinding: verified`)
- The published source fingerprint remained different from the checkout and
  prepared publish record (`5f6017a6a8addfa59e2ba3bde0492f9f49f1f373d9ff970717bdf44ae9028071`).
  The observed production behavior below is therefore reported directly, not
  attributed to an exact source match.
- The production read-replica aggregate again found 70 dated rows in one scope,
  with at most 70 rows in that scope. In this window, 10 scheduled-evaluation
  jobs were created across 10 scope/time-bucket groups: maximum one job per
  group, zero duplicate groups, and zero keys outside the current checkout's
  expected scope/time-bucket format.
- Scheduled-evaluation status totals at capture were 110,929 queued, 2 running,
  55 succeeded, 18 failed, and 2 cancelled. The queued count was 5,015 lower
  than the earlier 10:41 UTC snapshot, but these snapshots span different
  platform builds and do not establish that the scheduler correction caused
  the net decrease.
- Readiness returned HTTP 200 with `status: ok` and all checks `ok`. In the
  earlier post-publish check, readiness returned HTTP 200 with
  `backgroundWorkers: warning` and core database/startup/audit checks `ok`.
- The aggregate did not return scope names, job keys, inputs, or results. No
  production jobs were deleted, cancelled, or rewritten; no production writes
  were performed.

**Outcome:** The latest observed production window satisfies the
one-job-per-scope/time-bucket criterion across 10 buckets while the scope has
70 dated rows. Readiness was healthy both with an optional worker warning and
with all checks healthy. The earlier duplicate-producing window and the
published-vs-checkout fingerprint mismatch remain evidence caveats; this
bounded sample confirms the later behavior but does not prove long-term queue
drainage or exact source identity.

## Evidence hygiene

Only build identity, health status, allowlisted error classes, aggregate counts,
date classes, and timestamps are retained. Raw logs, job inputs/results,
production records, recipe data, credentials, URLs with sensitive values, and
request payloads were not retained. All production SQL was read-only and
aggregate-only. No production writes or publish were performed.

## Follow-up live capacity capture

- Captured 2026-10-08 02:26:35–03:26:35 UTC from the published deployment.
  Deployment metadata confirmed a successful Autoscale deployment. Public
  `/api/build-info` returned the same app build, verified Git revision, platform
  deployment, platform build, and source fingerprint listed above.
- Public `/api/readyz` returned HTTP 200 with overall status `ok`; `database`
  was `ok` and `backgroundWorkers` was `warning`. No authenticated diagnostic
  route or production app credentials were used.
- Filtered deployment logs for that one-hour window contained 25 exact pool
  checkout-wait messages and 30 new-client connection-timeout messages. There
  were no matching connection-refusal/setup or database connection-limit
  messages.
- The same filtered log result contained 46 bounded `capacity_telemetry`
  records. Across those records, the observed pool total reached 10 clients,
  the maximum reported wait queue was 6, and 4 records had a nonzero wait
  queue. One record showed 10 total clients and 6 waiting. The production
  environment inventory contained no `DATABASE_POOL_MAX` environment entry or
  secret, and the published `.replit` run command does not set it; the current
  source therefore resolves the deployed pool maximum to its default of 10.
  This confirms pool saturation in at least one telemetry snapshot. The summed
  acquisition-error counter was 69 across 10,358 acquisition timing samples.
  The largest per-record acquisition p95/p99 were 21,600 ms and 22,401 ms,
  respectively. These acquisition durations substantially exceed the
  source-configured 900 ms timeout; they show delayed `pool.connect`
  completions, but do not independently establish that a database handshake
  itself lasted that long. Timer/event-loop delay or the measurement path needs
  separate corroboration.
- A read-only aggregate against the production read replica, limited to
  `server_job_attempts` started in the same one-hour period, found 3 exact
  checkout-wait messages and no new-client timeout, refusal/setup, or
  connection-limit messages. This receipt table is narrower than all database
  activity and does not contradict the deployment-log counts.

### Updated conclusion and remaining limits

The capture confirms that **the API pool saturated at its 10-client limit in
at least one snapshot**, with up to 6 waiting clients, and that new-client
connection timeouts also occurred. No explicit refusal or server
connection-limit error was observed in this window. The pool saturation is a
confirmed proximate cause of checkout waits; the separate establishment
timeouts remain unexplained and may or may not share that cause.

The production SQL interface reads a replica and cannot establish live-primary
connection headroom, `max_connections`, reserved slots, or other primary
clients. The deployment metadata identifies Autoscale but does not return the
current instance count. Replit documents active-instance and scaling
visibility in **Tools → Replit Cloud → Monitoring**
([Monitoring a deployment](https://docs.replit.com/features/publishing/monitoring-a-deployment));
that dashboard was not queried as part of this capture.

Therefore, the current evidence establishes process-pool saturation and
concurrent connection-establishment failures, but does not establish whether
the primary is at its connection limit or whether Autoscale fan-out multiplies
the per-process pool demand beyond available headroom. Before considering any
pool or deployment change, obtain the Autoscale instance count for the same
period and the primary connection ceiling, reserve, and baseline client usage.
No pool or deployment setting was changed.

Only timestamps, build identity, status checks, allowlisted error classes,
aggregate pool metrics, and bounded attempt counts were retained. Raw logs,
database rows, production payloads, and credentials were not retained.

## Queue trend confirmation

- Captured a follow-up aggregate snapshot at 2026-10-08 16:37:18.658 UTC.
  The public build-info check immediately before capture still identified the
  active release as:
  - App build: `app-build:a3d3e838-87ab-4ad7-9301-8dc2d534daf1`
  - Platform build: `91ef316e-f1ae-4b6a-afcc-2cd753f5d0c6`
  - Published source fingerprint:
    `a0028555380e99766d502dccbe8754327fb75b7e39d08c3147270c1132029b18`
  - Published Git revision: `d173e1f8bbb0ea67f105b031e9c03d80f3b9cfa6`
    (`gitBinding: verified`)
- This snapshot is compared only with the earlier 2026-10-08 16:19:17.425 UTC
  aggregate, which recorded the same app build, platform build, source
  fingerprint, and verified Git revision. The snapshots are 18m 1.233s apart.
- The read-only production aggregate found 110,876 queued, 2 running, 79
  succeeded, 31 failed, and 19 cancelled scheduled evaluations. Compared with
  the earlier snapshot, queued fell by 53; running stayed at 2; succeeded rose
  by 24, failed by 13, and cancelled by 17. Total jobs rose by 1, consistent
  with 54 terminal transitions and 1 new job.
- Across jobs created since the published build completed at 15:56:34.756 UTC,
  the aggregate found 11 new scheduled evaluations, all with the current
  scope/time-bucket key format. Grouping by stored scope and the numeric
  time-bucket suffix found 11 groups, zero duplicate groups, and a maximum of
  one job per group. The previous 16:19 snapshot had 10 new jobs across 10
  groups, also with zero duplicates and maximum one per group.
- The public readiness endpoint returned HTTP 200 with overall status `ok`;
  `backgroundWorkers` was `warning`, while database, startup, and audit
  protection were `ok`.
- Only aggregate counts and timestamps were retained. The query did not select
  job inputs/results, and its output did not include scope names or job keys.
  No jobs were cancelled, deleted, or rewritten; no production writes were
  performed.

**Outcome:** Two snapshots of the same published build show the queued backlog
decreasing while new evaluations remain capped at one per scope/time bucket.
This confirms a short-term net decline of 53 queued jobs over 18 minutes; the
backlog remains large, and this brief interval is not a reliable basis for a
completion-time estimate.
