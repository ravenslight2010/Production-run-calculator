// @vitest-environment jsdom
//
// Task 4 of server-live-calc-stream: verify that LiveRunContext adopts the
// streamed server calc when the receipt is fresh (inside the 10s freshness
// window), falls back to local computeCalc when stale/offline/disconnected,
// and cancels adoption when the run switches.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useState, type ReactNode } from "react";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";
import { useNotifications } from "../../hooks/useNotifications";
import { useAutoTrack } from "../../hooks/useAutoTrack";
import type { Calc } from "@workspace/live-calc";

vi.mock("../../hooks/useNotifications");
vi.mock("../../hooks/useAutoTrack");

// Mock computeCalc from @workspace/live-calc so we can spy on calls
const LOCAL_SENTINEL = { __localCalc: true } as unknown as Calc;
vi.mock("@workspace/live-calc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@workspace/live-calc")>();
  const spy = vi.fn((...args: Parameters<typeof mod.computeCalc>) => LOCAL_SENTINEL);
  // keep spy callable by real impl only when needed
  return { ...mod, computeCalc: spy };
});
import { computeCalc } from "@workspace/live-calc";

const RUN_ID = "test-run-1";
const SNAPSHOT_ID = "snap-1";
const NOW_MS = 1_700_000_000_000;

const fakeRun = {
  id: RUN_ID,
  brand: "TestBrand",
  flavor: "TestFlavor",
  startedAt: NOW_MS - 60_000,
} as const;

const serverCalcResult: Calc = {
  batch: { lbs: 100, doughballs: 50 },
  sauce: { cups: 10, lbs: 8 },
  pepperoni: { slices: 100, oz: 5 },
  toppings: [],
  dough: { lbs: 100, doughballs: 50 },
  packaging: { cases: 10, skids: 1 },
  elapsed: { min: 10 },
  productionRate: { pizzasPerMin: 5 },
  projectedWaste: 2,
  yield: { actual: 50, theoretical: 55 },
} as unknown as Calc;

function ProviderProbe({ probeRef }: { probeRef: { current: Calc | null } }) {
  const { calc } = useLiveRun();
  probeRef.current = calc;
  return null;
}

function TestProvider({
  children,
  operationalOnline = true,
  operationalSyncConnected = true,
  operationalSnapshotReceipt = null,
  operationalServerCalc = null,
  currentRun = undefined,
  serverClockOffsetMs = 0,
}: {
  children: ReactNode;
  operationalOnline?: boolean;
  operationalSyncConnected?: boolean;
  operationalSnapshotReceipt?: { runId: string; snapshotId: string; capturedAt: number } | null;
  operationalServerCalc?: Calc | null;
  currentRun?: { id: string; brand: string; flavor: string; startedAt?: number } | undefined;
  serverClockOffsetMs?: number;
}) {
  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });
  return (
    <LiveRunProvider
      v={DEFAULT_VALUES}
      ve={DEFAULT_VALUES}
      runStatus="running"
      currentRun={currentRun}
      currentRunId={RUN_ID}
      form={form}
      dayState={{ runs: [], currentIndex: 0 }}
      doughSubTab="dough"
      upcomingRunLabels={[]}
      prefs={undefined}
      screenMode={null}
      machine={{ spinSec: 0, hopperSec: 0 }}
      operationalOnline={operationalOnline}
      operationalSyncConnected={operationalSyncConnected}
      operationalSnapshotReceipt={operationalSnapshotReceipt}
      operationalServerCalc={operationalServerCalc}
      serverClockOffsetMs={serverClockOffsetMs}
    >
      {children}
    </LiveRunProvider>
  );
}

