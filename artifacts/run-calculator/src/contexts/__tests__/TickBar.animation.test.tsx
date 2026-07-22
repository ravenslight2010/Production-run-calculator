// @vitest-environment jsdom
//
// Regression guard: TickBar fill-width MUST change as nowTime advances while
// auto-track is running.
//
// TickBars in LiveDoughTabContent animate by computing:
//   secLeft = max(0, (tickDueRefs.tray.current - nowMs) / 1000)
//   pct     = (1 - secLeft / periodSec) * 100
//
// Two paths can silently freeze the bar without throwing any JS error:
//   1. Clock subscription dropped — useLiveRun() returns stale nowTime, so
//      secLeft never decreases and pct never grows.
//   2. tickDueRefs.tray.current (or .batch.current) stays 0 — secLeftOf
//      short-circuits to periodSec, pct stays 0 forever regardless of nowTime.
//
// This test guards both: it verifies that after the clock ticks (≥ 1 s), the
// fill-pct rendered by a useLiveRun() consumer is measurably greater than at
// mount. The counter-proof (same assertions fail when runStatus keeps timers
// slow) is included to confirm the tests are meaningful.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactNode } from "react";
import { type FormValues, DEFAULT_VALUES } from "../../types";
import { LiveRunProvider, useLiveRun } from "../../contexts/LiveRunContext";

// ── Hoisted tickDueRefs — must be created with vi.hoisted() so the vi.mock()
// factory (which is hoisted before imports) can reference them.
const mockTickRefs = vi.hoisted(() => ({
  case:      { current: 0 as number },
  tray:      { current: 0 as number },
  trayProd:  { current: 0 as number },
  batch:     { current: 0 as number },
  batchProd: { current: 0 as number },
}));

vi.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => ({ showBatchDue: false, setShowBatchDue: vi.fn() }),
}));

vi.mock("../../hooks/useAutoTrack", () => ({
  useAutoTrack: () => ({
    autoTrackProgress: true,
    setAutoTrackProgress: vi.fn(),
    autoTrackSuggestion: null,
    autoSuppressUntilRef: { current: 0 },
    fireAutoTrackNow: vi.fn(),
    tickDueRefs: mockTickRefs,
  }),
  suggestedDoughStaging: () => ({ trays: null, batches: null }),
}));

// ── TickBar math (mirrors home.tsx inline helpers) ───────────────────────────

function secLeftOf(dueMs: number, periodSec: number, nowMs: number): number {
  return dueMs > 0
    ? Math.min(periodSec, Math.max(0, (dueMs - nowMs) / 1000))
    : periodSec;
}

function fillPct(secLeft: number, periodSec: number): number {
  return periodSec > 0
    ? Math.min(100, Math.max(0, (1 - secLeft / periodSec) * 100))
    : 0;
}

// ppm=100, perTray=60  → trayPeriodSec  = (60  / 100) * 60 = 36 s
// ppm=100, perBatch=600 → lineBatchSec  = (600 / 100) * 60 = 360 s
//                        drainQuarterSec = lineBatchSec / 4 = 90 s
// spinSec (mixer cycle): arbitrary realistic value used for batchProd period
const TRAY_PERIOD_SEC = 36;
const BATCH_QUARTER_PERIOD_SEC = 90;
const SPIN_SEC = 120;

