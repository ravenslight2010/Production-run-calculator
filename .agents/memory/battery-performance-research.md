# Battery & Performance — Research & Improvement Opportunities

## Current State — Genuinely Greenfield, With One Exception

Unlike sync/import/auto-track/AI, this section has essentially no existing
implementation to audit: zero `wakeLock`/`WakeLock` references anywhere in the web app,
no service worker caching, no adaptive polling logic found. The backlog's "Ideas only"
status is accurate here, not stale — this is genuinely still to be built.

**The one exception, and it's a real, specific, actionable gap**: `floorModeEnabled` /
"Floor Mode" already exists (`artifacts/run-calculator/src/pages/home.tsx`) — an
idle-screen "big numbers" kiosk display that auto-activates after 3 minutes of no
activity, clearly intended as an always-glanceable production-floor status board. It has
no relationship to the Screen Wake Lock API today. That means Floor Mode's entire
purpose — a screen a manager can glance at across the room — can be silently defeated by
the OS's own screen-timeout dimming/locking the display mid-session, since nothing tells
the browser to keep the screen on while Floor Mode is active.

---

## Priority 1: Wire Screen Wake Lock into Floor Mode (new, concrete, high-value)

**What**: request a screen wake lock the moment Floor Mode activates, release it when
Floor Mode deactivates (manual dismiss, or activity resumes).

**Why now, specifically**: the Screen Wake Lock API reached Baseline **widely available**
status in 2025 (Chrome 84+, Firefox 126+, Safari 16.4+, and — critically for this app's
likely iPad/tablet floor devices — the long-standing iOS PWA bug was fixed in iOS 18.4).
It's no longer a partial-support gamble.

**Implementation gotchas from current documentation** (worth building against, not
discovering the hard way):
- The lock is **automatically released whenever the tab loses visibility** (backgrounded,
  screen locked by the user, tab switched) — Floor Mode's own activation logic already
  hooks visibility/idle state, so re-acquiring on `visibilitychange` when the page becomes
  visible again is a natural fit for code that's already there
- Requires a **secure context** (HTTPS) — already true given the Render deployment
- The request can be **rejected** (low battery, OS power-saving mode, user preference) —
  wrap in try/catch and fail silently; Floor Mode should degrade to "no wake lock" rather
  than error, since the dashboard is still useful even if the screen eventually dims
- Some browsers require a **user gesture** to request the lock — Floor Mode's own
  idle-activation is not itself a gesture, so the first activation may need to piggyback
  on the most recent real user interaction, or acquire the lock on manual
  Floor-Mode-toggle (a real gesture) and simply re-acquire on the idle auto-activation
  path where the API allows it

**Benefit**: closes a real gap between what Floor Mode is *for* (an always-visible status
board) and what it currently *does* (a display mode with no actual persistence
guarantee). This is the single most concrete, evidence-backed item in this whole section.

---

## Priority 2: Correct the Backlog's Own WebSocket Idea (research finding, not a build item)

The backlog lists "WebSocket instead of SSE — more efficient bidirectional sync" as an
idea under this section's own stated goal of **reducing battery drain**. Current
measurement-based research says the opposite: **real-world mobile measurements put
WebSocket at 2-3x the battery drain of SSE/HTTP-streaming**, because WebSocket's
ping/pong keepalives (every 25-30s) keep the cellular radio awake between messages, while
SSE's TCP-level keepalives and HTTP heartbeat comments cooperate with radio sleep cycles
far better. WebSocket only wins where the client sends *almost as often* as it receives
(chat-style, bidirectional-heavy traffic) — this app's sync pattern (client writes
occasionally, server pushes updates) doesn't match that profile.

**Recommendation**: drop this item from the battery-reduction goals entirely, or at most
reframe it as a separate "reduce per-message overhead" concern unrelated to battery (where
it's also not a clear win — see the sync plan's own delta-sync proposal, which reduces
payload size directly and composes with SSE as-is, addressing the actual bandwidth
concern without the keepalive battery cost). **Keep SSE.**

---

## Remaining Ideas — Already Reasonably Scoped, Just Sequence Behind the Above

The rest of the backlog's list (adaptive polling, lazy tab loading, service worker
caching, virtual scrolling) are standard, well-understood techniques without a specific
gap or correction to add here — they don't need external validation, they need
prioritization. Two sequencing notes:
- **Compression** (gzip/brotli) — don't build this independently; it's already Phase 3 of
  `docs/sync-system-improvements-plan.md`, explicitly deferred there pending delta sync's
  measured impact (delta sync may make compression's marginal benefit small). Cross-
  reference rather than duplicate.
- **Adaptive polling** — auto-track and sync already moved to server-authoritative
  push (SSE), not polling, per Section 13's completed server-side migration; confirm
  what's actually still polling today (if anything) before scoping this, since it may
  already be moot.

---

## Code References
| File | Purpose |
|------|---------|
| `artifacts/run-calculator/src/pages/home.tsx` (`floorModeEnabled`, idle-activation effect) | Where the Screen Wake Lock request/release would be wired in |
| `docs/sync-system-improvements-plan.md` | Owns the compression/payload-size work — don't duplicate |
| `.agents/memory/cross-channel-auto-track-claims.md` | Confirms auto-track is already server-tick-driven, not client-polling |
