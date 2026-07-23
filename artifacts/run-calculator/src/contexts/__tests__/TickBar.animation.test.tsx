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
import { useAutoTrack } from "../../hooks/useAutoTrack";
import { useNotifications } from "../../hooks/useNotifications";

// ── Hoisted tickDueRefs — must be created with vi.hoisted() so the vi.mock()
// factory (which is hoisted before imports) can reference them.
const mockTickRefs = vi.hoisted(() => ({
  case:      { current: 0 as number },
  tray:      { current: 0 as number },
  trayProd:  { current: 0 as number },
  batch:     { current: 0 as number },
  batchProd: { current: 0 as number },
}));

// !! STABILITY CONTRACT — DO NOT BREAK !!
//
// Every object and function returned by these mock factories MUST be defined
// at closure scope (outside the inner arrow function), NOT created inline.
//
// WHY THIS MATTERS:
//   LiveRunProvider wraps its hook results in a `value` useMemo whose deps
//   include the return values of useAutoTrack() and useNotifications().
//   If any field is an inline literal (e.g. `vi.fn()` or `{ current: 0 }`
//   written directly in the return body), a NEW reference is produced on
//   every call to the hook.  That makes the useMemo deps unstable, so the
//   memo fires on every render, which silently defeats memo()-based isolation
//   and can freeze TickBar animation by corrupting nowTime propagation.
//
// CORRECT (closure-level — same ref every call):
//   const myFn = vi.fn();
//   return { useFoo: () => ({ fn: myFn }) };
//
// WRONG (inline literal — new ref every call):
//   return { useFoo: () => ({ fn: vi.fn() }) };
//
// The "STABILITY CONTRACT" describe block below enforces this contract with
// reference-identity assertions.

vi.mock("../../hooks/useNotifications", () => {
  // Closure-level refs — stable across every call to useNotifications().
  // Inline `vi.fn()` here would produce a new ref per call and break the
  // liveSlice useMemo in LiveRunProvider.  See STABILITY CONTRACT above.
  const setShowBatchDue = vi.fn();
  return {
    useNotifications: () => ({ showBatchDue: false, setShowBatchDue }),
  };
});

vi.mock("../../hooks/useAutoTrack", () => {
  // Closure-level refs — stable across every call to useAutoTrack().
  // Every object/function here must remain at closure scope.  Moving any
  // of these inline (e.g. `autoSuppressUntilRef: { current: 0 }` inside
  // the return body) would silently defeat the liveSlice useMemo isolation.
  // See STABILITY CONTRACT above.
  const setAutoTrackProgress = vi.fn();
  const autoSuppressUntilRef = { current: 0 };
  const fireAutoTrackNow = vi.fn();
  return {
    useAutoTrack: () => ({
      autoTrackProgress: true,
      setAutoTrackProgress,
      autoSuppressUntilRef,
      fireAutoTrackNow,
      autoTrackSuggestion: null,
      tickDueRefs: mockTickRefs,
    }),
    suggestedDoughStaging: () => ({ trays: null, batches: null }),
  };
});

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

  it("counter-proof: trayProd and batchProd pcts do NOT increase when the run is pending (clock at 10 s cadence)", async () => {
    // Arms both production-side refs (trayProd, batchProd) under
    // runStatus="pending" so the 10-second clock cadence means the interval
    // has NOT fired after 2.1 s of fake time.  If a future developer weakens
    // the counter-proof to cover only the consumption refs (tray/batch), this
    // dedicated check will still catch a regression where trayProd or
    // batchProd mistakenly animates while the run is not yet active.
    render(
      <TestProvider runStatus="pending">
        <TickBarProbe />
      </TestProvider>,
    );

    const t0 = Date.now();
    mockTickRefs.trayProd.current  = t0 + TRAY_PERIOD_SEC * 1000;
    mockTickRefs.batchProd.current = t0 + SPIN_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const trayProdPct0  = Number(probe.getAttribute("data-tray-prod-pct"));
    const batchProdPct0 = Number(probe.getAttribute("data-batch-prod-pct"));

    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });

    const trayProdPct1  = Number(probe.getAttribute("data-tray-prod-pct"));
    const batchProdPct1 = Number(probe.getAttribute("data-batch-prod-pct"));

    // nowTime has not advanced (10 s cadence, only 2.1 s elapsed), so neither
    // production bar should have changed.  If it does, the clock subscription
    // is firing faster than expected for a pending run — a freeze-risk signal.
    expect(trayProdPct1).toBe(trayProdPct0);
    expect(batchProdPct1).toBe(batchProdPct0);
  });

  it("symmetric guard: trayProd and batchProd pcts DO change when the pending clock is forced to fire (11 s advance)", async () => {
    // This test is the symmetric complement of the counter-proof above.
    // The counter-proof asserts that pcts do NOT change after 2.1 s under
    // runStatus="pending" (10 s cadence — interval has not fired yet).
    // HERE we advance by 11 s, which IS enough to trigger the pending clock
    // interval, so nowTime WILL advance and pct MUST increase.
    //
    // If the counter-proof were passing vacuously (e.g. the useLiveRun spy
    // target drifted so nowTime never propagates at all regardless of cadence),
    // this test would fail because even 11 s of elapsed time would not change
    // the pct — catching the drift before it silently masks a real freeze.
    render(
      <TestProvider runStatus="pending">
        <TickBarProbe />
      </TestProvider>,
    );

    const t0 = Date.now();
    mockTickRefs.trayProd.current  = t0 + TRAY_PERIOD_SEC * 1000;
    mockTickRefs.batchProd.current = t0 + SPIN_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const trayProdPct0  = Number(probe.getAttribute("data-tray-prod-pct"));
    const batchProdPct0 = Number(probe.getAttribute("data-batch-prod-pct"));

    // Advance by 11 s — crosses the 10 s pending clock cadence, so the
    // interval fires at least once and nowTime advances.
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    const trayProdPct1  = Number(probe.getAttribute("data-tray-prod-pct"));
    const batchProdPct1 = Number(probe.getAttribute("data-batch-prod-pct"));

    // Both production bars must have increased: nowTime propagated through
    // useLiveRun() and the armed refs contributed to the computation.
    // If either stays at its mount value, the useLiveRun spy target has
    // drifted and the counter-proof was passing vacuously.
    expect(trayProdPct1).toBeGreaterThan(trayProdPct0);
    expect(batchProdPct1).toBeGreaterThan(batchProdPct0);
  });
});

