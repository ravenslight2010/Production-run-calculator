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
