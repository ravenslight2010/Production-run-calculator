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
current instance count. Replit documents request and resource charts in
**Tools → Replit Cloud → Monitoring**
([Monitoring a deployment](https://docs.replit.com/features/publishing/monitoring-a-deployment));
the documentation does not establish that an active-instance count is exposed.
That dashboard was not queried as part of the original capture.

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

### Additional dashboard review

- On 2026-10-08, two user-supplied Publishing dashboard screenshots were
  reviewed. They show CPU and memory utilization charts for “Past one day” and
  “Past one hour”; they do not show an Autoscale instance count, deployment
  maximum, or database connection metrics. The phone clock is visible, but the
  screenshots do not establish an exact UTC range for either chart.
- These screenshots therefore do not establish the active Autoscale instance
  count or primary database ceiling, reserved slots, or baseline client usage.
  No screenshot was copied into this report. The published build identity was
  independently rechecked against `/api/build-info` and still matches the
  build recorded above.


### Replit Monitoring request-peak capture

- Four later user-supplied Replit Monitoring screenshots, captured on
  2026-10-08 around 13:09 GMT-5 with the “Past one day” range, show uptime,
  request volume, HTTP statuses, request-duration distribution, and CPU/memory
  utilization. A visible HTTP-status tooltip is for Oct 8, 10:00 GMT-5 and
  reports two HTTP 200 responses. The request chart has visible bursts around
  early morning and about 11:00 GMT-5. The screenshots contain no active
  Autoscale instance count or database connection metrics; no raw screenshot
  was copied into this report.
- The published build had changed since the earlier capture. At
  2026-10-08 18:12 UTC, `/api/build-info` reported app build
  `app-build:a3d3e838-87ab-4ad7-9301-8dc2d534daf1`, Git revision
  `d173e1f8bbb0ea67f105b031e9c03d80f3b9cfa6`, platform deployment
  `411f3a0b-be0f-499a-9b85-b35deec43e5d`, and platform build
  `91ef316e-f1ae-4b6a-afcc-2cd753f5d0c6`. The current production environment
  inventory has no `DATABASE_POOL_MAX`; the published per-process pool max
  therefore resolves to the source default of 10.
- A bounded production-log capture for the post-build interval
  2026-10-08 15:56:34.756–17:00 UTC (10:56–12:00 GMT-5), which overlaps the
  visible late-morning request burst, returned 55 `capacity_telemetry` records.
  Pool total reached 10 and the wait queue reached 16; 12 snapshots had a
  nonzero queue. Filtered logs contained 54 exact pool checkout-wait matches
  and 66 new-client connection-timeout matches, with no explicit database
  connection-limit error.
- This confirms pool saturation during a Monitoring-visible request burst on
  the current build, but the logs do not identify the number of active
  Autoscale instances and do not expose primary database settings or total
  client usage.


### Usage dashboard review

- Two additional user-supplied screenshots dated 2026-10-08 around 14:28
  show hosting, traffic, and storage usage totals. Replit's
  [usage billing documentation](https://docs.replit.com/billing/about-usage-based-billing)
  identifies compute units, requests, compute hours, and GiB-months as usage
  measures, not simultaneous instance or database-client counts. Several
  resource labels and the reporting-period selector are cropped, so unlabeled
  quantities were not assigned meanings.
- Accumulated usage cannot establish peak concurrency, primary connection
  limits, or reserved slots. Billing quantities and raw screenshots were not
  copied into this report.


### Access review before production collection

- The Replit documentation reviewed describes deployment Monitoring for
  requests, statuses, latency, CPU, and memory; database Monitoring for active
  queries and query performance; and Publishing settings for configuring
  machine capacity. Those documented views do not provide the required
  historical active-instance count or primary PostgreSQL connection settings.
  The supplied Monitoring screenshots add request and resource charts but
  still do not show instance counts or database connections.
- The available deployment metadata confirms Autoscale and build status, but
  has no active or peak instance count. A later bounded log lookup for the
  original 02:26:35–03:26:35 UTC window returned no capacity-telemetry records;
  the earlier captured aggregate remains the only retained log evidence for
  that window.
- The production SQL tool is read-only against a replica, not the app's live
  primary. At the time of these dashboard-only captures, app telemetry recorded per-process pool counts only;
  it does not expose the primary server's connection ceiling, reserved slots,
  or total client usage. No primary-capacity comparison can be made from
  replica results or CPU/memory charts.
- No pool or deployment settings were changed. This task remains incomplete
  until an authorized source provides the Autoscale count and primary
  connection ceiling, reserved slots, and baseline client usage for one
  matching high-load window.

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

## Additional short-window queue snapshot

- Captured a read-only production aggregate at 2026-10-08 16:48:18.744 UTC.
  Public build-info checks immediately before and after capture identified the
  same published release:
  - App build: `app-build:a3d3e838-87ab-4ad7-9301-8dc2d534daf1`
  - Platform deployment: `411f3a0b-be0f-499a-9b85-b35deec43e5d`
  - Platform build: `91ef316e-f1ae-4b6a-afcc-2cd753f5d0c6`
  - Published source fingerprint:
    `a0028555380e99766d502dccbe8754327fb75b7e39d08c3147270c1132029b18`
  - Published Git revision: `d173e1f8bbb0ea67f105b031e9c03d80f3b9cfa6`
    (`gitBinding: verified`)
  - Build mode: `release`
- The status aggregate found 110,837 queued, 2 running, and 172 terminal jobs:
  106 succeeded, 41 failed, and 25 cancelled. Compared with the matching-build
  16:37:18.658 UTC snapshot, queued fell by 39, running stayed at 2, and
  terminal counts rose by 43 (27 succeeded, 10 failed, 6 cancelled).
- Since the preceding 16:37:18.658 UTC capture, 4 scheduled evaluations were
  created in 4 scope/time-bucket groups: zero duplicate groups, maximum one job
  per group, and zero malformed keys. The 4 new jobs and 43 terminal
  transitions reconcile with the 39-job queue decrease.
- Across the two adjacent intervals on platform build
  `91ef316e-f1ae-4b6a-afcc-2cd753f5d0c6`, the observed queue decline was 53 in
  18m 1.233s (about 176 per hour), then 39 in 11m 0.086s (about 213 per hour).
  Combined, that is 92 over 29m 1.319s (about 190 per hour). This is a
  short-window observation only, not a full-day rate or completion estimate.
- The 10:41 UTC snapshot used the same app build ID and source fingerprint but
  a different platform build ID. It also precedes the 15:56 UTC platform build
  completion and is not included in the exact-platform-build rate above. The
  available captures do not identify representative busy and quiet periods,
  and the exact-platform-build observations cover only about 29 minutes.

Only aggregate counts, capture times, and build identity were retained. The
query did not select job inputs/results or return scopes or job keys. No
production jobs were changed. **The requested full-operating-day measurement
was not yet complete at this capture; the operating-day extension below adds
later evidence.**

## Operating-day extension

- Captured another read-only production aggregate at 2026-10-08 18:11:22.828
  UTC (13:11 Central). Public build-info before capture and deployment metadata
  confirmed a successful Autoscale deployment. The live identity remained:
  - App build: `app-build:a3d3e838-87ab-4ad7-9301-8dc2d534daf1`
  - Platform deployment: `411f3a0b-be0f-499a-9b85-b35deec43e5d`
  - Platform build: `91ef316e-f1ae-4b6a-afcc-2cd753f5d0c6`
  - Published source fingerprint:
    `a0028555380e99766d502dccbe8754327fb75b7e39d08c3147270c1132029b18`
  - Published Git revision: `d173e1f8bbb0ea67f105b031e9c03d80f3b9cfa6`
    (`gitBinding: verified`)
- The aggregate found 110,625 queued, 2 running, and 409 terminal scheduled
  evaluations: 228 succeeded, 108 failed, and 73 cancelled. Compared with
  16:48:18.744 UTC on the same platform build, queued fell by 212, running
  stayed at 2, and terminal counts rose by 237 (122 succeeded, 67 failed,
  48 cancelled).
- During that 1h 23m 4.084s interval, 25 jobs were created across 25
  scope/time-bucket groups: zero duplicate groups, maximum one job per group,
  and zero malformed keys. Across the platform build's lifetime since
  15:56:34.756 UTC, the aggregate found 40 jobs across 40 groups, also with
  zero duplicates and maximum one per group. The 25 new jobs and 237 terminal
  transitions reconcile with the 212-job queued decrease.
- On the exact platform build, adjacent interval net queue declines were:
  53 over 18m 1.233s (about 176 per hour), 39 over 11m 0.086s (about 213 per
  hour), and 212 over 1h 23m 4.084s (about 153 per hour). Across 16:19:17.425
  to 18:11:22.828 UTC, the net decline was 304 jobs over 1h 52m 5.403s
  (about 163 per hour). These observed interval rates give a cautious range of
  about 153–213 queued jobs per hour, not a completion estimate.
- The user-supplied Replit Monitoring screenshots show the past day's request
  activity, with visible bursts in the early morning and late morning and much
  lower activity around the 13:09 Central capture. They provide busy/quiet
  context, not queue counts. Queue aggregates on the same app build/source
  identity span 10:41–18:11 UTC (05:41–13:11 Central); this includes captures
  near the morning activity and a later low-activity period. The platform build
  ID changed between the 10:41 and 16:19 captures while the app build ID,
  source fingerprint, Git revision, and deployment ID remained the same.
  Therefore the full span is evidence for one published app/source identity,
  but rates are calculated only within the unchanged 16:19–18:11 platform
  build.
- The 10:41 and 16:19 status aggregates differ by a 4,987-job reduction in
  total rows, despite only a 5,015-job queued decline and 28-job net terminal
  increase. The available snapshots do not explain this total-row change, so
  that longer cross-platform interval is excluded from the drain-rate range.
- Only timestamps, build identity, health status, aggregate counts, and
  scope/time-bucket summary metrics were retained. The production queries did
  not return job payloads, scopes, or job keys. No production jobs were
  altered.

**Outcome:** Five aggregate snapshots across the same published app/source
identity cover the observed morning-to-early-afternoon operating window and
include busy and quieter periods indicated by the one-day Monitoring graphs.
Later snapshots on the current platform build show a net queue decline of
about 153–213 jobs per hour, while new work remained capped at one job per
scope/time bucket. The exact-platform-build sample is under two hours and the
earlier cross-platform total-row change remains unexplained; no backlog
completion estimate is supported.

### Verified identity and samples

Public `/api/build-info` now reports:

- App build: `app-build:5f2825e5-fc81-4663-84db-fab7acba18b5`
- Source fingerprint: `5f09805d0289452dd9b1ae5c186a98a66eca1d5621c2370b4282fcc982b00048`
- Git revision: `9ecc934673ae629a98c4a97d182d214855589d7c`, verified binding
- Platform build: `fcbdaa9d-75d4-4860-ba01-fddabed5a507`
- Completed: 2026-10-08 19:28:12.565 UTC

A bounded six-hour deployment-log query for capacity sample events returned
two `database_capacity_sample` records. Both match the live app build, source
fingerprint, and platform build, declare production, and report an interval of
300,000 ms. Raw logs, host identifiers, and production records were not retained.

| Capture (UTC) | Primary metrics status | Client backends | Limit | Known reserved slots | Estimated ordinary slots remaining | Sampled pool max / total / idle / waiting |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-08 19:34:58.241 | observed; collector reports primary verified | 12 | 450 | 4 superuser + 0 role-reserved | 434 | 10 / 9 / 1 / 0 |
| 2026-10-08 19:40:20.366 | unavailable; primary not verified for this sample | unknown | unknown | unknown | unknown | 10 / 5 / 0 / 0 |

The first sample's calculation is `450 - 4 - 0 - 12 = 434`. It includes the
diagnostic backend and reports complete state visibility. Provider-reserved
slots remain explicitly unknown, so 434 is an estimate after known PostgreSQL
reserves, not guaranteed usable provider capacity. The unavailable sample is
a coverage gap, never a zero-client observation. Primary verification is
attested by the production collector; no separate primary SQL session was used.


### Pressure between samples and conclusion

In the bounded post-build log interval 19:28:12.565–19:41:00 UTC, five
`capacity_telemetry` records and two exact checkout-timeout matches were
returned; no new-client-timeout match was returned by that filter. In
particular, the 19:37:22.942 UTC pool snapshot reports 10 total clients,
0 idle, and 20 waiting. Other returned snapshots reported no waiters.
The primary-capacity sample at 19:34:58 preceded this saturation, and the
next sample at 19:40:20 was unavailable. Thus the observed pressure has no
simultaneous successful primary-capacity measurement.

The deployed per-process pool maximum is directly reported as 10. Aggregate
potential pool demand is `10 × active API processes`, but active/maximum
Autoscale instances, processes per instance, and provider-reserved slots remain
unknown. The logs do not separate other-client baseline usage from application
usage. Neither a safe aggregate pool budget nor representative peak-load
headroom can therefore be established yet.

No pool or deployment setting was changed. The task remains incomplete pending
successful primary observations covering representative peak pressure and an
authorized Autoscale instance-count source for the same window. Retrieve the
scheduled production logs directly after the next peak window; manual upload
is not required. Preserve unavailable samples and sampling gaps in that review.


## Resumed production sample review — 2026-10-09

A bounded six-hour deployment-log query from 08:46:23–14:46:23 UTC returned
71 scheduled `database_capacity_sample` entries at a configured 300,000 ms
interval. Thirty-six contained verified primary observations and 35 reported
the primary metrics as unavailable. The unavailable entries were retained as
gaps, not interpreted as zero usage.

All 36 observed records match the then-live `/api/build-info` app build
`app-build:eef6e133-ec7a-4cd5-b47c-a38965fd6e44`, source fingerprint
`c0f5a1ffc54b5e581196a250160dbad99903d0c2e634d9bb3271bc7cfd685402`, and
platform build `872b8143-d006-4447-99d7-18c10cd1e726`. The live endpoint
reported no Git revision (`gitBinding: unavailable`), so no revision was
inferred.

Across those 36 observed samples:

- The primary reported `max_connections=450`, 4 superuser-reserved slots,
  0 role-reserved slots, and unknown provider-reserved slots.
- Total client backends ranged from 6 to 13. After known PostgreSQL reserves,
  estimated ordinary slots remaining ranged from 440 to 433.
- The collector-reported per-process pool maximum remained 10.
- Autoscale current and maximum instance counts were null in every sample.

The closest successful primary sample to the highest pool wait in this
six-hour window occurred at 2026-10-09 13:05:31.672 UTC: 12 client backends,
434 estimated ordinary slots remaining, pool total 9, idle 6, waiting 0.
At 13:07:14.073 UTC, the pool telemetry showed total 10, idle 0, waiting 13,
about 102 seconds later. No successful primary sample coincided with that
pool-queue peak. The sample does indicate substantial known-reserve database
headroom shortly before it, but provider reserves, other-client attribution,
and Autoscale process count remain unknown.

This improves the baseline and near-peak evidence but still cannot calculate
aggregate application demand (`10 × active processes`) or guaranteed primary
headroom. The task remains incomplete until a trustworthy Autoscale instance
count and provider-reserve treatment are established and a successful primary
sample covers representative peak pressure.
## Build-bound production capacity collection

The owner confirmed that production capacity collection is live and that
manual uploads are no longer needed. Its scheduled interval is five minutes
while an instance is running. This section supersedes the earlier lack of a
primary-capacity data source, but not the missing peak/Autoscale evidence.
