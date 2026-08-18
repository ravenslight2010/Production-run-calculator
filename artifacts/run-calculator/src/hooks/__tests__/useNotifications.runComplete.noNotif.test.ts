// @vitest-environment jsdom
//
// Regression guard: confirms the run-complete effect returns cleanly when the
// Notification API is entirely absent.
//
// The run-complete effect (lines 340–370 of useNotifications.ts) calls
// navigator.vibrate() synchronously BEFORE the `"Notification" in window`
// guard, then wraps the showAppNotification call inside that guard.  This
// means when Notification is absent:
//
//   • The latch (runCompleteNotifRef) is set — so a future re-enable of the
//     alert won't retroactively fire a stale "time's up".
//   • navigator.vibrate() IS called (it precedes the guard).
//   • showAppNotification is NOT called (it's inside the guard).
//   • No ReferenceError is thrown from accessing Notification.permission.
//
// This is analogous to batchCycle.test.ts, where vibrate also precedes the
// guard.  It is DIFFERENT from fifteenMin.noNotif.test.ts and
// warehouseStaging.noNotif.test.ts, where both vibrate and the notification
// call are inside the guard (so vibrate must NOT be called when absent).
//
// This file deliberately does NOT install a Notification stub in beforeAll.
// A per-test injectNotificationStub() helper is provided for the one test
// that confirms the notification DOES fire when Notification is present.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import type { RunMeta } from "../../types";

// ── Sanity: confirm jsdom really omits Notification ──────────────────────────
// If this fails the whole test file's premise is wrong.
if (typeof window !== "undefined" && "Notification" in window) {
  throw new Error("Expected jsdom to NOT have Notification — test premise violated");
}

// ── Fixed epoch ──────────────────────────────────────────────────────────────
const T0 = 1_700_000_000_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRun(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    id: "run-1",
    brand: "TestBrand",
    flavor: "TestFlavor",
    startedAt: T0,
    stoppages: [],
    ...overrides,
  };
}

type Params = Parameters<typeof useNotifications>[0];

/**
 * Base params designed to isolate the run-complete effect.
 *
 * To allow the runWasTimedRef latch to arm, tests start with
 * adjustedTimeSec > 0, then step it to 0 to trigger the effect body.
 *
 * The run is started far enough in the past that Date.now() − startedAt
 * always exceeds the 60-second safety floor.
 *
 * Other effects are suppressed:
 *   timePerBatchSec = 0          → batch-cycle effect returns early
 *   adjustedTimeSec = 45 min     → 15-min alert clears on initial render
 *   pressCasesLeft = 50          → warehouse staging above both thresholds
 *   elapsed (3 min) < freezerTime (10 min) → pace effect arms only, never fires
 *   runStatus = "running"        → freezer-drain effect returns early (needs "ended")
 */
// startedAt far in the past so 60-second safety floor is always cleared.
const START_AT_PAST = T0 - 5 * 60_000; // 5 minutes before T0
const NOW = T0 + 3 * 60_000;           // 3 minutes after T0 (8 min since startedAt)

function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(NOW),
    currentRun: makeRun({ startedAt: START_AT_PAST }),
    calc: {
      adjustedTimeSec: 45 * 60,   // well above 15-min threshold
      timePerBatchSec: 0,         // disables batch-cycle effect
      ppm: 100,
      casesCompleted: 50,
      casesInFreezer: 0,
      pressCasesLeft: 50,         // above both warehouse staging thresholds
      pressDone: false,
    },
    v: {
      freezerTime: 10,
      casesNeeded: 200,
      casesPerSkid: 10,
    },
    isCrust: false,
    nextRunLabels: [],
    prefs: undefined,
    ...overrides,
  };
}

// ── vibrate stub ─────────────────────────────────────────────────────────────
// navigator.vibrate is optional-chained in the hook so it never throws when
// missing; we assign a vi.fn() so we can assert on its calls.
// No Notification stub in beforeAll — that is the point of this file.

let vibrateMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  vibrateMock = vi.fn();
  Object.defineProperty(navigator, "vibrate", {
    value: vibrateMock,
    writable: true,
    configurable: true,
  });
});

beforeEach(() => {
  vibrateMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Remove any per-test Notification stub that a test may have injected.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).Notification;
});

// ── Helper: per-test Notification stub ───────────────────────────────────────
// Injected only inside the tests that need to observe a Notification fire.
// NOT installed globally in beforeAll — that is the whole point of this file.
function injectNotificationStub(permission: NotificationPermission = "granted") {
  const ctor = vi.fn();
  const stub = Object.assign(ctor, { permission });
  Object.defineProperty(window, "Notification", {
    value: stub,
    writable: true,
    configurable: true,
  });
  return ctor;
}

// ── Run-complete effect tests (no Notification API) ───────────────────────────

