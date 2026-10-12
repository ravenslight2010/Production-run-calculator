# SSE Scale Verification

**Captured:** 2026-09-20T16:36:37Z  
**Local repository revision:** `cfa7d7eb7bb43bb5e6b585ba9c97d46b439f47fc`  
**Published revision:** unknown; the deployment service did not expose a revision identifier  
**Published environment:** active, successful, public Replit Autoscale deployment  
**Evidence boundary:** No credentials, cookies, authorization headers, users, recipes, production records, request bodies, response bodies, SSE frame contents, or production identifiers were retained.

## Published probe

The authenticated probe used the published HTTPS origin, two concurrent SSE clients, one no-op write of the already-canonical state, an idle heartbeat wait, and a reconnect. It discarded all payloads after classifying each frame in memory.

| Observation | Result |
|---|---|
| Sign-in status | 200 |
| Stream A headers | 200 in 140 ms; `text/event-stream`; `no-cache`; chunked; `via: 1.1 google`; `server: Google Frontend` |
| Stream B headers | 200 in 194 ms; same allowlisted headers |
| Initial frames | complete baseline on both streams |
| Synthetic no-op write | 200 in 219 ms |
| Peer frame after write | complete frame on both streams at 1,846 ms from probe start |
| Idle heartbeat | comment frame; 14,180 ms after the preceding frame |
| Reconnect | headers and complete initial baseline in 146 ms |
| Close category | client abort |
| Total bounded probe time | 16,174 ms |
| `content-encoding`, `connection`, `x-accel-buffering` | not present in the observed response |

This sample verifies prompt unbuffered-enough delivery, a heartbeat below the observed idle interval, two simultaneous streams, a peer write, and complete reconnect recovery for the requests that were routed during the sample. It does **not** prove cross-instance delivery: the platform exposed no instance identity, affinity result, or control that could force the streams and write onto different serving instances.

## Deterministic two-process fixture

`sync.convergence.integration.test.ts` now starts the real sync router in a second OS process against the same disposable PostgreSQL database:

1. A peer stream connects to process B and receives a complete initial frame.
2. A normal sync write enters process A.
3. Process B receives no peer data frame during the bounded observation window.
4. The stream reconnects to process B.
5. Process B reads the shared database and sends a complete initial frame containing the canonical write.

Command:

```text
pnpm --filter @workspace/api-server exec vitest run src/routes/sync.convergence.integration.test.ts --reporter=verbose
```

Result: 3 tests passed, including the cross-process boundary and complete reconnect recovery case.

## Decision

The current Autoscale topology is not sufficient evidence for instantaneous peer delivery because:

- Replit documents that Autoscale can add serving instances.
- The application registry and broadcast loop are process-local.
- The deterministic fixture proves a process-B stream misses a process-A write.
- The published sample cannot establish whether its successful requests shared one instance.

If Autoscale remains able to serve this application from more than one process, **shared fanout is required** for prompt peer updates. Shared fanout must remain only a notification path; the complete database-backed initial/reconnect snapshot stays authoritative because any at-most-once bus can lose messages.

The alternatives are an explicit, verified single-serving-process constraint or an always-on single-server topology such as Reserved VM. Replit documents Reserved VM as dedicated and always running, but a target change would still require the same sanitized stream probe; “always on” alone is not an SSE correctness guarantee.

No heartbeat, proxy-header, or deployment-target change is justified by this probe. The observed heartbeat and frame delivery were prompt, and `X-Accel-Buffering` should not be added without evidence that buffering is occurring.

## 2026-10-11 production capacity recheck

The current deployment metadata reports an active Autoscale deployment with a
successful build. The owner confirmed the configured maximum is three machines;
the deployment metadata and logs do not expose actual current/peak serving
process counts. The configured run command starts one Node API process per
machine, and the live pool maximum is 10.

A sanitized allowlist-only review of 101 samples from 2026-10-10T20:35:03Z
through 2026-10-11T04:58:48Z found 35 primary observations and 66 unavailable
capacity results. Successful primary samples reported `max_connections=450`,
four known reserved slots, 6–13 client backends, and a per-process pool maximum
of 10. Across the samples, pool waiters reached 16, with waiters present in 12
samples. A read-only production-replica snapshot at 2026-10-11T13:57:46Z
reported the same 450 connection limit, four superuser-reserved slots, zero
role-reserved slots, and three client backends; it is not a primary or peak
measurement. The configured ceiling implies at most 30 API pool connections
against 446 ordinary PostgreSQL slots, leaving 416 for other clients before
provider limits. Peak non-API client counts and any tighter provider limit
remain unknown, so the observed remainder does not prove safe peak capacity.

The observation is retained in
[`../docs/evidence/sse-capacity-observation-2026-10-11.json`](../docs/evidence/sse-capacity-observation-2026-10-11.json).
The current isolated cross-process test also verifies explicit listener stop,
core `/api/readyz` behavior, graceful process shutdown cleanup, reconnect
recovery, retention-gap reconciliation, and notification-loss polling; its sanitized report is retained in
[`../docs/evidence/sync-peer-fanout-2026-10-11.json`](../docs/evidence/sync-peer-fanout-2026-10-11.json).
These disposable-database tests do not replace deployment-bound capacity
evidence. Keep live peer SSE **NOT SUPPORTED** until the remaining database
client/provider constraints are measured over representative peak demand.

The offline capacity-report command can summarize sanitized
`database_capacity_sample` JSONL logs and a separate Replit-metrics file:

```bash
pnpm --filter @workspace/scripts run sse-capacity-report -- \
  --samples /path/to/sanitized-capacity-samples.jsonl \
  --platform /path/to/sse-capacity-platform-metrics.json
```

Use
[`../docs/evidence/sse-capacity-platform-metrics.template.json`](../docs/evidence/sse-capacity-platform-metrics.template.json)
for the input shape. The database-client peak is computed from complete primary
samples. The verified deployment fingerprint, process count per machine, peak
active-machine count, provider limit/reservations, and representative-window
confirmation remain Replit evidence until a supported metrics source is
available. Missing evidence stays `UNKNOWN`; this tool does not change
deployment settings or enable peer SSE.
