/**
 * useAutoTrack — post-screen-wake / long-timeout counter correctness.
 *
 * Covers the four gap-closing scenarios from the screen-timeout task that are
 * distinct from the existing pause/resume tests:
 *
 *  1. Cases: a long screen-off leaves the interval cleared (the useClock snap
 *     from Task #849 fires a single effect call with a large nowTime jump).
 *     The full accumulated case-delta must be applied in that one tick — there
 *     is intentionally NO cap on the cases side, so catch-up is complete.
 *
 *  2. Trays: the consumption tick is capped at 2 × tray-period worth per tick,
 *     so even a 10-period sleep causes at most 2 periods of tray consumption.
 *
 *  3. Batches: the consumption tick is capped at 2 × batch-period worth per
 *     tick, so even an 8-period sleep causes at most 0.5-batch consumption.
 *
 *  4. formResetSkippedRef after SSE-0-reset during sleep: an SSE echo that
 *     resets the form to 0 while lastExpectedCasesRef holds a large positive
 *     value must be caught on the first wake tick (guard fires, no write), and
 *     the NEXT tick must write a normal ≈1-case increment from 0 — never the
 *     full stale catch-up delta.
 *
 * Production constants (same as pauseResume.test.ts):
 *   ppm=100, pizzasPerCase=10   → CASE_PERIOD_MS  =   6 000 ms
 *   perTray=200                 → TRAY_PERIOD_MS  = 120 000 ms
 *   perBatch=1200               → lineBatchMs     = 720 000 ms
 *                                  BATCH_PERIOD_MS = 180 000 ms (÷4)
 *   casesPerSkid=10, casesNeeded=100, freezerTime=10 min
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { UseFormReturn } from "react-hook-form";
import { useAutoTrack } from "../useAutoTrack";
import type { FormValues } from "../../types";

// ── Fake form ─────────────────────────────────────────────────────────────────
function makeFakeForm(initial: Partial<Record<string, number>> = {}): {
  form: UseFormReturn<FormValues>;
  store: Record<string, number>;
} {
  const store: Record<string, number> = {
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
    traysOnLine: 5,
    batchesReady: 2,
    ...initial,
  };
  const form = {
    getValues: vi.fn((key: string) => store[key] ?? 0),
    setValue: vi.fn((key: string, value: number) => {
      store[key] = value;
    }),
  } as unknown as UseFormReturn<FormValues>;
  return { form, store };
}

// ── Production constants ──────────────────────────────────────────────────────
// ppm=100, pizzasPerCase=10 → CASE_PERIOD_MS  = (10/100)*60000 =   6 000 ms
// perTray=200               → TRAY_PERIOD_MS  = (200/100)*60000 = 120 000 ms
// perBatch=1200             → lineBatchMs     = (1200/100)*60000 = 720 000 ms
//                              BATCH_PERIOD_MS = 720000/4        = 180 000 ms
const CASE_PERIOD_MS = 6_000;
const TRAY_PERIOD_MS = 120_000;
const BATCH_PERIOD_MS = 180_000; // = effDrainMs / 4

const BASE_CALC = {
  ppm: 100,
  perTray: 200,
  perBatch: 1200,
  traysNeeded: 5,
  batchesNeeded: 2,
  pressDone: false,
  casesInFreezer: 0,
};

const BASE_V = {
  casesPerSkid: 10,
  pizzasPerCase: 10,
  casesNeeded: 100,
  freezerTime: 10,
  traysOnLine: 5,
  batchesReady: 2,
};

const T0 = 1_600_000_000_000;

function ms(t: number): Date {
  return new Date(t);
}

// ── Suite ─────────────────────────────────────────────────────────────────────
describe("useAutoTrack — post-screen-wake / long-timeout counter correctness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Cases: full accumulated delta is applied in one tick (no cap).
  //
  // Setup:
  //   elapsed=780 → elapsedMin=13 → afterTunnel=3 → raw = floor(3*100/10) = 30
  //   curTotal=31 → first tick baselines only (prevExpected=-1 → curTotal>0).
  //
  // After 20 min sleep (1200 s):
  //   elapsed = 1980 → elapsedMin=33 → afterTunnel=23 → raw = 230
  //   clamped expectedCases = min(230, 100) = 100
  //   deltaCases = floor(100 - 30) = 70   [clamped value − prevExpected]
  //   curTotal stays 31 (no SSE reset) → guard does NOT fire
  //   target = 31 + 70 = 101 → clamped to casesNeeded=100
  //   skidsCompleted = floor(100/10) = 10, casesOnCurrentSkid = 0 → total = 100.
  // ───────────────────────────────────────────────────────────────────────────
  it("1. after a 20-minute sleep, the full case catch-up delta is applied in one tick", () => {
    const elapsed0 = 780; // → raw≈30

    const { form, store } = makeFakeForm({
      skidsCompleted: 3,
      casesOnCurrentSkid: 1, // curTotal = 31
      traysOnLine: 5,
      batchesReady: 2,
    });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, elapsedSec: number): Props => ({
      runId: "wake-cases-1",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: { ...BASE_V, traysOnLine: store.traysOnLine, batchesReady: store.batchesReady },
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0, elapsed0) },
    );

    // ── Tick 1 at T0+500: prevExpected=-1 → first-tick branch.
    // curTotal=31 > 0 → baseline only (no write).
    // lastExpectedCasesRef ← raw≈30; caseNextDueMsRef ← T0+500+CASE_PERIOD_MS.
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props(T1, elapsed0));
    });
    // Form unchanged; total stays at 31.
    const casesAfterBaseline = store.skidsCompleted * 10 + store.casesOnCurrentSkid;
    expect(casesAfterBaseline).toBe(31);

    // ── 20-minute sleep: advance time without intermediate ticks.
    // elapsedBatchSec advances proportionally — the useClock snap delivers
    // ONE effect call at T_wake with nowTime jumped forward 20 minutes.
    const sleepMs = 20 * 60_000; // 1 200 000 ms
    const T_wake = T1 + sleepMs;
    const elapsedAtWake = elapsed0 + sleepMs / 1000; // 1980

    act(() => {
      vi.setSystemTime(T_wake);
      rerender(props(T_wake, elapsedAtWake));
    });

    const casesAfterWake = store.skidsCompleted * 10 + store.casesOnCurrentSkid;

    // Exact assertion: the deterministic fixture produces total = 100.
    //   delta = 70, target = 31+70 = 101 → clamped → 100.
    // A regression that capped catch-up to fewer cases would fail here.
    expect(casesAfterWake).toBe(100);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Trays: consumption is capped at 2 × tray-period per tick.
  //
  // After the first consumption tick establishes trayLastMsRef, a 10-period
  // sleep means the next tick would see (nowMs - trayLastMsRef) = 10 periods.
  // But durationMin is capped at 2 × trayPeriodMs / 60000 = 4 min, so:
  //   traysConsumed = floor(4 * 100/200) = 2 maximum per consumption tick.
  //
  // Production may also fire (+1), so the net tray change is bounded:
  //   worst-case DROP = 2 consumed − 0 produced = 2.
  // ───────────────────────────────────────────────────────────────────────────
  it("2. after a 10× tray-period sleep, tray consumption in one tick is ≤ 2 periods worth", () => {
    const { form, store } = makeFakeForm({
      skidsCompleted: 3,
      casesOnCurrentSkid: 1, // curTotal=31 → baseline only on tick 1
      traysOnLine: 30, // large starting stock so we don't hit 0
      batchesReady: 2,
    });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, elapsedSec: number): Props => ({
      runId: "wake-trays-2",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: { ...BASE_V, traysOnLine: store.traysOnLine, batchesReady: store.batchesReady },
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0, 700) },
    );

    // ── Tick 1 at T0+1: arms tray consumption anchor (trayLastMsRef ← T0+1).
    // traysOnLine=30 → no seed; prevMs=0 → 1 period worth → 1 tray consumed.
    const T1 = T0 + 1;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props(T1, 700));
    });
    const traysAfterTick1 = store.traysOnLine;

    // ── 10-period sleep (10 × 120 000 ms = 1 200 000 ms). ──────────────────
    // The wake tick fires ONE effect call with nowMs = T_wake.
    // durationMin = min(4 min, 1200000/60000 min) = min(4, 20) = 4 min (capped).
    // traysConsumed per consumption tick = floor(4 * 100/200) = 2.
    const sleepMs = 10 * TRAY_PERIOD_MS;
    const T_wake = T1 + sleepMs + 1;

    act(() => {
      vi.setSystemTime(T_wake);
      rerender(props(T_wake, 700 + sleepMs / 1000));
    });

    const traysAfterWake = store.traysOnLine;
    // Net DROP = traysAfterTick1 - traysAfterWake.
    // Production may fire once (+1); consumption capped at 2.
    // Worst-case net drop = 2 − 0 = 2 (no production). Best case = gain 1.
    const traysNetDrop = traysAfterTick1 - traysAfterWake;
    expect(traysNetDrop).toBeLessThanOrEqual(2);
    // And the counter must not go negative.
    expect(traysAfterWake).toBeGreaterThanOrEqual(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Batches: consumption is capped at 2 × batch-period per tick.
  //
  // effDrainMs = lineBatchMs = 720 000 ms; batchPeriodMs = 180 000 ms.
  // 2-period cap: durationMin = 2 × 180000/60000 = 6 min.
  // delta per consumption tick = (6*60000)/720000 = 0.5 batches maximum.
  //
  // After an 8-period sleep the consumption is still capped at 0.5.
  // ───────────────────────────────────────────────────────────────────────────
  it("3. after an 8× batch-period sleep, batch consumption in one tick is ≤ 2 batch-periods worth", () => {
    const { form, store } = makeFakeForm({
      skidsCompleted: 3,
      casesOnCurrentSkid: 1, // curTotal=31 → baseline only
      traysOnLine: 5,
      batchesReady: 3, // non-zero so we avoid seed path and measure consumption
    });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, elapsedSec: number): Props => ({
      runId: "wake-batches-3",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: { ...BASE_V, traysOnLine: store.traysOnLine, batchesReady: store.batchesReady },
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0, 700) },
    );

    // ── Tick 1 at T0+1: arms batch anchor (batchLastMsRef ← T0+1).
    // batchesReady=3 → no seed; prevMs=0 → 1 period worth consumed.
    const T1 = T0 + 1;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props(T1, 700));
    });
    const batchesAfterTick1 = store.batchesReady;

    // ── 8-period sleep (8 × 180 000 ms = 1 440 000 ms). ────────────────────
    // durationMin = min(6, 8*3) min = min(6, 24) = 6 min (capped at 2 periods).
    // delta from consumption = (6*60000)/720000 = 0.5 batches (capped).
    const sleepMs = 8 * BATCH_PERIOD_MS;
    const T_wake = T1 + sleepMs + 1;

    act(() => {
      vi.setSystemTime(T_wake);
      rerender(props(T_wake, 700 + sleepMs / 1000));
    });

    const batchesAfterWake = store.batchesReady;

    // The cap ensures consumption is at most 2 × batchPeriod worth = 0.5 batches.
    // (Production may also fire +1 so net could be a gain; the important bound
    // is that consumption never applies the uncapped 8-period span.)
    //
    // Maximum drop from consumption alone: 0.5 batches.
    // Production can add +1 in the same tick.
    // So worst-case net drop = 0.5 (if production does NOT fire).
    // The assertion covers both: batchesAfterWake >= batchesAfterTick1 - 0.5
    // which, since we compare stored values (floats), rounds to ≥ -1 change.
    const batchesNetDrop = batchesAfterTick1 - batchesAfterWake;
    // Max consumption delta per tick = 2 × batchPeriodMs / effDrainMs = 0.5
    expect(batchesNetDrop).toBeLessThanOrEqual(
      (2 * BATCH_PERIOD_MS) / (4 * BATCH_PERIOD_MS), // = 0.5
    );
    // And the counter must never go negative.
    expect(batchesAfterWake).toBeGreaterThanOrEqual(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. formResetSkippedRef: SSE-0-reset during sleep.
  //
  // Sequence:
  //   a) Tick 1 baselines lastExpectedCasesRef ← ~30 (curTotal=31>0 → no write).
  //   b) SSE echo resets form to 0 (store mutated directly, as the hook does in
  //      production when it receives a sync push that overwrites the values).
  //   c) 20 case-periods of screen-off — the useClock snap delivers one tick
  //      with a large nowMs jump. prevExpected=30 > casesPerSkid=10, curTotal=0
  //      → guard fires, write skipped, formResetSkippedRef latched.
  //   d) Second tick (CASE_PERIOD_MS later) → guard disarmed → normal +delta
  //      write from 0 → total is a small positive number (not the full 200+
  //      stale catch-up).
  // ───────────────────────────────────────────────────────────────────────────
  it("4. SSE-0-reset during sleep: wake tick 1 is skipped, wake tick 2 writes a normal ≈1-case increment", () => {
    const elapsed0 = 780; // → raw≈30

    const { form, store } = makeFakeForm({
      skidsCompleted: 3,
      casesOnCurrentSkid: 1, // curTotal = 31
      traysOnLine: 5,
      batchesReady: 2,
    });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, elapsedSec: number): Props => ({
      runId: "wake-sse-reset-4",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: { ...BASE_V, traysOnLine: store.traysOnLine, batchesReady: store.batchesReady },
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0, elapsed0) },
    );

    // ── Tick 1 at T0+500: prevExpected=-1 → first-tick branch.
    // curTotal=31>0 → baseline only; lastExpectedCasesRef ← 30.
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props(T1, elapsed0));
    });
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(31);

    // ── SSE echo resets form to 0 while screen is off. ───────────────────────
    store.skidsCompleted = 0;
    store.casesOnCurrentSkid = 0;

    // ── 20 case-period sleep (120 000 ms). ───────────────────────────────────
    // The useClock snap delivers ONE tick at T_wake with a large nowTime jump.
    // elapsed grows proportionally so expectedCasesRaw ≫ lastExpectedCasesRef.
    const sleepMs = 20 * CASE_PERIOD_MS; // 120 000 ms
    const T_wake = T1 + sleepMs + 1;
    const elapsedAtWake = elapsed0 + sleepMs / 1000; // 900 s

    // ── Wake tick 1: stale-delta guard must fire. ─────────────────────────────
    // prevExpected=30 > casesPerSkid=10, curTotal=0 → guard condition is true.
    // Expected behaviour: write is skipped, formResetSkippedRef latched to true.
    act(() => {
      vi.setSystemTime(T_wake);
      rerender(props(T_wake, elapsedAtWake));
    });

    const totalAfterWakeTick1 = store.skidsCompleted * 10 + store.casesOnCurrentSkid;
    // The guard suppressed the catch-up write — form stays at 0.
    expect(totalAfterWakeTick1).toBe(0);

    // ── Wake tick 2: guard disarmed → normal ≈1-delta write from 0. ──────────
    // caseNextDueMsRef is now T_wake + CASE_PERIOD_MS.
    // After one more CASE_PERIOD_MS, expectedCasesRaw grows by exactly
    // floor(CASE_PERIOD_MS_min * ppm / pizzasPerCase) = floor(0.1 * 100/10) = 1.
    const T_tick2 = T_wake + CASE_PERIOD_MS + 1;
    const elapsedAtTick2 = elapsedAtWake + CASE_PERIOD_MS / 1000 + 1;

    act(() => {
      vi.setSystemTime(T_tick2);
      rerender(props(T_tick2, elapsedAtTick2));
    });

    const totalAfterWakeTick2 = store.skidsCompleted * 10 + store.casesOnCurrentSkid;

    // Guard disarmed: a normal incremental write happened.
    expect(totalAfterWakeTick2).toBeGreaterThan(0);
    // Must be a small increment — never the stale 200+ case catch-up.
    expect(totalAfterWakeTick2).toBeLessThanOrEqual(BASE_V.casesPerSkid);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Foreground sync barrier: a second device corrected Cases on Skid while
  // this screen was asleep. The remote value must survive the wake snap, and
  // the first later production interval may add only one normal case.
  // ───────────────────────────────────────────────────────────────────────────
  it("5. re-bases after foreground sync so a remote skid correction is not replaced by hidden-time catch-up", () => {
    const elapsed0 = 780; // expectedCasesRaw ≈ 30
    const { form, store } = makeFakeForm({
      skidsCompleted: 3,
      casesOnCurrentSkid: 1, // local total = 31 before sleep
    });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (
      nowMs: number,
      elapsedSec: number,
      autoTrackBlocked = false,
    ): Props => ({
      runId: "wake-foreground-sync-5",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: { ...BASE_V, traysOnLine: store.traysOnLine, batchesReady: store.batchesReady },
      form,
      autoTrackBlocked,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0, elapsed0) },
    );

    // A long screen-off interval gives the old baseline a large potential
    // catch-up delta. During the foreground pull, the active device's manual
    // correction is adopted into the form while auto-track is held.
    const sleepMs = 20 * 60_000;
    const wakeAt = T0 + sleepMs;
    const elapsedAtWake = elapsed0 + sleepMs / 1000;
    store.skidsCompleted = 0;
    store.casesOnCurrentSkid = 4; // remote shared correction
    act(() => {
      vi.setSystemTime(wakeAt);
      rerender(props(wakeAt, elapsedAtWake, true));
      // Focus and visibility can both fire while one pull is active. A second
      // blocked render must remain inert and must not reintroduce a delta.
      rerender(props(wakeAt, elapsedAtWake, true));
    });
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(4);

    // Successful pull applied: release the barrier at the same production
    // timeline. The barrier re-bases expectedCasesRaw and schedules the next
    // tick in the future, so the correction remains visible.
    act(() => {
      rerender(props(wakeAt, elapsedAtWake, false));
    });
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(4);

    // One normal case period later, only the normal +1 increment is allowed.
    const nextTick = wakeAt + CASE_PERIOD_MS + 1;
    act(() => {
      vi.setSystemTime(nextTick);
      rerender(props(nextTick, elapsedAtWake + CASE_PERIOD_MS / 1000 + 1, false));
    });
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(5);
  });
});
