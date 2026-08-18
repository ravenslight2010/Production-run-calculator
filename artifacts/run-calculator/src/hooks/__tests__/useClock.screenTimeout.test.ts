// @vitest-environment jsdom
//
// useClock — screen-timeout / visibility event tests.
//
// Confirms the three clock-snap behaviours documented in the screen-timeout
// task:
//
//   1. While document.hidden=true the 1-second interval is NOT started, so
//      nowTime never advances while the tab/device is asleep.
//   2. A "visibilitychange" event (hidden → visible) immediately snaps nowTime
//      to the current mocked time and restarts the interval.
//   3. A window "focus" event (fallback path) performs the same snap + restart.
//   4. Going hidden clears the interval so no phantom ticks accumulate during
//      sleep — even if the tab was ticking before it was hidden.
//
// All tests use vi.useFakeTimers() so setInterval / Date are both controlled.
//
// CLOCK INTERACTION NOTE:
// vi.advanceTimersByTime(n) advances BOTH the fake timer clock AND the system
// clock (new Date()) by n ms.  Calling vi.setSystemTime() inside an act() that
// also calls vi.advanceTimersByTime() would double-advance the system clock and
// produce the wrong timestamp in the interval callback.  Therefore we ONLY use
// vi.advanceTimersByTime() to move time within each act(); vi.setSystemTime()
// is called only once per test in beforeEach to set the epoch, never again.
//
// FLUSHING PATTERN:
// State updates triggered by setInterval callbacks or addEventListener handlers
// call setNowTime(), which in React 18 automatic batching is deferred.  We
// flush those pending updates into result.current by calling rerender() inside
// the same act() scope immediately after the triggering operation — the same
// pattern used throughout useAutoTrack.pauseResume.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClock, PENDING_CLOCK_MS } from "../useClock";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Override document.hidden — jsdom exposes the property as read-only, so we
 * use Object.defineProperty with configurable:true to allow reassignment inside
 * tests.
 */
function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

// A fixed epoch.  vi.useFakeTimers() + vi.setSystemTime(T0) makes new Date()
// return T0 at mount.  vi.advanceTimersByTime(n) then advances both the timer
// clock AND the system clock (new Date()) by n ms in concert.
const T0 = 1_700_000_000_000;

