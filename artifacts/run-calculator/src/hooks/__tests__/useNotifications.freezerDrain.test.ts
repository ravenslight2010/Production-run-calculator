// @vitest-environment jsdom
//
// Unit tests for the freezer-drain alert in useNotifications (lines 373–398).
//
// These tests deliberately do NOT install a Notification stub in beforeAll —
// jsdom omits the Notification API entirely, which is what we're guarding
// against.  The guard is `if ("Notification" in window && ...)` on line 391,
// so the effect must not crash when Notification is absent.
//
// Detection strategy:
//
//   • "No-crash" path (no Notification stub): vibrate still fires (it is
//     BEFORE the Notification guard), but the Notification constructor must
//     never be called.  Removing the guard would cause a ReferenceError in
//     jsdom where Notification is undefined.
//
//   • "Fires" path: a per-test Notification stub is injected into window
//     (NOT in beforeAll) so showAppNotification can reach the constructor.
//     The constructor is called one microtask later (inside an async IIFE),
//     so tests that assert on it use `await act(async () => {})` to flush.
//
//   • Scroll-to-already-drained guard: a run whose freezer expired long before
//     we first observe it (freezerDrainingRef never set) must NOT fire the
//     alert — this is the latch that prevents spurious alerts on navigation.
//
//   • Suppressed-pref path: the silent-latch branch runs BEFORE the
//     Notification guard, so even without a stub the latch is applied.  No
//     Notification ctor call is expected.

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
// Run ended 30 minutes ago; freezerTime = 10 min.
// Freezer drains at endedAt + 10 * 60_000.
// With endedAt = T0 - 30 * 60_000, drain completes at T0 - 20 * 60_000.
// So nowTime = T0 is well past drain — but we won't observe draining unless
// we first render with nowTime < drain time.
const ENDED_AT = T0 - 30 * 60_000;
const FREEZER_TIME_MIN = 10;
const DRAIN_DONE_AT = ENDED_AT + FREEZER_TIME_MIN * 60_000; // T0 - 20 min

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRun(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    id: "run-drain-1",
    brand: "TestBrand",
    flavor: "TestFlavor",
    startedAt: ENDED_AT - 60 * 60_000,
    endedAt: ENDED_AT,
    stoppages: [],
    ...overrides,
  };
}

type Params = Parameters<typeof useNotifications>[0];

/**
 * Base params that keep all OTHER effects idle so only the freezer-drain
 * effect can produce output:
 *
 *   runStatus = "ended"   → all running-only effects skip early
 *   ppm = 0               → disables warehouse-staging, pace, run-complete
 *   adjustedTimeSec = 0   → keeps 15-min effect from firing (no startedAt check — it checks endedAt too)
 *   timePerBatchSec = 0   → batch-cycle effect skips (returns early)
 *   pressDone = true      → batch-cycle effect clears banner and returns
 */
