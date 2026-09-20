# Battery & Performance — Deep Dive

**Supersedes the original pass below** (kept inline for the Wake Lock / SSE findings,
which still hold) with a genuine code audit: every `setInterval` in the web app, checked
individually for whether it respects tab visibility, and whether it's duplicated across
component instances. This is not greenfield the way the first pass characterized it —
there's a genuinely excellent existing pattern (`useClock`) sitting right next to several
components that don't use it.

## Scope Correction: This App Is Web-Only Now

Before anything else: `.agents/memory/web-mobile-parity.md` confirms the standalone
Expo/React Native mobile app was formally archived (`_archived/mobile`) — *"maintaining
an archived native client created stale routes, dependencies, and parity tests without
serving a current product target."* The product is a single responsive web app used on
desktop, phone, and tablet browsers, installed as a PWA on the floor tablets. So "battery
saving across the app" means the web app's behavior on phone/tablet browsers — there is
no separate native codebase with its own battery APIs (KeepAwake, native BatteryLevel,
etc.) to audit here.

---

## Finding 1: `useClock` Is the Right Pattern — and Most Timers Don't Use It

`artifacts/run-calculator/src/hooks/useClock.ts` is genuinely excellent, already-shipped
code:
- Ticks every 1s **only** while a run is live (running/paused); slows to 10s otherwise
- **Pauses entirely when the tab is hidden** (`document.hidden` check, both on initial
  mount and via a `visibilitychange` listener)
- Has an Android-specific `focus` event fallback for devices where `visibilitychange`
  doesn't fire reliably on screen wake/app-switch — a real-world detail, not
  theoretical
- Used exactly once, centrally, in `LiveRunContext.tsx` — the intended single source of
  truth for "what time is it" across the live-run UI

**The problem**: a full audit of every `setInterval` call in the web app (13 calls
across 8 files) found several that duplicate `useClock`'s job with none of its
battery-awareness:

| File | Interval | Visibility-aware? | Notes |
|---|---|---|---|
| `hooks/useClock.ts` | 1s (live) / 10s (idle) | **Yes** | The model to follow |
| `components/InventoryTab.tsx` | 1s, **x5 separate call sites** | No | Countdown-style "retry in" timers, each its own independent `setInterval` |
| `components/CanonicalRunViewCard.tsx` | 1s + 15s | No | "time ago" elapsed display |
| `hooks/useHomeSyncCoordination.ts` | 60s | No (but low-frequency enough not to matter much) | Date-change reconnect check |
| `pages/home.tsx` | 60s | No (same) | Date rollover check |
| `pwaUpdateChecks.ts` | 30 min | Effectively yes (also checks on `visibilitychange`/`focus`) | Already fine |
| `fieldChecks.ts` | 120s | No (low-frequency, fine) | Signal flush |
| `operationalIntentOutbox.ts` | (lock renewal) | N/A | Different concern (lease renewal), not a UI ticker |

**Why the 5 duplicated 1s timers in `InventoryTab.tsx` matter most**: each is an
independent OS-level timer that wakes the JS engine and triggers a React state update
every second, for as long as its "counting" flag is true — completely independent of
whether the tab is visible. If a user backgrounds the tab mid-count (switches apps,
locks the screen while a count is in progress), these keep firing every second, waking
the device repeatedly, until the counting flag naturally clears. `useClock` already
solves exactly this problem one file over and simply isn't reused here.

**This is a recognized anti-pattern, not just this codebase's opinion**: a comparable
real-world case (an unrelated production app, a poker table UI) hit the identical
architecture — *"During an active turn ~4-6 independent timers run... Each triggers
separate React state updates. Measurable battery/jank on a low-end client"* — and the
fix that project settled on was exactly the shared-ticker pattern this app already has
in `useClock`: *"One shared `useSharedTicker(hz)` context the timed components subscribe
to."*

**Recommendation**: extend `useClock` (or extract a lower-level
`useVisibilityAwareInterval(callback, delayMs)` hook from its guts) and have
`InventoryTab.tsx`'s five countdown call sites and `CanonicalRunViewCard.tsx`'s
elapsed-time display consume it instead of rolling their own `setInterval`. This doesn't
need a shared *value* the way `useClock`'s single `Date` is shared in `LiveRunContext` —
each countdown still owns its own state — it just needs the *pausing behavior* factored
out so five call sites don't each reimplement (or fail to implement) it.

