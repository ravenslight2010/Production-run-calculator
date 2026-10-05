# Published background database investigation

## Scope and identity

- Captured: 2026-10-05, 10:48–10:54 UTC.
- Environment: the published Replit production deployment, Autoscale; deployment metadata reported a successful public build.
- Runtime identity: deployment `411f3a0b-be0f-499a-9b85-b35deec43e5d`, platform build `5b314468-63a6-409e-ab45-85d703ee08b8`, app build `app-build:0b3efdef-fd53-46a0-a469-274acdb3243d`.
- Published source fingerprint: `799efb31ed697fedfa5cb0f2aa8ca51038663c85bce6129122815b9d2f3be54a`.
- The published build reports `gitRevision: null` and `gitBinding: unavailable`. The local prepared publish source fingerprint (`0355673daa4676dbf03bde4c5b42078b592735ff890bb09d5e1f46ab8bf129d5`) does not match. Therefore the checked-out source is not evidence of the exact source used by this deployment.
- Methods: filtered published deployment logs; public `/api/build-info` and `/api/readyz` probes; bounded aggregate `SELECT` queries against the read-only production database. All times are UTC.

## Findings

1. **The published app is still seeing PostgreSQL connection-acquisition timeouts.** In filtered logs covering 2026-10-05 04:48:49–10:48:49 UTC, 36 matches contained node-postgres's exact message `timeout exceeded when trying to connect`; there were 77 timeout matches overall. The filtered set included 24 server-job-run and 24 web-push-schedule log matches. Matching log entries spanned 09:49:39–10:46:10 UTC. This is a pool checkout/connection-acquisition timeout, not evidence of a SQL statement timeout.
2. **This is intermittent, not a complete database outage.** At 10:50:50 UTC, `/api/readyz` returned HTTP 200 and core status `ok`; the database check was `ok`. `backgroundWorkers` was `warning`, with `web-push-schedule` reporting 5 failures in its five-minute window (threshold 3), last failure at 10:49:52 and last success at 10:36:49. `server-job-run` had recovered by that probe. The process remained able to serve requests.
3. **Durable scheduled work is substantially backlogged.** Production aggregates at about 10:52 UTC showed approximately 109.8k queued `scheduled-evaluation` jobs, 2 running, 12,619 succeeded, 4,876 failed with the bounded `handler_failed` code, 406 failed with `attempts_exhausted`, 1,560 cancelled, and 6 failed with `execution_timeout`. Queue-age buckets showed queued work older than six hours, with the oldest queue entries created on 2026-09-28. A separate 24-hour creation-window query found 12,216 newly created jobs still queued.
4. **The current workspace producer has a strong historical-work amplification risk, but its exact presence in this published build is unverified.** In the checked-out code, the web-push scheduler defaults to a one-minute cadence and walks every `daily_sync` row when creating jobs, using a fresh date-and-minute idempotency key. The read-only production aggregates showed 68 `daily_sync` rows: 63 past dates, 1 current date, and 4 future dates. At capture, queued scheduled evaluations comprised 101,078 jobs for 63 past dates, 2,019 for today, and 6,667 for 4 future dates. Repeatedly scheduling past dates is unnecessary historical work and a plausible source of sustained database pressure and queue growth. However, the local source fingerprint differs from the published fingerprint, so this code-path attribution is a strong hypothesis, not proof that this exact implementation is deployed.
5. **The immediate source of the acquisition delay cannot be separated into pool saturation versus slow/unavailable new connections from the available evidence.** The checked-out `lib/db` configuration uses a 900 ms `connectionTimeoutMillis` and a default per-process maximum of 10, overridable by `DATABASE_POOL_MAX`; the production override, pool `totalCount`/`idleCount`/`waitingCount`, database connection ceiling, and live Autoscale instance count were not available from these read-only observations. Replit Autoscale documentation confirms that it can add instances with concurrent traffic, multiplying per-process pools and worker loops, but does not establish the active production instance count.
6. Production `server_job_attempts` aggregates for the six-hour window classified 14 attempts with the exact PostgreSQL acquisition-timeout message: 8 retrying, 4 cancelled, and 2 failed. Other failures were not attributed to database access based on their error codes alone.

## Assessment and next step

**Confirmed:** the published deployment repeatedly hit database connection-acquisition deadlines, web-push scheduling crossed its sustained-failure warning threshold, and the durable scheduled-evaluation queue is heavily backlogged, predominantly for past dates.

**Not confirmed:** whether the underlying checkout deadline is caused by pool wait-queue saturation, slow connection establishment, or database-side connection availability; whether the workspace's all-date scheduler implementation is identical to the published source; and which job-level failures were caused by these database timeouts. No single log excerpt is treated as proof of those claims.

The next diagnostic should bind source to the published fingerprint and, over a matching time window, capture sanitized database active-query/connection metrics plus effective Autoscale maximum/current instances and the effective per-process pool limit. If the deployed source confirms the all-date producer, separately approve and implement a bounded scheduling fix; do not purge or rewrite the production backlog without explicit authorization. Do not increase pool size until database capacity and maximum instance count are known.

## Evidence hygiene and actions

Only allowlisted build identity, aggregate counts, bounded operation/error labels, health statuses, and timestamps are retained here. Raw logs, database rows, job inputs/results, request payloads, connection strings, environment values, and credentials were not retained. Production database access was read-only. No production writes, configuration changes, package changes, or publish occurred.
