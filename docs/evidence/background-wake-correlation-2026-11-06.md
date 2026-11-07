# Background activity and wake-delay correlation

## Conclusion

**Background pool pressure was severe, but a link to a user-visible wake failure
was not established.** No schedule, pool-size, or timeout change is recommended
from this evidence.

The read-only production investigation found co-occurring database acquisition
delays, elevated pool waiters, event-loop delay, auto-track failures, and slow
background phases during **2026-11-06 23:35–2026-11-07 00:00 UTC**. However, the
available owner reports and server records do not provide exact wake intervals
or an active-run/no-run marker for those intervals. Same-window pressure does
not prove that a specific background job caused a phone's wake delay.

## Scope and evidence handling

- Environment: published production, autoscale; deployment metadata reported a
  successful build.
- Runtime-log query coverage: **2026-11-04 00:00–2026-11-08 00:00 UTC**
  (end-exclusive), split by day, with a focused **2026-11-06 23:35–2026-11-07
  00:00 UTC** review in five-minute slices.
- The focused query returned 129 `background_database_phase`, 38
  `capacity_telemetry`, 5 `database_capacity_sample`, 21 queue-monitor, and 14
  auto-track records. The broader phase/capacity/database-sample/queue queries
  were truncated, so they do not establish complete daily coverage. Auto-track
  logs were not truncated; the available Nov 7 records only extend to 05:33
  UTC.
- Only bounded structured records and aggregate endpoint metrics were used.
  Request bodies, sync payload values, user identities, credentials, and
  operational records were not inspected or retained.
- Runtime records did not consistently match the provider's latest successful
  build identity; broader Nov 6 samples showed two runtime build identities.
  The focused logs exposed one host/process pair, but instance-count evidence
  was absent. Fleet-wide coverage and exact source-to-runtime identity are
  therefore unverified.

## Focus-window findings

| Signal | Observation | What it establishes |
| --- | --- | --- |
| Background database phases | 27 acquisition timeouts: 16 queue-monitor `status_aggregate` checkout timeouts; 7 outbox `outbox_scope_list` connection timeouts (maximum 30.4 s); 3 scope-list checkout timeouts; and 1 cursor-read checkout timeout. Successful outbox scope reads also reached 31.6 s after checkout. | Background database operations experienced long waits. These are bounded phase timings, not PostgreSQL execution-only time. |
| Pool and event loop | In 38 capacity reports, pool total was 4–10; latest waiter snapshots were 0–13 and the within-window waiter maximum was 23. Event-loop p99 peaked at 37.9 s. Acquisition maxima were 43.9 s for `server_job`, 30.4 s for `outbox`, and 43.5 s for `unknown`. | App-side pool waiting and event-loop delay overlapped. The `unknown` class cannot identify a worker. |
| Database capacity samples | Five samples showed pool waiters up to 18, 0–1 active waiting PostgreSQL backends, and 433–439 ordinary connection slots remaining. | These sparse samples do not show exhausted PostgreSQL connection slots. They do not exclude short-lived waits between samples or identify a provider/pooler cause. |
| Auto-track | Ten `server_auto_track_tick` failure records and four tick summaries with durations from 12.2–40.6 s overlapped the focus window. | Auto-track activity overlapped the pressure window, but the records do not tie a tick to a specific failed checkout or wake. |
| Scheduled-evaluation queue | 16 `sample_unavailable`, 2 `slow_sample`, and 3 `monitor_recovered` outcomes. | Queue monitoring was affected during the same window; these outcomes are not unique job counts or proof that queued work caused the other waits. |
| `/api/sync/today` | Nov 6 aggregate: 1,256 requests, p50 424 ms, p95 1.45 s, p99 2.29 s, 19 4xx, and 0 5xx. The 23:55–00:00 bucket had 12 requests with p95 2.2 s. No route result was returned for the four preceding five-minute buckets. | Returned server endpoint metrics do not show minute-long route latency. They are aggregate and do not identify any reported browser request. |
| Cancellation | No `cancelled` outcome appeared in the focus-window database-phase records. | This does not establish whether a browser request was cancelled; the server phase records and browser lifecycle are separate evidence. |

The route implementation emits `Server-Timing` details for `PUT /sync/today`,
but not for `GET /sync/today`. The latter's aggregate deployment endpoint metric
is the only available server-latency comparison here; it does not provide a
per-request database phase or browser wait.

## Idle/no-run and active-run comparison

**Not established.** The owner reported no production run started during a busy
day on Nov 5 and reported wake problems more often during active runs on Nov 6.
Those are useful comparison clues, but they do not give UTC intervals that can
be aligned to the Nov 6 23:35–23:55 pressure window. The production records
reviewed here do not carry an active-run/no-run Boolean for each wake interval.
Consequently, this capture cannot compare idle/no-run and active-run wakes or
state that a particular tick, outbox drain, queue poll, or other job coincided
with a user-visible failure.

Browser elapsed wait and cancellation also remain separate from server
processing. A suspended browser can accumulate long elapsed time while the
server request completes quickly, and an aggregate route metric cannot identify
which side accounted for a particular wait.

## Recommendation and minimum next evidence

Do not change background cadence, pool size, or checkout timeouts on this
evidence. The server-side pressure is real and merits correlation, but a
targeted mitigation would be speculative without an aligned wake interval and
operation-level linkage.

The minimum useful next capture is a privacy-safe UTC interval for each
observed wake, with a Boolean active-run/no-run state and timestamps for
foregrounding, first sync request, response/cancellation, and canonical UI
adoption. Pair it with server-side `/api/sync/today` timing and bounded
background/pool/event-loop windows from the same interval. Do not add payloads,
run/user identifiers, or credentials. Also verify serving-build identity and
instance coverage before interpreting a future comparison.
