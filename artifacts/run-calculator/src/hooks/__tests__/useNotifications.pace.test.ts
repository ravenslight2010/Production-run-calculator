// @vitest-environment jsdom
//
// Unit tests for the behind-pace alert in useNotifications.
//
// Covers four scenarios called out in the task spec:
//  1. Alert does NOT fire before freezerTime minutes have elapsed (arm-only window).
//  2. Alert fires exactly once when shortfall ≥ 10 cases AND ≤ 30 min remain,
//     after the run was first observed while on pace.
//  3. Alert does NOT fire when the run was already behind from the very first
//     observation (never-armed → never-fires, prevents old-run re-fire).
//     Also: alert does not fire when runStatus = "ended" (navigation to old run).
//  4. Alert does NOT fire when ppm = 0 or casesNeeded = 0.
//
// The hook is exercised directly (not mocked) via renderHook so the latch
// logic in paceArmedRef and paceFiredRef is exercised against real state.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import type { RunMeta } from "../../types";

// ── Fixed epoch ──────────────────────────────────────────────────────────────
const T0 = 1_700_000_000_000;

// ── Helper: make a minimal running RunMeta ───────────────────────────────────
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

// ── Helper: make full useNotifications params ────────────────────────────────
//
// Default calc values produce a clear "behind pace" condition at 15 min elapsed:
//   elapsedMin = 15, casesCompleted = 50, adjustedTimeSec = 25*60
//   actualRateCasesPerHr = (50/15)*60 ≈ 200
//   projectedFinish = 50 + 200*25/60 ≈ 133
//   shortfall = ceil(200 - 133) = 67 ≥ 10  ✓
//   timeRemainingMin = 25 ≤ 30              ✓
//   → conditionMet = true

type Params = Parameters<typeof useNotifications>[0];

