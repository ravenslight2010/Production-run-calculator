# Scheduled-check database latency investigation

## Scope and result

Read-only production investigation; captured on 2026-10-31 UTC. Evidence came
from the deployment investigation's supported state, build, revision-filtered
runtime-log and metrics callbacks. No production configuration, data, code,
notification, scheduler trigger, restart or Publish was performed.

**Confirmed:** database acquisition failures and slow queue-monitor reads are
current. Pool pressure and large event-loop delays coexist in the serving
process. The preceding successful build already showed these symptoms.

**Not established:** the ultimate cause of that pressure or the fraction due to
server SQL execution, connection establishment, locks, provider throttling or
host/runtime pauses. These are explicitly named measurement/access gaps, not
zero-valued measurements. Retention pagination is not implicated by this evidence.

## Authority, revision and capture

- Deployment metadata: published, public, Autoscale, successful build.
- Serving build/revision selected from the latest successful build listing,
  confirmed by build detail and exact revision-filtered runtime logs:
  `42763954-0c35-47c4-8b4b-6ea38c26deb1`.
- Build created: 2026-10-30T15:38:15.271Z; success/update timestamp:
  2026-10-30T15:45:55.440Z. These identify a platform build, **not a Git commit**.
  Exact serving Git/source mapping was not exposed and remains unknown.
- Primary log capture upper bound: 2026-10-31T00:26:33.807Z.
  Requested window: 00:16:33.807Z–00:26:33.807Z.
- Phase query: 49 records across three pages (page size 20), first log timestamp
  00:16:34.982Z, last 00:26:13.082Z. No remaining cursor, `truncated=false`.
  Queue query: 12 records; capacity query: 19 records; each one page,
  non-truncated, no remaining cursor. These counts cover the queried event
  categories and revision/window, not every operation in production.
- Prior successful revision: `fc0cae68-6711-46ff-8c01-9fa5d3fdfa87`,
  created 2026-10-30T15:22:28.836Z, updated 15:31:13.842Z.
  Its historical query covered 15:31:13.842Z–15:38:15.271Z on October 30.
  Its current-window phase query returned zero records.
- The original incidental observations had no supplied timestamps. This capture
  proves recurrence, not an incident start time or attribution of the original
  individual records.

## Bounded phase measurements

All 49 dedicated `background_database_phase` records had complete coverage:
no unobserved, multiple-checkout, incomplete, shutdown or missing coverage.
There were 39 successful post-checkout observations and 10 acquisition failures:
six `connection_timeout`, four `checkout_timeout`.

| Stage | Records | Outcomes | Acquisition max | Post-checkout max |
| --- | ---: | --- | ---: | ---: |
| `status_aggregate` | 9 | 5 success; 4 connection timeout | 10,799 ms | 4,500 ms |
| `duplicate_group_scan` | 5 | 5 success | 2,499 ms | 4,499 ms |
| `outbox_scope_list` | 18 | 14 success; 2 connection timeout; 2 checkout timeout | 31,899 ms | 33,301 ms |
| `outbox_cursor_read` | 17 | 15 success; 2 checkout timeout | 2,501 ms | 20,200 ms |

Across these logged phase records, elapsed p50/p95/max were
3,100/20,200/33,301 ms. Acquisition p95/max were 9,800/31,899 ms
(49 numeric observations); post-checkout p95/max were 20,200/33,301 ms
(39 observations). Percentiles use nearest rank over logged values, not a
provider histogram. The stage maxima are independent, not additive.

Queue-monitor events contained five slow samples (median 4,656 ms, maximum
13,501 ms), four unavailable transitions and three recovery transitions.
All four unavailable reads failed during `status_aggregate` acquisition with
the bounded `database-connection` classification; durations were about
5,000–10,800 ms. Logged successful-sample combined stage durations reached
10,201 ms for `status_aggregate` and 4,700 ms for `duplicate_group_scan`.
These include acquisition and scheduling; they are not pure query times.

Do not add modern queue-warning phase fields to dedicated phase counts: that
would count the same observation twice. Successful outbox records are sampled
by stage/category/minute, so this population is not an unbiased latency
distribution or an overall timeout rate. No `outbox_events_read` record appeared
in this bounded capture; that is not proof that the operation never ran.

## Pool pressure and runtime overlap

Nineteen capacity reports showed acquisition max 31,899 ms and worst report
acquisition p95 9,900 ms. Pool waiting count reached 21; total reached 10.
The latest snapshot had 10 total, zero idle and three waiting. These are
process-pool observations, not database backend totals or Autoscale capacity.

Ten reports included event-loop distributions; maximum delay was 28,102 ms,
with the worst report p95 5,901 ms. Two concrete interval comparisons:

| Phase interval, 2026-10-31 UTC | Histogram window, same date | Event-loop observation |
| --- | --- | --- |
| `outbox_scope_list`, acquisition timeout, 00:23:41.282–00:24:13.182; acquisition 31,899 ms | 00:23:19.382–00:24:19.682 | max 28,102 ms, p95 3,800 ms; phase interval wholly contained |
| `status_aggregate`, acquisition timeout, 00:23:11.982–00:23:22.782; acquisition 10,799 ms | 00:22:13.982–00:23:18.881 | max 26,407 ms, p95 2,934 ms; overlap 6,899 ms |

For each pair, equality of process envelope fields was checked within the
investigation; the identifying values are not retained. These are same-process
overlaps, not merely same-revision coincidences. A window maximum still does not
locate a pause precisely within a query or establish causation.

