// @vitest-environment jsdom
//
// LiveRunProvider — wake-snap integration: useClock → useLiveRun() chain.
//
// Task #854: Confirm the full useClock → useAutoTrack chain fires correctly
// in a single wake tick (integration gap).
//
// What this test covers that the isolated unit tests (useClock.screenTimeout
// and useAutoTrack.screenWake) cannot:
//
//   1. The nowTime produced by useClock actually flows through the LiveRunProvider
//      value memo into a component that calls useLiveRun().  If a bug in the
//      provider's value memo or liveSlice derivation breaks the nowTime path,
//      the isolated tests would still pass while useLiveRun() consumers silently
//      freeze.
//
//   2. The visibilitychange snap and the first interval tick after wake are
//      SEPARATE render cycles — the subscriber sees the snapped nowTime value
//      before seeing the first post-wake tick.  Coalescing them into one would
//      skip the snap value and violate the guarantee that nowTime always reflects
//      the exact moment of wake-up.
//
// Test structure:
//   - Real useClock (controlled via vi.useFakeTimers).
//   - Mocked useNotifications + useAutoTrack (shared __mocks__ files, same as
//     clock-isolation.test.tsx).  These are mocked only to avoid side effects;
//     the nowTime path under test does not go through them.
//
// CLOCK INTERACTION NOTE (same rule as useClock.screenTimeout.test.ts):
//   vi.advanceTimersByTime(n) advances both the timer clock AND new Date() by n
//   ms together.  We do NOT mix vi.setSystemTime() inside the same act() as
//   vi.advanceTimersByTime() to avoid double-advancing the system clock.
//   vi.setSystemTime() is used only once in beforeEach to set the epoch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactNode } from "react";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";
import { PENDING_CLOCK_MS } from "../../hooks/useClock";

// ── Stub heavy side-effect hooks (same pattern as clock-isolation.test.tsx) ──
vi.mock("../../hooks/useNotifications");
vi.mock("../../hooks/useAutoTrack");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Override document.hidden (jsdom exposes it as read-only). */
function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

// A fixed epoch.  vi.useFakeTimers() + vi.setSystemTime(T0) makes new Date()
// return T0 at mount.  vi.advanceTimersByTime(n) then advances both clocks.
const T0 = 1_700_000_000_000;

// ── Provider wrapper (identical to clock-isolation.test.tsx) ─────────────────
function TestProviderWrapper({ children }: { children: ReactNode }) {
  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });
  return (
    <LiveRunProvider
      v={DEFAULT_VALUES}
      ve={DEFAULT_VALUES}
      runStatus="running"
      currentRun={undefined}
      currentRunId="test-run-wake"
      form={form}
      dayState={{ runs: [], currentIndex: 0 }}
      doughSubTab="dough"
      upcomingRunLabels={[]}
      prefs={undefined}
      screenMode={null}
      machine={{ spinSec: 0, hopperSec: 0 }}
    >
      {children}
    </LiveRunProvider>
  );
}

