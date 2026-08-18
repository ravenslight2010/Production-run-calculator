// @vitest-environment jsdom
//
// Unit tests for the warehouse-staging alert in useNotifications (lines 236–299).
//
// These tests deliberately do NOT install a Notification stub in beforeAll —
// jsdom omits the Notification API entirely, which is what we're guarding
// against.  The effect reaches `Notification.permission` only after the
// `if (!("Notification" in window)) return;` guard (line 245), so it must not
// crash in this environment.  The tests therefore also serve as regression
// guards for accidental guard removal.
//
// Detection strategy:
//
//   • "No-fire" paths (no Notification stub): assert the Notification
//     constructor is never called and vibrate is never called.  The effect
//     returns at the guard on line 245, before either branch runs.
//
//   • "Fires" path: a per-test Notification stub is injected into window (NOT
//     in beforeAll) so the `if (!("Notification" in window)) return` guard
//     is passed and showAppNotification can proceed.  vibrate is called
//     synchronously inside fireStage, so it is a reliable indicator that the
//     effect ran all the way through.  The Notification constructor itself is
//     invoked one microtask later (inside an async IIFE), so tests that assert
//     on it use `await act(async () => {})` to flush the microtask queue.
//
//   • Suppressed-pref path: the silent-latch branch runs AFTER the Notification
//     guard, so a per-test Notification stub is needed to reach it.  The latch
//     prevents retroactive firing when the pref is re-enabled mid-run.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import type { RunMeta } from "../../types";

// ── Sanity: confirm jsdom really omits Notification ──────────────────────────
// If this fails the whole test file's premise is wrong.
if (typeof window !== "undefined" && "Notification" in window) {
  throw new Error("Expected jsdom to NOT have Notification — test premise violated");
}

// ── Fixed epoch ───────────────────────────────────────────────────────────────
const T0 = 1_700_000_000_000;
// Run started 30 minutes ago — clears all safety-floor guards.
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
 * Base params that keep all OTHER effects idle so only the warehouse-staging
 * effect can produce output:
 *
 *   adjustedTimeSec = 45 min → well above 15-min threshold (no 15-min alert)
 *   timePerBatchSec = 0      → batch-cycle effect returns early
 *   ppm = 100                → valid timing basis (required by staging effect)
 *   casesNeeded = 200        → non-zero (required by staging effect)
 *   casesPerSkid = 20        → non-zero (required by staging effect)
 *   pressCasesLeft = 100     → well above 2*casesPerSkid=40 by default
 *   runStatus = "running"    → freezer-drain effect skips (requires "ended")
 *   elapsed < freezerTime    → pace effect arms but never fires
 */
function makeParams(nowMs: number, overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(nowMs),
    currentRun: makeRun(),
    calc: {
      adjustedTimeSec: 45 * 60,  // well above 15-min threshold
      timePerBatchSec: 0,        // disables batch-cycle effect
      ppm: 100,
      casesCompleted: 50,
      casesInFreezer: 0,
      pressCasesLeft: 100,       // well above 2*casesPerSkid threshold by default
      pressDone: false,
    },
    v: {
      freezerTime: 10,
      casesNeeded: 200,
      casesPerSkid: 20,
    },
    isCrust: false,
    nextRunLabels: [],
    prefs: undefined,
    ...overrides,
  };
}

// ── vibrate stub ──────────────────────────────────────────────────────────────
// vibrate is called synchronously inside fireStage (AFTER the Notification
// guard), so it is a reliable indicator that the effect body ran to completion.
// No Notification stub — that is the point of this file's beforeAll.
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
// The Notification constructor is called one microtask after fireStage runs
// (inside an async IIFE in showAppNotification), so callers must
// `await act(async () => {})` before asserting on the returned ctor mock.
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

// ── Warehouse-staging effect tests ────────────────────────────────────────────

