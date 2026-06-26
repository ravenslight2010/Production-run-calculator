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
- Same bug also presents as "<field> isn't saving" (e.g. "cases needed isn't
  saving on schedule import / manual entry"): the PUT persists fine, but the UI
  re-reads through the cached GET and shows the stale copy. It tends to be
  reported via the most VISIBLE field (cases needed is on the schedule list).
  Before treating a "not saving" report as a write bug, DB-verify the write
  first (`executeSql({environment:"production"})`) — if the value is in the row,
  it's this cache bug, not a persistence bug.
no-store on these fixes it; the separate SSE stream still live-pushes today's row.

**no-store does NOT stop Express from returning 304.** Express emits an ETag for
JSON responses regardless of Cache-Control, and short-circuits to `304 Not
Modified` whenever a request carries a matching `If-None-Match` — the response's
`no-store` is irrelevant to that decision. So a client (or URL-keyed intermediary)
that still holds a pre-fix or cross-scope cached copy keeps revalidating and is
handed back its OWN stale body. This is why a "not saving" report can persist even
after no-store ships and even after a redeploy: origin logs keep showing
`/sync/scheduled → 304`. Fix: `noStoreMiddleware` ALSO deletes the conditional
request headers (`if-none-match`, `if-modified-since`) for non-excluded GETs, so
`req.fresh` is always false and the route always returns a fresh `200`. Stripping
the RESPONSE ETag would be too late — the 304 decision happens in Express's `send`
before `writeHead`. Locked in by an integration test (re-request with the prior
ETag must still be 200, not 304). Server-only change; no web/mobile parity impact.

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
