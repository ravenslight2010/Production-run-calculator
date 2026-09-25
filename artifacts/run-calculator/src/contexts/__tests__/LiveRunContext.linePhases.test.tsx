// @vitest-environment jsdom
//
// Slice 5 of server live-calc streaming: LiveRunContext adopts the server-owned
// line-phase model from a confirmed operational projection (extrapolating
// countdowns from capturedAtServerMs), and falls back to the local
// computeLinePhases derivation when the projection is absent, the lifecycle
// stamp differs (just-paused/ended), a countdown would cross zero between
// ticks, or an older server omits the field.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { type ReactNode } from "react";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";
import { useNotifications } from "../../hooks/useNotifications";
import { useAutoTrack } from "../../hooks/useAutoTrack";
import type { Calc, OperationalProjection, LinePhases } from "@workspace/live-calc";

vi.mock("../../hooks/useNotifications");
vi.mock("../../hooks/useAutoTrack");

const LOCAL_SENTINEL = {
  __localCalc: true,
  casesOnLine: 32,
  casesInFreezer: 25,
} as unknown as Calc;
vi.mock("@workspace/live-calc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@workspace/live-calc")>();
  const spy = vi.fn((...args: Parameters<typeof mod.computeCalc>) => LOCAL_SENTINEL);
  return { ...mod, computeCalc: spy };
});

const RUN_ID = "test-run-1";
const NOW_MS = 1_700_000_000_000;

const fakeRun = {
  id: RUN_ID,
  brand: "TestBrand",
  flavor: "TestFlavor",
  startedAt: NOW_MS - 60_000,
} as const;

// Server-owned phase model: stage 1 filling with 150s left, downstream empty.
const SERVER_PHASES: LinePhases = {
  stage1: { label: "Press · Oven · Frontline", state: "filling", remainMs: 150_000 },
  stage2: { label: "Freeze tunnel", state: "empty", remainMs: 0 },
  stage3: { label: "Wrapper · Packaging", state: "empty", remainMs: 0 },
};

type FakeRun = {
  id: string;
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  stoppages?: { type: string; startedAt?: number; endedAt?: number; stopTunnel?: boolean }[];
};

function projectionFor(options: {
  capturedAtMs?: number;
  runStatus?: "running" | "paused" | "ended" | "pending";
  linePhases?: LinePhases;
  calc?: Partial<Calc>;
}): OperationalProjection {
  return {
    runId: RUN_ID,
    capturedAtServerMs: options.capturedAtMs ?? NOW_MS - 2_000,
    effectiveElapsedSec: 60,
    facts: { runStatus: options.runStatus ?? "running" },
    timers: { currentBatchNum: 1, secUntilNextBatch: 5, totalBatchesNeeded: 3 },
    linePhases: options.linePhases ?? SERVER_PHASES,
    calc: options.calc,
  } as unknown as OperationalProjection;
}

function Probe({ probeRef }: { probeRef: { current: LinePhases | null } }) {
  const { linePhases } = useLiveRun();
  probeRef.current = linePhases;
  return null;
}

function OccupancyProbe({
  probeRef,
}: {
  probeRef: { current: { casesOnLine: number; casesInFreezer: number } | null };
}) {
  const { calc } = useLiveRun();
  probeRef.current = {
    casesOnLine: calc.casesOnLine,
    casesInFreezer: calc.casesInFreezer,
  };
  return null;
}

function TestProvider({
  children,
  operationalProjection = null,
  operationalSnapshotReceipt = null,
  currentRun = undefined,
  runStatus = "running",
}: {
  children: ReactNode;
  operationalProjection?: OperationalProjection | null;
  operationalSnapshotReceipt?: { runId: string; snapshotId: string; capturedAt: number } | null;
  currentRun?: FakeRun | undefined;
  runStatus?: "pending" | "running" | "paused" | "ended";
}) {
  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });
  return (
    <LiveRunProvider
      v={DEFAULT_VALUES}
      ve={DEFAULT_VALUES}
      runStatus={runStatus}
      currentRun={currentRun}
      currentRunId={RUN_ID}
      form={form}
      dayState={{ runs: [], currentIndex: 0 }}
      doughSubTab="dough"
      upcomingRunLabels={[]}
      prefs={undefined}
      screenMode={null}
      machine={{ spinSec: 0, hopperSec: 0 }}
      operationalOnline={true}
      operationalSyncConnected={true}
      operationalSnapshotReceipt={operationalSnapshotReceipt}
      operationalProjection={operationalProjection}
    >
      {children}
    </LiveRunProvider>
  );
}