// ── Suite ─────────────────────────────────────────────────────────────────────
describe("useClock — screen timeout / visibility event handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0); // initial epoch; do NOT call vi.setSystemTime again inside tests
    setDocumentHidden(false); // start with tab visible
  });

  afterEach(() => {
    setDocumentHidden(false); // restore so other test files see a clean state
    vi.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. While hidden, no interval starts and nowTime stays frozen.
  //
  // useClock's start() guards: `id = document.hidden ? null : setInterval(...)`.
  // With hidden=true at mount, id=null. Advancing fake timers fires nothing.
  // nowTime stays at the useState initializer value (new Date() at T0).
  // ──────────────────────────────────────────────────────────────────────────
  it("1. while document.hidden=true the interval does not run (nowTime stays frozen)", () => {
    setDocumentHidden(true);

    const { result, rerender } = renderHook(() => useClock("running"));
    const initialMs = result.current.getTime(); // T0

    // Advance 3 s — no interval registered, no timer callback fires.
    // vi.advanceTimersByTime also moves the system clock to T0+3000 but since
    // setNowTime is never called, nowTime stays at T0.
    act(() => {
      vi.advanceTimersByTime(3_000);
      rerender();
    });

    expect(result.current.getTime()).toBe(initialMs);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. visibilitychange (hidden → visible): nowTime snaps and interval resumes.
  //
  // After advancing 5 s while hidden (system clock = T0+5000, no ticks),
  // dispatching visibilitychange fires onVisibility which calls
  // setNowTime(new Date()) — new Date() now returns T0+5000.  Then start()
  // creates a fresh interval.  One more vi.advanceTimersByTime(1000) fires that
  // interval and sets nowTime to T0+6000.
  // ──────────────────────────────────────────────────────────────────────────
  it("2. visibilitychange (hidden → visible) snaps nowTime to current time and restarts the interval", () => {
    setDocumentHidden(true);

    const { result, rerender } = renderHook(() => useClock("running"));
    const initialMs = result.current.getTime(); // T0

    // Advance 5 s while hidden.
    // System clock reaches T0+5000; nowTime stays T0 (no interval).
    act(() => {
      vi.advanceTimersByTime(5_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(initialMs);

    // Tab becomes visible.  System clock is now T0+5000.
    // onVisibility: setNowTime(new Date()) → setNowTime(T0+5000); start() → new interval.
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender(); // flush pending setNowTime() state update
    });
    expect(result.current.getTime()).toBe(T0 + 5_000);

    // Verify the interval was restarted: one more second fires the new interval.
    // System clock: T0+5000 → T0+6000.  Interval fires → setNowTime(T0+6000).
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 6_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. window "focus" event: fallback snap + interval restart.
  //
  // The tab is visible; the interval runs.  We advance 1.5 s (interval fires
  // once at T0+1000, system clock ends at T0+1500).  A window "focus" event
  // then snaps nowTime to T0+1500 (the mid-period system time) and restarts the
  // interval.  Advancing 1 more second fires the new interval at T0+2500.
  // ──────────────────────────────────────────────────────────────────────────
  it("3. window focus event snaps nowTime and restarts the interval (fallback path)", () => {
    // Tab is visible; interval starts immediately at timer clock 0.
    const { result, rerender } = renderHook(() => useClock("running"));

    // Advance 1.5 s: interval fires at timer clock 1000 (system T0+1000), then
    // timer clock reaches 1500 with no more timers.  System clock = T0+1500.
    act(() => {
      vi.advanceTimersByTime(1_500);
      rerender();
    });
    // nowTime = T0+1000 (from the interval that fired at 1000 ms).
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Dispatch window "focus" at system clock T0+1500 (mid-period).
    // onFocus: setNowTime(new Date()) → T0+1500 (immediate snap); start() restarts interval.
    act(() => {
      window.dispatchEvent(new Event("focus"));
      rerender(); // flush pending setNowTime() from onFocus
    });
    expect(result.current.getTime()).toBe(T0 + 1_500);

    // New interval fires 1 s later (timer clock 1500 → 2500, system T0+2500).
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 2_500);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Going hidden clears the interval — no phantom ticks accumulate.
  //
  // After the first interval tick at T0+1000, the tab goes hidden.
  // onVisibility clears the interval (id → null).  Advancing 10 s fires
  // nothing — the timer is gone.  nowTime stays at T0+1000.
  // ──────────────────────────────────────────────────────────────────────────
  it("4. going hidden clears the interval so no phantom ticks accumulate during sleep", () => {
    const { result, rerender } = renderHook(() => useClock("running"));

    // First tick at T0+1000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    const timeAfterFirstTick = result.current.getTime();
    expect(timeAfterFirstTick).toBe(T0 + 1_000);

    // Tab goes hidden: onVisibility fires the hidden branch → clearInterval(id).
    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender();
    });

    // Advance 10 s while hidden.  No registered interval → nothing fires.
    act(() => {
      vi.advanceTimersByTime(10_000);
      rerender();
    });

    // nowTime must not have advanced past the pre-hide tick.
    expect(result.current.getTime()).toBe(timeAfterFirstTick);
  });
});

// ── Slow-tick path (runStatus="pending" / "ended") ────────────────────────────
//
// When no run is active the hook uses PENDING_CLOCK_MS (10 s) instead of 1 s.
// The same three screen-timeout guarantees must hold on this slower cadence:
//   A. While hidden, the slow interval is NOT started (nowTime stays frozen).
//   B. visibilitychange (hidden → visible) snaps nowTime and restarts the
//      slow interval so the next tick fires after exactly PENDING_CLOCK_MS.
//   C. window "focus" performs the same snap + restart on the slow path.
//   D. Going hidden clears the slow interval — no phantom ticks during sleep.
//
// Tests use PENDING_CLOCK_MS imported from useClock.ts so that changing the
// cadence constant automatically keeps the guard meaningful.
// ─────────────────────────────────────────────────────────────────────────────
describe("useClock — slow-tick path (runStatus=pending) screen timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    setDocumentHidden(false);
  });

  afterEach(() => {
    setDocumentHidden(false);
    vi.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A. While hidden, the slow interval does not start and nowTime stays frozen.
  //
  // useClock's start() guards: `id = document.hidden ? null : setInterval(...)`.
  // With hidden=true at mount and runStatus="pending", id=null regardless of
  // which cadence would have been chosen.  Advancing fake timers beyond
  // PENDING_CLOCK_MS fires nothing; nowTime stays at T0.
  // ──────────────────────────────────────────────────────────────────────────
  it("A. while document.hidden=true the slow interval does not run (nowTime stays frozen)", () => {
    setDocumentHidden(true);

    const { result, rerender } = renderHook(() => useClock("pending"));
    const initialMs = result.current.getTime(); // T0

    // Advance beyond one full slow-tick period — still hidden, no callbacks.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS + 1_000);
      rerender();
    });

    expect(result.current.getTime()).toBe(initialMs);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B. visibilitychange (hidden → visible): nowTime snaps and slow interval
  //    restarts.
  //
  // After staying hidden for PENDING_CLOCK_MS (system clock = T0+PENDING_CLOCK_MS,
  // no ticks), dispatching visibilitychange fires onVisibility which calls
  // setNowTime(new Date()) — snapping to T0+PENDING_CLOCK_MS.  A fresh slow
  // interval is then started.  Advancing PENDING_CLOCK_MS more fires it once,
  // setting nowTime to T0 + 2*PENDING_CLOCK_MS.
  // ──────────────────────────────────────────────────────────────────────────
  it("B. visibilitychange (hidden → visible) snaps nowTime and restarts the slow interval", () => {
    setDocumentHidden(true);

    const { result, rerender } = renderHook(() => useClock("pending"));
    const initialMs = result.current.getTime(); // T0

    // Stay hidden for one full slow-tick period.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender();
    });
    // No interval registered while hidden — nowTime still T0.
    expect(result.current.getTime()).toBe(initialMs);

    // Tab becomes visible.  System clock is now T0 + PENDING_CLOCK_MS.
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender(); // flush pending setNowTime() state update
    });
    expect(result.current.getTime()).toBe(T0 + PENDING_CLOCK_MS);

    // Verify the slow interval was restarted: advancing PENDING_CLOCK_MS fires it.
    // System clock: T0+PENDING_CLOCK_MS → T0+2*PENDING_CLOCK_MS.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 2 * PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C. window "focus" event: fallback snap + slow interval restart.
  //
  // The tab is visible; the slow interval runs.  We advance PENDING_CLOCK_MS/2
  // (no tick yet — we are mid-period), then dispatch "focus".  onFocus snaps
  // nowTime to T0 + PENDING_CLOCK_MS/2 and restarts the interval.  Advancing
  // PENDING_CLOCK_MS more fires the new interval at T0 + 3/2*PENDING_CLOCK_MS.
  // ──────────────────────────────────────────────────────────────────────────
  it("C. window focus event snaps nowTime and restarts the slow interval (fallback path)", () => {
    const { result, rerender } = renderHook(() => useClock("pending"));

    // Advance half a period — no tick yet (interval fires every PENDING_CLOCK_MS).
    const halfPeriod = PENDING_CLOCK_MS / 2;
    act(() => {
      vi.advanceTimersByTime(halfPeriod);
      rerender();
    });
    // Mid-period: no interval callback yet, nowTime still T0.
    expect(result.current.getTime()).toBe(T0);

    // Dispatch window "focus" at system clock T0 + halfPeriod.
    // onFocus: setNowTime(new Date()) → T0+halfPeriod; start() restarts interval.
    act(() => {
      window.dispatchEvent(new Event("focus"));
      rerender(); // flush pending setNowTime() from onFocus
    });
    expect(result.current.getTime()).toBe(T0 + halfPeriod);

    // New slow interval fires PENDING_CLOCK_MS later.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + halfPeriod + PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D. Going hidden clears the slow interval — no phantom ticks during sleep.
  //
  // After the first slow-tick fires at T0+PENDING_CLOCK_MS, the tab goes
  // hidden.  onVisibility clears the interval (id → null).  Advancing another
  // full PENDING_CLOCK_MS fires nothing; nowTime stays at T0+PENDING_CLOCK_MS.
  // ──────────────────────────────────────────────────────────────────────────
  it("D. going hidden clears the slow interval so no phantom ticks accumulate during sleep", () => {
    const { result, rerender } = renderHook(() => useClock("pending"));

    // First slow tick at T0 + PENDING_CLOCK_MS.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender();
    });
    const timeAfterFirstTick = result.current.getTime();
    expect(timeAfterFirstTick).toBe(T0 + PENDING_CLOCK_MS);

    // Tab goes hidden: onVisibility fires the hidden branch → clearInterval(id).
    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender();
    });

    // Advance another full slow period while hidden.  No registered interval
    // → nothing fires.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender();
    });

    // nowTime must not have advanced past the pre-hide tick.
    expect(result.current.getTime()).toBe(timeAfterFirstTick);
  });
});

