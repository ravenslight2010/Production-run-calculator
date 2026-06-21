---
name: no-store cache headers on shared GETs
description: Which JSON GET endpoints must send no-store, and why sync is the exception
---

No-store is applied **automatically by `noStoreMiddleware`** (`src/lib/
cacheControl.ts`), mounted first in `routes/index.ts`. It stamps the triplet
(`Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache` +
`Expires: 0`) on EVERY GET response whose route is not in
`CACHE_CONTROL_EXCLUSIONS`. The rule is on-by-default — handlers no longer call
`noStore(res)` (the per-handler helper still exists but isn't used in routes).
Without it, browsers apply heuristic freshness and serve a stale copy even on
periodic/SSE-nudged refetches (the original production-rules bug).

`CACHE_CONTROL_EXCLUSIONS` is the single source of truth, consumed by both the
middleware and `cacheControlCoverage.test.ts`. Exclusion keys are route-pattern
strings (`:param` segments wildcard-match). Excluded: `/healthz`,
`/auth/username-available`, `/sync/today`, `/sync/scheduled`, `/sync/:date`,
`/sync/events`, `/inventory/events`. Everything else GET is no-store.

**Why sync.ts is intentionally NOT covered:** its SSE broadcast pushes the FULL
day-state payload to clients, so they never rely on a (cacheable) GET refetch to
see edits. Inventory's SSE, by contrast, broadcasts only a NUDGE
(`{type:"inventory"}`) — clients must refetch `/inventory`, so that GET *is* at
risk and needs no-store. Rule of thumb: SSE-pushes-full-payload → GET can cache;
SSE-pushes-nudge (or no SSE) → GET must be no-store.

**How to apply:** any new GET serving shared mutable data → call `noStore(res)`
at the top of the handler. Never call it on SSE endpoints (they set their own
streaming headers).
