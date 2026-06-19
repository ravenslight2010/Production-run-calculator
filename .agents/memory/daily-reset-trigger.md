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

**How to apply:** keep the rollover logic in shared helpers used by both the
cold-start path and the live path so they can't drift. When importing RN's
`AppState`, alias it (`AppState as RNAppState`) — the mobile RunContext has its
own local `AppState` interface.
