// @vitest-environment jsdom
//
// Unit tests for the batch-cycle alert in useNotifications (lines 301–338).
//
// These tests deliberately do NOT install a Notification stub in beforeAll —
// jsdom omits the Notification API entirely, which is what we're guarding
// against.  The effect only reaches `if ("Notification" in window)` (line 326)
// AFTER the batch-boundary and latch logic, so it must not crash when
// Notification is absent.  These tests therefore also serve as regression
// guards for accidental guard removal.
//
// Detection strategy:
//
//   • "No-crash" path (no Notification stub): vibrate and setShowBatchDue still
//     fire (they are BEFORE the Notification guard), but the Notification
//     constructor must never be called.  Removing the `if ("Notification" in
//     window)` guard would cause a ReferenceError in jsdom.
//
//   • "Fires" path: a per-test Notification stub is injected into window (NOT
//     in beforeAll) so showAppNotification can reach the constructor.  The
//     constructor is invoked one microtask later (inside an async IIFE), so
//     tests that assert on it use `await act(async () => {})` to flush.
//
//   • Suppressed-pref path: the silent-latch branch runs BEFORE the
//     Notification guard, so even without a Notification stub the latch
//     is applied.  No Notification ctor call is expected.

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
// Run started 30 minutes ago — batchNum=3 at timePerBatchSec=600.
// 30 * 60 = 1800s → floor(1800 / 600) = 3.
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
 * Base params that keep all OTHER effects idle so only the batch-cycle effect
 * can produce output:
 *
 *   adjustedTimeSec = 45 min → well above 15-min threshold (no 15-min alert)
 *   timePerBatchSec = 600    → 10-min cycle; at 30 min elapsed batchNum = 3
 *   ppm = 0                  → disables warehouse-staging, pace, run-complete
 *   pressCasesLeft = 100     → irrelevant with ppm=0, but safe
 *   pressDone = false        → batch-cycle effect must not early-return
 *   sauceDepletionSec = 0    → sauce timing is unset, so it does not suppress
 *   sauceBarrelElapsedSec = 0 → active barrel just started
 *   isCrust = false          → batch-cycle effect must not early-return
 *   runStatus = "running"    → freezer-drain effect skips (requires "ended")
 */
