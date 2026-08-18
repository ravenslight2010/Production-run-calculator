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
import { useClock } from "../useClock";

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
