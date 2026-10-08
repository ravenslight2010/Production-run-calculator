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

## Evidence hygiene

Only build identity, health status, allowlisted error classes, aggregate counts,
date classes, and timestamps are retained. Raw logs, job inputs/results,
production records, recipe data, credentials, URLs with sensitive values, and
request payloads were not retained. All production SQL was read-only and
aggregate-only. No production writes or publish were performed.
