// @vitest-environment jsdom
//
// Unit tests for the behind-pace alert effect in useNotifications.
//
// These tests deliberately do NOT install a Notification stub — jsdom omits the
// Notification API entirely, which is what we're guarding against.
// showAppNotification() returns immediately when "Notification" is absent (its
// first guard: `if (!("Notification" in window)) return`), so the call after
// navigator.vibrate must never crash in this environment.
//
// Side-effect detection strategy: the pace effect calls navigator.vibrate(…)
// synchronously BEFORE the showAppNotification call, so vibrate is a reliable
// indicator that the effect body ran to that point without throwing, even when
// Notification is absent.
//
// Arm → fire lifecycle:
//   - While elapsedMin < freezerTime  → paceArmedRef is set (run is "armed").
//   - Once elapsedMin >= freezerTime and the shortfall condition is met → fires once.
//   - A run observed for the first time already behind pace (never armed) never fires.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import type { RunMeta } from "../../types";

// ── Sanity: confirm jsdom really omits Notification ──────────────────────────
// If this assertion fails the whole test file's premise is wrong.
if (typeof window !== "undefined" && "Notification" in window) {
  throw new Error("Expected jsdom to NOT have Notification — test premise violated");
}

// ── Fixed epoch ───────────────────────────────────────────────────────────────
const T0 = 1_700_000_000_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRun(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    id: "run-pace-1",
    brand: "TestBrand",
    flavor: "TestFlavor",
    startedAt: T0,
    stoppages: [],
    ...overrides,
  };
}

type Params = Parameters<typeof useNotifications>[0];

/**
 * Params tuned so only the pace alert can fire on a second tick:
 *
 *   freezerTime = 10 min  (elapsedMin < 10 → arm tick; >= 10 → evaluate tick)
 *   casesNeeded = 200, casesCompleted = 50, casesInFreezer = 0
 *   At T0 + 15 min elapsed:
 *     actualRateCasesPerHr ≈ 200/hr
 *     projectedFinish = 50 + (200×20)/60 ≈ 117
 *     shortfall = ceil(200 − 117) = 84  ≥ 10  ✓
 *   adjustedTimeSec = 20 min → timeRemainingMin = 20,  0 < 20 ≤ 30  ✓
 *
 * Other effects are suppressed:
 *   adjustedTimeSec well below 900 s (15 min) on the eval tick — but the
 *   15-min alert is gated by sawAbove15Ref which is never set in these tests.
 *   timePerBatchSec = 0  → batch-cycle effect returns early.
 *   pressCasesLeft = 50 (> 2 skids = 20) → warehouse alert doesn't fire.
 */
function makeArmParams(nowMs: number, overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(nowMs),
    currentRun: makeRun({ startedAt: T0 }),
    calc: {
      adjustedTimeSec: 20 * 60,   // 20 min remaining — pace eval tick value
      timePerBatchSec: 0,          // disables batch-cycle effect
      ppm: 100,
      casesCompleted: 50,
      casesInFreezer: 0,
      pressCasesLeft: 50,          // well above 2-skid warehouse threshold (2×10=20)
      pressDone: false,
    },
    v: {
      freezerTime: 10,             // min; arm tick = T0+5 min, eval tick = T0+15 min
      casesNeeded: 200,
      casesPerSkid: 10,
    },
    isCrust: false,
    nextRunLabels: [],
    prefs: undefined,
    ...overrides,
  };
}

// ── vibrate stub ──────────────────────────────────────────────────────────────
// navigator.vibrate is optional-chained so it never throws when absent; we
// assign a vi.fn() so we can assert it was called.
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
  // Remove any per-test Notification stub that a test may have injected.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).Notification;
});

// ── Helper: per-test Notification stub ───────────────────────────────────────
// Injected only inside the test that confirms the OS notification fires when
// Notification IS present.  NOT installed globally in beforeAll — that is the
// whole point of this file.
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

// ── Behind-pace effect tests ──────────────────────────────────────────────────

