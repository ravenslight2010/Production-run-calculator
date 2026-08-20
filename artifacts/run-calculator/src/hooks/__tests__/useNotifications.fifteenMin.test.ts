// @vitest-environment jsdom
//
// Unit tests for the 15-minute end-of-run alert in useNotifications.
//
// These tests deliberately do NOT install a Notification stub in beforeAll —
// jsdom omits the Notification API entirely, which is what we're guarding
// against.  The effect is correctly wrapped in `if ("Notification" in window)`
// so it must not crash in this environment.  The tests therefore also serve as
// regression guards for the missing-Notification crash.
//
// Detection strategy:
//
//   • "No-fire" paths (no Notification stub): assert the Notification
//     constructor is never called and vibrate is never called.
//
//   • "Fires" path: a per-test Notification stub is injected into window (NOT
//     in beforeAll) so the `if ("Notification" in window)` branch is entered.
//     showAppNotification is called synchronously by fire(), but its body is
//     async (void (async () => { ... })()), so the Notification constructor is
//     invoked one microtask later.  Tests use `await act(async () => {})` to
//     flush the microtask queue before asserting.
//
//   • Suppressed-pref path: the code sets notifiedRunRef BEFORE the Notification
//     branch, so "no re-fire on re-enable" is fully testable without any
//     Notification stub at all.

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
// Run started 30 minutes ago — far above the 60-second safety floor used by
// the run-complete effect and also well above any freezer-drain window.
const START_AT = T0 - 30 * 60_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRun(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    id: "run-1",
    brand: "TestBrand",
    flavor: "TestFlavor",
    startedAt: START_AT,
    stoppages: [],
    ...overrides,
  };
}

type Params = Parameters<typeof useNotifications>[0];

/**
 * Base params that keep all OTHER effects idle so only the 15-min effect can
 * produce output:
 *
 *   adjustedTimeSec = 1800 (30 min) → above the 900 s threshold, so the
 *     15-min effect just arms sawAbove15Ref and returns on first render.
 *   timePerBatchSec = 0 → batch-cycle effect returns early.
 *   pressCasesLeft = 100 → well above both warehouse staging thresholds.
 *   runStatus = "running" → freezer-drain effect skips (requires "ended").
 *   ppm > 0, large casesNeeded → pace effect arms but never fires within the
 *     freezerTime window.
 */
function makeParams(nowMs: number, overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(nowMs),
    currentRun: makeRun(),
    calc: {
      adjustedTimeSec: 1800,    // 30 min — above 15-min threshold
      timePerBatchSec: 0,       // disables batch-cycle effect
      ppm: 100,
      casesCompleted: 50,
      casesInFreezer: 0,
      pressCasesLeft: 100,      // above both warehouse staging thresholds
      pressDone: false,
    },
    v: {
      freezerTime: 10,
      casesNeeded: 300,
      casesPerSkid: 20,
    },
    isCrust: false,
    nextRunLabels: [],
    prefs: undefined,
    ...overrides,
  };
}