Runtime phase evidence also confirms a configured 900 ms acquisition deadline:
observed acquisition minus `timeoutOverrunMs` equals 900 ms in examples
10,799−9,899, 4,800−3,900, 6,700−5,800 and 9,800−8,900 ms.
Long observed waits therefore do not mean a configured multi-second deadline.
Delayed JavaScript timeout handling is plausible; the subtraction does not
identify what delayed it.

### Historical comparison

The preceding revision's October 30 window already contained 34 phase records,
six acquisition timeouts, four slow queue samples, two unavailable queue samples,
and event-loop maximum 21,307 ms. The latest build is not the symptom's onset.
This does not establish equal frequency across unequal windows or identify the
first affected build.

## Distinguishing hypotheses and gaps

| Layer | Supported conclusion | Unresolved distinction |
| --- | --- | --- |
| Pool checkout | Pool queueing and acquisition failures are real | Acquisition includes both waiter time and new-client setup; not a pure queue timer |
| Connection setup | Six exact connection-timeout classifications occurred | Network, authentication, provider availability and callback scheduling are not separated |
| Post-checkout | Successful operations can remain slow after checkout | Dispatch, network, SQL, response decoding and JS scheduling are combined; no server SQL execution measurement |
| Event loop | Large pauses overlap failing reads in the same process | No causal trace, GC profile, event-loop utilization or host scheduling evidence |
| Database locks | No authorized current measurement obtained | Unknown, not zero; no query/lock trace |
| Host/provider | Low aggregate resource use does not explain or rule out pauses | No exposed host contention/provider connection-latency metric; effective instance count and provider limits unknown |

Supported deployment metrics were queried for
2026-10-30T00:25:07.190Z–2026-10-31T00:25:07.190Z:
`http_request_count` sum 1,584; `http_request_latency` p95 394.42 ms;
`http_response_5xx_count` sum zero; `compute_cpu_utilization` p95 2.94%;
`compute_memory_utilization` p95 12.92%. Percentages refer to the allocated
limit. These are broad aggregate foreground/compute observations, not a
same-process explanation of background stalls. A current-window
`compute_instance_count` latest value of zero conflicts with current runtime
logs; do not infer zero serving instances or usable capacity from that gauge.

## Failure ledger and accountable next actions

| Status | Evidence / limitation | Owner and next action |
| --- | --- | --- |
| CONFIRMED | Current acquisition failures and multi-second monitor samples | Application maintainer: consider the separately approved, reversible trial below |
| BLOCKED measurement | Supported production `executeSql` rejected one aggregate-only SELECT with `Production database access requires an authenticated user.` No SQL result obtained | Production-access owner: authorize an authenticated supported production read-only session for aggregate-only measurements; never supply credentials in chat |
| MISSING measurement | Server execution/lock timing, provider connection timing and host pauses not exposed by available deployment metrics | Database/platform operator: provide a bounded same-window correlation, without records, SQL text or identities |
| MISSING provenance | Platform build known; exact Git/source mapping unknown | Build owner: supply independently prepared/sealed source identity before exact deployed-code attribution |
| UNRELIABLE measurement | Latest instance-count gauge zero despite current logs | Platform operator: reconcile metric resource/window scope; do not size pools from it |

The attempted SQL selected only current capture time, replica flag and aggregate
client-backend/active/wait/lock counts from `pg_stat_activity`; it requested no
query text, users, addresses, IDs or application records. The gateway rejected
it before results. Even a successful replica snapshot would not by itself prove
primary workload lock/query timing. Deployment calls succeeded; no fallback
runtime reader was needed. No access workaround or direct connection was tried.

## Reversible recommendation — not applied

1. First correlate a bounded failing interval with authenticated, authorized
   primary-side connection/setup, query and lock aggregates and runtime/host
   evidence. Keep replica provenance separate, and independently establish the
   effective instance count, pool limits and provider limits.
2. If a mitigation trial is authorized, implement an opt-in, bounded reduction
   of background database concurrency in an isolated/disposable environment.
   Coordinate the queue monitor, outbox and job work without changing alert
   claims, ordering, leases, cancellation, retries or idempotency. A per-process
   cap must not be advertised as a fleet-wide cap.
3. Compare acquisition errors, pool waiting, event-loop delay, queue age and
   throughput against an explicit baseline. Stop/revert the trial if backlog
   grows, work starves or alert timeliness worsens. Make reversal a flag/config
   rollback with no data migration. Any production trial is a separate approval,
   not authorized by this report.

Do not blindly raise pool size, lengthen the 900 ms deadline, add retries,
purge jobs, change retention, or roll back to the preceding build: the evidence
does not justify these actions and that build already exhibited stalls.

## Verification and sanitization

- PASS: current revision-bound logs, bounded pagination, phase coverage/count
  reconciliation, prior-revision comparison and same-process interval overlap.
- PASS: repository telemetry semantics checked against `webPush.ts`,
  `serverJobs.ts`, `databasePhaseTelemetry.ts`, `capacityTelemetry.ts` and
  `lib/db/src/index.ts`; local source is explanatory, not proof of exact deployed
  source.
- BLOCKED/MISSING: deeper measurements as recorded above; diagnostic deliverable
  is a bounded finding plus an explicit gap, not a proven ultimate root cause.
- Not applicable: desktop, phone, tablet portrait/landscape, Chromium,
  WebKit/Safari and physical Android/iOS/PWA checks. No UI or user journey changed.
- Not run: application tests, builds, workflow restarts and release gates;
  this change is a sanitized investigation report only, not a runtime change or
  production readiness assessment.
- Retained: build identity, fixed event/stage/outcome labels, aggregate counts,
  durations, capture windows and missing-access statement. Omitted: raw logs,
  process/host identities, credentials, request/notification payloads, SQL text
  from workloads, customer data and operational record identities.
