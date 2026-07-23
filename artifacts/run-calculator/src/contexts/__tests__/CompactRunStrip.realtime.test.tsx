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
import { useNotifications } from "../../hooks/useNotifications";
import { useAutoTrack } from "../../hooks/useAutoTrack";
// ── Shared mocks (closure-level stability enforced structurally) ─────────────
//
// The closure-level guarantee (all refs/fns allocated once at module scope,
// never inline) is STRUCTURAL: the manual mock files in src/hooks/__mocks__/
// are the single authoritative source.  Vitest resolves them automatically
// from the no-factory vi.mock() calls below.  See those files for the full
// explanation of why inline vi.fn() inside a vi.mock factory silently defeats
// LiveRunProvider's liveSlice useMemo and can freeze CompactRunStrip's
// real-time counters.
//
// The describe block at the bottom of this file verifies the contract with
// reference-identity assertions so any drift in the shared mocks is caught immediately.

vi.mock("../../hooks/useNotifications");
vi.mock("../../hooks/useAutoTrack");

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

// ── Mock reference stability ──────────────────────────────────────────────────
//
// CompactRunStrip — Mock stability: useAutoTrack and useNotifications return
//                   the SAME object/function references on every call
// ═══════════════════════════════════════════════════════════════════════════════
//
// LiveRunProvider builds its `value` with a useMemo whose deps include the
// individual fields returned by useAutoTrack() and useNotifications().  If any
// field is an inline literal (vi.fn() or { current: 0 } written inside the
// factory's return body) a NEW reference is produced on every hook call, the
// useMemo fires on every render, and FloorModeView's memo() isolation is
// silently defeated.
//
// These tests call each mock hook TWICE and assert that every returned
// object/function field is the exact same reference (===) across both calls.
// If a future developer moves a closure-level constant inline, the reference
// changes and the relevant assertion fails here — catching the regression
// before it silently freezes the live-tab display.
//
// See the STABILITY CONTRACT comment block above the vi.mock factories for the
// full explanation of WHY closure-level refs are mandatory.
// ═══════════════════════════════════════════════════════════════════════════════

describe("CompactRunStrip — mock stability: useAutoTrack and useNotifications return stable references across calls", () => {
  it("useNotifications: setShowBatchDue is the same function reference on every call", () => {
    const call1 = useNotifications();
    const call2 = useNotifications();
    // If setShowBatchDue were defined inline (`vi.fn()` inside the return body),
    // call1.setShowBatchDue !== call2.setShowBatchDue and this would fail.
    expect(call1.setShowBatchDue).toBe(call2.setShowBatchDue);
  });

  it("useNotifications: the returned object is structurally consistent across calls", () => {
    const call1 = useNotifications();
    const call2 = useNotifications();
    expect(call1.showBatchDue).toBe(call2.showBatchDue);
  });

  it("useAutoTrack: all function references are stable across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // Each of these would fail if the corresponding constant were moved inline.
    expect(call1.setAutoTrackProgress).toBe(call2.setAutoTrackProgress);
    expect(call1.fireAutoTrackNow).toBe(call2.fireAutoTrackNow);
  });

  it("useAutoTrack: autoSuppressUntilRef is the same object reference across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // autoSuppressUntilRef is used as a useMemo dep inside LiveRunProvider.
    // An inline `{ current: 0 }` would produce a new object each call and
    // defeat the memo — this assertion catches that regression.
    expect(call1.autoSuppressUntilRef).toBe(call2.autoSuppressUntilRef);
  });

  it("useAutoTrack: tickDueRefs is the same object reference across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // tickDueRefs is also used as a useMemo dep.  An inline object literal
    // would produce a new ref per call; this test catches that drift.
    expect(call1.tickDueRefs).toBe(call2.tickDueRefs);
  });

  it("useAutoTrack: each tickDueRef slot is the same object reference across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    const slots = ["case", "tray", "trayProd", "batch", "batchProd"] as const;
    for (const slot of slots) {
      expect(call1.tickDueRefs[slot]).toBe(call2.tickDueRefs[slot]);
    }
  });

  it("useAutoTrack: non-ref fields are value-stable across calls", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    expect(call1.autoTrackProgress).toBe(call2.autoTrackProgress);
    expect(call1.autoTrackSuggestion).toBe(call2.autoTrackSuggestion);
  });
});