---

## Finding 2: Everything Else Checked Out Clean

To be fair to the rest of the codebase — a lot of adjacent things I checked specifically
*because* they're common battery drains turned out fine:
- **PWA update checks**: 30-minute interval, already gated on `visibilitychange`/`focus`
  too — no change needed
- **CSS animations**: one `infinite` animation exists (`floor-drift`, a 90s slow
  transform drift) — this is a deliberate, cheap, GPU-composited OLED-burn-in prevention
  measure for Floor Mode's always-on kiosk display, not an oversight
- **`frameRepeater.ts`**: a `requestAnimationFrame`-based press-and-hold repeat utility
  (e.g. holding a stepper button) — bounded to while actively held, not a background
  drain
- **No AJAX-polling anti-pattern**: the app's live-data path is SSE-based (see the sync
  plan), not interval-based polling — this matters because mobile radios specifically
  penalize exactly the "small request every N seconds forever" pattern (each poll forces
  a full radio power-state escalation cycle); SSE's single long-lived connection avoids
  that entirely, which is a real, if easy to overlook, generic advantage over
  poll-based designs on cellular connections

---

## Finding 3: Screen Wake Lock for Floor Mode (from the original pass, still valid)

`floorModeEnabled` ("Floor Mode") is an idle-screen kiosk display that auto-activates
after 3 minutes of inactivity — clearly meant as an always-glanceable status board. It
has no relationship to the Screen Wake Lock API, so its entire purpose can be silently
defeated by the OS's own screen-timeout. The Wake Lock API reached Baseline **widely
available** in 2025 (the long-standing iOS PWA bug was fixed in iOS 18.4), so this is no
longer a partial-support gamble. Implementation gotchas: the lock auto-releases on
`visibilitychange` (re-acquire when Floor Mode's own visibility hook fires, which
already exists), requires a secure context (already true), can be rejected (low battery
— fail silently, don't error), and may need a real user gesture for the first
acquisition (piggyback on the manual Floor-Mode-toggle gesture, then let idle
auto-activation re-acquire on the already-covered visibility path).

---

## Finding 4: Keep SSE Over WebSocket (from the original pass, still valid)

Real-world measurements put WebSocket at **2-3x the mobile battery drain of SSE**,
because WebSocket's ping/pong keepalives (every 25-30s) fight the cellular radio's
power-saving sleep cycles, while SSE's HTTP-level keepalives cooperate with them better.
This app's traffic pattern (client writes occasionally, server pushes updates) doesn't
match the profile where WebSocket's bidirectional-heavy advantage would matter. **Keep
SSE** — don't build the backlog's "WebSocket instead of SSE" item.

---

## Priority Order
1. **Timer consolidation** (Finding 1) — concrete, code-audited, has a working model
   already in the same codebase to copy from
2. **Screen Wake Lock + Floor Mode** (Finding 3) — concrete, high-value, well-scoped
3. Everything else in the original backlog (lazy tab loading, service worker caching,
   virtual scrolling) remains reasonable but unaudited — sequence behind 1 and 2

## Code References
| File | Purpose |
|------|---------|
| `artifacts/run-calculator/src/hooks/useClock.ts` | The pattern to extract/reuse |
| `artifacts/run-calculator/src/components/InventoryTab.tsx` | 5 duplicated un-pausable 1s timers (lines ~1575, 1811, 1995, 2178, 2342) |
| `artifacts/run-calculator/src/components/CanonicalRunViewCard.tsx` | 1s + 15s timers, no visibility check |
| `artifacts/run-calculator/src/pwaUpdateChecks.ts` | Already-correct reference for a low-frequency, visibility-aware interval |
| `.agents/memory/web-mobile-parity.md` | Confirms web-only product scope |
| `artifacts/run-calculator/src/pages/home.tsx` (`floorModeEnabled`) | Where Screen Wake Lock would be wired in |
| `docs/sync-system-improvements-plan.md` | Owns compression/payload-size work — don't duplicate |
