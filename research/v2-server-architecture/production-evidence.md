# Sanitized V1 Production Telemetry Findings

**Environment:** Replit production
**Capture window:** 2026-11-09 6:33–6:49 PM America/Chicago (2026-11-10 00:33–00:49 UTC)
**Serving build:** `f022d86d-54e9-44e7-849f-26db90152ce0`
**Method:** Read-only, build-bound deployment telemetry review for the final V1 investigation
**Sanitization:** Only bounded timings, counts, outcomes, and build identity retained; no request bodies, operational rows, credentials, or customer payloads

## Findings

- The runtime reported `pool.max=10`. In the 00:33:59.380–00:34:59.681 UTC capacity window, pool total count was 10 at p50/p95/max, idle count p50 was 0, and wait count p95 was 14.
- A database acquisition phase for `outbox_scope_list` ran from 00:33:42.580 to 00:34:39.368 UTC and was recorded as 56,788 ms with `connection_timeout` and a 55,888 ms timeout overrun. Repository configuration is 900 ms; telemetry did not expose the production effective timeout directly.
- The overlapping event-loop histogram reported p50 20 ms, p95 39 ms, p99 300 ms, and max 37,917 ms. This overlap establishes serious event-loop delay but does not correlate its maximum to the individual acquisition.
- The nearest database-capacity sample was 00:35:20.658 UTC, about 41 seconds after the acquisition interval. It reported pool 5/10, idle 4, waiting 0, and an estimated 438 ordinary PostgreSQL slots remaining. It is not a capacity reading from the worst interval.
- Auto-track tick failures occurred near the pressure window. Later successful tick summaries still had long durations (77,898 ms and 119,597 ms); their internal phases were not sufficient to assign those durations to pool acquisition, SQL, or other work.
- In a later cleaner window, 00:47:59.888–00:48:59.889 UTC, acquisition p95/max were 8/108 ms and event-loop p95/max were 20/81 ms; a nearby auto-track tick completed in 508 ms.
- Process metadata did not provide a unique Autoscale instance identity, and the active/maximum serving-instance counts remain unknown. These readings do not prove that all records came from one process.

## Interpretation

The evidence confirms intermittent severe pool-checkout and event-loop stalls with recovery in a later window. It does not identify which background task or request caused the stalls, prove that database-wide capacity was exhausted, or establish a causal chain between pool waits and event-loop delay.