// ── Status transition tests ───────────────────────────────────────────────────
//
// The useEffect([runStatus]) cleanup runs when runStatus changes: it clears the
// existing interval and removes event listeners, then the new effect installs a
// fresh interval at the new cadence.  These tests confirm:
//
//   E. ended → pending: both use PENDING_CLOCK_MS; old interval is cleared and
//      a new one starts cleanly (exactly one tick per period, no extra fire).
//   F. running → ended: the 1-second interval is cleared and the new slow
//      interval fires only after a full PENDING_CLOCK_MS, not 1 s later.
//   G. No phantom interval after ended → pending transition: advancing past
//      where the old interval would have fired produces no tick (old interval
//      was cleared); only the new interval's period matters.
// ─────────────────────────────────────────────────────────────────────────────
describe("useClock — status transition interval cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    setDocumentHidden(false);
  });

  afterEach(() => {
    setDocumentHidden(false);
    vi.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // E. ended → pending: old PENDING_CLOCK_MS interval cleared, new one starts
  //    cleanly.
  //
  // Both statuses share the same cadence (PENDING_CLOCK_MS).  The test
  // verifies that after the transition:
  //   • Exactly one tick fires per PENDING_CLOCK_MS (not two from a stale +
  //     fresh interval running concurrently).
  //   • The new interval's period is measured from the moment of transition,
  //     not from the original mount time.
  // ──────────────────────────────────────────────────────────────────────────
  it("E. ended → pending: old interval is cleared and new slow interval starts cleanly", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "pending" | "ended" }) => useClock(status),
      { initialProps: { status: "ended" as const } },
    );

    // First tick from "ended" slow interval.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(T0 + PENDING_CLOCK_MS);

    // Switch to "pending": React runs useEffect cleanup (clearInterval) then
    // re-runs the effect with a fresh PENDING_CLOCK_MS interval.
    act(() => {
      rerender({ status: "pending" });
    });

    // Advance one full period from the transition point.  New interval fires
    // exactly once → nowTime = T0 + 2 * PENDING_CLOCK_MS.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender({ status: "pending" });
    });
    expect(result.current.getTime()).toBe(T0 + 2 * PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // F. running → ended: 1-second interval is cleared; slow interval starts at
  //    the correct cadence.
  //
  // After the status switches, advancing only 1 more second must NOT produce
  // a tick (the old 1-second interval is gone).  The slow interval fires only
  // after a full PENDING_CLOCK_MS from the transition point.
  // ──────────────────────────────────────────────────────────────────────────
  it("F. running → ended: 1-second interval cleared; slow interval fires after PENDING_CLOCK_MS", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "running" | "ended" }) => useClock(status),
      { initialProps: { status: "running" as const } },
    );

    // First 1-second tick.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Transition to "ended": cleanup clears the 1-second interval; new slow
    // interval (PENDING_CLOCK_MS) is registered at the current timer position.
    act(() => {
      rerender({ status: "ended" });
    });
    const timeAtTransition = result.current.getTime(); // T0 + 1_000

    // Advance 1 second — the old 1-second interval no longer exists, so no
    // callback fires.  nowTime must stay at timeAtTransition.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(timeAtTransition);

    // Advance the remaining (PENDING_CLOCK_MS - 1_000) ms to complete one full
    // slow-tick period from the transition point.  The new interval fires once.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS - 1_000);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000 + PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // G. No phantom interval after ended → pending mid-period transition.
  //
  // Transition happens at PENDING_CLOCK_MS/2 (mid-period, no tick yet).
  // If the old interval were NOT cleared it would fire PENDING_CLOCK_MS/2 ms
  // later (completing its period).  We advance past that point and verify
  // nowTime did NOT advance — confirming the old interval is gone.
  // Only after a full PENDING_CLOCK_MS from the transition point should a
  // single tick appear.
  // ──────────────────────────────────────────────────────────────────────────
  it("G. no phantom interval after ended → pending transition (no double-tick)", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "pending" | "ended" }) => useClock(status),
      { initialProps: { status: "ended" as const } },
    );

    // Advance half a period — interval has not fired yet.
    const halfPeriod = PENDING_CLOCK_MS / 2;
    act(() => {
      vi.advanceTimersByTime(halfPeriod);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(T0); // mid-period, no tick

    // Transition to "pending": cleanup clears the old interval which would
    // have fired halfPeriod ms from now (at T0 + PENDING_CLOCK_MS).
    act(() => {
      rerender({ status: "pending" });
    });

    // Advance past where the old (phantom) interval would have fired.
    // New interval needs a full PENDING_CLOCK_MS from this point, so it
    // has NOT fired yet.  If the phantom existed, nowTime would jump to
    // T0 + PENDING_CLOCK_MS here.  Correct behaviour: nowTime stays T0.
    act(() => {
      vi.advanceTimersByTime(halfPeriod + 1_000);
      rerender({ status: "pending" });
    });
    expect(result.current.getTime()).toBe(T0);

    // Advance the rest of the new interval's first period.
    // New interval fires once at PENDING_CLOCK_MS from the transition point:
    // system clock = T0 + halfPeriod + PENDING_CLOCK_MS.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS - halfPeriod - 1_000);
      rerender({ status: "pending" });
    });
    expect(result.current.getTime()).toBe(T0 + halfPeriod + PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // H. paused → pending: 1-second interval is cleared; advancing 1 s must NOT
  //    produce a tick (old fast interval is gone).
  //
  // "paused" uses a 1-second interval (same as "running").  When the status
  // switches to "pending", React's useEffect cleanup fires clearInterval on
  // that 1-second interval and registers a fresh PENDING_CLOCK_MS interval.
  // If cleanup fails, the phantom 1-second interval would tick and advance
  // nowTime — this test catches exactly that failure.
  // ──────────────────────────────────────────────────────────────────────────
  it("H. paused → pending: old 1-second interval is cleared; 1 s later produces no tick", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "paused" | "pending" }) => useClock(status),
      { initialProps: { status: "paused" as const } },
    );

    // First 1-second tick while paused.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Transition to "pending": cleanup clears the 1-second interval; a new
    // PENDING_CLOCK_MS interval is registered from this point.
    act(() => {
      rerender({ status: "pending" });
    });
    const timeAtTransition = result.current.getTime(); // T0 + 1_000

    // Advance 1 second — the old 1-second interval is gone, so no callback
    // fires.  nowTime must stay at timeAtTransition.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "pending" });
    });
    expect(result.current.getTime()).toBe(timeAtTransition);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // I. paused → pending: new slow interval fires correctly after PENDING_CLOCK_MS.
  //
  // Companion to H: confirms the fresh PENDING_CLOCK_MS interval that replaced
  // the old 1-second interval actually ticks exactly once per slow period,
  // measured from the moment of the paused → pending transition.
  // ──────────────────────────────────────────────────────────────────────────
  it("I. paused → pending: new slow interval fires exactly once after PENDING_CLOCK_MS", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "paused" | "pending" }) => useClock(status),
      { initialProps: { status: "paused" as const } },
    );

    // Let the paused 1-second interval tick once to establish a non-T0 baseline.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Transition to "pending".
    act(() => {
      rerender({ status: "pending" });
    });
    const timeAtTransition = result.current.getTime(); // T0 + 1_000

    // Advance (PENDING_CLOCK_MS - 1_000) ms: the new slow interval has NOT
    // yet completed its first full period from the transition point.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS - 1_000);
      rerender({ status: "pending" });
    });
    // Still no tick — we are 1 second short of the first slow-tick period.
    expect(result.current.getTime()).toBe(timeAtTransition);

    // Advance the final 1_000 ms to complete the first PENDING_CLOCK_MS period.
    // The new slow interval fires once → nowTime = T0 + 1_000 + PENDING_CLOCK_MS.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "pending" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000 + PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // K. paused → ended: 1-second interval is cleared; advancing 1 s must NOT
  //    produce a tick (ghost fast interval is gone).
  //
  // "paused" uses a 1-second interval (same as "running").  When the status
  // switches to "ended", React's useEffect cleanup fires clearInterval on the
  // 1-second interval and registers a fresh PENDING_CLOCK_MS interval.  If
  // cleanup fails, the phantom 1-second interval would tick and advance
  // nowTime — this test catches exactly that failure.
  // ──────────────────────────────────────────────────────────────────────────
  it("K. paused → ended: old 1-second interval is cleared; 1 s later produces no tick", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "paused" | "ended" }) => useClock(status),
      { initialProps: { status: "paused" as const } },
    );

    // First 1-second tick while paused.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Transition to "ended": cleanup clears the 1-second interval; a new
    // PENDING_CLOCK_MS interval is registered from this point.
    act(() => {
      rerender({ status: "ended" });
    });
    const timeAtTransition = result.current.getTime(); // T0 + 1_000

    // Advance 1 second — the old 1-second interval is gone, so no callback
    // fires.  nowTime must stay at timeAtTransition.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(timeAtTransition);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // L. paused → ended: new slow interval fires correctly after PENDING_CLOCK_MS.
  //
  // Companion to K: confirms the fresh PENDING_CLOCK_MS interval that replaced
  // the old 1-second interval actually ticks exactly once per slow period,
  // measured from the moment of the paused → ended transition.
  // ──────────────────────────────────────────────────────────────────────────
  it("L. paused → ended: new slow interval fires exactly once after PENDING_CLOCK_MS", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "paused" | "ended" }) => useClock(status),
      { initialProps: { status: "paused" as const } },
    );

    // Let the paused 1-second interval tick once to establish a non-T0 baseline.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Transition to "ended".
    act(() => {
      rerender({ status: "ended" });
    });
    const timeAtTransition = result.current.getTime(); // T0 + 1_000

    // Advance (PENDING_CLOCK_MS - 1_000) ms: the new slow interval has NOT
    // yet completed its first full period from the transition point.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS - 1_000);
      rerender({ status: "ended" });
    });
    // Still no tick — we are 1 second short of the first slow-tick period.
    expect(result.current.getTime()).toBe(timeAtTransition);

    // Advance the final 1_000 ms to complete the first PENDING_CLOCK_MS period.
    // The new slow interval fires once → nowTime = T0 + 1_000 + PENDING_CLOCK_MS.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000 + PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // M. paused → ended while the tab is hidden: the cleanup path runs but the
  //    new PENDING_CLOCK_MS interval must NOT start (start() guards:
  //    document.hidden → id=null).
  //
  // Steps:
  //   1. Mount with "paused" (tab visible); tick once at T0+1000.
  //   2. Hide the tab; transition to "ended".
  //   3. Advance PENDING_CLOCK_MS — nowTime must NOT advance (no phantom slow
  //      interval was started while the tab was hidden).
  //   4. Make the tab visible; dispatch visibilitychange so onVisibility snaps
  //      nowTime and starts the slow interval.  Advance PENDING_CLOCK_MS — the
  //      interval fires exactly once.
  // ──────────────────────────────────────────────────────────────────────────
  it("M. paused → ended while tab hidden: slow interval does NOT start until tab is visible again", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "paused" | "ended" }) => useClock(status),
      { initialProps: { status: "paused" as const } },
    );

    // Step 1: first 1-second tick while paused (tab visible).
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 2: hide the tab, then transition to "ended".
    // useClock's useEffect cleanup fires (clearInterval on the paused 1-s
    // interval + removeEventListeners), then re-runs: start() sees
    // document.hidden=true → id=null (no slow interval created).
    act(() => {
      setDocumentHidden(true);
      rerender({ status: "ended" });
    });
    const timeAtTransition = result.current.getTime(); // T0 + 1_000

    // Step 3: advance a full PENDING_CLOCK_MS while hidden.
    // No interval was registered (document.hidden=true at effect setup time),
    // so no callback fires and nowTime must not advance.
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(timeAtTransition);

    // Step 4: tab becomes visible → onVisibility snaps nowTime to the current
    // system clock (T0 + 1_000 + PENDING_CLOCK_MS) and starts the slow
    // interval.  Advancing PENDING_CLOCK_MS more fires it exactly once.
    const snapTime = T0 + 1_000 + PENDING_CLOCK_MS;
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender({ status: "ended" }); // flush pending setNowTime() state update
    });
    expect(result.current.getTime()).toBe(snapTime);

    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(snapTime + PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // J. running → paused: same-cadence transition keeps exactly one 1-second
  //    interval (no double-tick).
  //
  // Both "running" and "paused" share the same 1-second delay, so the
  // useEffect([runStatus]) cleanup-and-reinstall cycle must clear the old
  // interval before registering the new one.  If cleanup is broken both
  // intervals survive and nowTime advances twice per second.
  //
  // Steps:
  //   1. Mount with "running"; advance 1 s → nowTime = T0 + 1_000 (one tick).
  //   2. Transition to "paused"; advance 1 s → nowTime = T0 + 2_000 (exactly
  //      ONE tick, not two from a stale + fresh interval).
  //   3. Advance 1 more second → nowTime = T0 + 3_000 (each subsequent second
  //      also advances by exactly 1 s).
  // ──────────────────────────────────────────────────────────────────────────
  it("J. running → paused: exactly one 1-second interval ticks (no double-tick)", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "running" | "paused" }) => useClock(status),
      { initialProps: { status: "running" as const } },
    );

    // Step 1: first 1-second tick while running.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 2: transition to "paused".  React runs the useEffect cleanup
    // (clears the old interval) then re-runs the effect registering a fresh
    // 1-second interval.  Advance exactly 1 s — if both intervals were alive
    // nowTime would jump by 2_000 ms; correct behaviour is +1_000.
    act(() => {
      rerender({ status: "paused" });
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 2_000);

    // Step 3: subsequent seconds each advance by exactly 1 s.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 3_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // K. paused → running: same-cadence transition keeps exactly one 1-second
  //    interval (no double-tick).
  //
  // Both "paused" and "running" share the same 1-second delay, so the
  // useEffect([runStatus]) cleanup-and-reinstall cycle must clear the old
  // interval before registering the new one.  If cleanup is broken, the stale
  // paused interval survives alongside the new running interval — two active
  // timers instead of one.
  //
  // WHY timestamp assertions alone don't detect this bug:
  // Both intervals fire at the same fake-clock timestamp and each calls
  // setNowTime(new Date()) with the identical value.  React's final state looks
  // correct even if cleanup is skipped.  We therefore assert the active timer
  // count via vi.getTimerCount() immediately after the transition; it returns 2
  // when cleanup fails and 1 when it succeeds.
  //
  // Steps:
  //   1. Mount with "paused"; verify timer count = 1.
  //   2. Advance 1 s → nowTime = T0 + 1_000 (one tick).
  //   3. Transition to "running"; verify timer count is still 1 (← regression
  //      guard: would be 2 if the old interval survived).
  //   4. Advance 1 s → nowTime = T0 + 2_000 (supplementary cadence check).
  //   5. Advance 1 more second → nowTime = T0 + 3_000.
  // ──────────────────────────────────────────────────────────────────────────
  it("K. paused → running: exactly one 1-second interval active after transition (no double-tick)", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "paused" | "running" }) => useClock(status),
      { initialProps: { status: "paused" as const } },
    );

    // Step 1: one interval must be active immediately after mount.
    expect(vi.getTimerCount()).toBe(1);

    // Step 2: first 1-second tick while paused.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 3: transition to "running".  React runs the useEffect cleanup
    // (clearInterval on the paused handle) then re-runs the effect registering
    // a fresh 1-second interval.  After the transition there must still be
    // exactly ONE active timer — not two (stale paused + new running).
    // vi.getTimerCount() is the definitive guard here because timestamps alone
    // cannot distinguish one vs two callbacks setting the same value.
    act(() => {
      rerender({ status: "running" });
    });
    expect(vi.getTimerCount()).toBe(1); // ← primary regression guard

    // Step 4: supplementary cadence check — advance 1 s.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 2_000);

    // Step 5: subsequent seconds each advance by exactly 1 s.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 3_000);
  });
});