describe("useNotifications — behind-pace alert (no Notification API)", () => {
  // ARM tick  : nowMs = T0 + 5 min  → elapsedMin = 5 < freezerTime=10 → paceArmedRef set
  const ARM_TICK  = T0 + 5  * 60_000;
  // EVAL tick : nowMs = T0 + 15 min → elapsedMin = 15 ≥ 10 → shortfall check runs
  const EVAL_TICK = T0 + 15 * 60_000;

  it("fires vibrate when the run crosses the shortfall threshold after being armed (no Notification crash)", () => {
    const run = makeRun({ startedAt: T0 });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Arm tick: elapsedMin = 5 < 10 → paceArmedRef.add(runId), returns early.
      initialProps: makeArmParams(ARM_TICK, { currentRun: run }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Eval tick: elapsedMin = 15 ≥ 10 → shortfall = 84 ≥ 10, timeRemainingMin = 20 ≤ 30 → fires.
    act(() => {
      rerender(makeArmParams(EVAL_TICK, { currentRun: run }));
    });

    // vibrate proves the effect body ran past the isNotifEnabled check AND that
    // showAppNotification's `"Notification" in window` guard didn't crash
    // (Notification is entirely absent in jsdom).
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
  });

  it("fires exactly once — subsequent ticks with the condition still met do not re-fire", () => {
    const run = makeRun({ startedAt: T0 });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeArmParams(ARM_TICK, { currentRun: run }),
    });

    // First crossing — fires.
    act(() => {
      rerender(makeArmParams(EVAL_TICK, { currentRun: run }));
    });

    expect(vibrateMock).toHaveBeenCalledTimes(1);

    // Another tick — paceFiredRef already holds this run id.
    act(() => {
      rerender(makeArmParams(EVAL_TICK + 1_000, { currentRun: run }));
    });

    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when the run is first observed already behind pace (never-armed guard)", () => {
    const run = makeRun({ startedAt: T0 });

    // First (and only) observation is already at the eval tick — paceArmedRef is
    // never set for this run, so the `if (!paceArmedRef.current.has(runId)) return`
    // guard prevents the fire.
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeArmParams(EVAL_TICK, { currentRun: run }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when ppm is 0 (no timing basis)", () => {
    const run = makeRun({ startedAt: T0 });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeArmParams(ARM_TICK, {
        currentRun: run,
        calc: { ...makeArmParams(ARM_TICK).calc, ppm: 0 },
      }),
    });

    act(() => {
      rerender(makeArmParams(EVAL_TICK, {
        currentRun: run,
        calc: { ...makeArmParams(EVAL_TICK).calc, ppm: 0 },
      }));
    });

    // Effect returns at `if (calc.ppm <= 0) return`.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when casesNeeded is 0", () => {
    const run = makeRun({ startedAt: T0 });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeArmParams(ARM_TICK, {
        currentRun: run,
        v: { ...makeArmParams(ARM_TICK).v, casesNeeded: 0 },
      }),
    });

    act(() => {
      rerender(makeArmParams(EVAL_TICK, {
        currentRun: run,
        v: { ...makeArmParams(EVAL_TICK).v, casesNeeded: 0 },
      }));
    });

    // Effect returns at `if (casesNeeded <= 0) return`.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when the shortfall is below the minimum threshold", () => {
    const run = makeRun({ startedAt: T0 });

    // casesNeeded = 120: at the eval tick projectedFinish ≈ 117, shortfall = 3 < 10.
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeArmParams(ARM_TICK, {
        currentRun: run,
        v: { ...makeArmParams(ARM_TICK).v, casesNeeded: 120 },
      }),
    });

    act(() => {
      rerender(makeArmParams(EVAL_TICK, {
        currentRun: run,
        v: { ...makeArmParams(EVAL_TICK).v, casesNeeded: 120 },
      }));
    });

    // conditionMet = false (shortfall < PACE_SHORTFALL_MIN_CASES=10) → arms but doesn't fire.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when timeRemainingMin exceeds the 30-minute window", () => {
    const run = makeRun({ startedAt: T0 });

    // adjustedTimeSec = 35 min > PACE_TIME_REMAINING_MAX_MIN=30 → conditionMet = false.
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeArmParams(ARM_TICK, {
        currentRun: run,
        calc: { ...makeArmParams(ARM_TICK).calc, adjustedTimeSec: 35 * 60 },
      }),
    });

    act(() => {
      rerender(makeArmParams(EVAL_TICK, {
        currentRun: run,
        calc: { ...makeArmParams(EVAL_TICK).calc, adjustedTimeSec: 35 * 60 },
      }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("keeps the Run-station pace action visible even when an obsolete slowPace value exists", () => {
    const run = makeRun({ startedAt: T0 });
    const prefOff = { slowPace: false } as import("../../notificationPrefs").NotificationPrefs;

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeArmParams(ARM_TICK, { currentRun: run, prefs: prefOff }),
    });

    // Behind pace is no longer a browser-notification preference: it must
    // remain visible as the Run-station action banner.
    act(() => {
      rerender(makeArmParams(EVAL_TICK, { currentRun: run, prefs: prefOff }));
    });

    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);

    // Subsequent ticks are still latched, so it does not re-fire.
    act(() => {
      rerender(makeArmParams(EVAL_TICK + 1_000, { currentRun: run, prefs: undefined }));
    });

    expect(vibrateMock).toHaveBeenCalledOnce();
  });

  it("showPaceAlert and paceAlertMsg are set when the alert fires", () => {
    const run = makeRun({ startedAt: T0 });

    const { rerender, result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeArmParams(ARM_TICK, { currentRun: run }),
    });

    expect(result.current.showPaceAlert).toBe(false);
    expect(result.current.paceAlertMsg).toBe("");

    act(() => {
      rerender(makeArmParams(EVAL_TICK, { currentRun: run }));
    });

    // Both in-app state values must be set alongside vibrate.
    expect(result.current.showPaceAlert).toBe(true);
    expect(result.current.paceAlertMsg).toMatch(/Behind pace|cases short|min remaining/i);
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
  });

  // ── 9. Pace stays in-app even when browser notifications are available ─────
  it("does not call the Notification constructor for behind pace", async () => {
    const notifCtor = injectNotificationStub("granted");
    const run = makeRun({ startedAt: T0 });

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Arm tick: elapsedMin = 5 < 10 → paceArmedRef.add(runId), returns early.
      initialProps: makeArmParams(ARM_TICK, { currentRun: run }),
    });

    expect(notifCtor).not.toHaveBeenCalled();

    // Eval tick: crosses the shortfall threshold → fires the behind-pace alert.
    act(() => {
      rerender(makeArmParams(EVAL_TICK, { currentRun: run }));
    });

    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
    expect(notifCtor).not.toHaveBeenCalled();
  });
});
