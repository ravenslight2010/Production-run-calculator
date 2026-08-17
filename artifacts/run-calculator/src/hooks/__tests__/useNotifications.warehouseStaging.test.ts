// @vitest-environment jsdom
//
// Unit tests for the warehouse staging alerts in useNotifications.
//
// Covers four scenarios called out in the task spec:
//  1. Frontline alert fires once when pressCasesLeft ≤ 2 × casesPerSkid.
//  2. Packaging alert fires once when pressCasesLeft ≤ casesPerSkid.
//  3. Neither re-fires when navigating to an already-ended run
//     (runStatus=ended guard, and per-run Set-latch prevents re-trigger).
//  4. Neither fires when ppm ≤ 0 or casesNeeded = 0.
//
// Side-effect detection strategy: the warehouse staging effect calls
// navigator.vibrate([200, 100, 200]) SYNCHRONOUSLY inside fireStage()
// before the async showAppNotification.  We spy on navigator.vibrate so
// the latch bookkeeping in frontlineNotifRef / packagingNotifRef is tested
// through real, observable behaviour without needing to flush async
// notification micro-tasks.
//
// Isolation notes:
//  • timePerBatchSec = 0 → batch-cycle effect returns early (no vibrate
//    from that path).
//  • elapsed time < PACE_MIN_ELAPSED_MIN (10 min) → pace effect only
//    arms, never fires (no vibrate from that path).
//  • adjustedTimeSec > 900 s → 15-min alert is well clear of its threshold.
//  • A stable EMPTY_LABELS constant prevents nextRunLabels array-reference
//    churn from spuriously re-running the effect.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import type { RunMeta } from "../../types";

// ── Fixed epoch ──────────────────────────────────────────────────────────────
const T0 = 1_700_000_000_000;

// Stable empty array so the nextRunLabels dep never changes reference between
// rerenders — a new [] each call would re-run the effect unnecessarily.
const EMPTY_LABELS: string[] = [];

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
 * Build default params that keep ONLY the warehouse staging effect active:
 *
 *   casesPerSkid = 10  → frontline threshold: pressCasesLeft ≤ 20
 *                         packaging threshold: pressCasesLeft ≤ 10
 *
 * Chosen defaults place pressCasesLeft = 25 — above both thresholds — so
 * the initial render fires nothing.  Tests step it down to cross each
 * threshold individually.
 *
 * Pace alert is suppressed: elapsed = nowTime - T0 = 3 min < 10 min limit.
 * Batch alert is suppressed: timePerBatchSec = 0 → effect returns early.
 * 15-min alert is suppressed: adjustedTimeSec = 45 min >> 15-min threshold.
 */
function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(T0 + 3 * 60_000), // 3 min elapsed — pace alert arm-only
    currentRun: makeRun(),
    calc: {
      adjustedTimeSec: 45 * 60,   // 45 min remaining — above 15-min alert
      timePerBatchSec: 0,         // disables batch-cycle alert
      ppm: 120,                   // positive — warehouse staging is active
      casesCompleted: 10,
      pressCasesLeft: 25,         // above both staging thresholds at start
      pressDone: false,
    },
    v: {
      freezerTime: 10,
      casesNeeded: 200,
      casesPerSkid: 10,
    },
    isCrust: false,
    nextRunLabels: EMPTY_LABELS,
    prefs: undefined,
    ...overrides,
  };
}

// ── Browser API stubs ─────────────────────────────────────────────────────────
// jsdom does not provide the Notification API.  The warehouse staging effect
// guards with `!("Notification" in window)` — if Notification is absent the
// whole effect returns without touching vibrate, so the spy would always read 0.
// We install a stub with permission = "granted" so the granted branch fires
// synchronously (no Notification.requestPermission() call needed).
//
// navigator.vibrate is optional-chained in the hook so it never throws even
// when missing; we assign a plain vi.fn() so we can count calls.

let vibrateMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  // Notification stub — permission "granted", constructor no-op (async IIFE
  // inside showAppNotification will call `new Notification(...)` but we only
  // care about the synchronous vibrate call that precedes it).
  const MockNotification = vi.fn() as unknown as typeof Notification;
  (MockNotification as unknown as Record<string, unknown>).permission = "granted";
  Object.defineProperty(window, "Notification", {
    value: MockNotification,
    writable: true,
    configurable: true,
  });

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("useNotifications — warehouse staging alerts", () => {

  // ── 1. Frontline fires once at ≤ 2 × casesPerSkid ───────────────────────
  it("fires frontline alert exactly once when pressCasesLeft crosses ≤ 2×casesPerSkid", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(),       // pressCasesLeft = 25 > 20 → no fire
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Cross the frontline threshold (pressCasesLeft = 18 ≤ 20, > 10)
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 18 } }));
    });

    // Frontline fires: vibrate called once with the staging pattern.
    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);

    // Step pressCasesLeft further down — effect re-runs, but latch holds.
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 16 } }));
    });

    // Still exactly one call — latch prevented a second fire.
    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  // ── 2. Packaging fires once at ≤ 1 × casesPerSkid ──────────────────────
  it("fires packaging alert exactly once when pressCasesLeft crosses ≤ casesPerSkid", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(),       // pressCasesLeft = 25 → no fire
    });

    // Cross frontline first (casesPerSkid = 10 → frontline at ≤ 20)
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 18 } }));
    });
    const callsAfterFrontline = vibrateMock.mock.calls.length;
    expect(callsAfterFrontline).toBe(1); // frontline fires

    // Cross packaging threshold (pressCasesLeft = 9 ≤ 10)
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 9 } }));
    });

    // One more vibrate for packaging (total 2).
    expect(vibrateMock).toHaveBeenCalledTimes(2);

    // Another step down — latch prevents both from re-firing.
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 7 } }));
    });
    expect(vibrateMock).toHaveBeenCalledTimes(2);
  });

  // ── 3a. No re-fire on already-ended run (runStatus guard) ───────────────
  it("does NOT fire when runStatus is 'ended' (navigating to a completed run)", () => {
    const endedRun = makeRun({ endedAt: T0 + 60 * 60_000 });

    renderHook((p: Params) => useNotifications(p), {
      // pressCasesLeft = 5 would trigger both thresholds if the guard were absent.
      initialProps: makeParams({
        runStatus: "ended",
        currentRun: endedRun,
        calc: { ...makeParams().calc, pressCasesLeft: 5 },
      }),
    });

    // Effect returns at the first guard (`currentRun?.endedAt` is set).
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 3b. Per-run Set-latch: no re-fire after navigating away and back ─────
  it("does NOT re-fire after navigating away from a run and back to it", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(),       // pressCasesLeft = 25 → no fire
    });

    // Fire frontline for run-1.
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 15 } }));
    });
    expect(vibrateMock).toHaveBeenCalledTimes(1);

    // Navigate to a different run.
    act(() => {
      rerender(makeParams({
        currentRun: makeRun({ id: "run-2", startedAt: T0 + 1000 }),
        calc: { ...makeParams().calc, pressCasesLeft: 25 }, // above thresholds
      }));
    });

    // Navigate back to run-1 with pressCasesLeft still at 15 (below frontline).
    act(() => {
      rerender(makeParams({
        currentRun: makeRun({ id: "run-1" }),
        calc: { ...makeParams().calc, pressCasesLeft: 15 },
      }));
    });

    // The Set latch for run-1 is still populated — no additional fire.
    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  // ── 4a. No fire when ppm ≤ 0 ────────────────────────────────────────────
  it("does NOT fire when ppm is 0", () => {
    const noPpm = { ...makeParams().calc, ppm: 0, pressCasesLeft: 5 };

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ calc: noPpm }),
    });

    act(() => {
      rerender(makeParams({ calc: { ...noPpm, pressCasesLeft: 4 } }));
    });

    // Effect returns at `if (calc.ppm <= 0) return`.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 4b. No fire when casesNeeded = 0 ────────────────────────────────────
  it("does NOT fire when casesNeeded is 0", () => {
    const zeroNeeded = { ...makeParams().v, casesNeeded: 0 };

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ v: zeroNeeded, calc: { ...makeParams().calc, pressCasesLeft: 5 } }),
    });

    act(() => {
      rerender(makeParams({ v: zeroNeeded, calc: { ...makeParams().calc, pressCasesLeft: 4 } }));
    });

    // Effect returns at `if (cps <= 0 || needed <= 0) return`.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 4c. No fire when casesPerSkid = 0 ───────────────────────────────────
  it("does NOT fire when casesPerSkid is 0", () => {
    const zeroCps = { ...makeParams().v, casesPerSkid: 0 };

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ v: zeroCps, calc: { ...makeParams().calc, pressCasesLeft: 5 } }),
    });

    act(() => {
      rerender(makeParams({ v: zeroCps, calc: { ...makeParams().calc, pressCasesLeft: 4 } }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 5. Suppressed pref: silently latches, does not re-fire on re-enable ──
  it("latches silently when warehouseStaging pref is off, preventing fire on re-enable", () => {
    const prefOff = { warehouseStaging: false } as import("../../../notificationPrefs").NotificationPrefs;
    const prefOn  = undefined; // missing key = ON

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // pref is OFF, pressCasesLeft already below frontline threshold.
      initialProps: makeParams({
        prefs: prefOff,
        calc: { ...makeParams().calc, pressCasesLeft: 15 },
      }),
    });

    // Alert suppressed but silently latched — vibrate never called.
    expect(vibrateMock).not.toHaveBeenCalled();

    // Re-enable the pref and step pressCasesLeft further down to re-trigger.
    act(() => {
      rerender(makeParams({
        prefs: prefOn,
        calc: { ...makeParams().calc, pressCasesLeft: 14 },
      }));
    });

    // The milestone was already latched while suppressed — must NOT fire.
    expect(vibrateMock).not.toHaveBeenCalled();
  });
});
