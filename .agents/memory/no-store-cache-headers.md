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
middleware and `cacheControlCoverage.test.ts` (which snapshots the exact set in
`KNOWN_SAFE_EXCLUSIONS` — update both together). Exclusion keys are route-pattern
strings (`:param` segments wildcard-match). Excluded: `/healthz`,
`/auth/username-available`, `/sync/events`, `/inventory/events`. **Everything
else GET — including the sync data GETs — is no-store.**

**The sync data GETs (`/sync/today`, `/sync/scheduled`, `/sync/:date`) are
deliberately NOT excluded** (they were, until a production incident). The old
"SSE pushes the full payload so the GET can be cached" theory was unsound:
- The SSE broadcast is scoped to `(scope + today's date)`. It NEVER pushes
  scheduled/future-day changes, so the scheduled list genuinely relies on the GET
  refetch — a cacheable response served a stale (empty) list.
- The cache key is the URL only (no scope/user). The seeded sandbox `test`
  account and a live account hit the same URL, so a shared cache can serve one
  scope's result to the other — a sandbox-isolation hole too.
- Symptom: a live user opened the published app and their schedule was EMPTY
  though future live rows existed; origin logs showed `/sync/scheduled → 304`
  (only that endpoint, because only it was cacheable).
no-store on these fixes it; the separate SSE stream still live-pushes today's row.

Inventory's SSE broadcasts only a NUDGE (`{type:"inventory"}`) — clients must
refetch `/inventory`, so that GET needs no-store. Rule of thumb after this
incident: **shared mutable data GET → no-store, full stop.** The only safe
exclusions are SSE streams (they set their own headers) and genuinely-public,
non-shared lookups (`/healthz`, `/auth/username-available`).

**How to apply:** no-store is middleware-owned now — `noStoreMiddleware` (mounted
first in `routes/index.ts`) stamps the triplet on EVERY GET automatically, so a
new shared-data GET needs NO per-handler action. Do NOT call `noStore(res)` in
handlers (the structural guard test fails on leftover calls). Only touch
`CACHE_CONTROL_EXCLUSIONS` to make a GET cacheable, and only for SSE streams or
genuinely-public non-shared lookups; update `KNOWN_SAFE_EXCLUSIONS` in
`cacheControlCoverage.test.ts` in the same edit.
