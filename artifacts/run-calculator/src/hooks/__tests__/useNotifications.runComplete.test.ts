// @vitest-environment jsdom
//
// Unit tests for the run-complete and freezer-drain effects in useNotifications.
//
// These tests deliberately do NOT install a Notification stub — jsdom omits the
// Notification API entirely, which is what we're guarding against.  Both effects
// reach `Notification.permission` only after a `"Notification" in window` check
// (added alongside this test); without that guard they would throw a ReferenceError
// in this environment.  The tests therefore also serve as regression guards for
// the missing-Notification crash.
//
// Side-effect detection strategy: both effects call navigator.vibrate(…)
// synchronously BEFORE the `"Notification" in window` branch, so vibrate is a
// reliable indicator that the effect body ran to that point without throwing,
// even when Notification is absent.

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
 * Base params that keep only the target effect active:
 *
 *   timePerBatchSec = 0  → batch-cycle effect returns early
 *   adjustedTimeSec = 45 min >> 15-min threshold → 15-min alert clears
 *   elapsed < freezerTime → pace effect arms but never fires
 *   ppm = 100, casesNeeded = 200, pressCasesLeft = 50 → warehouse well above threshold
 */
function makeParams(nowMs: number, overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(nowMs),
    currentRun: makeRun(),
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
// navigator.vibrate is optional-chained in the hook so it never throws even
// when missing; we assign a plain vi.fn() so we can count calls.
// No Notification stub — that is the point of this test file.

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
});

// ── Run-complete effect tests ─────────────────────────────────────────────────

