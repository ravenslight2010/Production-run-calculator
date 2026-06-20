---
name: Daily reset / session boundary trigger model
description: How the midnight daily reset is detected and enforced, and the parity rule between web and mobile triggers.
---

# Daily reset trigger model

The daily reset (clear prior day's run + force everyone to re-auth for the new
production day) is **client-driven at the device's LOCAL midnight**, not server
scheduled.

- A client detects the rollover by comparing the stored day-string to
  `todayStr()`, then archives the prior day, resets to one empty run, stamps
  `resetAt` (= local midnight), and calls `forceSignedOut`.
- The server only *enforces* a boundary once some client pushes `resetAt` into
  today's `daily_sync` row: `requireAuth` 401s any token with `iat < resetAt`.
  If no client ever crosses midnight in-app, the boundary stays 0 and nobody is
  fenced — by design.

**Why client-driven:** no server timezone is configured (Replit prod is
typically UTC), so a server-computed midnight could sign the floor out at the
wrong wall-clock time. Local-midnight resetAt keeps it correct for the floor.

**Parity rule (the bug that bit us):** BOTH apps must detect the rollover on a
*live* timer, not just on load. Web uses `setInterval(60s)` + `visibilitychange`.
Mobile must mirror this with `setInterval(60s)` + an `AppState` `"active"`
listener — otherwise a tablet left open or merely backgrounded across midnight
never rolls over (prior run lingers AND, since no resetAt is pushed, the session
is never fenced so the user stays logged in). A cold-mount-only check is NOT
enough.

**The complementary trap (live-timer-only is also NOT enough on web):** the
rollover routine that carries `forceSignedOut` must ALSO run on mount. Web's
`loadDayState()` resets only the in-memory view on a stale date (no archive, no
persist, no `resetAt`, no signout); the real `checkDateRollover` ran only via the
60s interval / `visibilitychange`. So on a new-day cold start the archive +
resetAt-push + signout was deferred up to 60s — and once ANY device pushed today's
`resetAt`, the server 401 boundary bounced this device to login BEFORE its delayed
rollover ran. Symptom: "auto-logout fires but the reset never happens." Fix:
invoke `checkDateRollover()` once on mount inside its effect (mobile already rolls
over on its mount effect — this was a web-only parity gap).

**Do NOT stamp `freshDayState().resetAt` > 0.** The web sync guard is
`acceptRemoteDay = remoteDateOk && remoteResetAt >= localResetAt`. A brand-new /
empty web start has no rollover provenance, yet a non-zero local `resetAt` would
reject legitimate same-day remote payloads carrying `resetAt: 0` (e.g. mobile's
INITIAL_STATE) — blocking adopt-from-server and causing drift. Stale days are
already rejected by the DATE guard, so `resetAt` 0/absent is correct for a fresh
day; the on-mount rollover stamps its own `resetAt` when a real rollover occurs.

**How to apply:** keep the rollover logic in shared helpers used by both the
cold-start path and the live path so they can't drift. When importing RN's
`AppState`, alias it (`AppState as RNAppState`) — the mobile RunContext has its
own local `AppState` interface.
