# Battery & Performance — Deep Dive

**Supersedes the original pass below** with a code audit of every `setInterval` in the
web app, checked individually for tab-visibility handling and duplication. The audit
found an existing visibility-aware pattern (`useClock`), one persistent display timer
that does not use it, and five bounded retry countdowns that could reuse the same
pausing behavior.

## Scope Correction: This App Is Web-Only Now

Before anything else: `.agents/memory/web-mobile-parity.md` confirms the standalone
Expo/React Native mobile app was formally archived (`_archived/mobile`) — *"maintaining
an archived native client created stale routes, dependencies, and parity tests without
serving a current product target."* The product is a single responsive web app for
desktop, phone, and tablet browsers. So "battery saving across the app" means the web
app's behavior on phone/tablet browsers — there is no separate native codebase with its
own battery APIs (KeepAwake, native BatteryLevel, etc.) to audit here.

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

The audit found 13 `setInterval` calls across 8 files. Most are not clocks and should
not be forced through `useClock`, but two UI areas lack its visibility-aware behavior:

| File | Interval | Visibility-aware? | Notes |
|---|---|---|---|
| `hooks/useClock.ts` | 1s (live) / 10s (idle) | **Yes** | The model to follow |
| `components/InventoryTab.tsx` | 1s, **x5 separate call sites** | No | Bounded "retry in" timers; active only while `retryIn > 0` |
| `components/CanonicalRunViewCard.tsx` | 1s + 15s | No | Persistent while the card is mounted |
| `hooks/useHomeSyncCoordination.ts` | 60s | No (but low-frequency enough not to matter much) | Date-change reconnect check |
| `pages/home.tsx` | 60s | No (same) | Date rollover check |
| `pwaUpdateChecks.ts` | 30 min | Effectively yes (also checks on `visibilitychange`/`focus`) | Already fine |
| `fieldChecks.ts` | 120s | No (low-frequency, fine) | Signal flush |
| `operationalIntentOutbox.ts` | (lock renewal) | N/A | Different concern (lease renewal), not a UI ticker |

The `InventoryTab.tsx` intervals are conditional and self-terminating, so they are not a
standing battery drain. They can still continue briefly after the page becomes hidden
if a retry countdown is active. The stronger persistent candidate is
`CanonicalRunViewCard.tsx`: its 1-second age timer and 15-second refresh timer run for
the card's full mounted lifetime without checking visibility.

**Recommendation**: extract a lower-level
`useVisibilityAwareInterval(callback, delayMs, enabled)` hook from `useClock`. Apply it
first to `CanonicalRunViewCard.tsx`, then use it to remove the five repeated countdown
effects in `InventoryTab.tsx`. Each countdown should retain its own state and remain
disabled when `retryIn` is zero.

---

## Finding 2: Other Audited Timer Paths Need No Immediate Change

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
  plan), not interval-based polling. The audit found no repository evidence that a
  transport replacement is needed for battery performance.

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

## Finding 4: No Evidence Supports Replacing SSE

This app's traffic pattern uses occasional client writes and server-pushed updates.
The audit found no measured project need for bidirectional WebSocket transport and no
repository evidence that replacing SSE would reduce battery use. Keep SSE unless future
profiling identifies a transport-specific problem; do not justify a migration with an
unsupported generic battery comparison.

---

## Priority Order
1. **Visibility-aware display timers** (Finding 1) — start with the persistent
   `CanonicalRunViewCard` timers, then deduplicate the bounded Inventory retry effects
2. **Screen Wake Lock + Floor Mode** (Finding 3) — concrete, high-value, well-scoped
3. Everything else in the original backlog (lazy tab loading, service worker caching,
   virtual scrolling) remains reasonable but unaudited — sequence behind 1 and 2

## Code References
| File | Purpose |
|------|---------|
| `artifacts/run-calculator/src/hooks/useClock.ts` | The pattern to extract/reuse |
| `artifacts/run-calculator/src/components/InventoryTab.tsx` | 5 bounded retry countdown effects with no visibility check |
| `artifacts/run-calculator/src/components/CanonicalRunViewCard.tsx` | Persistent 1s + 15s timers with no visibility check |
| `artifacts/run-calculator/src/pwaUpdateChecks.ts` | Already-correct reference for a low-frequency, visibility-aware interval |
| `.agents/memory/web-mobile-parity.md` | Confirms web-only product scope |
| `artifacts/run-calculator/src/pages/home.tsx` (`floorModeEnabled`) | Where Screen Wake Lock would be wired in |
| `docs/sync-system-improvements-plan.md` | Owns compression/payload-size work — don't duplicate |