function makeParams(nowMs: number, overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "running",
    nowTime: new Date(nowMs),
    currentRun: makeRun(),
    calc: {
      adjustedTimeSec: 45 * 60, // well above 15-min threshold
      timePerBatchSec: 600,     // 10-min cycle
      ppm: 0,                   // disables staging / pace / run-complete
      casesCompleted: 50,
      casesInFreezer: 0,
      pressCasesLeft: 100,
      pressDone: false,
      sauceDepletionSec: 0,
    },
    sauceBarrelElapsedSec: 0,
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
// vibrate is called synchronously in the batch-cycle effect BEFORE the
// Notification guard, so it is a reliable indicator that the effect body ran
// all the way to the fire path.
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
// The Notification constructor is called one microtask after the effect runs
// (inside an async IIFE in showAppNotification), so callers must
// `await act(async () => {})` before asserting on the returned ctor mock.
function injectNotificationStub(
  permission: NotificationPermission = "granted",
  visibility: DocumentVisibilityState = "hidden",
) {
  const ctor = vi.fn();
  const stub = Object.assign(ctor, { permission });
  Object.defineProperty(window, "Notification", {
    value: stub,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document, "visibilityState", { value: visibility, configurable: true });
  return ctor;
}

// ── Batch-cycle effect tests ──────────────────────────────────────────────────

describe("useNotifications — batch-cycle effect (no Notification API)", () => {
  // The batch-cycle effect fires when:
  //   1. isCrust = false
  //   2. calc.pressDone = false
  //   3. runStatus = "running", currentRun.startedAt set, timePerBatchSec > 0
  //   4. batchNum = floor(elapsed / timePerBatchSec) >= 1
  //   5. batchNum differs from the previous tick's batchNum (new boundary)
  //   6. key (`${runId}-${batchNum}`) not already latched in batchNotifRef
  //   7. isNotifEnabled(prefs, "batchDue") = true
  //
  // vibrate and setShowBatchDue fire synchronously BEFORE `if ("Notification" in window)`,
  // so they trigger even when Notification is absent.

  it("does NOT crash when a batch boundary is crossed with NO Notification API", () => {
    // Critical regression guard: the effect fires vibrate and setShowBatchDue
    // normally, but must NOT throw when reaching `if ("Notification" in window)`.
    // Removing the guard would cause a ReferenceError trying to access
    // Notification.permission in jsdom where Notification is undefined.
    const run = makeRun();

    expect(() => {
      act(() => {
        renderHook((p: Params) => useNotifications(p), {
          initialProps: makeParams(T0, { currentRun: run }),
        });
      });
    }).not.toThrow();

    // The visible Dough action card is the only immediate notice while the app
    // is in view, so it does not also vibrate as an away-from-app escalation.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("keeps the in-app banner when Notification exists but is incomplete", () => {
    // Some embedded browsers expose a function-shaped global without its
    // permission state. It must be treated as unavailable, without interrupting
    // the Dough card or reading a free `Notification` identifier.
    Object.defineProperty(window, "Notification", {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
    const run = makeRun();

    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run }),
    });

    expect(result.current.showBatchDue).toBe(true);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("shows the in-app banner when a batch boundary is first crossed", () => {
    const run = makeRun();
    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run }),
    });

    // At T0: elapsed = 30 min, batchNum = 3 → banner should appear.
    expect(result.current.showBatchDue).toBe(true);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when no batch boundary has been crossed yet (batchNum < 1)", () => {
    // Only 5 minutes elapsed → batchNum = floor(300 / 600) = 0 → returns early.
    const earlyStart = T0 - 5 * 60_000;
    const run = makeRun({ startedAt: earlyStart });

    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run }),
    });

    expect(result.current.showBatchDue).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("fires exactly once per batch key — same batchNum on a subsequent tick is a no-op", () => {
    const run = makeRun();
    const { rerender, result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run }),
    });

    // First render: batchNum=3, fires.
    expect(result.current.showBatchDue).toBe(true);
    expect(vibrateMock).not.toHaveBeenCalled();

    vibrateMock.mockClear();

    // Second render: T0 + 1s → elapsed=1801s, batchNum=floor(1801/600)=3 still.
    // prevBatchNumRef.current === 3 → early exit.
    act(() => {
      rerender(makeParams(T0 + 1_000, { currentRun: run }));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("fires again when the run crosses to the next batch boundary", async () => {
    const notifCtor = injectNotificationStub("granted");
    const run = makeRun();
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run }),
    });

    // First boundary (batchNum=3) — fires.
    await act(async () => { await Promise.resolve(); });
    expect(vibrateMock).toHaveBeenCalledOnce();
    expect(notifCtor).toHaveBeenCalledOnce();

    vibrateMock.mockClear();
    notifCtor.mockClear();

    // Advance to batchNum=4: elapsed must be ≥ 4*600=2400s.
    // START_AT = T0-1_800_000 → nowTime must be T0+600_000 to get elapsed=2400s.
    act(() => {
      rerender(makeParams(T0 + 600_000, { currentRun: run }));
    });
    await act(async () => { await Promise.resolve(); });

    // New batch boundary — fires again.
    expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100]);
    expect(notifCtor).toHaveBeenCalledOnce();
    // Title matches the batch-cycle notification.
    expect(notifCtor.mock.calls[0][0]).toBe("🍕 Start next dough batch");
  });

  it("does NOT fire when batchDue pref is off — latches silently so re-enable won't retroactively fire", () => {
    const prefOff = { batchDue: false } as import("../../notificationPrefs").NotificationPrefs;
    const run = makeRun();

    const { rerender, result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run, prefs: prefOff }),
    });

    // Pref suppresses only the browser escalation. The Dough action card stays
    // visible so a staff member already in the app is not left without direction.
    expect(result.current.showBatchDue).toBe(true);
    expect(vibrateMock).not.toHaveBeenCalled();

    // Re-enable pref — same batch key is already latched, must NOT retroactively fire.
    act(() => {
      rerender(makeParams(T0 + 1_000, { currentRun: run, prefs: undefined }));
    });

    expect(result.current.showBatchDue).toBe(true);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("clears the banner and suppresses alerts on a crust run", () => {
    // Crust runs open pre-made cases — no dough is mixed, so showBatchDue
    // must be false (and any stale banner cleared) whenever isCrust is true.
    const run = makeRun();
    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run, isCrust: true }),
    });

    expect(result.current.showBatchDue).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("clears the banner and suppresses alerts when pressDone is true", () => {
    // Once the press has made all cases needed, the dough crew switches to the
    // next run — no further batch alerts should fire for the current run.
    const run = makeRun();
    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressDone: true },
      }),
    });

    expect(result.current.showBatchDue).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("clears a stale banner when isCrust becomes true mid-run", () => {
    const run = makeRun();
    const { rerender, result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run, isCrust: false }),
    });

    // Banner appeared on the non-crust render.
    expect(result.current.showBatchDue).toBe(true);

    // Operator switches to crust mode — banner must clear.
    act(() => {
      rerender(makeParams(T0 + 1_000, { currentRun: run, isCrust: true }));
    });

    expect(result.current.showBatchDue).toBe(false);
  });

  it("clears a stale banner when pressDone becomes true mid-run", () => {
    const run = makeRun();
    const { rerender, result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressDone: false },
      }),
    });

    // Banner appeared on the initial render.
    expect(result.current.showBatchDue).toBe(true);

    // Press finishes all cases — banner must clear.
    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, pressDone: true },
      }));
    });

    expect(result.current.showBatchDue).toBe(false);
  });

  it("does NOT raise a batch alert once the active sauce barrel depletes before dough or the press", () => {
    const run = makeRun();

    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: {
          ...makeParams(T0).calc,
          // Thirty elapsed minutes have passed, so this low-sauce run's
          // 20-minute barrel is empty. Dough is still available and the press
          // is not done: only sauce depletion can suppress the batch alert.
          sauceDepletionSec: 20 * 60,
          pressDone: false,
        },
        sauceBarrelElapsedSec: 20 * 60,
      }),
    });

    expect(result.current.showBatchDue).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does not count paused wall-clock time toward the active sauce barrel", () => {
    const run = makeRun();
    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: {
          ...makeParams(T0).calc,
          // The wall clock is 30 minutes past start, but a ten-minute pause
          // means only 19 minutes of this 20-minute barrel were consumed.
          sauceDepletionSec: 20 * 60,
          pressDone: false,
        },
        sauceBarrelElapsedSec: 19 * 60,
      }),
    });

    expect(result.current.showBatchDue).toBe(true);
  });

  it("resumes batch alerts when a replacement sauce barrel resets the active clock", () => {
    const run = makeRun();
    const { rerender, result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: {
          ...makeParams(T0).calc,
          sauceDepletionSec: 20 * 60,
          pressDone: false,
        },
        sauceBarrelElapsedSec: 20 * 60,
      }),
    });

    // The first barrel is depleted, but dough remains and the press is not
    // done, so only sauce should suppress the batch prompt.
    expect(result.current.showBatchDue).toBe(false);

    act(() => {
      rerender(makeParams(T0 + 1_000, {
        currentRun: run,
        calc: {
          ...makeParams(T0).calc,
          sauceDepletionSec: 20 * 60,
          pressDone: false,
        },
        // Mirrors the Sauce tab's + action, which writes the current
        // pause-aware elapsed time as the new barrel's anchor.
        sauceBarrelElapsedSec: 0,
      }));
    });

    expect(result.current.showBatchDue).toBe(true);
  });

  it("does NOT fire when runStatus is not 'running'", () => {
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { runStatus: "paused" }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when timePerBatchSec is 0 (no valid batch timing)", () => {
    const run = makeRun();
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        calc: { ...makeParams(T0).calc, timePerBatchSec: 0 },
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("fires the Notification with the correct body text when Notification IS present", async () => {
    const notifCtor = injectNotificationStub("granted");
    const run = makeRun();

    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run }),
    });

    // Flush the async IIFE that calls the Notification constructor.
    await act(async () => { await Promise.resolve(); });

    expect(notifCtor).toHaveBeenCalledOnce();
    expect(notifCtor.mock.calls[0][0]).toBe("🍕 Start next dough batch");
    const opts = notifCtor.mock.calls[0][1] as NotificationOptions;
    // Body should mention the batch number (batchNum=3 → "batch 4 is due now").
    expect(opts.body).toMatch(/batch 4/);
  });

  it("does NOT call the Notification constructor when permission is not 'granted'", async () => {
    // When permission is "denied", the effect must not attempt to fire.
    const notifCtor = injectNotificationStub("denied");
    const run = makeRun();

    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run }),
    });

    await act(async () => { await Promise.resolve(); });

    // vibrate and banner still fire (before the Notification guard).
    expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100]);
    // But the Notification constructor must not be called.
    expect(notifCtor).not.toHaveBeenCalled();
  });

  it("keeps the Dough action card but does not show a browser notification while the app is visible", async () => {
    const notifCtor = injectNotificationStub("granted", "visible");
    const run = makeRun();

    const { result } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, { currentRun: run }),
    });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.showBatchDue).toBe(true);
    expect(notifCtor).not.toHaveBeenCalled();
  });
});