describe("useNotifications — warehouse-staging effect (no Notification API)", () => {
  // The warehouse-staging effect requires, in order:
  //   1. runStatus = "running", startedAt set, endedAt NOT set
  //   2. calc.ppm > 0
  //   3. casesPerSkid > 0 and casesNeeded > 0
  //   4. pressCasesLeft > 0
  //   5. "Notification" in window        ← the guard under test
  //   6. pressCasesLeft ≤ 2*casesPerSkid → frontline not yet latched
  //   7. pressCasesLeft ≤ casesPerSkid   → packaging not yet latched
  //
  // vibrate is called synchronously INSIDE fireStage (after the guard),
  // so it is only reachable when Notification IS present.

  it("does NOT crash when pressCasesLeft crosses ≤ 2*casesPerSkid with NO Notification API", () => {
    // Critical regression guard: the effect must silently return at the
    // `!("Notification" in window)` guard — NOT throw a ReferenceError.
    // If someone removes the guard, accessing Notification.permission in jsdom
    // (where Notification is absent) would throw synchronously.
    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // First render: pressCasesLeft well above frontline threshold.
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100 },
      }),
    });

    // Cross the frontline threshold with NO Notification stub.
    expect(() => {
      act(() => {
        rerender(makeParams(T0 + 1_000, {
          currentRun: run,
          calc: { ...makeParams(T0).calc, pressCasesLeft: 35 }, // ≤ 2*20=40
        }));
      });
    }).not.toThrow();

    // Effect returned at the Notification guard — vibrate was never called.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("fires frontline alert exactly once when pressCasesLeft drops to ≤ 2*casesPerSkid", async () => {
    const notifCtor = injectNotificationStub("granted");

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Above threshold — no staging alert yet.
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100 },
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
    expect(notifCtor).not.toHaveBeenCalled();

    // Cross the frontline threshold: pressCasesLeft ≤ 2*casesPerSkid (40).
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35 },
      }));
    });

    // vibrate fires synchronously in fireStage.
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);

    // Flush microtask queue so the async Notification constructor call runs.
    await act(async () => { await Promise.resolve(); });

    expect(notifCtor).toHaveBeenCalledOnce();
    // Confirm frontline title.
    expect(notifCtor.mock.calls[0][0]).toBe("🚚 Warehouse: stage FRONTLINE for next run");
  });

  it("does NOT refire frontline — a second tick at the same pressCasesLeft is a no-op", async () => {
    const notifCtor = injectNotificationStub("granted");

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100 },
      }),
    });

    // First crossing — fires once.
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35 },
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(notifCtor).toHaveBeenCalledOnce();

    // Second tick — frontlineNotifRef already holds run-1.
    act(() => {
      rerender(makeParams(T0 + 2_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 30 },
      }));
    });
    await act(async () => { await Promise.resolve(); });

    // Still exactly 1 call — no refire.
    expect(notifCtor).toHaveBeenCalledOnce();
  });

  it("fires packaging alert when pressCasesLeft drops to ≤ casesPerSkid", async () => {
    const notifCtor = injectNotificationStub("granted");

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      // Start above frontline threshold.
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100 },
      }),
    });

    // Cross packaging threshold (≤ 1*casesPerSkid = 20); frontline also fires
    // here since this is the first time either latch triggers.
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 15 },
      }));
    });
    await act(async () => { await Promise.resolve(); });

    // Both frontline and packaging should have fired (both thresholds crossed).
    expect(notifCtor).toHaveBeenCalledTimes(2);
    const titles = notifCtor.mock.calls.map((c: unknown[]) => c[0]);
    expect(titles).toContain("🚚 Warehouse: stage FRONTLINE for next run");
    expect(titles).toContain("🚚 Warehouse: stage PACKAGING for next run");
  });

  it("fires frontline first, then packaging independently on a later tick", async () => {
    const notifCtor = injectNotificationStub("granted");

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100 },
      }),
    });

    // Step 1: cross frontline threshold only (between cps and 2*cps).
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35 }, // ≤40 but >20
      }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(notifCtor).toHaveBeenCalledOnce();
    expect(notifCtor.mock.calls[0][0]).toBe("🚚 Warehouse: stage FRONTLINE for next run");

    notifCtor.mockClear();
    vibrateMock.mockClear();

    // Step 2: cross packaging threshold.
    act(() => {
      rerender(makeParams(T0 + 2_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 15 }, // ≤20
      }));
    });
    await act(async () => { await Promise.resolve(); });

    // Only packaging fires this time — frontline is already latched.
    expect(notifCtor).toHaveBeenCalledOnce();
    expect(notifCtor.mock.calls[0][0]).toBe("🚚 Warehouse: stage PACKAGING for next run");
  });

  it("does NOT fire when ppm is 0 (no valid timing basis)", () => {
    const run = makeRun();

    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100, ppm: 0 },
      }),
    });

    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35, ppm: 0 },
      }));
    });

    // Effect returns early at `if (calc.ppm <= 0) return`.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when pressCasesLeft is 0 (press already done)", () => {
    const run = makeRun();

    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 0 },
      }),
    });

    // Effect returns early at `if (pressLeft <= 0) return`.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when runStatus is not 'running'", () => {
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        runStatus: "paused",
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35 },
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when the run has endedAt set", () => {
    const run = makeRun({ endedAt: T0 - 5_000 });

    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35 },
      }),
    });

    // Effect returns at the endedAt guard.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("latches silently when warehouseStaging pref is off — no refire when pref is re-enabled", async () => {
    // The suppressed-pref branch runs AFTER the `!("Notification" in window)`
    // guard, so a Notification stub is needed to reach it.
    const notifCtor = injectNotificationStub("granted");
    const prefOff = { warehouseStaging: false } as import("../../notificationPrefs").NotificationPrefs;

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        prefs: prefOff,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100 },
      }),
    });

    // Cross frontline threshold with pref OFF → silently latches both refs.
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        prefs: prefOff,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35 },
      }));
    });
    await act(async () => { await Promise.resolve(); });

    // Pref suppressed → no Notification, no vibrate.
    expect(notifCtor).not.toHaveBeenCalled();
    expect(vibrateMock).not.toHaveBeenCalled();

    // Re-enable pref — milestone is already latched, must NOT retroactively fire.
    act(() => {
      rerender(makeParams(T0 + 2_000, {
        currentRun: run,
        prefs: undefined,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 30 },
      }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(notifCtor).not.toHaveBeenCalled();
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("fires frontline with short-run message when needed < 2*casesPerSkid", async () => {
    // A short run (casesNeeded < 2*casesPerSkid) trips the frontline threshold
    // immediately at start.  The notification body should tell warehouse to
    // stage 2+ runs now.
    const notifCtor = injectNotificationStub("granted");

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        // Short run: needed=30, cps=20, so needed < 2*cps=40
        // pressCasesLeft starts above threshold.
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100 },
        v: { freezerTime: 10, casesNeeded: 30, casesPerSkid: 20 },
      }),
    });

    // Cross frontline threshold for a short run.
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35 }, // ≤ 2*20=40
        v: { freezerTime: 10, casesNeeded: 30, casesPerSkid: 20 },
      }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(notifCtor).toHaveBeenCalledOnce();
    expect(notifCtor.mock.calls[0][0]).toBe("🚚 Warehouse: stage FRONTLINE for next run");
    // Short-run body mentions "under 2 skids total".
    const body = (notifCtor.mock.calls[0][1] as NotificationOptions).body ?? "";
    expect(body).toMatch(/under 2 skids/);
  });

  it("includes next-run labels in the notification body", async () => {
    const notifCtor = injectNotificationStub("granted");

    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        nextRunLabels: ["Run 2 – Cheese", "Run 3 – Pepperoni"],
        calc: { ...makeParams(T0).calc, pressCasesLeft: 100 },
      }),
    });

    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        nextRunLabels: ["Run 2 – Cheese", "Run 3 – Pepperoni"],
        calc: { ...makeParams(T0).calc, pressCasesLeft: 35 },
      }));
    });
    await act(async () => { await Promise.resolve(); });

    const body = (notifCtor.mock.calls[0][1] as NotificationOptions).body ?? "";
    expect(body).toContain("Run 2 – Cheese");
  });
});
