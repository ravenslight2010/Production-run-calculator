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
import { PENDING_CLOCK_MS } from "../../hooks/useClock";
// Direct import of the exported tickDueRefs object from the shared manual mock.
// Mutating its slots in beforeEach is visible to the rendered TickBarProbe
// because the mock's useAutoTrack() returns the SAME object reference.
import {
  mockAutoTrackTickRefs,
  mockSetAutoTrackProgress,
  mockAutoSuppressUntilRef,
  mockFireAutoTrackNow,
} from "../../hooks/__mocks__/useAutoTrack";
import { mockSetShowBatchDue } from "../../hooks/__mocks__/useNotifications";

// The symmetric guard advances fake time by this amount to cross the pending
// clock cadence (PENDING_CLOCK_MS).  Deriving it here means that if the
// cadence constant in useClock.ts ever changes, the advance automatically
// stays meaningful — and the meta-guard test below will catch any edit that
// accidentally brings the advance back below the cadence.
const SYMMETRIC_GUARD_ADVANCE_MS = PENDING_CLOCK_MS + 1_000;

// The counter-proof tests advance fake time by this amount to stay BELOW the
// pending clock cadence and confirm nowTime does NOT advance.  If
// PENDING_CLOCK_MS is ever lowered (e.g. to 2 s), the meta-guard below will
// catch the mismatch immediately with a clear diagnostic before the
// counter-proof tests start failing for a confusing reason.
const COUNTER_PROOF_ADVANCE_MS = 2_100;

// ── Shared manual mocks ───────────────────────────────────────────────────────
//
// Closure-level stability is enforced STRUCTURALLY by the shared manual mock
// files in src/hooks/__mocks__/.  Those files allocate all refs/fns once at
// module scope and export a hook that always yields the same references —
// preventing the inline-vi.fn() mistake that silently defeats LiveRunProvider's
// liveSlice useMemo and freezes TickBar animation.
//
// Vitest resolves the __mocks__ sibling automatically from the no-factory calls
// below.  No vi.hoisted() is needed: beforeEach mutates slots on the exported
// mockAutoTrackTickRefs object (same reference returned by useAutoTrack()),
// which is structurally impossible to break via an inline allocation.
//
// The "STABILITY CONTRACT" describe block below verifies the contract with
// reference-identity assertions so any drift in the shared mocks is caught.