describe("useNotifications — run-complete effect (no Notification API)", () => {
  //
  // The run-complete effect fires when:
  //   1. runStatus = "running", startedAt set
  //   2. ppm > 0
  //   3. adjustedTimeSec > 0 observed at least once (runWasTimedRef latched)
  //   4. adjustedTimeSec drops to 0
  //   5. Date.now() − startedAt ≥ 60 000 ms (safety floor)
  //
  // vibrate fires synchronously BEFORE `if ("Notification" in window)`, so:
  //   • vibrate IS called even when Notification is absent.
  //   • No ReferenceError is thrown from the Notification check.
  //

  // ── 1. No crash — the primary regression guard ────────────────────────────
  it("does NOT crash when countdown crosses 0 and Notification API is absent", () => {
    const run = makeRun({ startedAt: START_AT_PAST });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Arm runWasTimedRef: adjustedTimeSec > 0.
      initialProps: makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 60, ppm: 100 } }),
    });

    // Cross to 0 — must not throw even though Notification is absent.
    expect(() => {
      act(() => {
        rerender(makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }));
      });
    }).not.toThrow();
  });

  // ── 2. vibrate fires (it precedes the Notification guard) ────────────────
  it("calls vibrate when countdown crosses 0, even with Notification absent", () => {
    const run = makeRun({ startedAt: START_AT_PAST });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 60, ppm: 100 } }),
    });

    // No vibrate on arm tick.
    expect(vibrateMock).not.toHaveBeenCalled();

    // Cross the countdown threshold.
    act(() => {
      rerender(makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }));
    });

    // vibrate fires before the Notification guard — must have been called.
    expect(vibrateMock).toHaveBeenCalledWith([300, 100, 300, 100, 300]);
  });

  // ── 3. Fires exactly once — latch prevents a second fire ─────────────────
  it("fires vibrate exactly once — subsequent ticks at 0 do not re-fire", () => {
    const run = makeRun({ startedAt: START_AT_PAST });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 60, ppm: 100 } }),
    });

    // First zero tick — fires.
    act(() => {
      rerender(makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }));
    });

    expect(vibrateMock).toHaveBeenCalledTimes(1);

    // Second zero tick — runCompleteNotifRef already holds this run id.
    act(() => {
      rerender(makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }));
    });

    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  // ── 4. Safety floor: instant-complete guard prevents fire < 60 s ─────────
  it("does NOT call vibrate within the 60-second safety floor (startedAt just now)", () => {
    // startedAt = 5 s ago → Date.now() − startedAt < 60 000 → effect returns.
    const recentRun = makeRun({ startedAt: Date.now() - 5_000 });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ currentRun: recentRun, calc: { ...makeParams().calc, adjustedTimeSec: 60, ppm: 100 } }),
    });

    act(() => {
      rerender(makeParams({ currentRun: recentRun, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }));
    });

    // The 60-second safety floor guard fires BEFORE vibrate.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 5. Suppressed pref: silent latch, no vibrate, no re-fire on re-enable ─
  it("latches silently when runComplete pref is off — re-enable does not retroactively fire", () => {
    const run = makeRun({ startedAt: START_AT_PAST });
    const prefOff = { runComplete: false } as import("../../notificationPrefs").NotificationPrefs;

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ currentRun: run, prefs: prefOff, calc: { ...makeParams().calc, adjustedTimeSec: 60, ppm: 100 } }),
    });

    // Cross the threshold with pref OFF → silently latches, no vibrate.
    act(() => {
      rerender(makeParams({ currentRun: run, prefs: prefOff, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Re-enable pref — milestone already latched, must NOT fire.
    act(() => {
      rerender(makeParams({ currentRun: run, prefs: undefined, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 6. Run never observed at > 0 — no fire (never-timed guard) ───────────
  it("does NOT call vibrate when the run was never observed at adjustedTimeSec > 0", () => {
    const run = makeRun({ startedAt: START_AT_PAST });

    // First (and only) observation already has adjustedTimeSec = 0 →
    // runWasTimedRef is never set → guard prevents the "time's up" fire.
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 7. ppm = 0 → no fire (effect returns early) ───────────────────────────
  it("does NOT call vibrate when ppm is 0 (no valid timing basis)", () => {
    const run = makeRun({ startedAt: START_AT_PAST });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 60, ppm: 0 } }),
    });

    act(() => {
      rerender(makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 0 } }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 8. Notification fires when API IS present (integration path) ──────────
  it("calls the Notification constructor when Notification IS present and permission is granted", async () => {
    const notifCtor = injectNotificationStub("granted");
    const run = makeRun({ startedAt: START_AT_PAST });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 60, ppm: 100 } }),
    });

    act(() => {
      rerender(makeParams({ currentRun: run, calc: { ...makeParams().calc, adjustedTimeSec: 0, ppm: 100 } }));
    });

    // Flush the async IIFE inside showAppNotification.
    await act(async () => { await Promise.resolve(); });

    expect(vibrateMock).toHaveBeenCalledWith([300, 100, 300, 100, 300]);
    expect(notifCtor).toHaveBeenCalledOnce();
    expect(notifCtor.mock.calls[0][0]).toBe("✅ Run time complete");
  });
});