// ── STABILITY CONTRACT enforcement ───────────────────────────────────────────
//
// These tests call each mock hook TWICE and assert that every returned
// object/function field is the exact same reference (===) across both calls.
// If a future developer moves a closure-level constant inline, the reference
// changes and the relevant assertion fails here — catching the regression
// before it silently freezes TickBar animation.
//
// See the STABILITY CONTRACT comment block above the vi.mock factories for the
// full explanation of WHY closure-level refs are mandatory.

describe("TickBar.animation — STABILITY CONTRACT: mock hooks return stable references across calls", () => {
  it("useNotifications: setShowBatchDue is the same function reference on every call", () => {
    const call1 = useNotifications();
    const call2 = useNotifications();
    // If setShowBatchDue were defined inline (`vi.fn()` inside the return body),
    // call1.setShowBatchDue !== call2.setShowBatchDue and this would fail.
    expect(call1.setShowBatchDue).toBe(call2.setShowBatchDue);
  });

  it("useNotifications: showBatchDue is value-stable across calls", () => {
    const call1 = useNotifications();
    const call2 = useNotifications();
    expect(call1.showBatchDue).toBe(call2.showBatchDue);
  });

  it("useAutoTrack: setAutoTrackProgress is the same function reference on every call", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // An inline `vi.fn()` inside the return body would produce a new reference
    // each call — this assertion catches that drift.
    expect(call1.setAutoTrackProgress).toBe(call2.setAutoTrackProgress);
  });

  it("useAutoTrack: fireAutoTrackNow is the same function reference on every call", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    expect(call1.fireAutoTrackNow).toBe(call2.fireAutoTrackNow);
  });

  it("useAutoTrack: autoSuppressUntilRef is the same object reference on every call", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // autoSuppressUntilRef is used as a useMemo dep inside LiveRunProvider.
    // An inline `{ current: 0 }` would produce a new object each call and
    // defeat the memo — this assertion catches that regression.
    expect(call1.autoSuppressUntilRef).toBe(call2.autoSuppressUntilRef);
  });

  it("useAutoTrack: tickDueRefs is the same object reference on every call", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // tickDueRefs is also used as a useMemo dep.  An inline object literal
    // would produce a new ref per call; this test catches that drift.
    expect(call1.tickDueRefs).toBe(call2.tickDueRefs);
  });

  it("useAutoTrack: each tickDueRefs slot is the same object reference on every call", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // Each individual slot must also be a stable ref.  The slots in this file
    // come from mockTickRefs (vi.hoisted), which is stable by construction.
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