// ── Provider wrapper for slow-cadence (pending) tests ────────────────────────
function PendingProviderWrapper({ children }: { children: ReactNode }) {
  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });
  return (
    <LiveRunProvider
      v={DEFAULT_VALUES}
      ve={DEFAULT_VALUES}
      runStatus="pending"
      currentRun={undefined}
      currentRunId="test-run-wake-pending"
      form={form}
      dayState={{ runs: [], currentIndex: 0 }}
      doughSubTab="dough"
      upcomingRunLabels={[]}
      prefs={undefined}
      screenMode={null}
      machine={{ spinSec: 0, hopperSec: 0 }}
    >
      {children}
    </LiveRunProvider>
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────
describe("LiveRunProvider — wake-snap integration (useClock → useLiveRun chain)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    setDocumentHidden(false);
  });

  afterEach(() => {
    setDocumentHidden(false);
    vi.useRealTimers();
    cleanup();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: After a visibilitychange (hidden → visible), the useLiveRun()
  // subscriber sees a nowTime that matches the snapped system clock, not the
  // stale pre-sleep value.
  //
  // Sequence:
  //   a) Mount with document.hidden=true → useClock skips the interval.
  //      nowTime = T0.
  //   b) Advance 5 s while hidden → system clock = T0+5000, nowTime stays T0.
  //   c) Tab becomes visible; dispatch visibilitychange → useClock snaps
  //      nowTime = new Date() = T0+5000; restarts interval.
  //   d) Assert subscriber's nowTime.getTime() === T0+5000.
  // ──────────────────────────────────────────────────────────────────────────
  it("1. useLiveRun() nowTime snaps to the woken system time after visibilitychange", async () => {
    // Record every nowTime value the subscriber renders with.
    const nowTimeHistory: number[] = [];

    function LiveSubscriber() {
      const { nowTime } = useLiveRun();
      nowTimeHistory.push(nowTime.getTime());
      return null;
    }

    // Mount with hidden tab — no interval, nowTime = T0.
    setDocumentHidden(true);
    render(
      <TestProviderWrapper>
        <LiveSubscriber />
      </TestProviderWrapper>,
    );

    // Should have mounted once at T0.
    expect(nowTimeHistory.at(-1)).toBe(T0);

    // Advance 5 s while hidden — system clock moves, nowTime does not.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(nowTimeHistory.at(-1)).toBe(T0);

    // Tab becomes visible → useClock snaps nowTime to T0+5000.
    await act(async () => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The subscriber must now see the snapped time.
    expect(nowTimeHistory.at(-1)).toBe(T0 + 5_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: The wake snap and the first post-wake interval tick arrive as
  // SEPARATE render cycles — not coalesced into one that skips the snap value.
  //
  // Why this matters: if React batches the visibilitychange state update
  // together with the first interval tick, consumers would never see the exact
  // wake-moment snapshot — the counter-display would jump from the pre-sleep
  // value directly to "snap + 1 tick", effectively skipping the snap itself.
  // The existing useClock unit test guards the hook in isolation; this test
  // verifies the guarantee holds end-to-end through LiveRunProvider.
  //
  // Sequence:
  //   a) Mount hidden; advance 5 s.
  //   b) Dispatch visibilitychange → snap render (nowTime = T0+5000).
  //   c) Advance 1 s → interval fires → tick render (nowTime = T0+6000).
  //   d) Verify the history contains T0+5000 BEFORE T0+6000 — proving they
  //      were separate, ordered render cycles.
  // ──────────────────────────────────────────────────────────────────────────
  it("2. the wake snap and the first interval tick are separate render cycles (snap value is not skipped)", async () => {
    const nowTimeHistory: number[] = [];

    function LiveSubscriber() {
      const { nowTime } = useLiveRun();
      nowTimeHistory.push(nowTime.getTime());
      return null;
    }

    setDocumentHidden(true);
    render(
      <TestProviderWrapper>
        <LiveSubscriber />
      </TestProviderWrapper>,
    );

    // Advance 5 s while hidden.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    // Snap: visibilitychange → nowTime = T0+5000 in its own render cycle.
    await act(async () => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const snapRenderCount = nowTimeHistory.length;
    const snapValue = nowTimeHistory.at(-1)!;

    // Sanity: the snap render happened and produced T0+5000.
    expect(snapValue).toBe(T0 + 5_000);

    // First post-wake interval tick: 1 s later → nowTime = T0+6000.
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    // A new render must have occurred after the snap.
    expect(nowTimeHistory.length).toBeGreaterThan(snapRenderCount);

    // The final value must be the tick value, not still the snap value.
    expect(nowTimeHistory.at(-1)).toBe(T0 + 6_000);

    // Critical ordering assertion: T0+5000 (snap) appears somewhere before
    // T0+6000 (tick) — confirming the two renders are distinct cycles with the
    // snap value visible to consumers before the tick fires.
    const snapIdx = nowTimeHistory.indexOf(T0 + 5_000);
    const tickIdx = nowTimeHistory.lastIndexOf(T0 + 6_000);
    expect(snapIdx).toBeGreaterThanOrEqual(0); // snap was observed
    expect(tickIdx).toBeGreaterThan(snapIdx);  // tick came after snap
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: The window "focus" fallback path propagates through LiveRunProvider
  // into a useLiveRun() subscriber.
  //
  // Some devices/browsers (e.g. some iOS Safari and Android tablets) do not
  // fire visibilitychange reliably on screen wake or app-switch.  useClock
  // registers a "focus" handler as a fallback snap.  This test confirms that
  // the focus snap reaches useLiveRun() consumers end-to-end through
  // LiveRunProvider — not just the isolated useClock unit test (test 3 in
  // useClock.screenTimeout.test.ts).
  //
  // Sequence (mirrors the isolated unit test, but at the integration level):
  //   a) Mount with visible tab — interval starts immediately.
  //   b) Advance 1.5 s: interval fires once at T0+1000; system clock = T0+1500.
  //      nowTime = T0+1000.
  //   c) Dispatch window "focus" at mid-period (system clock T0+1500).
  //      onFocus: setNowTime(new Date()) → T0+1500 (snap); interval restarted.
  //   d) Assert subscriber's nowTime = T0+1500 (the mid-period snap, not the
  //      stale interval value T0+1000).
  //   e) Advance 1 s: new interval fires → nowTime = T0+2500.
  // ──────────────────────────────────────────────────────────────────────────
  it("3. window focus fallback snap propagates through LiveRunProvider into useLiveRun() subscriber", async () => {
    const nowTimeHistory: number[] = [];

    function LiveSubscriber() {
      const { nowTime } = useLiveRun();
      nowTimeHistory.push(nowTime.getTime());
      return null;
    }

    // Mount with tab visible — interval starts immediately.
    render(
      <TestProviderWrapper>
        <LiveSubscriber />
      </TestProviderWrapper>,
    );

    // Should have mounted once at T0.
    expect(nowTimeHistory.at(-1)).toBe(T0);

    // Advance 1.5 s: interval fires at T0+1000; system clock ends at T0+1500.
    // The subscriber should see T0+1000 from the interval callback.
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(nowTimeHistory.at(-1)).toBe(T0 + 1_000);

    // Dispatch window "focus" at mid-period (system clock = T0+1500).
    // onFocus: setNowTime(new Date()) → T0+1500; start() restarts the interval.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    // The subscriber must now reflect the focus snap, not the stale interval value.
    expect(nowTimeHistory.at(-1)).toBe(T0 + 1_500);

    // Verify the interval was restarted: new interval fires 1 s after the snap.
    // System clock: T0+1500 → T0+2500.
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(nowTimeHistory.at(-1)).toBe(T0 + 2_500);
  });
});

// ── Slow-cadence integration (runStatus="pending") ───────────────────────────
//
// Task #861: The existing wakeSnap suite (above) covers the fast path
// (runStatus="running", 1-second tick).  This suite confirms that the focus
// wake path works identically when the run is pending or ended — where useClock
// uses PENDING_CLOCK_MS (10 s) instead of 1 s.
//
// The slow-cadence unit tests (C, D in useClock.screenTimeout.test.ts) verify
// the hook in isolation.  These tests verify the path end-to-end through
// LiveRunProvider into a useLiveRun() subscriber — a different code path because
// the interval delay differs and LiveRunProvider forwards runStatus to useClock.
//
// What these tests cover over the unit tests:
//   • The PENDING_CLOCK_MS delay actually flows through LiveRunProvider's
//     useClock call (runStatus="pending" is forwarded correctly).
//   • nowTime produced by the slow-cadence snap propagates through the provider
//     value memo into useLiveRun() consumers.
//   • No regression where LiveRunProvider accidentally hard-codes the fast
//     cadence regardless of runStatus.
// ─────────────────────────────────────────────────────────────────────────────
describe("LiveRunProvider — wake-snap integration (slow cadence, runStatus=pending)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    setDocumentHidden(false);
  });

  afterEach(() => {
    setDocumentHidden(false);
    vi.useRealTimers();
    cleanup();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P1. window "focus" at PENDING_CLOCK_MS/2 (mid-period, no tick yet) snaps
  //     nowTime through LiveRunProvider into the useLiveRun() subscriber.
  //
  // With the slow cadence the first interval tick would not fire until
  // PENDING_CLOCK_MS (10 s) has elapsed.  Dispatching "focus" at the midpoint
  // (5 s) must immediately update the subscriber to the mid-period snap,
  // not leave it at the stale mount value T0.
  //
  // Sequence:
  //   a) Mount with tab visible; slow interval starts (PENDING_CLOCK_MS).
  //      nowTime = T0.
  //   b) Advance PENDING_CLOCK_MS/2 — no tick yet.  System clock = T0+5000.
  //      nowTime still = T0.
  //   c) Dispatch window "focus" → onFocus snaps nowTime = T0+5000; restarts.
  //   d) Assert subscriber nowTime = T0+5000 (mid-period snap propagated).
  //   e) Advance PENDING_CLOCK_MS → new slow interval fires.
  //      nowTime = T0+5000+PENDING_CLOCK_MS.
  // ──────────────────────────────────────────────────────────────────────────
  it("P1. window focus at mid-period snaps nowTime through LiveRunProvider (slow cadence)", async () => {
    const nowTimeHistory: number[] = [];

    function LiveSubscriber() {
      const { nowTime } = useLiveRun();
      nowTimeHistory.push(nowTime.getTime());
      return null;
    }

    render(
      <PendingProviderWrapper>
        <LiveSubscriber />
      </PendingProviderWrapper>,
    );

    // Mount: T0.
    expect(nowTimeHistory.at(-1)).toBe(T0);

    // Advance to mid-period — no slow-interval tick yet.
    const halfPeriod = PENDING_CLOCK_MS / 2;
    await act(async () => {
      vi.advanceTimersByTime(halfPeriod);
    });
    // No tick has fired; subscriber still sees T0.
    expect(nowTimeHistory.at(-1)).toBe(T0);

    // Focus snap at system clock T0 + halfPeriod.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    // Subscriber must now reflect the mid-period snap.
    expect(nowTimeHistory.at(-1)).toBe(T0 + halfPeriod);

    // Verify the slow interval was restarted: fires PENDING_CLOCK_MS after snap.
    await act(async () => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
    });
    expect(nowTimeHistory.at(-1)).toBe(T0 + halfPeriod + PENDING_CLOCK_MS);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P2. The focus snap and the first post-focus slow-interval tick arrive as
  //     SEPARATE render cycles on the slow cadence.
  //
  // Mirrors integration test 2 (above) but on PENDING_CLOCK_MS timing.  The
  // snap value must appear in nowTimeHistory before the first post-snap tick.
  //
  // Sequence:
  //   a) Mount visible; advance PENDING_CLOCK_MS/2 (no tick).
  //   b) Dispatch "focus" → snap render (nowTime = T0 + halfPeriod).
  //   c) Advance PENDING_CLOCK_MS → interval fires → tick render
  //      (nowTime = T0 + halfPeriod + PENDING_CLOCK_MS).
  //   d) Verify snap appears before tick in the history — two distinct cycles.
  // ──────────────────────────────────────────────────────────────────────────
  it("P2. slow-cadence focus snap and first post-snap tick are separate render cycles", async () => {
    const nowTimeHistory: number[] = [];

    function LiveSubscriber() {
      const { nowTime } = useLiveRun();
      nowTimeHistory.push(nowTime.getTime());
      return null;
    }

    render(
      <PendingProviderWrapper>
        <LiveSubscriber />
      </PendingProviderWrapper>,
    );

    const halfPeriod = PENDING_CLOCK_MS / 2;

    // Advance to mid-period.
    await act(async () => {
      vi.advanceTimersByTime(halfPeriod);
    });

    // Focus snap.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const snapRenderCount = nowTimeHistory.length;
    const snapValue = nowTimeHistory.at(-1)!;
    expect(snapValue).toBe(T0 + halfPeriod);

    // First post-snap slow-interval tick.
    await act(async () => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
    });

    const tickValue = T0 + halfPeriod + PENDING_CLOCK_MS;

    // A new render must have occurred after the snap render.
    expect(nowTimeHistory.length).toBeGreaterThan(snapRenderCount);
    // The final value must be the tick value.
    expect(nowTimeHistory.at(-1)).toBe(tickValue);

    // Critical ordering: snap appears before tick — two separate render cycles.
    const snapIdx = nowTimeHistory.indexOf(T0 + halfPeriod);
    const tickIdx = nowTimeHistory.lastIndexOf(tickValue);
    expect(snapIdx).toBeGreaterThanOrEqual(0); // snap was observed
    expect(tickIdx).toBeGreaterThan(snapIdx);  // tick came after snap
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P3. visibilitychange (hidden → visible) on the slow cadence also snaps
  //     nowTime through LiveRunProvider into the useLiveRun() subscriber.
  //
  // Complements P1 (focus) with the primary visibility-change path.
  //
  // Sequence:
  //   a) Mount hidden; advance PENDING_CLOCK_MS/2 while hidden.
  //      System clock = T0 + halfPeriod; nowTime stays T0.
  //   b) Tab becomes visible; dispatch visibilitychange → snap to T0+halfPeriod.
  //   c) Assert subscriber sees T0+halfPeriod (not stale T0).
  // ──────────────────────────────────────────────────────────────────────────
  it("P3. visibilitychange on slow cadence snaps nowTime through LiveRunProvider", async () => {
    const nowTimeHistory: number[] = [];

    function LiveSubscriber() {
      const { nowTime } = useLiveRun();
      nowTimeHistory.push(nowTime.getTime());
      return null;
    }

    setDocumentHidden(true);
    render(
      <PendingProviderWrapper>
        <LiveSubscriber />
      </PendingProviderWrapper>,
    );

    expect(nowTimeHistory.at(-1)).toBe(T0);

    const halfPeriod = PENDING_CLOCK_MS / 2;

    // Advance while hidden — no slow interval running, nowTime stays T0.
    await act(async () => {
      vi.advanceTimersByTime(halfPeriod);
    });
    expect(nowTimeHistory.at(-1)).toBe(T0);

    // Tab becomes visible → visibilitychange snap.
    await act(async () => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Subscriber must reflect the snap value.
    expect(nowTimeHistory.at(-1)).toBe(T0 + halfPeriod);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P4. Going hidden stops the slow interval — no phantom ticks accumulate
  //     while the tab is hidden (end-to-end through LiveRunProvider).
  //
  // This is the primary guard for Task #866: a device that screen-locks after
  // a run ends (runStatus="pending") must not accumulate phantom
  // PENDING_CLOCK_MS ticks.  The useClock unit test (case D) verifies the
  // hook in isolation; this test verifies the full provider → subscriber chain.
  //
  // Sequence:
  //   a) Mount with tab visible; slow interval starts (PENDING_CLOCK_MS).
  //      nowTime = T0.
  //   b) Advance exactly PENDING_CLOCK_MS → first slow tick fires.
  //      Subscriber sees T0 + PENDING_CLOCK_MS.  Record this as preHideTime.
  //   c) Dispatch visibilitychange (hidden) → useClock clears the interval.
  //   d) Advance another PENDING_CLOCK_MS while hidden.  The cleared interval
  //      must not fire — subscriber's nowTime must stay at preHideTime.
  // ──────────────────────────────────────────────────────────────────────────
  it("P4. going hidden stops the slow interval — no phantom ticks through LiveRunProvider", async () => {
    const nowTimeHistory: number[] = [];

    function LiveSubscriber() {
      const { nowTime } = useLiveRun();
      nowTimeHistory.push(nowTime.getTime());
      return null;
    }

    // Mount with tab visible — slow interval starts immediately.
    render(
      <PendingProviderWrapper>
        <LiveSubscriber />
      </PendingProviderWrapper>,
    );

    // Mount render: T0.
    expect(nowTimeHistory.at(-1)).toBe(T0);

    // Advance exactly one slow period → first tick fires.
    await act(async () => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
    });
    const preHideTime = T0 + PENDING_CLOCK_MS;
    expect(nowTimeHistory.at(-1)).toBe(preHideTime);

    // Tab goes hidden → useClock must clear the slow interval.
    await act(async () => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Record how many renders have happened up to this point.
    const renderCountAfterHide = nowTimeHistory.length;

    // Advance another full slow period while hidden.
    // If the interval were still running it would fire and push a new value.
    await act(async () => {
      vi.advanceTimersByTime(PENDING_CLOCK_MS);
    });

    // No new renders (or no new nowTime advancement) — the interval is stopped.
    // Either the render count is the same, or every subsequent render still
    // shows the pre-hide value (both are acceptable; a phantom tick would
    // have pushed T0 + 2*PENDING_CLOCK_MS into the history).
    const phantomTickValue = T0 + 2 * PENDING_CLOCK_MS;
    expect(nowTimeHistory).not.toContain(phantomTickValue);

    // The last observed nowTime must still be the pre-hide tick value.
    expect(nowTimeHistory.at(-1)).toBe(preHideTime);
  });
});
