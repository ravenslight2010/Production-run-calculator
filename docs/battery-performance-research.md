# Battery & Performance — Deep Dive

**Historical upstream audit:** captured on GitHub `main` at `8768ec88` and incorporated during the 2026-09-21 branch reconciliation.

**Current status:** implemented in the repository. Non-essential display timers use visibility-aware scheduling, and Floor Mode owns an optional Screen Wake Lock with safe fallback. This document remains the reviewed evidence that established the priorities; it is not proof of measured battery improvement on production devices.

## Scope Correction: This App Is Web-Only Now

The product is a single responsive web app for desktop, phone, and tablet browsers. Battery work therefore concerns browser behavior; there is no supported native client to optimize.

## Finding 1: `useClock` Is the Right Pattern

`artifacts/run-calculator/src/hooks/useClock.ts` is the established visibility-aware pattern:

- it ticks every second only while a run is live and slows while idle;
- it pauses when the tab is hidden;
- it resumes through visibility and focus handling; and
- `LiveRunContext.tsx` uses it as the shared live clock.

The upstream audit found persistent display timers and bounded retry countdowns that did not consistently use the same hidden-tab behavior. The durable recommendation is to share one visibility-aware interval primitive while keeping operational lease renewal and low-frequency date checks separate.

## Finding 2: Other Timer Paths Were Not Immediate Battery Risks

The audit found no general AJAX polling loop and no evidence that the following needed immediate replacement:

- PWA update checks already combine a low-frequency interval with visibility/focus checks.
- The slow Floor Mode drift animation is a deliberate OLED-burn-in mitigation.
- Press-and-hold repeat animation is bounded to active user input.
- Operational lease renewal is correctness work, not a display ticker.

## Finding 3: Screen Wake Lock Belongs to Floor Mode

Floor Mode is intended as an always-visible status board, but browser and operating-system screen timeout can defeat that purpose. Wake Lock should:

- be requested only while Floor Mode needs it;
- be reacquired after visibility returns;
- fail safely when unsupported or rejected;
- never block Floor Mode itself; and
- avoid claiming production support without real-device evidence.

## Finding 4: No Evidence Supports Replacing SSE

The application uses occasional client writes and server-pushed updates. No measured repository evidence shows that replacing SSE with WebSockets would improve battery life. Keep SSE unless profiling identifies a transport-specific problem.

## Priority Order

1. Visibility-aware display timers.
2. Screen Wake Lock while Floor Mode is active.
3. Measure real devices before broader battery claims or transport changes.

## Evidence Boundary

Repository implementation and tests can prove timer ownership, hidden-tab behavior, and Wake Lock fallback. They cannot prove battery-life improvement, published deployment topology, or device-specific operating-system behavior. Those require controlled real-device evidence.

## Code References

| File | Purpose |
|---|---|
| `artifacts/run-calculator/src/hooks/useClock.ts` | Existing visibility-aware clock pattern |
| `artifacts/run-calculator/src/contexts/LiveRunContext.tsx` | Shared live clock consumer |
| `artifacts/run-calculator/src/components/CanonicalRunViewCard.tsx` | Persistent display timers identified by the audit |
| `artifacts/run-calculator/src/components/InventoryTab.tsx` | Bounded retry countdowns identified by the audit |
| `artifacts/run-calculator/src/pwaUpdateChecks.ts` | Low-frequency visibility-aware reference |
| `artifacts/run-calculator/src/pages/home.tsx` | Floor Mode ownership |
| `docs/sync-system-improvements-plan.md` | Sync transport and payload work |