function makeParams(nowMs: number, overrides: Partial<Params> = {}): Params {
  return {
    runStatus: "ended",
    nowTime: new Date(nowMs),
    currentRun: makeRun(),
    calc: {
      adjustedTimeSec: 0,
      timePerBatchSec: 0,
      ppm: 0,
      casesCompleted: 200,
      casesInFreezer: 0,
      pressCasesLeft: 0,
      pressDone: true,
    },
    v: {
      freezerTime: FREEZER_TIME_MIN,
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
// vibrate is called synchronously in the drain effect BEFORE the Notification
// guard, so it is a reliable indicator that the effect body ran to the fire path.
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

// ── Freezer-drain effect tests ────────────────────────────────────────────────

describe("useNotifications — freezer-drain effect (no Notification API)", () => {
  // The freezer-drain effect fires when:
  //   1. runStatus = "ended" and currentRun.endedAt is set
  //   2. freezerMs > 0 (freezerTime > 0)
  //   3. freezerDoneNotifRef does NOT already have this runId (not re-latched)
  //   4. remainMs = 0 (nowTime is past endedAt + freezerMs)
  //   5. freezerDrainingRef HAS this runId (we observed remainMs > 0 at least once)
  //   6. isNotifEnabled(prefs, "freezerEmpty") = true
  //
  // vibrate fires synchronously BEFORE `if ("Notification" in window)`, so it
  // fires even when Notification is absent.

  it("does NOT crash when the freezer drains with NO Notification API", () => {
    // Critical regression guard: the effect fires vibrate normally but must NOT
    // throw when reaching `if ("Notification" in window && ...)`.
    // Removing the guard would cause a ReferenceError in jsdom.
    const run = makeRun();

    // Phase 1: render while freezer is still draining (remainMs > 0).
    // This sets freezerDrainingRef so the fire condition can be met later.
    const midDrain = DRAIN_DONE_AT - 60_000; // 1 min before drain completes
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(midDrain, { currentRun: run }),
    });
    expect(vibrateMock).not.toHaveBeenCalled();

    // Phase 2: advance past drain — effect should fire vibrate but NOT crash.
    expect(() => {
      act(() => {
        rerender(makeParams(DRAIN_DONE_AT + 1_000, { currentRun: run }));
      });
    }).not.toThrow();

    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
  });

  it("fires vibrate exactly once when the freezer finishes draining", () => {
    const run = makeRun();

    // Phase 1: mid-drain observation — adds runId to freezerDrainingRef.
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(DRAIN_DONE_AT - 60_000, { currentRun: run }),
    });
    expect(vibrateMock).not.toHaveBeenCalled();

    // Phase 2: past drain — fires.
    act(() => {
      rerender(makeParams(DRAIN_DONE_AT + 1_000, { currentRun: run }));
    });
    expect(vibrateMock).toHaveBeenCalledOnce();
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);

    vibrateMock.mockClear();

    // Phase 3: another tick past drain — already latched in freezerDoneNotifRef,
    // must NOT fire again.
    act(() => {
      rerender(makeParams(DRAIN_DONE_AT + 2_000, { currentRun: run }));
    });
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when scrolling to an already-drained run (never observed draining)", () => {
    // This is the key guard: if we navigate to a completed run whose freezer
    // drained long ago (remainMs was never > 0 in our session), the alert
    // must NOT fire — freezerDrainingRef is empty for this runId.
    const run = makeRun();

    // Render directly at a time well past drain — no prior mid-drain observation.
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(DRAIN_DONE_AT + 60 * 60_000, { currentRun: run }),
    });

    // freezerDrainingRef never got this runId → effect returns early at line 385.
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when freezerTime is 0 (no freezer configured)", () => {
    const run = makeRun();

    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(T0, {
        currentRun: run,
        v: { freezerTime: 0, casesNeeded: 200, casesPerSkid: 20 },
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when runStatus is not 'ended'", () => {
    const run = makeRun();

    // runStatus = "running" — effect returns immediately.
    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(DRAIN_DONE_AT + 1_000, {
        currentRun: run,
        runStatus: "running",
      }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when endedAt is missing", () => {
    // currentRun.endedAt is undefined — the effect returns early.
    const run = makeRun({ endedAt: undefined });

    renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(DRAIN_DONE_AT + 1_000, { currentRun: run }),
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does NOT fire when freezerEmpty pref is off — latches silently so re-enable won't retroactively fire", () => {
    const prefOff = { freezerEmpty: false } as import("../../notificationPrefs").NotificationPrefs;
    const run = makeRun();

    // Phase 1: mid-drain — sets freezerDrainingRef.
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(DRAIN_DONE_AT - 60_000, { currentRun: run, prefs: prefOff }),
    });
    expect(vibrateMock).not.toHaveBeenCalled();

    // Phase 2: past drain with pref off — latch is applied but no vibrate.
    act(() => {
      rerender(makeParams(DRAIN_DONE_AT + 1_000, { currentRun: run, prefs: prefOff }));
    });
    expect(vibrateMock).not.toHaveBeenCalled();

    // Phase 3: re-enable pref — runId is already in freezerDoneNotifRef, must NOT fire.
    act(() => {
      rerender(makeParams(DRAIN_DONE_AT + 2_000, { currentRun: run, prefs: undefined }));
    });
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("fires the Notification with the correct body text when Notification IS present", async () => {
    const notifCtor = injectNotificationStub("granted");
    const run = makeRun();

    // Phase 1: mid-drain.
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(DRAIN_DONE_AT - 60_000, { currentRun: run }),
    });
    await act(async () => { await Promise.resolve(); });
    expect(notifCtor).not.toHaveBeenCalled();

    // Phase 2: past drain.
    act(() => {
      rerender(makeParams(DRAIN_DONE_AT + 1_000, { currentRun: run }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(notifCtor).toHaveBeenCalledOnce();
    expect(notifCtor.mock.calls[0][0]).toBe("❄️ Freezer empty");
    const opts = notifCtor.mock.calls[0][1] as NotificationOptions;
    expect(opts.body).toMatch(/freezer is clear/i);
    expect(opts.tag).toBe(`freezer-done-${run.id}`);
  });

  it("does NOT call the Notification constructor when permission is not 'granted'", async () => {
    const notifCtor = injectNotificationStub("denied");
    const run = makeRun();

    // Phase 1: mid-drain.
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(DRAIN_DONE_AT - 60_000, { currentRun: run }),
    });

    // Phase 2: past drain.
    act(() => {
      rerender(makeParams(DRAIN_DONE_AT + 1_000, { currentRun: run }));
    });
    await act(async () => { await Promise.resolve(); });

    // vibrate fires (before the Notification guard).
    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
    // But the Notification constructor must not be called.
    expect(notifCtor).not.toHaveBeenCalled();
  });

  it("fires once per run — switching to a different run resets the latch for that new run", async () => {
    const notifCtor = injectNotificationStub("granted");
    const run1 = makeRun({ id: "run-drain-A" });
    const run2 = makeRun({ id: "run-drain-B", endedAt: ENDED_AT - 5 * 60_000 });

    // Phase 1: observe run1 mid-drain.
    const { rerender } = renderHook((p: Params) => useNotifications(p), {
      initialProps: makeParams(DRAIN_DONE_AT - 60_000, { currentRun: run1 }),
    });

    // Phase 2: run1 drains — fires once.
    act(() => {
      rerender(makeParams(DRAIN_DONE_AT + 1_000, { currentRun: run1 }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(vibrateMock).toHaveBeenCalledOnce();
    expect(notifCtor).toHaveBeenCalledOnce();
    vibrateMock.mockClear();
    notifCtor.mockClear();

    // Phase 3: switch to run2 before it's drained (remainMs > 0 for run2).
    const run2DrainAt = run2.endedAt! + FREEZER_TIME_MIN * 60_000;
    act(() => {
      rerender(makeParams(run2DrainAt - 60_000, { currentRun: run2 }));
    });
    expect(vibrateMock).not.toHaveBeenCalled();

    // Phase 4: run2 drains — must fire for run2 independently.
    act(() => {
      rerender(makeParams(run2DrainAt + 1_000, { currentRun: run2 }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(vibrateMock).toHaveBeenCalledOnce();
    expect(notifCtor).toHaveBeenCalledOnce();
    expect(notifCtor.mock.calls[0][1] as NotificationOptions).toMatchObject({
      tag: `freezer-done-${run2.id}`,
    });
  });
});
