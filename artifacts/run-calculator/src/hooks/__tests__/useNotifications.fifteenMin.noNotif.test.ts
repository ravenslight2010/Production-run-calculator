// @vitest-environment jsdom
//
// Regression guard: confirms the 15-minute end-of-run effect returns cleanly
// when the Notification API is entirely absent (the early-return guard fires).
//
// The 15-minute effect (lines 182–225 of useNotifications.ts) wraps ALL
// notification and vibrate logic inside `if ("Notification" in window)`, so
// when Notification is absent the block is entirely skipped — no crash, no
// ReferenceError, and no vibrate call.
//
// This file deliberately does NOT install a Notification stub. The tests
// confirm that crossing the 15-minute threshold with Notification absent
// produces no side-effects and no exceptions. It is analogous to the
// warehouse-staging no-Notification guard in
// useNotifications.warehouseStaging.noNotif.test.ts.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import type { RunMeta } from "../../types";

// ── Sanity: confirm jsdom really omits Notification ──────────────────────────
// If this assertion fails the whole test file's premise is wrong.
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
 * Base params designed to isolate the 15-minute effect.
 *
 * To allow the 15-minute crossing latch to arm, adjustedTimeSec starts
 * above 900 s (15 min) so sawAbove15Ref is seeded, then tests step it
 * into the ≤ 900 s range to trigger the effect body.
 *
 * Other effects are suppressed:
 *   timePerBatchSec = 0      → batch-cycle effect returns early
 *   runStatus = "running",   → freezer-drain effect returns early (needs "ended")
 *   ppm = 100, pressCasesLeft = 50 → warehouse staging stays above both thresholds
 *   elapsed (3 min) < freezerTime (10 min) → pace effect arms only, never fires
 */
function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(T0 + 3 * 60_000), // 3 min elapsed
    currentRun: makeRun(),
    calc: {
      adjustedTimeSec: 20 * 60,   // 20 min — well above 15-min threshold
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
// navigator.vibrate is optional-chained in the hook, so it never throws when
// missing; we assign a vi.fn() so we can assert it was NOT called.
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useNotifications — 15-minute end-of-run alert (no Notification API)", () => {

  // ── 1. Crossing the 15-minute threshold does NOT call vibrate ─────────────
  it("does NOT call vibrate when crossing the 15-minute threshold with Notification absent", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Initial render: adjustedTimeSec = 20 min > 15 min → sawAbove15Ref arms.
      initialProps: makeParams(),
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Cross the 15-minute threshold (adjustedTimeSec = 800 s ≤ 900 s, > 0).
    // Without the `"Notification" in window` guard the effect would enter the
    // notification block; with the guard it returns early and vibrate stays silent.
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 800 } }));
    });

    // The early-return guard fired — vibrate must NOT have been called.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 2. Subsequent ticks in the ≤ 900 s zone do NOT call vibrate ──────────
  it("does NOT call vibrate on repeated ticks below 15 minutes with Notification absent", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(),
    });

    // Cross threshold.
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 800 } }));
    });

    // Additional ticks.
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 600 } }));
    });
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 300 } }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 3. No crash or ReferenceError at any point in the countdown ───────────
  it("does not throw when adjustedTimeSec sweeps from above 15 min down toward 0 with Notification absent", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(),
    });

    // Sweep from above 15 min down to 1 s remaining — must never throw.
    // Note: we stop at 1 s (not 0) because reaching 0 would trigger the
    // separate run-complete effect (which does call vibrate). The 15-minute
    // effect only fires while adjustedTimeSec > 0 && ≤ 900, so 1 s covers
    // the full danger zone for this effect.
    expect(() => {
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 950 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 900 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 800 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 600 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 300 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 1 } })); });
    }).not.toThrow();

    // No vibrate calls throughout.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 4. A run that starts already below 15 min never arms, no vibrate ──────
  it("does NOT call vibrate for a short run that never exceeds 15 minutes remaining", () => {
    // adjustedTimeSec is already ≤ 900 s from the first tick → sawAbove15Ref is
    // never set → the effect returns at the `if (!sawAbove15Ref.current.has(runId)) return` guard.
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 800 } }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, adjustedTimeSec: 400 } }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 5. Effect does not crash when the run is ended ────────────────────────
  it("does not throw when currentRun has endedAt set (effect should return early)", () => {
    const endedRun = makeRun({ endedAt: T0 + 20 * 60_000 });

    expect(() => {
      renderHook((p: Params) => useNotifications(p), {
        initialProps: makeParams({
          runStatus: "ended",
          currentRun: endedRun,
          calc: { ...makeParams().calc, adjustedTimeSec: 800 },
        }),
      });
    }).not.toThrow();

    expect(vibrateMock).not.toHaveBeenCalled();
  });
});