vi.mock("../../hooks/useNotifications");
vi.mock("../../hooks/useAutoTrack");

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
    // These mutations are visible to the TickBarProbe via tickDueRefs from
    // useLiveRun() because mockAutoTrackTickRefs IS the object the mock returns.
    mockAutoTrackTickRefs.tray.current      = 0;
    mockAutoTrackTickRefs.trayProd.current  = 0;
    mockAutoTrackTickRefs.batch.current     = 0;
    mockAutoTrackTickRefs.batchProd.current = 0;
    mockAutoTrackTickRefs.case.current      = 0;
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
    mockAutoTrackTickRefs.tray.current = t0 + TRAY_PERIOD_SEC * 1000;

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
    mockAutoTrackTickRefs.batch.current = t0 + BATCH_QUARTER_PERIOD_SEC * 1000;

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
    mockAutoTrackTickRefs.trayProd.current = t0 + TRAY_PERIOD_SEC * 1000;

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
    mockAutoTrackTickRefs.batchProd.current = t0 + SPIN_SEC * 1000;

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
    mockAutoTrackTickRefs.tray.current = t0 + TRAY_PERIOD_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const pct0  = Number(probe.getAttribute("data-tray-pct"));

    await act(async () => {
      vi.advanceTimersByTime(COUNTER_PROOF_ADVANCE_MS);
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
    mockAutoTrackTickRefs.trayProd.current  = t0 + TRAY_PERIOD_SEC * 1000;
    mockAutoTrackTickRefs.batchProd.current = t0 + SPIN_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const trayProdPct0  = Number(probe.getAttribute("data-tray-prod-pct"));
    const batchProdPct0 = Number(probe.getAttribute("data-batch-prod-pct"));

    await act(async () => {
      vi.advanceTimersByTime(COUNTER_PROOF_ADVANCE_MS);
    });

    const trayProdPct1  = Number(probe.getAttribute("data-tray-prod-pct"));
    const batchProdPct1 = Number(probe.getAttribute("data-batch-prod-pct"));

    // nowTime has not advanced (10 s cadence, only COUNTER_PROOF_ADVANCE_MS ms
    // elapsed), so neither production bar should have changed.  If it does,
    // the clock subscription is firing faster than expected for a pending run —
    // a freeze-risk signal.
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
    mockAutoTrackTickRefs.trayProd.current  = t0 + TRAY_PERIOD_SEC * 1000;
    mockAutoTrackTickRefs.batchProd.current = t0 + SPIN_SEC * 1000;

    const probe = screen.getByTestId("probe");
    const trayProdPct0  = Number(probe.getAttribute("data-tray-prod-pct"));
    const batchProdPct0 = Number(probe.getAttribute("data-batch-prod-pct"));

    // Advance by SYMMETRIC_GUARD_ADVANCE_MS (PENDING_CLOCK_MS + 1_000) —
    // crosses the pending clock cadence so the interval fires at least once
    // and nowTime advances.  Using the derived constant instead of a literal
    // ensures this guard stays meaningful if PENDING_CLOCK_MS ever changes.
    await act(async () => {
      vi.advanceTimersByTime(SYMMETRIC_GUARD_ADVANCE_MS);
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
// Because the shared __mocks__ files allocate all refs/fns at module scope,
// this contract is STRUCTURALLY guaranteed — not per-file convention.  These
// assertions serve as a trip-wire: if the __mocks__ file is ever edited to
// return inline literals (e.g. vi.fn() inside the return body), the relevant
// assertion here fails immediately, catching the regression before it silently
// freezes TickBar animation.
//
// See src/hooks/__mocks__/useAutoTrack.ts for the full explanation of WHY
// closure-level (module-scope) refs are mandatory.

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

  it("useNotifications: setShowBatchDue IS the exported mockSetShowBatchDue constant (guards a second allocation in the mock)", () => {
    const { setShowBatchDue } = useNotifications();
    // The two-call reference-identity check above confirms consecutive calls
    // return the same object, but it cannot detect the case where BOTH calls
    // return a newly allocated fn that is neither call's expected reference.
    // This assertion closes that gap: it verifies the EXPLICIT CHAIN —
    // mock module → useNotifications() return → setShowBatchDue — is the
    // exact same reference as the exported constant.  If someone adds a reset
    // helper inside the __mocks__ file that re-allocates setShowBatchDue
    // (e.g. returning a fresh vi.fn() from a reset helper and yielding it
    // instead of the module-scope constant), the two-call check above would
    // still pass vacuously if the same new object is returned each time.
    // This assertion fails immediately in that scenario.
    expect(setShowBatchDue).toBe(mockSetShowBatchDue);
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

  it("useAutoTrack: tickDueRefs IS the exported mockAutoTrackTickRefs constant (guards a second allocation in the mock)", () => {
    const { tickDueRefs } = useAutoTrack();
    // The two-call reference-identity check above confirms that consecutive
    // calls return the same object, but it cannot detect the case where
    // BOTH calls return a newly allocated object that is neither call's
    // expected reference.  This assertion closes that gap: it verifies the
    // EXPLICIT CHAIN — mock module → useAutoTrack() return → tickDueRefs —
    // is the exact same object as the exported constant that TickBar tests
    // mutate in beforeEach.  If someone adds a reset helper inside the
    // __mocks__ file that re-allocates tickDueRefs (e.g.
    //   export const tickDueRefsReset = { ... }  and returns it instead),
    // the mutation in beforeEach would write to a different object, the
    // probe would always see 0, and the fill-pct tests would pass vacuously.
    // This assertion fails immediately in that scenario.
    expect(tickDueRefs).toBe(mockAutoTrackTickRefs);
  });

  it("useAutoTrack: each tickDueRefs slot is the same object reference on every call", () => {
    const call1 = useAutoTrack();
    const call2 = useAutoTrack();
    // Each individual slot must also be a stable ref.  The slots come from
    // mockAutoTrackTickRefs in the shared __mocks__ file — stable by construction.
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

  it("useAutoTrack: setAutoTrackProgress IS the exported mockSetAutoTrackProgress constant (guards a second allocation in the mock)", () => {
    const { setAutoTrackProgress } = useAutoTrack();
    // The two-call reference-identity check above confirms consecutive calls
    // return the same object, but it cannot detect the case where BOTH calls
    // return a newly allocated fn that is neither call's expected reference.
    // This assertion closes that gap: it verifies the EXPLICIT CHAIN —
    // mock module → useAutoTrack() return → setAutoTrackProgress — is the
    // exact same reference as the exported constant.  If someone adds a reset
    // helper inside the __mocks__ file that re-allocates setAutoTrackProgress
    // (e.g. returning a fresh vi.fn() and yielding it instead of the
    // module-scope constant), the two-call check above would still pass
    // vacuously if the same new object is returned each time.
    // This assertion fails immediately in that scenario.
    expect(setAutoTrackProgress).toBe(mockSetAutoTrackProgress);
  });

  it("useAutoTrack: autoSuppressUntilRef IS the exported mockAutoSuppressUntilRef constant (guards a second allocation in the mock)", () => {
    const { autoSuppressUntilRef } = useAutoTrack();
    // autoSuppressUntilRef is used as a useMemo dep inside LiveRunProvider.
    // An inline `{ current: 0 }` inside the return body would produce a new
    // object on every render, defeating the memo.  The two-call identity
    // check alone cannot catch the case where both calls happen to return
    // the same freshly allocated object.  This explicit-chain assertion
    // closes that gap by pinning the returned ref to the exported module-scope
    // constant — the only safe allocation point.
    expect(autoSuppressUntilRef).toBe(mockAutoSuppressUntilRef);
  });

  it("useAutoTrack: fireAutoTrackNow IS the exported mockFireAutoTrackNow constant (guards a second allocation in the mock)", () => {
    const { fireAutoTrackNow } = useAutoTrack();
    // fireAutoTrackNow is used as a useMemo dep inside LiveRunProvider.
    // Same reasoning as autoSuppressUntilRef above: the explicit-chain
    // assertion catches a re-allocation that the two-call identity check
    // would miss if both calls happen to return the same new reference.
    expect(fireAutoTrackNow).toBe(mockFireAutoTrackNow);
  });
});

// ── META-GUARD: symmetric advance must exceed the pending clock cadence ───────
//
// The symmetric guard test advances fake time by SYMMETRIC_GUARD_ADVANCE_MS
// (= PENDING_CLOCK_MS + 1_000) to cross the pending clock interval and confirm
// nowTime actually propagates.  If a future developer edits PENDING_CLOCK_MS
// upward (e.g. from 10 s to 30 s) without updating SYMMETRIC_GUARD_ADVANCE_MS,
// the symmetric guard silently becomes a copy of the counter-proof — it will
// pass even when nowTime never propagates, masking a real freeze.
//
// This test catches that drift: it fails as soon as SYMMETRIC_GUARD_ADVANCE_MS
// is no longer strictly greater than PENDING_CLOCK_MS, regardless of which
// side was edited.

describe("TickBar.animation — META-GUARD: symmetric advance exceeds pending clock cadence", () => {
  it("SYMMETRIC_GUARD_ADVANCE_MS is strictly greater than PENDING_CLOCK_MS", () => {
    // If this assertion fails, the symmetric guard in
    // "symmetric guard: trayProd and batchProd pcts DO change …" is no
    // longer meaningful — its timer advance won't cross the pending clock
    // interval and it will pass vacuously alongside the counter-proof.
    expect(SYMMETRIC_GUARD_ADVANCE_MS).toBeGreaterThan(PENDING_CLOCK_MS);
  });

  it("SYMMETRIC_GUARD_ADVANCE_MS equals PENDING_CLOCK_MS + 1_000 (advance formula is intact)", () => {
    // Guards against accidental constant folding or formula simplification
    // that happens to keep the advance above the cadence but breaks the
    // explicit +1_000 margin this file relies on.
    expect(SYMMETRIC_GUARD_ADVANCE_MS).toBe(PENDING_CLOCK_MS + 1_000);
  });
});

// ── META-GUARD: counter-proof advance must stay below the pending clock cadence
//
// The counter-proof tests advance fake time by COUNTER_PROOF_ADVANCE_MS and
// assert that pct does NOT change, relying on the fact that this advance is
// strictly less than PENDING_CLOCK_MS (the pending-run clock interval).  If
// PENDING_CLOCK_MS is ever lowered below COUNTER_PROOF_ADVANCE_MS (e.g. from
// 10 s to 2 s), the interval will fire within the counter-proof window and the
// counter-proof tests will start failing for a confusing reason with no clear
// explanation of why.
//
// This meta-guard catches that drift immediately: it fails as soon as
// COUNTER_PROOF_ADVANCE_MS is no longer strictly less than PENDING_CLOCK_MS,
// giving the developer a clear diagnostic — update either PENDING_CLOCK_MS or
// COUNTER_PROOF_ADVANCE_MS to restore the invariant.

describe("TickBar.animation — META-GUARD: counter-proof advance stays below pending clock cadence", () => {
  it("COUNTER_PROOF_ADVANCE_MS is strictly less than PENDING_CLOCK_MS", () => {
    // If this assertion fails, lowering PENDING_CLOCK_MS caused the
    // counter-proof advance to cross the pending clock interval.  Either
    // raise PENDING_CLOCK_MS back above COUNTER_PROOF_ADVANCE_MS, or lower
    // COUNTER_PROOF_ADVANCE_MS so the counter-proof window is safely below the
    // new cadence.
    expect(COUNTER_PROOF_ADVANCE_MS).toBeLessThan(PENDING_CLOCK_MS);
  });
});
