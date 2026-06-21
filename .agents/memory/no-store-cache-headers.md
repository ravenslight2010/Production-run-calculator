---
name: no-store cache headers on shared GETs
description: Which JSON GET endpoints must send no-store, and why sync is the exception
---

Shared, frequently-edited JSON GET endpoints in `artifacts/api-server` must send
no-store via the `noStore(res)` helper (`src/lib/cacheControl.ts`) — it sets
`Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache` +
`Expires: 0`. Without it, browsers apply heuristic freshness and serve a stale
copy even on periodic/SSE-nudged refetches (the original production-rules bug).

Covered: production-rules, inventory (list/ledger/settings), roles
(/me, /users, /password-reset-requests), incidents (list/unreviewed-count/:id),
runs, and all learned-memory pools (photo/import/merge/spec-import aliases,
ai-corrections, fill-missing-values, denied-merges).

**Why sync.ts is intentionally NOT covered:** its SSE broadcast pushes the FULL
day-state payload to clients, so they never rely on a (cacheable) GET refetch to
see edits. Inventory's SSE, by contrast, broadcasts only a NUDGE
(`{type:"inventory"}`) — clients must refetch `/inventory`, so that GET *is* at
risk and needs no-store. Rule of thumb: SSE-pushes-full-payload → GET can cache;
SSE-pushes-nudge (or no SSE) → GET must be no-store.

**How to apply:** any new GET serving shared mutable data → call `noStore(res)`
at the top of the handler. Never call it on SSE endpoints (they set their own
streaming headers).
