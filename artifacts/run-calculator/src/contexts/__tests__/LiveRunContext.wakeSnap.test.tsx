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
});