function makeParams(nowMs: number, overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(nowMs),
    currentRun: makeRun(),
    calc: {
      adjustedTimeSec: 25 * 60, // 25 min remaining
      timePerBatchSec: 360,
      ppm: 100,
      casesCompleted: 50,
      casesInFreezer: 0,
      pressCasesLeft: 20,
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

// Convenience time constants:
//   EARLY_MS  → 5 min elapsed  → elapsedMin < freezerTime(10) → arms, does not evaluate condition
//   BEHIND_MS → 15 min elapsed → elapsedMin ≥ freezerTime(10), conditionMet = true
const EARLY_MS = T0 + 5 * 60_000;
const BEHIND_MS = T0 + 15 * 60_000;

// ── Browser API stubs ────────────────────────────────────────────────────────
// navigator.vibrate is optional-chained in the hook so it never throws.
// The Notification API is guarded by `"Notification" in window` throughout
// the hook, so no stub is needed when jsdom omits it.
//
// No fake-timer setup is needed: the pace alert effect is purely reactive to
// nowTime prop changes, and the batch-due setTimeout auto-dismiss (10 s) is
// irrelevant to pace-alert assertions.

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("useNotifications — pace alert", () => {
  // ── 1. No fire before freezerTime elapsed ────────────────────────────────
  it("does NOT fire when elapsed time < freezerTime (arm-only window)", () => {
    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(EARLY_MS),
    });

    // elapsedMin = 5 < freezerTime(10) → only arms, never fires.
    expect(result.current.showPaceAlert).toBe(false);
    expect(result.current.paceAlertMsg).toBe("");
  });

  // ── 2. Fires exactly once after good-pace observation ────────────────────
  it("fires exactly once when shortfall ≥ 10 and ≤ 30 min remain, after being armed", () => {
    const { result, rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(EARLY_MS),
    });

    // Step 1 (elapsedMin = 5): effect arms the run via the early-return branch,
    // showPaceAlert stays false.
    expect(result.current.showPaceAlert).toBe(false);

    // Step 2 (elapsedMin = 15): conditionMet = true, run was armed → fires.
    act(() => {
      rerender(makeParams(BEHIND_MS));
    });

    expect(result.current.showPaceAlert).toBe(true);
    // Message should mention the approximate rate and minutes remaining.
    expect(result.current.paceAlertMsg).toMatch(/\/hr/);
    expect(result.current.paceAlertMsg).toMatch(/min remaining/i);

    // Step 3: user dismisses the banner; another tick must NOT re-fire it
    // (paceFiredRef already holds this run's id).
    act(() => {
      result.current.setShowPaceAlert(false);
    });
    act(() => {
      rerender(makeParams(BEHIND_MS + 1_000)); // 1 s later, still behind
    });
    expect(result.current.showPaceAlert).toBe(false);
  });

  // ── 3a. No fire when run was already behind from first observation ────────
  it("does NOT fire when the run was behind pace from the very first tick (never armed)", () => {
    // First (and only) observation is at 15 min elapsed with conditionMet = true.
    // Because paceArmedRef never observed this run while on-pace, the "only fire
    // if armed" guard prevents the alert.  This is the re-fire-on-old-run guard.
    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(BEHIND_MS),
    });

    expect(result.current.showPaceAlert).toBe(false);
    expect(result.current.paceAlertMsg).toBe("");
  });

  // ── 3b. No fire when navigating to an ended run ───────────────────────────
  it("does NOT fire when runStatus is 'ended' (navigating to an old completed run)", () => {
    const endedRun = makeRun({ endedAt: BEHIND_MS });

    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(BEHIND_MS, {
        runStatus: "ended",
        currentRun: endedRun,
      }),
    });

    // The effect's first guard (`runStatus !== "running"`) returns immediately.
    expect(result.current.showPaceAlert).toBe(false);
  });

  // ── 4a. No fire when ppm = 0 ─────────────────────────────────────────────
  it("does NOT fire when ppm is 0", () => {
    const noPpm = {
      ...makeParams(EARLY_MS).calc,
      ppm: 0,
    };

    const { result, rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(EARLY_MS, { calc: noPpm }),
    });

    act(() => {
      rerender(makeParams(BEHIND_MS, { calc: noPpm }));
    });

    // Effect returns early at `if (calc.ppm <= 0) return` — never fires.
    expect(result.current.showPaceAlert).toBe(false);
  });

  // ── 4b. No fire when casesNeeded = 0 ─────────────────────────────────────
  it("does NOT fire when casesNeeded is 0", () => {
    const zeroNeeded = { ...makeParams(EARLY_MS).v, casesNeeded: 0 };

    const { result, rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(EARLY_MS, { v: zeroNeeded }),
    });

    act(() => {
      rerender(makeParams(BEHIND_MS, { v: zeroNeeded }));
    });

    // Effect returns early at `if (casesNeeded <= 0) return` — never fires.
    expect(result.current.showPaceAlert).toBe(false);
  });

  // ── 4c. In-tunnel cases count toward throughput (no false alarm) ─────────
  it("does NOT fire when cased + in-tunnel output is on pace (task example)", () => {
    // 35 min at 40 PPM / 12 per case / 18-min tunnel: 54 cased + 60 in tunnel.
    // Cased-only rate ≈ 93/hr would project a big shortfall (false alarm);
    // press-output rate ≈ 195/hr projects finish ≥ casesNeeded → no alert.
    const NOW = T0 + 35 * 60_000;
    const calc = {
      ...makeParams(NOW).calc,
      adjustedTimeSec: 25 * 60, // 25 min remaining (≤ 30-min window)
      casesCompleted: 54,
      casesInFreezer: 60,
    };
    const v = { freezerTime: 18, casesNeeded: 195, casesPerSkid: 10 };

    const { result, rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(EARLY_MS, { calc, v }),
    });
    act(() => {
      rerender(makeParams(NOW, { calc, v }));
    });
    // pressOutput = 114 → rate ≈ 195/hr → projectedFinish ≈ 114 + 81 = 195 ≥ needed.
    expect(result.current.showPaceAlert).toBe(false);
  });

  // ── 5. Alert clears when switching to a different run ────────────────────
  it("clears the pace banner when the active run changes", () => {
    const { result, rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(EARLY_MS),
    });

    // Arm and fire for run-1.
    act(() => {
      rerender(makeParams(BEHIND_MS));
    });
    expect(result.current.showPaceAlert).toBe(true);

    // Switch to run-2 (different id) — the clear-on-id-change effect fires.
    act(() => {
      rerender(
        makeParams(BEHIND_MS, {
          currentRun: makeRun({ id: "run-2", startedAt: BEHIND_MS }),
        }),
      );
    });
    expect(result.current.showPaceAlert).toBe(false);
  });
});
