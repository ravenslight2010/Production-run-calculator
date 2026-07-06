---
name: Daily-reset auth boundary
description: How stateless sessions are force-expired at the daily midnight reset, web+mobile.
---

Sessions are stateless HMAC tokens (30-day exp). "Stay logged in until the daily
reset signs everyone out" is enforced by a **session boundary** on today's
`daily_sync` row: a token whose issued-at predates the latest reset is rejected
server-side, so it applies to every device — not just the one that detected
midnight.

**The fence reads `dayState.resetBoundaryAt`, NOT `dayState.resetAt`.** These
diverged because `resetAt` is client-LOCAL-date keyed but the fence reads the
SERVER-UTC "today" row (`getSessionBoundaryMs` uses server `todayStr()`), while
writes/rollover key on the client's `?today=`. West-of-UTC user in the evening:
their local date is D-1 but the server is already on D, so their scheduled
"tomorrow" (D) IS the server's UTC today. `writeDayResetAt(future)` stamps
`resetAt=now` on that D row (harmless override for scheduling), but the fence read
that row and force-logged-out the whole shift ~2h early ("reset fires before local
midnight"). Fix: split the concern. `resetAt` still drives `protectRunValues`
wholesale-adopt (unchanged). A NEW server-derived `resetBoundaryAt` is the fence,
set by `applyResetBoundary` in `routes/sync.ts` ONLY when the written row's
`date === clientToday` (a genuine same-day reset); future/past writes never set or
advance it. Server-authoritative (ignores any client-echoed value). Repro test:
`sessionBoundary.integration.test.ts` "cross-UTC daily-reset fence".

**Server:** tokens carry `iat`; `verifyToken` returns `{ sub, iat }`. requireAuth
(now async) 401s when `boundaryMs > 0 && (iat + 1) * 1000 <= boundaryMs`. Boundary
comes from a short (~15s) in-memory cached read of TODAY's row only (never max
across rows — scheduling future days writes resetAt on FUTURE rows). The read
fails **open** (returns last cached) so a DB blip never mass-logs-out.

**iat is whole seconds, boundary is full-ms — fence on the WHOLE second.** `iat`
is `Math.floor(now/1000)`, but `resetAt` (the boundary) is `Date.now()` to the ms,
and the rollover stamps it at the moment the first device opens the new day (any
time of day, NOT local midnight). The naive `iat*1000 < boundaryMs` wrongly fences
a token issued in the SAME wall-clock second as — but just AFTER — the reset: the
fresh sign-in returns 200 + sets the cookie, then every following request 401s →
user silently bounced back to login with NO error (classic "sign in not working"
report; shows up in logs as a burst of rapid sign-in 200s then silence). Fix: fence
only when the token's ENTIRE issuance second precedes the boundary —
`(iat + 1) * 1000 <= boundaryMs` — so a token issued in the boundary's second is
never falsely rejected (≤1s slack on a once-a-day fence is harmless). Server-only
(both clients just react to 401s — no parity concern). Tests in
`sessionBoundary.integration.test.ts` forge explicit-`iat` tokens via `tokenWithIat`
to pin the same-second vs strictly-before cases.

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

**ONLY a real rollover may advance `resetAt`.** Because `resetAt` IS the boundary
(and `protectRunValues` treats a strictly-forward `resetAt` as a "true daily reset"
→ wholesale-adopt incoming runs), any OTHER write to today's live row that stamps a
fresh `Date.now()` resetAt force-signs-out everyone AND wipes the live day = an
"early daily reset" report. The Excel-import + schedule (editor/move) commit paths
used to stamp `Date.now()`; importing/scheduling a block dated TODAY (import allows
today; schedule editor defaults to `todayStr()`) tripped this. Fix: pure
`writeDayResetAt(targetDate, today, existingResetAt, liveResetAt, now)` in web
`utils.ts` — FUTURE target ⇒ `now` (override semantics, harmless: boundary reads
today's row only); TODAY target ⇒ `existingResetAt ?? liveResetAt ?? 0` (never
advance; 0 = no fence; treats stored 0 as real). Wired into all 4 home.tsx write
sites. **Rule for any new day-row write:** never pass `Date.now()` as resetAt for a
today-target — preserve the existing boundary. Mobile has the same latent bug
(parity paused; MOBILE TODO logged).
