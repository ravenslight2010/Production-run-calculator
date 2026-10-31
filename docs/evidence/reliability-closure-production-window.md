# Production stall observation — read-only

**Root cause — inconclusive.** Current revision-bound evidence confirms recurrent pool-acquisition failures, slow post-checkout operations, and event-loop delays in one ten-minute window. Their same-process overlap is correlation, not proof of cause; primary-side database timing and replica provenance remain unavailable.

**Capture/status —** Captured 2026-10-31T01:08:29.466Z. Requested window: **2026-10-31T00:58:29.466Z–01:08:29.466Z UTC**. Deployment is public Autoscale, successfully published at the official primary URL; current build status is success. Platform build/revision: `42763954-0c35-47c4-8b4b-6ea38c26deb1`, created 2026-10-30T15:38:15.271Z, updated 15:45:55.440Z. Build detail exposed no Git/source mapping.

**Evidence/impact —** Revision-filtered info-log queries were successful, non-truncated, with no remaining cursor. Among 52 complete phase records: 37 success, 8 `connection_timeout`, 7 `checkout_timeout`; acquisition max 23,899 ms, successful post-checkout max 27,101 ms. Sixteen capacity reports showed pool waiters up to 13 (pool total up to 10, idle as low as 0); acquisition histogram max 35,599 ms. Ten event-loop samples reached 19,915 ms max and 7,202 ms p95. Phase and capacity intervals overlapped 64 times on the same process; 54 overlapping event-loop histogram pairs included those delays. Queue monitor also recorded 3 slow samples (max 33,100 ms), 7 unavailable transitions, and 3 recoveries. These client/runtime measurements do not isolate database execution.

Aggregate metrics: 7 requests, latency p95 335.4 ms, 4xx 0; 5xx and application-error metric queries returned empty points (not zero). Latest instance gauge was 0 despite logs, so it does not establish topology. Endpoint metrics covered only `/__ready` (6 requests).

**Access gaps —** Supported production `executeSql` aggregate access remains denied with `Production database access requires an authenticated user.` No primary/replica flag, backend/lock aggregates, provider connection-setup timing, or server SQL timing was obtained; app telemetry cannot distinguish pool wait from connection setup. Historical baseline values are not treated as current evidence, and neither this capture nor the historical symptoms establishes causation. No files/config/data were changed; no jobs, notifications, restarts, or publish actions were performed.

This observation does not certify the repaired workspace revision or identify a causal fix. No deployment or infrastructure trial was enabled.
