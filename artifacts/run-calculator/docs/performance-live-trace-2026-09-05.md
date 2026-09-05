# Authenticated master-data live trace

Date: 2026-09-05  
Application: Production Run Calculator  
Environment: local artifact workflow (`http://127.0.0.1:26038`) with the API
workflow on port 8080  
Authentication: configured manager account; credentials are not retained  
Viewport: 390 × 844  
Trace method: fresh headless Chromium context, authenticated through the
visible sign-in form, recording only endpoint path, status, request count, and
UTF-8 response bytes for `GET /api/master-data/bootstrap`.

## Result

**PASS — the live trace matches the deterministic master-data polling
behavior.** The real catalog response was 464,534 bytes, rather than the
375-byte fixture used by the deterministic harness. The request/byte ratios
match the audit evidence: one shared request when active or resumed, no
master-data polling while idle or hidden.

| State | Observation window | Bootstrap requests | Response bytes | Status |
| --- | ---: | ---: | ---: | --- |
| Initial authenticated load | after sign-in, settled at 5.4 s | 1 | 464,534 | 200 |
| Active | 65.0 s | 1 | 464,534 | 200 |
| Idle | 65.0 s after the three-minute idle threshold | 0 | 0 | — |
| Hidden | 65.0 s | 0 | 0 | — |
| Resumed | 8.2 s after foreground/activity events | 1 | 464,534 | 200 |

During the 250-second active-to-idle lead-in, the shared observer refreshed at
approximately 60.2 s, 120.3 s, 180.4 s, and 240.5 s. Once the idle state was
established, the subsequent quiet window had no bootstrap request. Foreground
return produced one deduplicated refresh at approximately 0.25 s.

## Comparison with the deterministic harness

The reference evidence in
`performance-audit-2026-08-23.md` reports the following fixture-scaled
behavior:

| Session | Harness before | Harness after | Live trace |
| --- | ---: | ---: | ---: |
| Active, one 60 s interval | 5 / 1,875 bytes | 1 / 375 bytes | 1 / 464,534 bytes |
| Idle quiet window | 1 every 5 min / 375 per request | 0 / 0 | 0 / 0 |
| Hidden/background | 0 / 0 | 0 / 0 | 0 / 0 |
| First activity / foreground return | 5 / 1,875 bytes | 1 / 375 bytes | 1 / 464,534 bytes |

For the active and resumed windows, the equivalent old behavior would have
been five full live bootstrap responses (2,322,670 bytes). The observed
single-response behavior is therefore an 80% reduction in both requests and
response bytes, or 1,858,136 live response bytes avoided per such window.
The 65-second idle window is intentionally shorter than the old five-minute
poll interval, so it confirms the new quiet behavior without overstating a
longer baseline comparison.

## Operational-polling safety

The trace deliberately excluded `/api/sync/*`, SSE, factory-data, field-check,
notification, and other operational endpoints from the master-data byte
measurement. Those endpoints continued to appear in the browser trace during
idle and hidden windows; no live sync or operational polling configuration was
changed.

The only browser console entry was the expected signed-out/unauthorized
resource message during the auth transition. The API health check was
`200`/`ok` after the one transient startup database connection timeout
recovered. The focused deterministic check also passed:

```text
pnpm --filter @workspace/run-calculator exec vitest run src/masterData.test.ts
4 tests passed
```

The raw trace retained for this check contained only bounded metrics and was
not committed because it also included the full catalog byte count and
endpoint timing details. No request or response bodies, credentials, customer
names, or run values were retained.