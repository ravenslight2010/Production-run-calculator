// @vitest-environment jsdom
//
// Regression guard: confirms the warehouse staging effect returns cleanly when
// the Notification API is entirely absent (the early-return guard fires).
//
// Analogous to the run-complete / freezer-drain coverage in
// useNotifications.runComplete.test.ts — those effects guard with
// `"Notification" in window` AFTER their vibrate call, so vibrate IS the
// observable signal. The warehouse staging effect guards BEFORE vibrate, so
// vibrate must NOT be called at all when Notification is absent.
//
// This file deliberately does NOT install a Notification stub. The
// `useNotifications.warehouseStaging.test.ts` file covers the vibrate +
// notification path; this file covers the early-return path.

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

// Stable empty array so nextRunLabels never causes spurious effect re-runs.
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
 * Base params that keep only the warehouse staging effect potentially active:
 *
 *   casesPerSkid = 10  → frontline threshold: pressCasesLeft ≤ 20
 *                         packaging threshold: pressCasesLeft ≤ 10
 *
 * pressCasesLeft starts at 25 (above both thresholds). Tests step it into
 * range to prove the early-return guard fires instead of vibrate.
 *
 * Other effects are suppressed:
 *   timePerBatchSec = 0  → batch-cycle effect returns early
 *   adjustedTimeSec = 45 min >> 15-min threshold → 15-min alert clears
 *   elapsed (3 min) < freezerTime (10 min) → pace effect arms only, never fires
 */
function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(T0 + 3 * 60_000), // 3 min elapsed
    currentRun: makeRun(),
    calc: {
      adjustedTimeSec: 45 * 60,   // well above 15-min alert threshold
      timePerBatchSec: 0,         // disables batch-cycle effect
      ppm: 120,                   // positive — warehouse staging guard passed
      casesCompleted: 10,
      casesInFreezer: 0,
      pressCasesLeft: 25,         // above both staging thresholds initially
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

// ── vibrate stub ─────────────────────────────────────────────────────────────
// navigator.vibrate is optional-chained in the hook so it never throws even
// when missing; we assign a vi.fn() so we can assert it was NOT called.
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

describe("useNotifications — warehouse staging (no Notification API)", () => {

  // ── 1. Crossing frontline threshold does NOT call vibrate ────────────────
  it("does NOT call vibrate when crossing the frontline threshold with Notification absent", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(),   // pressCasesLeft = 25 > 20 → above threshold
    });

    expect(vibrateMock).not.toHaveBeenCalled();

    // Cross the frontline threshold (pressCasesLeft = 18 ≤ 20, > 10).
    // Without the `"Notification" in window` guard the effect would call vibrate;
    // with the guard it returns early and vibrate stays silent.
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 18 } }));
    });

    // The early-return guard fired — vibrate must NOT have been called.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 2. Crossing packaging threshold does NOT call vibrate ────────────────
  it("does NOT call vibrate when crossing the packaging threshold with Notification absent", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(),
    });

    // Cross frontline first.
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 18 } }));
    });

    // Cross packaging threshold (pressCasesLeft = 8 ≤ 10).
    act(() => {
      rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 8 } }));
    });

    // Both thresholds crossed — neither should have called vibrate.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  // ── 3. No crash or ReferenceError at any threshold crossing ─────────────
  it("does not throw when pressCasesLeft sweeps through both thresholds with Notification absent", () => {
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(),
    });

    // Sweep through all relevant values — must never throw.
    expect(() => {
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 20 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 15 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 10 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 5 } })); });
      act(() => { rerender(makeParams({ calc: { ...makeParams().calc, pressCasesLeft: 1 } })); });
    }).not.toThrow();

    // Still no vibrate calls.
    expect(vibrateMock).not.toHaveBeenCalled();
  });
});