describe("LiveRunProvider — line-phase model adoption", () => {
  const phaseProbe = { current: null as LinePhases | null };
  const freshReceipt = { runId: RUN_ID, snapshotId: "snap-1", capturedAt: NOW_MS - 2_000 };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    phaseProbe.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("keeps confirmed paused occupancy instead of stale pre-wake local occupancy", () => {
    const occupancy = {
      current: null as { casesOnLine: number; casesInFreezer: number } | null,
    };
    render(
      <TestProvider
        runStatus="paused"
        currentRun={{ ...fakeRun, pausedAt: NOW_MS - 30_000 }}
        operationalSnapshotReceipt={freshReceipt}
        operationalProjection={projectionFor({
          runStatus: "paused",
          calc: { casesOnLine: 1, casesInFreezer: 1 },
        })}
      >
        <OccupancyProbe probeRef={occupancy} />
      </TestProvider>,
    );
    expect(occupancy.current).toEqual({ casesOnLine: 1, casesInFreezer: 1 });
  });

  it("still rebases running occupancy locally between confirmed server frames", () => {
    const occupancy = {
      current: null as { casesOnLine: number; casesInFreezer: number } | null,
    };
    render(
      <TestProvider
        currentRun={fakeRun}
        operationalSnapshotReceipt={freshReceipt}
        operationalProjection={projectionFor({
          calc: { casesOnLine: 1, casesInFreezer: 1 },
        })}
      >
        <OccupancyProbe probeRef={occupancy} />
      </TestProvider>,
    );
    expect(occupancy.current).toEqual({ casesOnLine: 32, casesInFreezer: 25 });
  });

  it("adopts server linePhases from a confirmed projection and extrapolates countdowns", () => {
    render(
      <TestProvider
        operationalSnapshotReceipt={freshReceipt}
        operationalProjection={projectionFor({ capturedAtMs: NOW_MS - 2_000 })}
        currentRun={fakeRun}
      >
        <Probe probeRef={phaseProbe} />
      </TestProvider>,
    );

    expect(phaseProbe.current?.stage1.state).toBe("filling");
    // 150s server remainMs minus the 2s wall delta since capturedAtServerMs.
    expect(phaseProbe.current?.stage1.remainMs).toBe(148_000);
    expect(phaseProbe.current?.stage2.state).toBe("empty");
    expect(phaseProbe.current?.stage3.state).toBe("empty");
  });

  it("falls back to local derivation without a confirmed projection", () => {
    render(
      <TestProvider currentRun={fakeRun}>
        <Probe probeRef={phaseProbe} />
      </TestProvider>,
    );

    // Local model with DEFAULT_VALUES (freezerTime 0, preTunnelMin 2.5): 60s
    // elapsed → stage 1 filling with (2.5 - 1) minutes remaining.
    expect(phaseProbe.current?.stage1.state).toBe("filling");
    expect(phaseProbe.current?.stage1.remainMs).toBe(90_000);
  });

  it("falls back to local derivation when the projection lifecycle differs", () => {
    render(
      <TestProvider
        operationalSnapshotReceipt={freshReceipt}
        operationalProjection={projectionFor({ runStatus: "running" })}
        currentRun={{ ...fakeRun, pausedAt: NOW_MS - 60_000 }}
        runStatus="paused"
      >
        <Probe probeRef={phaseProbe} />
      </TestProvider>,
    );

    // Local paused model: 60s into a safe stop-tunnel pause → stage 1 draining.
    expect(phaseProbe.current?.stage1.state).toBe("draining");
    expect(phaseProbe.current?.stage1.remainMs).toBe(90_000);
  });

  it("falls back to local derivation when a countdown would cross zero between ticks", () => {
    render(
      <TestProvider
        operationalSnapshotReceipt={freshReceipt}
        operationalProjection={projectionFor({
          capturedAtMs: NOW_MS - 2_000,
          linePhases: {
            stage1: { label: "Press · Oven · Frontline", state: "filling", remainMs: 1_000 },
            stage2: { label: "Freeze tunnel", state: "empty", remainMs: 0 },
            stage3: { label: "Wrapper · Packaging", state: "empty", remainMs: 0 },
          },
        })}
        currentRun={fakeRun}
      >
        <Probe probeRef={phaseProbe} />
      </TestProvider>,
    );

    // 1s remainMs would expire within the 2s delta → re-derive locally instead
    // of showing a frozen zero-countdown from the stale server frame. Local
    // model uses the server-anchored extrapolated elapsed (62s).
    expect(phaseProbe.current?.stage1.remainMs).toBe(88_000);
  });

  it("falls back to local derivation when an older server omits linePhases", () => {
    const withoutPhases = projectionFor({});
    delete (withoutPhases as { linePhases?: unknown }).linePhases;
    render(
      <TestProvider
        operationalSnapshotReceipt={freshReceipt}
        operationalProjection={withoutPhases}
        currentRun={fakeRun}
      >
        <Probe probeRef={phaseProbe} />
      </TestProvider>,
    );

    expect(phaseProbe.current?.stage1.state).toBe("filling");
    expect(phaseProbe.current?.stage1.remainMs).toBe(88_000);
  });
});