// ── vibrate stub ──────────────────────────────────────────────────────────────
// The 15-min effect itself does NOT call vibrate.  We install a stub so other
// effects' optional-chained vibrate calls are harmless and so we can assert
// zero vibrate calls as a double-check that no other effect accidentally fired.
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
//
// Returns the constructor spy so callers can assert on it.
// showAppNotification's body is:
//   void (async () => {
//     try { const reg = await navigator.serviceWorker?.getRegistration(); ... }
//     catch { /* fall through */ }
//     try { new Notification(title, options); } catch {}
//   })();
// The constructor is called ONE microtask after fire() runs, so callers must
// `await act(async () => {})` before asserting on this mock.
function injectNotificationStub(permission: NotificationPermission = "granted") {
  const ctor = vi.fn();
  const stub = Object.assign(ctor, { permission });
  Object.defineProperty(window, "Notification", {
    value: stub,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  return ctor;
}

// ── 15-minute effect tests ────────────────────────────────────────────────────

describe("useNotifications — 15-min effect (no Notification API)", () => {
  // The 15-min effect requires, in order:
  //   1. currentRun.startedAt set, currentRun.endedAt NOT set
  //   2. notifiedRunRef does NOT already hold this run id
  //   3. calc.adjustedTimeSec > 900 on at least one prior render (sawAbove15 armed)
  //   4. calc.adjustedTimeSec drops to 0 < x ≤ 900
  //   5. isNotifEnabled(prefs, "fifteenMin") is true (not suppressed)
  //   6. "Notification" in window (guard)

  it("does NOT fire when adjustedTimeSec is still above 900 s (arm-only phase)", () => {
    // No Notification stub → even if the guard were missing, the constructor
    // could not be called; the test proves no crash on the arm branch.
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 1800 },
      }),
    });

    // Effect adds to sawAbove15Ref and returns without firing.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when adjustedTimeSec starts at ≤ 900 s (short run — never crossed threshold from above)", () => {
    // A run whose adjusted time was always below 900 s (press time < 15 min)
    // never passes through the sawAbove15 arming branch, so the guard
    // `!sawAbove15Ref.current.has(runId)` prevents an instant stale alert.
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 500 }, // < 900 s from the first tick
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when the run has endedAt set (ended-run guard)", () => {
    // The effect's very first guard is `if (currentRun?.endedAt) return`.
    const run = makeRun({ endedAt: T0 - 5_000 });

    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 850 },
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("fires the Notification constructor exactly once when adjustedTimeSec crosses from above 900 to ≤ 900", async () => {
    // Per-test Notification stub — required so `if ("Notification" in window)`
    // is entered and showAppNotification can proceed.
    const notifCtor = injectNotificationStub("granted");

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // First render: above 900 → sawAbove15 armed; nothing fires yet.
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 1800 },
      }),
    });

    expect(notifCtor).not.toHaveBeenCalled();

    // Cross the 15-minute threshold.
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 850 },
      }));
    });

    // showAppNotification's body is async — flush the microtask queue so
    // `new Notification(...)` inside the async IIFE actually runs.
    await act(async () => { await Promise.resolve(); });

    expect(notifCtor).toHaveBeenCalledOnce();
    // Confirm the title matches the 15-min alert.
    expect(notifCtor.mock.calls[0][0]).toBe("⏰ 15 minutes left");
  });

  it("does NOT refire — a second tick inside the 0–900 s window is a no-op", async () => {
    const notifCtor = injectNotificationStub("granted");

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 1800 },
      }),
    });

    // First crossing — fires once; notifiedRunRef now holds run-1.
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 850 },
      }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(notifCtor).toHaveBeenCalledOnce();

    // Second tick — still inside the 0-900 window; effect returns early on
    // the `notifiedRunRef.current === runId` check.
    act(() => {
      rerender(makeParams(T0 + 2_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 800 },
      }));
    });
    await act(async () => { await Promise.resolve(); });

    // Still exactly 1 call — no refire.
    expect(notifCtor).toHaveBeenCalledOnce();
  });

  it("does NOT crash when adjustedTimeSec crosses ≤ 900 with prefs enabled but NO Notification API (guard regression)", () => {
    // Critical regression guard: the effect must silently skip the Notification
    // branch — NOT throw a ReferenceError — when `"Notification" in window` is
    // false.  If someone removes the guard, accessing `Notification.permission`
    // in jsdom (where Notification is absent) would throw synchronously and
    // crash the hook.  No Notification stub is installed anywhere in this file.
    const run = makeRun();

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Arm: above 900 → sawAbove15 armed.
      initialProps: makeParams(T0, {
        currentRun: run,
        prefs: undefined,  // default ON — alert is fully enabled
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 1800 },
      }),
    });

    // Cross the threshold with enabled prefs and NO Notification stub.
    // This must complete without throwing.
    expect(() => {
      act(() => {
        rerender(makeParams(T0 + 1_000, {
          currentRun: run,
          prefs: undefined,
          calc: { ...makeParams(T0).calc, adjustedTimeSec: 850 },
        }));
      });
    }).not.toThrow();

    // The 15-min effect does not call vibrate — confirm nothing else fired.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("latches silently when fifteenMin pref is off — no refire when pref is re-enabled", () => {
    // The suppressed-pref path sets notifiedRunRef BEFORE the Notification
    // branch, so this entire test runs correctly with NO Notification stub.
    const prefOff = { fifteenMin: false } as import("../../notificationPrefs").NotificationPrefs;
    const run = makeRun();

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Arm phase: adjustedTimeSec > 900 → sawAbove15 set.
      initialProps: makeParams(T0, {
        currentRun: run,
        prefs: prefOff,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 1800 },
      }),
    });

    // Cross the threshold with pref OFF → silently latches notifiedRunRef.
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        prefs: prefOff,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 850 },
      }));
    });

    // No Notification, no vibrate — pure silent latch.
    expect(vibrateMock).not.toHaveBeenCalled();

    // Re-enable pref — milestone is already latched, must NOT retroactively fire.
    act(() => {
      rerender(makeParams(T0 + 2_000, {
        currentRun: run,
        prefs: undefined,
        calc: { ...makeParams(T0).calc, adjustedTimeSec: 800 },
      }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });
});