describe("useNotifications — run-complete effect (no Notification API)", () => {
  // The run-complete effect requires:
  //   1. runStatus = "running", startedAt set
  //   2. ppm > 0
  //   3. The run was previously observed at adjustedTimeSec > 0 (runWasTimedRef latched)
  //   4. adjustedTimeSec drops to 0
  //   5. Date.now() − startedAt ≥ 60 000 ms (safety floor)
  //
  // We set startedAt far enough in the past that Date.now() always clears the 60s floor.

  const START_AT = Date.now() - 5 * 60_000; // 5 minutes ago

  // nowMs for these tests only affects freezer-drain (runStatus="ended") —
  // the run-complete effect ignores nowTime entirely.
  const NOW = Date.now();

  it("fires vibrate when adjustedTimeSec crosses 0 after being positive (no Notification crash)", () => {
    const run = makeRun({ startedAt: START_AT });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Initial render: adjustedTimeSec > 0 → runWasTimedRef latches the run id.
      initialProps: makeParams(NOW, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 60, ppm: 100 },
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Step: adjustedTimeSec → 0 → run-complete fires.
    act(() => {
      rerender(makeParams(NOW + 1_000, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 0, ppm: 100 },
      }));
    });

    // vibrate must have been called — proves the effect body ran past the
    // isNotifEnabled check and the `"Notification" in window` guard did not
    // crash (there is no Notification in jsdom).
    expect(vibrateMock).toHaveBeenCalledWith([300, 100, 300, 100, 300]);
  });

  it("fires exactly once — second tick at adjustedTimeSec=0 does not re-fire", () => {
    const run = makeRun({ startedAt: START_AT });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(NOW, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 60, ppm: 100 },
      }),
    });

    act(() => {
      rerender(makeParams(NOW + 1_000, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 0, ppm: 100 },
      }));
    });

    const callsAfterFirst = vibrateMock.mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Another tick — runCompleteNotifRef already holds this run id.
    act(() => {
      rerender(makeParams(NOW + 2_000, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 0, ppm: 100 },
      }));
    });

    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when ppm is 0", () => {
    const run = makeRun({ startedAt: START_AT });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(NOW, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 60, ppm: 0 },
      }),
    });

    act(() => {
      rerender(makeParams(NOW + 1_000, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 0, ppm: 0 },
      }));
    });

    // Effect returns early at `if (calc.ppm <= 0) return`.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when the run was never observed at adjustedTimeSec > 0", () => {
    const run = makeRun({ startedAt: START_AT });

    // First (and only) observation already has adjustedTimeSec = 0 →
    // runWasTimedRef is never set → runCompleteNotifRef guard fires.
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(NOW, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 0, ppm: 100 },
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire within the 60-second safety floor (instant-complete guard)", () => {
    // startedAt = just now → Date.now() - startedAt < 60_000 → effect returns.
    const run = makeRun({ startedAt: Date.now() - 5_000 }); // only 5 s ago

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(NOW, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 60, ppm: 100 },
      }),
    });

    act(() => {
      rerender(makeParams(NOW + 1_000, {
        currentRun: run,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 0, ppm: 100 },
      }));
    });

    // The 60s safety floor guard fires before vibrate.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("latches silently when runComplete pref is off, preventing fire on re-enable", () => {
    const run = makeRun({ startedAt: START_AT });
    const prefOff = { runComplete: false } as import("../../notificationPrefs").NotificationPrefs;

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(NOW, {
        currentRun: run,
        prefs: prefOff,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 60, ppm: 100 },
      }),
    });

    // Cross the threshold with pref OFF → silently latches.
    act(() => {
      rerender(makeParams(NOW + 1_000, {
        currentRun: run,
        prefs: prefOff,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 0, ppm: 100 },
      }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Re-enable pref → milestone already latched, must NOT fire.
    act(() => {
      rerender(makeParams(NOW + 2_000, {
        currentRun: run,
        prefs: undefined,
        calc: { ...makeParams(NOW).calc, adjustedTimeSec: 0, ppm: 100 },
      }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });
});

// ── Freezer-drain effect tests ────────────────────────────────────────────────

describe("useNotifications — freezer-drain effect (no Notification API)", () => {
  // The freezer-drain effect requires:
  //   1. runStatus = "ended", endedAt set
  //   2. freezerMs > 0
  //   3. The run was first observed while remainMs > 0 (freezerDrainingRef latched)
  //   4. remainMs drops to 0 (endedAt + freezerMs <= nowTime)

  // Run ended 12 minutes ago; freezerTime = 10 min → remainMs = 0 already after
  // 12 min → but we first need to observe it while draining (remainMs > 0).
  const ENDED_AT = T0;
  const FREEZER_MIN = 10;
  // "During drain" = 5 min after end (remainMs = 5 min > 0)
  const MID_DRAIN = ENDED_AT + 5 * 60_000;
  // "Drain done" = 11 min after end (remainMs = 0)
  const DRAIN_DONE = ENDED_AT + 11 * 60_000;

  function makeEndedParams(nowMs: number, overrides: Partial<Params> = {}): Params {
    return {
      runStatus: "ended",
      nowTime: new Date(nowMs),
      currentRun: makeRun({ endedAt: ENDED_AT }),
      calc: {
        adjustedTimeSec: 0,
        timePerBatchSec: 0,
        ppm: 0,
        casesCompleted: 100,
        casesInFreezer: 0,
        pressCasesLeft: 0,
        pressDone: true,
      },
      v: {
        freezerTime: FREEZER_MIN,
        casesNeeded: 100,
        casesPerSkid: 10,
      },
      isCrust: false,
      nextRunLabels: [],
      prefs: undefined,
      ...overrides,
    };
  }

  it("fires vibrate when remainMs crosses 0 after being positive (no Notification crash)", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // First tick: remainMs > 0 → freezerDrainingRef latches run-1.
      initialProps: makeEndedParams(MID_DRAIN),
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Second tick: remainMs = 0 → drain complete → fires.
    act(() => {
      rerender(makeEndedParams(DRAIN_DONE));
    });

    // vibrate proves the effect ran past the `"Notification" in window` guard
    // without crashing (Notification is absent in jsdom).
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
  });

  it("fires exactly once — subsequent ticks do not re-fire", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeEndedParams(MID_DRAIN),
    });

    act(() => { rerender(makeEndedParams(DRAIN_DONE)); });

    expect(vibrateMock).toHaveBeenCalledTimes(1);

    // Another tick — freezerDoneNotifRef already holds run-1.
    act(() => { rerender(makeEndedParams(DRAIN_DONE + 60_000)); });

    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when navigating to an already-drained run (never-draining guard)", () => {
    // First (and only) observation already has remainMs = 0 →
    // freezerDrainingRef is never set → guard prevents the "Freeze tunnel empty" fire.
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeEndedParams(DRAIN_DONE),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when freezerTime is 0", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeEndedParams(MID_DRAIN, { v: { freezerTime: 0, casesNeeded: 100, casesPerSkid: 10 } }),
    });

    act(() => {
      rerender(makeEndedParams(DRAIN_DONE, { v: { freezerTime: 0, casesNeeded: 100, casesPerSkid: 10 } }));
    });

    // Effect returns at `if (freezerMs <= 0) return`.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("latches silently when freezerEmpty pref is off, preventing fire on re-enable", () => {
    const prefOff = { freezerEmpty: false } as import("../../notificationPrefs").NotificationPrefs;

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeEndedParams(MID_DRAIN, { prefs: prefOff }),
    });

    // Cross the drain threshold with pref OFF → silently latches.
    act(() => {
      rerender(makeEndedParams(DRAIN_DONE, { prefs: prefOff }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Re-enable the pref — milestone already latched, must NOT fire.
    act(() => {
      rerender(makeEndedParams(DRAIN_DONE + 60_000, { prefs: undefined }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });
});
