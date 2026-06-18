---
name: Daily-reset auth boundary
description: How stateless sessions are force-expired at the daily midnight reset, web+mobile.
---

Sessions are stateless HMAC tokens (30-day exp). "Stay logged in until the daily
reset signs everyone out" is enforced by reusing the existing `resetAt` (ms) on
today's `daily_sync` row (`data.dayState.resetAt`) as a **session boundary**: a
token whose issued-at predates the latest reset is rejected server-side, so it
applies to every device — not just the one that detected midnight.

**Server:** tokens carry `iat`; `verifyToken` returns `{ sub, iat }`. requireAuth
(now async) 401s when `boundaryMs > 0 && iat*1000 < boundaryMs`. Boundary comes
from a short (~15s) in-memory cached read of TODAY's row only (never max across
rows — scheduling future days writes resetAt on FUTURE rows). The read fails
**open** (returns last cached) so a DB blip never mass-logs-out.

**Why PROCESS_START_SEC for legacy tokens (no `iat`):** treat their issued-at as
process start. On the introducing deploy, today's reset boundary was set in the
morning (< deploy time) so nobody is kicked immediately; the NEXT reset advances
the boundary past deploy time and they're signed out. Legacy tokens vanish within
a day (every sign-in mints an `iat` token). Caveat: a same-day server restart
moves PROCESS_START forward — only matters for the one transition day.

**Boundary is client-pushed:** the rollover (existing behavior) pushes the new
`resetAt` via the sync endpoints. The proactive logout MUST NOT break that push.
- Web: `forceSignedOut` = `setQueryData(["me"], null)` only — does NOT hit
  /auth/sign-out, so the cookie survives and the rollover's debounced push (whose
  timer has no unmount cleanup) still lands. Home is rendered only when authed, so
  there's no in-flight /me race; staleTime 60s blocks a focus-refetch re-login.
- Mobile: `forceSignedOut` keeps the token and sets a **`forcedOutRef` latch**.
  RunContextProvider sits ABOVE the auth gate, so its boot-rollover effect runs
  before AuthProvider's restore; restore's network `fetchMe` would otherwise
  resolve LAST and sign the user back in. The latch gates `setMe(user)` in BOTH
  the launch-restore and SSE `revalidate`; it's cleared in `applyToken(token)` on
  a real sign-in. The kept token lets the rollover push authenticate; the next
  request after the boundary cache expires 401s → full clear.

**Reactive 401 (non-triggering devices):** a 401 on any already-signed-in request
bounces to login. Web: `setUnauthorizedHandler` in `inventoryShared.api()`.
Mobile: `context/authEvents.ts` (`notifyUnauthorized`) called from
`inventoryShared.api()` AND `sync/client.ts` fetchToday/putToday. Both EXCLUDE
`/me` and `/auth/*` (those are probes / sign-in failures, not session expiry).

**SSE can't read HTTP status**, so on stream error both apps call `revalidate`
(web invalidates ["me"]; mobile fetchMe → 401 → clear) as a fallback bounce.
