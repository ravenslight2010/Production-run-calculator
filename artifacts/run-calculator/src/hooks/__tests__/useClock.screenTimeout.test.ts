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
import { renderHook, act, cleanup } from "@testing-library/react";
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

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Repeated hide/show cycles don't drift the clock or accumulate phantom
  //    intervals — 3 cycles while status="running".
  //
  // Each screen-lock/unlock pair (hide then show) must:
  //   • Clear the interval while hidden (vi.getTimerCount() === 0 after hide).
  //   • Restart exactly ONE interval on show (vi.getTimerCount() === 1 after
  //     show) — stale clearInterval ordering would leave 2+ timers.
  //   • Snap nowTime to the current system clock on each show, so the clock
  //     catches up the gap without phantom ticks filling it in.
  //   • NOT fire any callbacks during the hidden period, so nowTime doesn't
  //     advance while the device is asleep between cycles.
  //
  // cleanup() is called first so stale visibilitychange listeners from
  // earlier tests in this file don't inflate vi.getTimerCount() when we
  // dispatch events (same pattern as test M in the status-transition suite).
  //
  // Timeline (all times relative to T0):
  //   Cycle 1: visible 0→1000 (tick→T0+1000), hidden 1000→3000 (sleep 2s),
  //            show→snap T0+3000, count=1.
  //   Cycle 2: visible 3000→4000 (tick→T0+4000), hidden 4000→7000 (sleep 3s),
  //            show→snap T0+7000, count=1.
  //   Cycle 3: visible 7000→8000 (tick→T0+8000), hidden 8000→10000 (sleep 2s),
  //            show→snap T0+10000, count=1.
  //   Final:   advance 1s → nowTime=T0+11000 (exactly one tick, no phantom).
  // ──────────────────────────────────────────────────────────────────────────
  it("5. repeated hide/show cycles: exactly one interval active after each show, nowTime snaps correctly, no phantom ticks", () => {
    // Remove stale listeners from hooks mounted by earlier tests in this
    // describe so that dispatching visibilitychange events only fires the
    // single hook under test.
    cleanup();

    const { result, rerender } = renderHook(() => useClock("running"));

    // One interval must be active immediately after mount (tab is visible).
    expect(vi.getTimerCount()).toBe(1);

    // ── Cycle 1 ─────────────────────────────────────────────────────────────
    // Advance 1 s → interval fires once → nowTime = T0 + 1_000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Go hidden: onVisibility clears the interval → 0 active timers.
    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender();
    });
    expect(vi.getTimerCount()).toBe(0);

    // Sleep 2 s while hidden — no callback should fire.
    act(() => {
      vi.advanceTimersByTime(2_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 1_000); // no advance during sleep

    // Show: onVisibility snaps nowTime to system clock (T0+3000) and restarts
    // exactly one interval.
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender(); // flush pending setNowTime()
    });
    expect(vi.getTimerCount()).toBe(1); // exactly one interval active
    expect(result.current.getTime()).toBe(T0 + 3_000); // snapped to current clock

    // ── Cycle 2 ─────────────────────────────────────────────────────────────
    // Advance 1 s → interval fires → nowTime = T0 + 4_000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 4_000);

    // Go hidden again: interval cleared → 0 active timers.
    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender();
    });
    expect(vi.getTimerCount()).toBe(0);

    // Sleep 3 s — no ticks.
    act(() => {
      vi.advanceTimersByTime(3_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 4_000); // no advance during sleep

    // Show: snap to T0+7000, exactly one interval.
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender();
    });
    expect(vi.getTimerCount()).toBe(1);
    expect(result.current.getTime()).toBe(T0 + 7_000);

    // ── Cycle 3 ─────────────────────────────────────────────────────────────
    // Advance 1 s → nowTime = T0 + 8_000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 8_000);

    // Go hidden a third time → 0 active timers.
    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender();
    });
    expect(vi.getTimerCount()).toBe(0);

    // Sleep 2 s — no ticks.
    act(() => {
      vi.advanceTimersByTime(2_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 8_000); // no advance during sleep

    // Show: snap to T0+10000, exactly one interval.
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender();
    });
    expect(vi.getTimerCount()).toBe(1);
    expect(result.current.getTime()).toBe(T0 + 10_000);

    // ── Final cadence check ──────────────────────────────────────────────────
    // After 3 cycles exactly one interval is running.  Advancing 1 s must
    // advance nowTime by exactly 1_000 ms — no phantom tick doubles it.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 11_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Repeated window "focus" events don't accumulate phantom intervals
  //    during a live run (status="running", tab always visible).
  //
  // Android tablets may fire many rapid "focus" events on screen-wake without
  // ever toggling visibilitychange.  Each focus event calls onFocus → start(),
  // which must clearInterval(id) before creating a new one.  If clearInterval
  // is missing or the closure captures a stale id, each focus leaves an extra
  // phantom interval ticking; vi.getTimerCount() would exceed 1.
  //
  // Three focus events are fired with half-second gaps between them.  After
  // each focus the test asserts:
  //   • vi.getTimerCount() === 1  — no phantom accumulation.
  //   • nowTime snapped to the current system clock immediately.
  //   • No additional ticks fired since the previous focus (advancing less
  //     than 1 s between events must not trigger the interval).
  //
  // A final 1-second advance confirms exactly one interval is running: nowTime
  // advances by exactly 1_000 ms (a phantom second interval would double it).
  //
  // cleanup() is called first so stale listeners from earlier tests in this
  // file don't inflate vi.getTimerCount() when we dispatch events.
  //
  // Timeline (all times relative to T0):
  //   Mount  : visible, 1 interval started, count=1.
  //   +1000  : interval fires → nowTime=T0+1000.
  //   +1500  : focus #1 → snap T0+1500, count=1, old interval replaced.
  //   +2000  : focus #2 → snap T0+2000, count=1, old interval replaced.
  //   +2500  : focus #3 → snap T0+2500, count=1, old interval replaced.
  //   +3500  : advance 1s → nowTime=T0+3500 (exactly one tick, no phantom).
  // ──────────────────────────────────────────────────────────────────────────
  it("6. repeated window focus events: exactly one interval active after each focus, nowTime snaps correctly, no phantom ticks", () => {
    // Remove stale listeners from hooks mounted by earlier tests in this
    // describe so that dispatching focus events only fires the single hook
    // under test — same pattern as test 5 above.
    cleanup();

    const { result, rerender } = renderHook(() => useClock("running"));

    // One interval must be active immediately after mount (tab is visible).
    expect(vi.getTimerCount()).toBe(1);

    // ── Establish a non-T0 baseline ─────────────────────────────────────────
    // Advance 1 s → interval fires once → nowTime = T0 + 1_000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // ── Focus #1 at T0+1500 (mid-period) ────────────────────────────────────
    // Advance 0.5 s (no tick — the interval fires every 1 s from its last
    // reset).  System clock = T0+1500.
    act(() => {
      vi.advanceTimersByTime(500);
      rerender();
    });
    // Still the post-tick value — we are mid-period.
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Dispatch window "focus".  onFocus: setNowTime(T0+1500) + start() which
    // clears the current interval and creates a fresh one.
    act(() => {
      window.dispatchEvent(new Event("focus"));
      rerender(); // flush pending setNowTime() state update
    });
    expect(vi.getTimerCount()).toBe(1); // exactly one interval, no accumulation
    expect(result.current.getTime()).toBe(T0 + 1_500); // snapped to current clock

    // ── Focus #2 at T0+2000 ─────────────────────────────────────────────────
    // Advance 0.5 s more (0.5 s since the last focus reset; new interval has
    // NOT fired yet).  System clock = T0+2000.
    act(() => {
      vi.advanceTimersByTime(500);
      rerender();
    });
    // No interval callback fired — still at the post-focus-#1 snap value.
    expect(result.current.getTime()).toBe(T0 + 1_500);

    // Dispatch a second window "focus".
    act(() => {
      window.dispatchEvent(new Event("focus"));
      rerender();
    });
    expect(vi.getTimerCount()).toBe(1); // still exactly one interval
    expect(result.current.getTime()).toBe(T0 + 2_000); // snapped forward again

    // ── Focus #3 at T0+2500 ─────────────────────────────────────────────────
    // Advance 0.5 s more (0.5 s since the last focus reset; interval has NOT
    // fired yet).  System clock = T0+2500.
    act(() => {
      vi.advanceTimersByTime(500);
      rerender();
    });
    // Still at the post-focus-#2 snap value — no phantom ticks.
    expect(result.current.getTime()).toBe(T0 + 2_000);

    // Dispatch a third window "focus".
    act(() => {
      window.dispatchEvent(new Event("focus"));
      rerender();
    });
    expect(vi.getTimerCount()).toBe(1); // still exactly one interval
    expect(result.current.getTime()).toBe(T0 + 2_500); // snapped forward again

    // ── Final cadence check ──────────────────────────────────────────────────
    // After 3 focus events exactly one interval is running.  Advancing 1 s
    // must advance nowTime by exactly 1_000 ms — a phantom second interval
    // would double the advance to 2_000 ms.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 3_500);
    expect(vi.getTimerCount()).toBe(1); // still exactly one interval at the end
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

// ── Fast-tick path (runStatus="paused") hidden at mount ───────────────────────
//
// "paused" uses the same 1-second interval as "running".  The hidden-at-mount
// guard (`document.hidden ? null : setInterval(...)`) must suppress the
// interval regardless of which fast-tick status triggered it.
//
// Tests confirm:
//   P1. While document.hidden=true the 1-second interval is NOT started —
//       nowTime stays frozen even after 3 s.
//   P2. visibilitychange (hidden → visible) immediately snaps nowTime to the
//       current mocked time AND restarts the 1-second interval.
// ─────────────────────────────────────────────────────────────────────────────
describe("useClock — fast-tick path (runStatus=paused) hidden at mount", () => {
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
  // P1. While document.hidden=true the 1-second interval does NOT start and
  //     nowTime stays frozen.
  //
  // useClock's start() guards: `id = document.hidden ? null : setInterval(...)`.
  // With hidden=true at mount and runStatus="paused", id=null.  Advancing the
  // fake timer clock by 3 s fires nothing; nowTime stays at T0.
  // ──────────────────────────────────────────────────────────────────────────
  it("P1. while document.hidden=true the 1-second interval does not run (nowTime stays frozen)", () => {
    setDocumentHidden(true);

    const { result, rerender } = renderHook(() => useClock("paused"));
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
  // P2. visibilitychange (hidden → visible): nowTime snaps to the current
  //     system time and the 1-second interval restarts.
  //
  // After staying hidden for 3 s (system clock = T0+3000, no ticks),
  // dispatching visibilitychange fires onVisibility which calls
  // setNowTime(new Date()) — snapping to T0+3000.  A fresh 1-second interval
  // is then started.  One more vi.advanceTimersByTime(1000) fires that
  // interval and sets nowTime to T0+4000.
  // ──────────────────────────────────────────────────────────────────────────
  it("P2. visibilitychange (hidden → visible) snaps nowTime and restarts the 1-second interval", () => {
    setDocumentHidden(true);

    const { result, rerender } = renderHook(() => useClock("paused"));
    const initialMs = result.current.getTime(); // T0

    // Advance 3 s while hidden.
    // System clock reaches T0+3000; nowTime stays T0 (no interval).
    act(() => {
      vi.advanceTimersByTime(3_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(initialMs);

    // Tab becomes visible.  System clock is now T0+3000.
    // onVisibility: setNowTime(new Date()) → setNowTime(T0+3000); start() → new 1-second interval.
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender(); // flush pending setNowTime() state update
    });
    expect(result.current.getTime()).toBe(T0 + 3_000);

    // Verify the 1-second interval was restarted: one more second fires it.
    // System clock: T0+3000 → T0+4000.  Interval fires → setNowTime(T0+4000).
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender();
    });
    expect(result.current.getTime()).toBe(T0 + 4_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P3. Going hidden while paused clears the interval — no phantom ticks.
  //
  // The tab is visible; useClock("paused") starts its 1-second interval.
  // After the first tick at T0+1000, the tab goes hidden.  onVisibility fires
  // the hidden branch → clearInterval(id).  Advancing 10 more seconds must NOT
  // advance nowTime (the interval has been cleared and no new one is started).
  // ──────────────────────────────────────────────────────────────────────────
  it("P3. going hidden while paused clears the interval so no phantom ticks accumulate", () => {
    // Tab is visible; 1-second interval starts immediately.
    const { result, rerender } = renderHook(() => useClock("paused"));

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
  // N. running → ended while the tab is hidden: the cleanup path runs but the
  //    new PENDING_CLOCK_MS interval must NOT start (start() guards:
  //    document.hidden → id=null).
  //
  // This is the analogous test to M (paused → ended hidden-tab), confirming
  // the fast → slow cadence switch also holds when the tab is hidden at the
  // moment of the running → ended transition.
  //
  // Steps:
  //   1. Mount with "running" (tab visible); tick once at T0+1000.
  //   2. Hide the tab, then transition to "ended".
  //   3. Advance PENDING_CLOCK_MS — nowTime must NOT advance (no phantom slow
  //      interval was started while the tab was hidden).
  //   4. Make the tab visible; dispatch visibilitychange so onVisibility snaps
  //      nowTime and starts the slow interval.  Advance PENDING_CLOCK_MS — the
  //      interval fires exactly once.
  // ──────────────────────────────────────────────────────────────────────────
  it("N. running → ended while tab hidden: slow interval does NOT start until tab is visible again", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: "running" | "ended" }) => useClock(status),
      { initialProps: { status: "running" as const } },
    );

    // Step 1: first 1-second tick while running (tab visible).
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 2: hide the tab, then transition to "ended".
    // useClock's useEffect cleanup fires (clearInterval on the running 1-s
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

  // ──────────────────────────────────────────────────────────────────────────
  // M. running → paused while tab is hidden: exactly one interval after
  //    becoming visible again (no phantom interval from the stale effect).
  //
  // The risk: if the useEffect([runStatus]) cleanup does NOT remove the old
  // "running" effect's visibilitychange/focus listeners, BOTH the stale and
  // fresh onVisibility handlers fire when the tab becomes visible — creating
  // two concurrent 1-second intervals instead of one.
  //
  // WHY timestamps alone don't reliably catch this:
  // Both intervals fire at the same fake-clock tick and each calls
  // setNowTime(new Date()) with the same value, so the rendered time still
  // looks correct.  We therefore assert vi.getTimerCount() === 1 immediately
  // after the tab becomes visible; it returns 2 when cleanup fails and 1 when
  // it succeeds.
  //
  // Steps:
  //   1. Mount with "running"; tab is visible; one interval starts
  //      (vi.getTimerCount() === 1).
  //   2. Tab goes hidden; onVisibility clears the interval (count → 0).
  //   3. Transition to "paused" while still hidden; React cleanup removes the
  //      old listeners; new effect's start() finds document.hidden=true so
  //      id=null (still no interval, count stays 0).
  //   4. Tab becomes visible; the single new onVisibility fires — snaps
  //      nowTime and starts exactly one interval.
  //   5. Assert vi.getTimerCount() === 1 ← primary regression guard.
  //   6. Advance 1 s; nowTime advances by exactly 1_000 ms (no double-tick).
  // ──────────────────────────────────────────────────────────────────────────
  it("M. running → paused while hidden: exactly one interval active after becoming visible (no double-tick)", () => {
    // Flush stale hooks from earlier tests in this file so their
    // visibilitychange listeners are removed before we dispatch events.
    // Without this, all N-1 prior hooks' onVisibility handlers fire when we
    // dispatch the event in step 4, each calling start() and installing a
    // phantom interval — making vi.getTimerCount() return N instead of 1.
    cleanup();

    const { result, rerender } = renderHook(
      ({ status }: { status: "running" | "paused" }) => useClock(status),
      { initialProps: { status: "running" as const } },
    );

    // Step 1: one interval must be active immediately after mount.
    expect(vi.getTimerCount()).toBe(1);

    // Let the running interval tick once to establish a non-T0 baseline.
    // System clock advances to T0 + 1_000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 2: tab goes hidden.
    // onVisibility fires the hidden branch → clearInterval(id); id = null.
    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender({ status: "running" });
    });
    // Interval is gone — no timers should be active while hidden.
    expect(vi.getTimerCount()).toBe(0);

    // Step 3: transition to "paused" while still hidden.
    // React's useEffect cleanup fires: clears the (already-null) interval
    // handle and — critically — removes the old "running" effect's
    // visibilitychange and focus listeners.  The fresh "paused" effect then
    // runs: start() sees document.hidden=true → id stays null.
    act(() => {
      rerender({ status: "paused" });
    });
    // Still no interval — document is still hidden.
    expect(vi.getTimerCount()).toBe(0);

    // Step 4: tab becomes visible.
    // The (single) new "paused" effect's onVisibility fires:
    //   setNowTime(new Date())  → snaps to system clock = T0 + 1_000
    //   start()                 → one fresh 1-second interval registered
    // System clock has not advanced since step 1, so new Date() = T0 + 1_000.
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      rerender({ status: "paused" }); // flush pending setNowTime()
    });

    // Step 5: exactly one timer active — primary regression guard.
    // If cleanup failed, both old and new listeners fired → 2 intervals here.
    expect(vi.getTimerCount()).toBe(1);

    // Clock snap: nowTime must equal the current system clock (T0 + 1_000).
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 6: advance 1 s — the single interval fires once.
    // nowTime advances to T0 + 2_000.  If two intervals had survived they
    // would both fire at this tick, but vi.getTimerCount() in step 5 already
    // confirmed that can't happen; this step validates the cadence is correct.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 2_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // O. running → paused while tab is hidden (focus-event fallback path):
  //    exactly one interval active after window.focus restores focus.
  //
  // This is the window.focus analog of test M (which covers visibilitychange).
  // On Android tablets, visibilitychange doesn't fire reliably on screen
  // wake/app-switch, so useClock also listens to window "focus" via onFocus.
  // If the old "running" effect's onFocus listener is NOT removed during
  // cleanup, BOTH the stale and fresh handlers fire when window.focus is
  // dispatched — installing two concurrent 1-second intervals instead of one.
  //
  // The tab is hidden WITHOUT dispatching visibilitychange so the original
  // running interval is not cleared by onVisibility — only React's effect
  // cleanup (triggered by the status change) removes it.  This isolates the
  // focus-listener cleanup path from the visibility path.
  //
  // Steps:
  //   1. Mount with "running"; tab visible; one interval starts
  //      (vi.getTimerCount() === 1).
  //   2. Hide the tab (document.hidden = true) WITHOUT dispatching
  //      visibilitychange — the running interval remains alive.
  //   3. Transition to "paused" while still hidden; React cleanup fires:
  //      clearInterval on the old running interval + removeEventListeners for
  //      both visibilitychange and focus.  Fresh "paused" effect runs:
  //      start() sees document.hidden=true → id=null (no new interval yet).
  //   4. Make the tab visible (document.hidden = false), then dispatch
  //      window.focus.  The (single) new "paused" effect's onFocus fires:
  //      setNowTime(new Date()) + start() → one fresh 1-second interval.
  //   5. Assert vi.getTimerCount() === 1 ← primary regression guard.
  //      If cleanup failed, both old and new onFocus handlers fired → 2.
  //   6. Advance 1 s; nowTime advances by exactly 1_000 ms (no double-tick).
  // ──────────────────────────────────────────────────────────────────────────
  it("O. running → paused while hidden: exactly one interval active after window.focus (focus-event fallback path)", () => {
    // Flush stale hooks from earlier tests so their focus listeners are
    // removed before we dispatch the focus event in step 4.  Without this,
    // every prior hook's onFocus handler would also fire, each calling
    // start() and installing a phantom interval — making vi.getTimerCount()
    // return N instead of 1.
    cleanup();

    const { result, rerender } = renderHook(
      ({ status }: { status: "running" | "paused" }) => useClock(status),
      { initialProps: { status: "running" as const } },
    );

    // Step 1: one interval must be active immediately after mount.
    expect(vi.getTimerCount()).toBe(1);

    // Let the running interval tick once to establish a non-T0 baseline.
    // System clock advances to T0 + 1_000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 2: hide the tab WITHOUT dispatching visibilitychange.
    // The running interval is still alive (onVisibility has NOT been called).
    act(() => {
      setDocumentHidden(true);
      rerender({ status: "running" });
    });
    // Interval is still running — not cleared because visibilitychange was
    // never dispatched.
    expect(vi.getTimerCount()).toBe(1);

    // Step 3: transition to "paused" while still hidden.
    // React's useEffect cleanup fires: clearInterval on the old running
    // interval (vi.getTimerCount() → 0) and — critically — removes the old
    // "running" effect's focus listener via window.removeEventListener.
    // The fresh "paused" effect then runs: start() sees document.hidden=true
    // → id=null (no new interval yet).
    act(() => {
      rerender({ status: "paused" });
    });
    // Old interval is gone; no new one started (still hidden).
    expect(vi.getTimerCount()).toBe(0);

    // Step 4: tab becomes visible; dispatch window.focus.
    // The (single) new "paused" effect's onFocus fires:
    //   !document.hidden is now true → setNowTime(new Date()) + start()
    //   → one fresh 1-second interval registered.
    // System clock has not advanced since step 1, so new Date() = T0 + 1_000.
    act(() => {
      setDocumentHidden(false);
      window.dispatchEvent(new Event("focus"));
      rerender({ status: "paused" }); // flush pending setNowTime()
    });

    // Step 5: exactly one timer active — primary regression guard.
    // If cleanup failed to remove the old "running" onFocus listener, both
    // old and new handlers fired → 2 intervals here.
    expect(vi.getTimerCount()).toBe(1);

    // Clock snap: nowTime must equal the current system clock (T0 + 1_000).
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 6: advance 1 s — the single interval fires once.
    // nowTime advances to T0 + 2_000.  vi.getTimerCount() in step 5 already
    // confirmed only one interval exists; this step validates correct cadence.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 2_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P. paused → running while tab is hidden (focus-event fallback path):
  //    exactly one interval active after window.focus restores focus.
  //
  // This is the symmetric counterpart of test O (running → paused hidden).
  // The risk: if the old "paused" effect's onFocus listener is NOT removed
  // during cleanup, BOTH the stale and fresh handlers fire when window.focus
  // is dispatched — installing two concurrent 1-second intervals instead of
  // one.
  //
  // The tab is hidden WITHOUT dispatching visibilitychange so the original
  // paused interval is not cleared by onVisibility — only React's effect
  // cleanup (triggered by the status change) removes it.  This isolates the
  // focus-listener cleanup path from the visibility path.
  //
  // Steps:
  //   1. Mount with "paused"; tab visible; one interval starts
  //      (vi.getTimerCount() === 1).
  //   2. Hide the tab (document.hidden = true) WITHOUT dispatching
  //      visibilitychange — the paused interval remains alive.
  //   3. Transition to "running" while still hidden; React cleanup fires:
  //      clearInterval on the old paused interval + removeEventListeners for
  //      both visibilitychange and focus.  Fresh "running" effect runs:
  //      start() sees document.hidden=true → id=null (no new interval yet).
  //   4. Make the tab visible (document.hidden = false), then dispatch
  //      window.focus.  The (single) new "running" effect's onFocus fires:
  //      setNowTime(new Date()) + start() → one fresh 1-second interval.
  //   5. Assert vi.getTimerCount() === 1 ← primary regression guard.
  //      If cleanup failed, both old and new onFocus handlers fired → 2.
  //   6. Advance 1 s; nowTime advances by exactly 1_000 ms (no double-tick).
  // ──────────────────────────────────────────────────────────────────────────
  it("P. paused → running while hidden: exactly one interval active after window.focus (focus-event fallback path)", () => {
    // Flush stale hooks from earlier tests so their focus listeners are
    // removed before we dispatch the focus event in step 4.  Without this,
    // every prior hook's onFocus handler would also fire, each calling
    // start() and installing a phantom interval — making vi.getTimerCount()
    // return N instead of 1.
    cleanup();

    const { result, rerender } = renderHook(
      ({ status }: { status: "paused" | "running" }) => useClock(status),
      { initialProps: { status: "paused" as const } },
    );

    // Step 1: one interval must be active immediately after mount.
    expect(vi.getTimerCount()).toBe(1);

    // Let the paused interval tick once to establish a non-T0 baseline.
    // System clock advances to T0 + 1_000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "paused" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 2: hide the tab WITHOUT dispatching visibilitychange.
    // The paused interval is still alive (onVisibility has NOT been called).
    act(() => {
      setDocumentHidden(true);
      rerender({ status: "paused" });
    });
    // Interval is still running — not cleared because visibilitychange was
    // never dispatched.
    expect(vi.getTimerCount()).toBe(1);

    // Step 3: transition to "running" while still hidden.
    // React's useEffect cleanup fires: clearInterval on the old paused
    // interval (vi.getTimerCount() → 0) and — critically — removes the old
    // "paused" effect's focus listener via window.removeEventListener.
    // The fresh "running" effect then runs: start() sees document.hidden=true
    // → id=null (no new interval yet).
    act(() => {
      rerender({ status: "running" });
    });
    // Old interval is gone; no new one started (still hidden).
    expect(vi.getTimerCount()).toBe(0);

    // Step 4: tab becomes visible; dispatch window.focus.
    // The (single) new "running" effect's onFocus fires:
    //   !document.hidden is now true → setNowTime(new Date()) + start()
    //   → one fresh 1-second interval registered.
    // System clock has not advanced since step 1, so new Date() = T0 + 1_000.
    act(() => {
      setDocumentHidden(false);
      window.dispatchEvent(new Event("focus"));
      rerender({ status: "running" }); // flush pending setNowTime()
    });

    // Step 5: exactly one timer active — primary regression guard.
    // If cleanup failed to remove the old "paused" onFocus listener, both
    // old and new handlers fired → 2 intervals here.
    expect(vi.getTimerCount()).toBe(1);

    // Clock snap: nowTime must equal the current system clock (T0 + 1_000).
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 6: advance 1 s — the single interval fires once.
    // nowTime advances to T0 + 2_000.  vi.getTimerCount() in step 5 already
    // confirmed only one interval exists; this step validates correct cadence.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 2_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Q. running → ended while tab is hidden (focus-event fallback path):
  //    exactly one interval active after window.focus restores focus.
  //
  // This is the window.focus analog of test N (which covers visibilitychange
  // for the running → ended transition) and complements test O (which covers
  // running → paused via focus).  On Android tablets, visibilitychange doesn't
  // fire reliably on screen wake/app-switch, so useClock also listens to
  // window "focus" via onFocus.  If the old "running" effect's onFocus
  // listener is NOT removed during cleanup, BOTH the stale and fresh handlers
  // fire when window.focus is dispatched — installing two concurrent PENDING_CLOCK_MS
  // intervals instead of one (a phantom slow interval runs alongside the new one).
  //
  // The tab is hidden WITHOUT dispatching visibilitychange so the original
  // running interval is not cleared by onVisibility — only React's effect
  // cleanup (triggered by the status change) removes it.  This isolates the
  // focus-listener cleanup path from the visibility path.
  //
  // Steps:
  //   1. Mount with "running"; tab visible; one 1-second interval starts
  //      (vi.getTimerCount() === 1).
  //   2. Hide the tab (document.hidden = true) WITHOUT dispatching
  //      visibilitychange — the running 1-second interval remains alive.
  //   3. Transition to "ended" while still hidden; React cleanup fires:
  //      clearInterval on the old running interval + removeEventListeners for
  //      both visibilitychange and focus.  Fresh "ended" effect runs:
  //      start() sees document.hidden=true → id=null (no new interval yet).
  //   4. Make the tab visible (document.hidden = false), then dispatch
  //      window.focus.  The (single) new "ended" effect's onFocus fires:
  //      setNowTime(new Date()) + start() → one fresh PENDING_CLOCK_MS interval.
  //   5. Assert vi.getTimerCount() === 1 ← primary regression guard.
  //      If cleanup failed, both old and new onFocus handlers fired → 2.
  //   6. Advance PENDING_CLOCK_MS; nowTime advances by exactly PENDING_CLOCK_MS
  //      (exactly one slow tick, no phantom doubles it).
  // ──────────────────────────────────────────────────────────────────────────
  it("Q. running → ended while hidden: exactly one interval active after window.focus (focus-event fallback path)", () => {
    // Flush stale hooks from earlier tests so their focus listeners are
    // removed before we dispatch the focus event in step 4.  Without this,
    // every prior hook's onFocus handler would also fire, each calling
    // start() and installing a phantom interval — making vi.getTimerCount()
    // return N instead of 1.
    cleanup();

    const { result, rerender } = renderHook(
      ({ status }: { status: "running" | "ended" }) => useClock(status),
      { initialProps: { status: "running" as const } },
    );

    // Step 1: one interval must be active immediately after mount.
    expect(vi.getTimerCount()).toBe(1);

    // Let the running 1-second interval tick once to establish a non-T0 baseline.
    // System clock advances to T0 + 1_000.
    act(() => {
      vi.advanceTimersByTime(1_000);
      rerender({ status: "running" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 2: hide the tab WITHOUT dispatching visibilitychange.
    // The running 1-second interval is still alive (onVisibility has NOT been
    // called, so it has not been cleared yet).
    act(() => {
      setDocumentHidden(true);
      rerender({ status: "running" });
    });
    // Interval is still running — not cleared because visibilitychange was
    // never dispatched.
    expect(vi.getTimerCount()).toBe(1);

    // Step 3: transition to "ended" while still hidden.
    // React's useEffect cleanup fires: clearInterval on the old running
    // 1-second interval (vi.getTimerCount() → 0) and — critically — removes
    // the old "running" effect's focus listener via window.removeEventListener.
    // The fresh "ended" effect then runs: start() sees document.hidden=true
    // → id=null (no new PENDING_CLOCK_MS interval yet).
    act(() => {
      rerender({ status: "ended" });
    });
    // Old 1-second interval is gone; no new slow interval started (still hidden).
    expect(vi.getTimerCount()).toBe(0);

    // Step 4: tab becomes visible; dispatch window.focus.
    // The (single) new "ended" effect's onFocus fires:
    //   !document.hidden is now true → setNowTime(new Date()) + start()
    //   → one fresh PENDING_CLOCK_MS interval registered.
    // System clock has not advanced since step 1, so new Date() = T0 + 1_000.
    act(() => {
      setDocumentHidden(false);
      window.dispatchEvent(new Event("focus"));
      rerender({ status: "ended" }); // flush pending setNowTime()
    });

    // Step 5: exactly one timer active — primary regression guard.
    // If cleanup failed to remove the old "running" onFocus listener, both
    // old and new handlers fired → 2 intervals (one slow phantom + one new).
    expect(vi.getTimerCount()).toBe(1);

    // Clock snap: nowTime must equal the current system clock (T0 + 1_000).
    expect(result.current.getTime()).toBe(T0 + 1_000);

    // Step 6: advance PENDING_CLOCK_MS — the single slow interval fires once.
    // nowTime advances to T0 + 1_000 + PENDING_CLOCK_MS.  vi.getTimerCount()
    // in step 5 already confirmed only one interval exists; this step validates
    // the cadence is correct (PENDING_CLOCK_MS, not 1 s from a phantom running
    // interval).
    act(() => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
      rerender({ status: "ended" });
    });
    expect(result.current.getTime()).toBe(T0 + 1_000 + PENDING_CLOCK_MS);
  });
});
