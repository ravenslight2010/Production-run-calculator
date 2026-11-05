# Pool acquisition telemetry review — 2026-11-05

## Provenance

- Environment: published production deployment
- Serving revision: `0c40774f-a2a5-4183-9fab-a8dd24ddda17`
- Deployment state: successful autoscale build
- Capture/review completed: `2026-11-05T15:24:06.816Z`
- Read-only source: revision-filtered deployment runtime logs, filtered to `capacity_telemetry`
- Requested interval: `[2026-11-05T03:38:44.528Z, 2026-11-05T15:16:32.724Z)`
- Evidence retained: minimized counts, timestamp bounds, and field-presence findings only; no raw log entries, payloads, identities, SQL, or request data
- The referenced `.local/tasks/task-3838.md` was not present in this checkout.

## Sample coverage

- Matching records fetched: 1,118 across 112 pages; no final page was truncated and no records failed parsing.
- Whole telemetry snapshots inside the requested interval: 1,116; two boundary snapshots were excluded because their observation windows were not wholly inside it.
- Included observation bounds: `2026-11-05T03:39:34.372Z`–`2026-11-05T15:16:20.796Z`.
- Gaps within the requested interval:
  - `03:38:44.528Z–03:39:34.372Z` — 49,844 ms
  - `05:44:40.271Z–05:45:12.707Z` — 32,436 ms
  - `15:16:20.796Z–15:16:32.724Z` — 11,928 ms
- All 1,118 query results had `event=capacity_telemetry`; the log query itself was filtered to the serving revision. The records did not independently carry a revision field.

## Findings

| Operation class | Attempts | Errors | Duration samples | p50 / p95 / p99 / max |
|---|---:|---:|---:|---|
| `auto_track` | unknown | unknown | unknown | unknown |
| `outbox` | unknown | unknown | unknown | unknown |
| `server_job` | unknown | unknown | unknown | unknown |
| `health_check` | unknown | unknown | unknown | unknown |
| `foreground_sync` | unknown | unknown | unknown | unknown |
| `unknown` | unknown | unknown | unknown | unknown |

The per-operation success/error counters and duration distributions were absent
from every checked record, including all checked counter and distribution key
paths. No alternate nesting was found.

Across the included snapshots, the generic `db.pool.acquisition_ms` distribution
contained 99,388 duration observations. They are unattributed to the six
operation classes; this does not establish that they belong to the explicit
`unknown` class. The generic `db.pool.acquisition_error.count` counter reported
15,969 errors across 771 snapshots. It was absent in 345 snapshots, so the
interval-wide error total is unknown.

Generic per-snapshot percentile summary ranges, in milliseconds:

- p50: 0–38,600
- p95: 0–41,600
- p99: 0–41,900
- max: 0–41,900

These are ranges of individual snapshot summaries, not pooled interval
percentiles.

## Limitations and conclusion

The requested operation-level comparison cannot be made from this sample.
Missing counters are not zero, and the generic acquisition observations cannot
be assigned to an operation class. Percentile summaries describe observed
checkout latency; they do not establish why waits occurred or prove that any
worker cadence, timeout, or pool size caused them.

No production data, runtime settings, or code were changed.