describe("LiveRunProvider — calcTick adoption", () => {
  const calcProbe = { current: null as Calc | null };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    vi.mocked(computeCalc).mockClear();
    vi.mocked(computeCalc).mockImplementation(() => LOCAL_SENTINEL);
    calcProbe.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("adopts server calc when the receipt is fresh and does NOT call computeCalc", async () => {
    const freshReceipt = {
      runId: RUN_ID,
      snapshotId: SNAPSHOT_ID,
      capturedAt: NOW_MS - 4_000, // 4s ago — within 10s window
    };

    render(
      <TestProvider
        operationalSnapshotReceipt={freshReceipt}
        operationalServerCalc={serverCalcResult}
        currentRun={fakeRun}
      >
        <ProviderProbe probeRef={calcProbe} />
      </TestProvider>,
    );

    // Should use serverCalc directly
    expect(calcProbe.current).toBe(serverCalcResult);
    // computeCalc should NOT have been called
    expect(computeCalc).not.toHaveBeenCalled();
  });

  it("falls back to computeCalc when offline even with a fresh receipt", async () => {
    const freshReceipt = {
      runId: RUN_ID,
      snapshotId: SNAPSHOT_ID,
      capturedAt: NOW_MS - 4_000,
    };

    render(
      <TestProvider
        operationalOnline={false}
        operationalSnapshotReceipt={freshReceipt}
        operationalServerCalc={serverCalcResult}
        currentRun={fakeRun}
      >
        <ProviderProbe probeRef={calcProbe} />
      </TestProvider>,
    );

    // Should NOT use serverCalc — falls back to local computeCalc
    expect(calcProbe.current).toBe(LOCAL_SENTINEL);
    expect(calcProbe.current).not.toBe(serverCalcResult);
    expect(computeCalc).toHaveBeenCalled();
  });

  it("falls back to computeCalc when sync disconnected", async () => {
    const freshReceipt = {
      runId: RUN_ID,
      snapshotId: SNAPSHOT_ID,
      capturedAt: NOW_MS - 4_000,
    };

    render(
      <TestProvider
        operationalSyncConnected={false}
        operationalSnapshotReceipt={freshReceipt}
        operationalServerCalc={serverCalcResult}
        currentRun={fakeRun}
      >
        <ProviderProbe probeRef={calcProbe} />
      </TestProvider>,
    );

    expect(calcProbe.current).toBe(LOCAL_SENTINEL);
    expect(calcProbe.current).not.toBe(serverCalcResult);
    expect(computeCalc).toHaveBeenCalled();
  });

  it("falls back to computeCalc when the receipt is stale (> 10s)", async () => {
    const staleReceipt = {
      runId: RUN_ID,
      snapshotId: SNAPSHOT_ID,
      capturedAt: NOW_MS - 12_000, // 12s ago — outside 10s window
    };

    render(
      <TestProvider
        operationalSnapshotReceipt={staleReceipt}
        operationalServerCalc={serverCalcResult}
        currentRun={fakeRun}
      >
        <ProviderProbe probeRef={calcProbe} />
      </TestProvider>,
    );

    expect(calcProbe.current).toBe(LOCAL_SENTINEL);
    expect(calcProbe.current).not.toBe(serverCalcResult);
    expect(computeCalc).toHaveBeenCalled();
  });

  it("falls back to computeCalc when there is no receipt", async () => {
    render(
      <TestProvider
        operationalSnapshotReceipt={null}
        operationalServerCalc={serverCalcResult}
        currentRun={fakeRun}
      >
        <ProviderProbe probeRef={calcProbe} />
      </TestProvider>,
    );

    expect(calcProbe.current).toBe(LOCAL_SENTINEL);
    expect(calcProbe.current).not.toBe(serverCalcResult);
    expect(computeCalc).toHaveBeenCalled();
  });

  it("falls back to computeCalc when the run switched (receipt.runId mismatch)", async () => {
    const otherRunReceipt = {
      runId: "wrong-run-id",
      snapshotId: SNAPSHOT_ID,
      capturedAt: NOW_MS - 4_000,
    };

    render(
      <TestProvider
        operationalSnapshotReceipt={otherRunReceipt}
        operationalServerCalc={serverCalcResult}
        currentRun={fakeRun}
      >
        <ProviderProbe probeRef={calcProbe} />
      </TestProvider>,
    );

    expect(calcProbe.current).toBe(LOCAL_SENTINEL);
    expect(calcProbe.current).not.toBe(serverCalcResult);
    expect(computeCalc).toHaveBeenCalled();
  });
});
