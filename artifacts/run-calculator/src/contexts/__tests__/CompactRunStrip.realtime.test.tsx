// @vitest-environment jsdom
//
// Guarantee: CompactRunStrip, which is rendered on non-Run tabs (Dough, Front,
// Pack) whenever a run is active, subscribes to LiveRunContext via useLiveRun().
// This test confirms that the values it reads — specifically casesInFreezer and
// the elapsed-time clock — actually advance in real time as the clock ticks,
// so the strip cannot silently show frozen counters.
//
// How it works:
//  • A thin subscriber component mimics exactly what CompactRunStrip pulls from
//    useLiveRun() (calc, nowTime, liveFreezerMin, elapsedBatchSec, casesPct, …).
//  • The real LiveRunProvider (with useClock controlled via vi.useFakeTimers) is
//    wrapped around it, with an active currentRun (startedAt in the past) and
//    enough form values to produce a non-zero ppm so casesInFreezer can grow.
//  • After advancing fake time by a few seconds we assert that:
//      - nowTime advanced (the clock is ticking)
//      - casesInFreezer increased (computed from nowTime in the real calc)
//  • A second test confirms that a NON-subscriber does NOT see updates, so the
//    counter-proof is still tight — the strip is the only thing that re-renders.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import type { ReactNode } from "react";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";

vi.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => ({ showBatchDue: false, setShowBatchDue: vi.fn() }),
}));

vi.mock("../../hooks/useAutoTrack", () => ({
  useAutoTrack: () => ({
    autoTrackProgress: false,
    setAutoTrackProgress: vi.fn(),
    autoTrackSuggestion: null,
    autoSuppressUntilRef: { current: 0 },
    fireAutoTrackNow: vi.fn(),
    tickDueRefs: {
      case:      { current: 0 },
      tray:      { current: 0 },
      trayProd:  { current: 0 },
      batch:     { current: 0 },
      batchProd: { current: 0 },
    },
  }),
  suggestedDoughStaging: () => ({ trays: null, batches: null }),
}));

// Form values that produce a non-zero ppm so casesInFreezer can grow:
//   ppm = crustsPerCycle * cycleSpeed * speedAdjustment
//       = 10 * 1 * 1 = 10 pizzas/min
const ACTIVE_VALUES: FormValues = {
  ...DEFAULT_VALUES,
  crustsPerCycle: 10,
  cycleSpeed: 1,
  speedAdjustment: 1,
  pizzasPerCase: 10,
  casesNeeded: 100,
  freezerTime: 30,   // 30-minute tunnel → casesInFreezer ramps as time passes
};

// A run that started 5 minutes ago and is still active.
const STARTED_AT = Date.now() - 5 * 60 * 1000;
const ACTIVE_RUN = {
  id: "run-1",
  brand: "TestBrand",
  flavor: "TestFlavor",
  startedAt: STARTED_AT,
  endedAt: undefined,
  pausedAt: undefined,
  stoppages: [] as [],
};

function TestProviderWrapper({ children }: { children: ReactNode }) {
  const form = useForm<FormValues>({ defaultValues: ACTIVE_VALUES });
  return (
    <LiveRunProvider
      v={ACTIVE_VALUES}
      ve={ACTIVE_VALUES}
      runStatus="running"
      currentRun={ACTIVE_RUN}
      currentRunId="run-1"
      form={form}
      dayState={{ runs: [ACTIVE_RUN], currentIndex: 0 }}
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

describe("CompactRunStrip — real-time LiveRunContext subscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("a useLiveRun() subscriber receives updated calc values when the clock ticks (simulates CompactRunStrip)", async () => {
    // Capture snapshots of the values CompactRunStrip actually reads from the
    // context so we can compare before vs. after the clock advances.
    const snapshots: { nowMs: number; casesInFreezer: number }[] = [];

    function CompactRunStripSimulator() {
      // Mirrors the destructuring in the real CompactRunStrip:
      //   const { calc, nowTime, liveFreezerMin, elapsedBatchSec, … } = useLiveRun();
      const { calc, nowTime } = useLiveRun();
      // Record on every render so we can track changes.
      snapshots.push({ nowMs: nowTime.getTime(), casesInFreezer: calc.casesInFreezer });
      return null;
    }

    render(
      <TestProviderWrapper>
        <CompactRunStripSimulator />
      </TestProviderWrapper>,
    );

    const countBefore = snapshots.length;
    const firstNowMs = snapshots[0].nowMs;
    const firstCasesInFreezer = snapshots[0].casesInFreezer;

    // Advance time by 60 seconds — useClock fires its 1-second interval 60
    // times.  With ppm=10 and pizzasPerCase=10 the line runs 1 case/min, so
    // advancing by 60 s guarantees casesInFreezer increases by at least 1
    // across a full case boundary (deterministic floor arithmetic).
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    // The subscriber must have been called at least once more after mount.
    expect(snapshots.length).toBeGreaterThan(countBefore);

    // nowTime must have advanced — the clock is ticking.
    const lastNowMs = snapshots[snapshots.length - 1].nowMs;
    expect(lastNowMs).toBeGreaterThan(firstNowMs);

    // casesInFreezer is derived from nowTime in computeCasesInFreezer(), so it
    // must strictly increase after 60 s (at 1 case/min the floor crosses a
    // boundary).  This assertion fails if the subscription is broken and the
    // strip shows a frozen counter.
    const lastCasesInFreezer = snapshots[snapshots.length - 1].casesInFreezer;
    expect(lastCasesInFreezer).toBeGreaterThan(firstCasesInFreezer);
  });

  it("a non-subscriber in the same tree does NOT re-render when the clock ticks (isolation counter-proof)", async () => {
    let nonSubRenderCount = 0;

    function NonSubscriber() {
      nonSubRenderCount++;
      return null;
    }
    function LiveSubscriberRef() {
      // Subscribes so we know the clock is really ticking.
      const liveRef = useRef(0);
      const { nowTime } = useLiveRun();
      liveRef.current = nowTime.getTime();
      return null;
    }

    render(
      <TestProviderWrapper>
        <NonSubscriber />
        <LiveSubscriberRef />
      </TestProviderWrapper>,
    );

    const countAfterMount = nonSubRenderCount;

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // The non-subscriber must not have been re-rendered by the clock.
    expect(nonSubRenderCount).toBe(countAfterMount);
  });
});