// ── Minimal provider wrapper ─────────────────────────────────────────────────
function TestProvider({
  children,
  runStatus = "running",
}: {
  children: ReactNode;
  runStatus?: "running" | "pending";
}) {
  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });
  return (
    <LiveRunProvider
      v={DEFAULT_VALUES}
      ve={DEFAULT_VALUES}
      runStatus={runStatus}
      currentRun={undefined}
      currentRunId="test-run-tickbar"
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

// ── Probe: reads nowTime + tickDueRefs from useLiveRun() and exposes the
// computed tray, batch, trayProd, and batchProd fill-pcts as data-attributes
// for assertion.
function TickBarProbe() {
  const { nowTime, tickDueRefs } = useLiveRun();
  const nowMs = nowTime.getTime();
  const traySecLeft      = secLeftOf(tickDueRefs.tray.current,      TRAY_PERIOD_SEC,          nowMs);
  const batchSecLeft     = secLeftOf(tickDueRefs.batch.current,     BATCH_QUARTER_PERIOD_SEC, nowMs);
  const trayProdSecLeft  = secLeftOf(tickDueRefs.trayProd.current,  TRAY_PERIOD_SEC,          nowMs);
  const batchProdSecLeft = secLeftOf(tickDueRefs.batchProd.current, SPIN_SEC,                 nowMs);
  return (
    <div
      data-testid="probe"
      data-tray-pct={fillPct(traySecLeft,      TRAY_PERIOD_SEC)}
      data-batch-pct={fillPct(batchSecLeft,     BATCH_QUARTER_PERIOD_SEC)}
      data-tray-prod-pct={fillPct(trayProdSecLeft,  TRAY_PERIOD_SEC)}
      data-batch-prod-pct={fillPct(batchProdSecLeft, SPIN_SEC)}
    />
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TickBar animation — regression guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset all due-timestamp refs so each test starts from a clean slate.
    mockTickRefs.tray.current      = 0;
    mockTickRefs.trayProd.current  = 0;
    mockTickRefs.batch.current     = 0;
    mockTickRefs.batchProd.current = 0;
    mockTickRefs.case.current      = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("tray TickBar pct increases as nowTime advances (guards dropped clock subscription)", async () => {
    render(
      <TestProvider>
        <TickBarProbe />
      </TestProvider>,
    );

    // Arm the tray ref 36 s in the future so the bar starts near 0% and has
    // room to animate as the clock advances.
    const t0 = Date.now(); // fake-timer time at mount
    mockTickRefs.tray.current = t0 + TRAY_PERIOD_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const pct0  = Number(probe.getAttribute("data-tray-pct"));

    // Advance the fake clock by 2.1 s.  useClock fires every 1 s while
    // runStatus === "running", so after this advance nowTime will have
    // increased by ≥ 1 s and the component will have re-rendered with a
    // smaller secLeft and a larger pct.
    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });

    const pct1 = Number(probe.getAttribute("data-tray-pct"));

    // Guard 1: pct must have increased — nowTime is actually propagating
    // through useLiveRun() as the clock ticks.  If the clock subscription
    // is dropped, pct stays at pct0 and this assertion fails.
    expect(pct1).toBeGreaterThan(pct0);

    // Guard 2: pct must be strictly above 0 — tickDueRefs.tray.current was
    // set to a valid future timestamp and contributed to the computation.
    // If the ref stayed 0, secLeftOf would always return periodSec → pct = 0.
    expect(pct1).toBeGreaterThan(0);
  });

  it("batch TickBar pct increases as nowTime advances (guards dropped clock subscription)", async () => {
    render(
      <TestProvider>
        <TickBarProbe />
      </TestProvider>,
    );

    const t0 = Date.now();
    mockTickRefs.batch.current = t0 + BATCH_QUARTER_PERIOD_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const pct0  = Number(probe.getAttribute("data-batch-pct"));

    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });

    const pct1 = Number(probe.getAttribute("data-batch-pct"));

    // Same two guards as the tray test, applied to the batch TickBar.
    expect(pct1).toBeGreaterThan(pct0);
    expect(pct1).toBeGreaterThan(0);
  });

  it("trayProd TickBar pct increases as nowTime advances (guards dropped trayProd ref)", async () => {
    render(
      <TestProvider>
        <TickBarProbe />
      </TestProvider>,
    );

    // Arm the trayProd ref 36 s in the future.  trayProd uses the same period
    // as the consumption tray bar (trayPeriodSec), so a dropped or zeroed ref
    // would leave secLeftOf returning periodSec → pct stays 0.
    const t0 = Date.now();
    mockTickRefs.trayProd.current = t0 + TRAY_PERIOD_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const pct0  = Number(probe.getAttribute("data-tray-prod-pct"));

    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });

    const pct1 = Number(probe.getAttribute("data-tray-prod-pct"));

    // Guard 1: pct must increase — nowTime is propagating through useLiveRun().
    expect(pct1).toBeGreaterThan(pct0);
    // Guard 2: pct must be above 0 — the ref was set to a valid future timestamp.
    expect(pct1).toBeGreaterThan(0);
  });

  it("batchProd TickBar pct increases as nowTime advances (guards dropped batchProd ref)", async () => {
    render(
      <TestProvider>
        <TickBarProbe />
      </TestProvider>,
    );

    // Arm the batchProd ref SPIN_SEC (120 s) in the future.  batchProd uses
    // spinSec as its period; a dropped or zeroed ref keeps pct at 0 forever.
    const t0 = Date.now();
    mockTickRefs.batchProd.current = t0 + SPIN_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const pct0  = Number(probe.getAttribute("data-batch-prod-pct"));

    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });

    const pct1 = Number(probe.getAttribute("data-batch-prod-pct"));

    // Guard 1: pct must increase — nowTime is propagating through useLiveRun().
    expect(pct1).toBeGreaterThan(pct0);
    // Guard 2: pct must be above 0 — the ref was set to a valid future timestamp.
    expect(pct1).toBeGreaterThan(0);
  });

  it("counter-proof: pct does NOT increase when the run is pending (clock at 10 s cadence)", async () => {
    // With runStatus="pending" the clock ticks every 10 s instead of 1 s.
    // After only 2.1 s of fake-timer time the interval has NOT fired, so
    // nowTime is unchanged and pct must stay at its mount value.  This
    // counter-proof confirms the two live-run tests above are meaningful
    // and are not trivially passing from some other cause.
    render(
      <TestProvider runStatus="pending">
        <TickBarProbe />
      </TestProvider>,
    );

    const t0 = Date.now();
    mockTickRefs.tray.current = t0 + TRAY_PERIOD_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const pct0  = Number(probe.getAttribute("data-tray-pct"));

    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });

    const pct1 = Number(probe.getAttribute("data-tray-pct"));

    // nowTime has not advanced yet, so pct must be the same as at mount.
    expect(pct1).toBe(pct0);
  });
});
