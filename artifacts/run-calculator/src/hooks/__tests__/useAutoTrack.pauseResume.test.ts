/**
 * useAutoTrack — pause / resume counter correctness.
 *
 * Exercises the three pause-related failure modes documented in
 * autotrack-stale-delta.md and autotrack-remainder-carry.md:
 *
 *  1. traysOnLine must NOT jump after resume: trayLastMsRef is zeroed when
 *     runStatus becomes "running", so the first post-resume consumption tick
 *     uses ONE period's duration instead of the accumulated pause span.
 *
 *  2 & 3. formResetSkippedRef: when the form is cleared to 0 while
 *     lastExpectedCasesRef holds a large positive value, the guard skips the
 *     first write (stale-delta catch-up), then disarms so the NEXT tick writes
 *     a normal ≈ 1-case increment.
 *
 * Timing invariants (all tick refs start at 0 → first tick fires at the first
 * nowTime that is ≥ 0, i.e. always):
 *   Tick 1 fires at: T0 + 500  ms
 *   After tick 1, caseNextDueMsRef = T0 + 500 + CASE_PERIOD_MS (= T0 + 6500)
 *   After tick 1, trayNextDueMsRef = T0 + 500 + TRAY_PERIOD_MS (= T0 + 120500)
 *
 * React flushes both useEffect queues inside a single act() call.  The resume
 * rerender triggers:
 *   a) runStatus effect → zeros trayLastMsRef / trayNextDueMsRef
 *   b) tick effect      → fires immediately (nextDue refs are 0)
 * So assertions after the resume act() capture the state AFTER the first
 * post-resume tick has already run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { UseFormReturn } from "react-hook-form";
import { getAutoTrackTiming, useAutoTrack } from "../useAutoTrack";
import type { FormValues } from "../../types";

// ── Fake form ────────────────────────────────────────────────────────────────
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
// ppm=100, pizzasPerCase=10   → CASE_PERIOD_MS = 10/100*60000 = 6 000 ms
// perTray=200                 → TRAY_PERIOD_MS = 200/100*60000 = 120 000 ms
// casesPerSkid=10, casesNeeded=100
const CASE_PERIOD_MS = 6_000;
const TRAY_PERIOD_MS = 120_000;

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

// elapsedBatchSec=700 → elapsedMin≈11.67 → afterTunnel≈1.67 min → raw≈16
const ELAPSED_SEC = 700;

// Fixed epoch so Date.now() inside the hook's suppression check is consistent.
const T0 = 1_600_000_000_000;

function ms(t: number) {
  return new Date(t);
}

// ── Suite ─────────────────────────────────────────────────────────────────────
describe("useAutoTrack — pause/resume counter correctness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. traysOnLine does not jump on resume
  //
  // Setup: start a run, fire tick 1 (establishes trayLastMsRef), pause, wait
  // 5 minutes, then resume.  The runStatus "running" effect zeros both
  // trayLastMsRef and trayNextDueMsRef before the tick effect runs, so the
  // first post-resume consumption tick sees prevMs=0 and uses ONE period
  // (2 min) — not the 5-minute pause span capped at 4 min (2 periods).
  // ───────────────────────────────────────────────────────────────────────────
  it("1. tray consumption on resume uses ONE period, not the pause duration", () => {
    // Initialize form with 31 cases so the first-tick baseline assertion holds
    // (curTotal=31 > 0 → hook baselines without writing; form stays at 31).
    const { form, store } = makeFakeForm({
      traysOnLine: 5,
      batchesReady: 2,
      skidsCompleted: 3,
      casesOnCurrentSkid: 1,
    });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (
      status: "running" | "paused",
      nowMs: number,
    ): Props => ({
      runId: "run-1",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: BASE_CALC,
      v: { ...BASE_V, traysOnLine: store.traysOnLine },
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props("running", T0) },
    );

    // ── Tick 1 at T0+500 ─────────────────────────────────────────────────
    // All due refs start at 0 → consumption tick fires immediately.
    // prevMs = 0 → durationMin = TRAY_PERIOD_MS/60000 = 2 min
    // traysConsumed = floor(2*100/200) = 1.  trays: 5 → 4.
    // trayLastMsRef    ← T0+500
    // trayNextDueMsRef ← T0+500+TRAY_PERIOD_MS
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props("running", T1));
    });
    expect(store.traysOnLine).toBe(4);

    // ── Pause at T1+1 ────────────────────────────────────────────────────
    const tPause = T1 + 1;
    act(() => {
      vi.setSystemTime(tPause);
      rerender(props("paused", tPause));
    });
    expect(store.traysOnLine).toBe(4);

    // ── Stay paused for 5 min (> 2 tray periods). ────────────────────────
    const tResume = tPause + 5 * 60_000;
    act(() => {
      vi.setSystemTime(tResume);
      rerender(props("paused", tResume));
    });
    expect(store.traysOnLine).toBe(4); // unchanged while paused

    // ── Resume ───────────────────────────────────────────────────────────
    // runStatus effect zeros trayLastMsRef + trayNextDueMsRef on paused→running.
    // tick: prevMs=0 → durationMin=2 min (1 period) → 1 tray consumed → 4→3.
    // WITHOUT the reset: elapsed≈5 min capped at 4 min → 2 trays → 4→2.
    const traysBeforeResume = store.traysOnLine; // 4
    act(() => {
      vi.setSystemTime(tResume + 2);
      rerender(props("running", tResume + 2));
    });

    // Resume arms the full tray period; it must not fire early.
    expect(traysBeforeResume - store.traysOnLine).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. formResetSkippedRef prevents the stale-delta catch-up jump
  //
  // Scenario: run is live, form shows ~31 cases; operator pauses; SSE echo
  // resets form to 0; 54 case-periods of wall-clock pass; operator resumes.
  // Without the guard, delta = expectedRaw − prevExpected ≈ 54; auto-track
  // would write 54 on top of 0 → total=54 (the bug).  With the guard, the
  // first post-resume tick is skipped and the second writes ≈ 1.
  // ───────────────────────────────────────────────────────────────────────────
  it("2. catch-up delta of 54 cases is blocked — total stays ≤ 2 after form reset + resume", () => {
    // Initialize form with 31 cases so the first-tick baseline assertion holds
    // (curTotal=31 > 0 → hook baselines without writing; form stays at 31).
    const { form, store } = makeFakeForm({
      traysOnLine: 5,
      batchesReady: 2,
      skidsCompleted: 3,
      casesOnCurrentSkid: 1,
    });

    // elapsed=780 → elapsedMin=13 → afterTunnel=3 → expectedCasesRaw≈30
    const elapsed = 780;

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (
      status: "running" | "paused",
      nowMs: number,
      elapsedSec?: number,
    ): Props => ({
      runId: "run-2",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec ?? ELAPSED_SEC,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props("running", T0, elapsed) },
    );

    // ── Tick 1 at T0+500 ─────────────────────────────────────────────────
    // prevExpected=-1 → first-tick branch; curTotal=31>0 → baseline only.
    // lastExpectedCasesRef ← expectedCasesRaw ≈ 30
    // caseNextDueMsRef     ← T0+500+CASE_PERIOD_MS
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props("running", T1, elapsed));
    });
    // Form unchanged (first-tick baselines only).
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(31);

    // ── Pause, then SSE resets form to 0. ────────────────────────────────
    const tPause = T1 + 1;
    act(() => {
      vi.setSystemTime(tPause);
      rerender(props("paused", tPause, elapsed));
    });
    store.skidsCompleted = 0;
    store.casesOnCurrentSkid = 0;

    // ── Stay paused for 54 case-periods (~5.4 min). ─────────────────────
    // elapsed grows by the same amount → expectedCasesRaw grows by ≈ 54.
    const pauseMs = 54 * CASE_PERIOD_MS; // 324 000 ms
    const tResume = tPause + pauseMs;
    const elapsedAfterPause = elapsed + pauseMs / 1000;

    act(() => {
      vi.setSystemTime(tResume);
      rerender(props("paused", tResume, elapsedAfterPause));
    });
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(0);

    // ── Resume ───────────────────────────────────────────────────────────
    // A resume starts the case countdown from a full period, so it must not
    // write the stale 54-case delta in the same render.
    act(() => {
      vi.setSystemTime(tResume + 2);
      rerender(props("running", tResume + 2, elapsedAfterPause + 1));
    });

    // No counter write is caused solely by the Resume action.
    const totalAfterResume = store.skidsCompleted * 10 + store.casesOnCurrentSkid;
    expect(totalAfterResume).toBe(0);

    // ── First full post-resume interval: stale-delta guard still wins. ────
    act(() => {
      vi.setSystemTime(tResume + CASE_PERIOD_MS + 3);
      rerender(props("running", tResume + CASE_PERIOD_MS + 3, elapsedAfterPause + 7));
    });
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(0);

    // ── Next ordinary period: guard disarmed → one normal increment. ──────
    act(() => {
      vi.setSystemTime(tResume + 2 * CASE_PERIOD_MS + 4);
      rerender(props("running", tResume + 2 * CASE_PERIOD_MS + 4, elapsedAfterPause + 13));
    });
    const totalAfterNextTick = store.skidsCompleted * 10 + store.casesOnCurrentSkid;
    expect(totalAfterNextTick).toBe(totalAfterResume + 1);
    expect(totalAfterNextTick).toBeLessThan(10);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. formResetSkippedRef is a single-use latch
  //
  // Verify that after one guard skip, the NEXT tick always writes — even when
  // the operator keeps the form at 0 deliberately (operator-corrected-to-0
  // case).  The latch must not permanently suppress auto-track.
  //
  // Uses exact multiples of 60 s for elapsed so all period boundaries are
  // whole integers — avoids IEEE 754 rounding issues with elapsedMin fractions
  // (e.g. 906/60 = 15.1 is not exactly representable, making floor() fragile).
  // ───────────────────────────────────────────────────────────────────────────
  it("3. formResetSkippedRef disarms on the next tick (never permanently suppresses)", () => {
    // elapsed=1200 → elapsedMin=20 → afterTunnel=10 → expectedCasesRaw=100
    // elapsed+60=1260 → elapsedMin=21 → afterTunnel=11 → raw=110  (Δ=10)
    // elapsed+120=1320 → elapsedMin=22 → afterTunnel=12 → raw=120 (Δ=10)
    // All arithmetic is exact integers — no floating-point surprises.
    const elapsed = 1200;

    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, elapsedSec: number): Props => ({
      runId: "run-3",
      runStatus: "running" as const,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: BASE_V,
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0, elapsed) },
    );

    // ── Initial render: case tick fires immediately (caseNextDueMsRef=0).
    // prevExpected=-1 → first-tick branch → baselines lastExpectedCasesRef=100.
    // caseNextDueMsRef ← T0+CASE_PERIOD_MS (= T0+6000).

    // ── SSE form reset to 0 (simulating an SSE echo while paused). ───────
    store.skidsCompleted = 0;
    store.casesOnCurrentSkid = 0;

    // ── Guard tick at T0+6001 (just past caseNextDueMsRef = T0+6000). ───
    // elapsed+60=1260 → elapsedMin=21 → afterTunnel=11 → raw=110.
    // prevExpected=100, deltaCases=110-100=10 > 0.
    // curTotal=0, prevExpected(100) > casesPerSkid(10) → guard fires!
    // → skip write; formResetSkippedRef ← true.
    // → lastExpectedCasesRef ← 110; caseNextDueMsRef ← T0+12001.
    const Tguard = T0 + CASE_PERIOD_MS + 1; // T0+6001
    act(() => {
      vi.setSystemTime(Tguard);
      rerender(props(Tguard, elapsed + 60));
    });
    const afterGuardTick = store.skidsCompleted * 10 + store.casesOnCurrentSkid;
    // Guard fired: write was skipped; form stays at 0.
    expect(afterGuardTick).toBe(0);

    // ── Write tick at T0+12002 (just past caseNextDueMsRef = T0+12001). ─
    // elapsed+120=1320 → elapsedMin=22 → afterTunnel=12 → raw=120.
    // prevExpected=110, deltaCases=120-110=10 > 0.
    // formResetSkippedRef=true → else branch → write proceeds!
    // target = 0+10=10 → setValue("skidsCompleted",1); setValue(...,0).
    // formResetSkippedRef ← false (latch disarmed).
    const Twrite = T0 + 2 * CASE_PERIOD_MS + 2; // T0+12002
    act(() => {
      vi.setSystemTime(Twrite);
      rerender(props(Twrite, elapsed + 120));
    });
    const afterWriteTick = store.skidsCompleted * 10 + store.casesOnCurrentSkid;

    // Latch disarmed: write proceeded — total is 10 (one normal delta).
    expect(afterWriteTick).toBeGreaterThan(0);
    // Exactly one delta worth (10), nowhere near the 110-case stale catch-up.
    expect(afterWriteTick).toBeLessThanOrEqual(BASE_V.casesPerSkid);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Dough-timer independent pause: traysOnLine must NOT jump on resume
  //
  // pauseDoughTimers() freezes dough ticks mid-run while runStatus stays
  // "running".  resumeDoughTimers() zeroes trayLastMsRef + trayNextDueMsRef so
  // the first post-resume consumption tick uses ONE period (2 min) — not the
  // accumulated pause span (5 min, capped at 2 periods = 4 min → 2 trays).
  //
  // Note: unlike the global-pause resume path, the runStatus effect does NOT
  // fire here (runStatus never changes). resumeDoughTimers() itself zeros the
  // refs, so the no-jump guarantee comes from resumeDoughTimers alone.
  // ───────────────────────────────────────────────────────────────────────────
  it("4. traysOnLine/batchesReady do not jump after dough-timer pause + resume", () => {
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (status: "running" | "paused", nowMs: number): Props => ({
      runId: "run-4",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props("running", T0) },
    );

    // ── Tick 1 at T0+500: establishes trayLastMsRef / batchLastMsRef ──────
    // prevMs=0 → duration=1 period (2 min) → traysConsumed=1.  trays: 5→4.
    // trayLastMsRef    ← T0+500
    // trayNextDueMsRef ← T0+500+TRAY_PERIOD_MS
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props("running", T1));
    });
    expect(store.traysOnLine).toBe(4);

    // ── pauseDoughTimers() called at T1+1 ────────────────────────────────
    // doughTimerPausedRef.current = T1+1; tray/batch ticks suppressed.
    act(() => {
      vi.setSystemTime(T1 + 1);
      result.current.pauseDoughTimers();
      rerender(props("running", T1 + 1));
    });
    expect(store.traysOnLine).toBe(4); // unchanged — dough paused

    // ── Stay paused for 5 minutes (> 2 tray periods). ─────────────────────
    const tPause5min = T1 + 5 * 60_000;
    act(() => {
      vi.setSystemTime(tPause5min);
      rerender(props("running", tPause5min));
    });
    expect(store.traysOnLine).toBe(4); // still no tray tick

    // ── resumeDoughTimers() called: zeroes trayLastMsRef + trayNextDueMsRef.
    // The consumption tick fires immediately (trayNextDueMsRef=0, nowMs≥0):
    //   prevMs = trayLastMsRef = 0 → durationMin = 1 period (2 min)
    //   traysConsumed = floor(2*100/200) = 1 → 4→3
    //
    // WITHOUT resumeDoughTimers resetting trayLastMsRef, prevMs would be T1
    // (T0+500). The elapsed span (≈5 min) would be capped at 2 periods (4 min)
    // → floor(4*100/200)=2 trays consumed → 4→2 (the "jump").
    const tResume = tPause5min + 1;
    const traysBeforeResume = store.traysOnLine; // 4
    act(() => {
      vi.setSystemTime(tResume);
      result.current.resumeDoughTimers();
      rerender(props("running", tResume + 2));
    });

    // Dough-timer pause must be cleared by resumeDoughTimers.
    expect(result.current.isDoughTimerPaused).toBe(false);
    expect(traysBeforeResume - store.traysOnLine).toBe(0);
    expect(store.traysOnLine).toBe(4);
    expect(store.batchesReady).toBeGreaterThanOrEqual(0);
  });

  it("4a. a timed dough correction pause auto-rearms after one tray cadence", () => {
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });
    const doughSuppressRef = { current: 0 };

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number): Props => ({
      runId: "run-timed-dough-correction",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
      externalDoughAutoSuppressRef: doughSuppressRef,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0) },
    );

    const correctionAt = T0 + 1_000;
    const firstResumeAt = correctionAt + TRAY_PERIOD_MS;
    act(() => {
      vi.setSystemTime(correctionAt);
      store.traysOnLine = 20;
      doughSuppressRef.current = firstResumeAt;
      result.current.pauseDoughTimers(TRAY_PERIOD_MS);
      rerender(props(correctionAt));
    });
    expect(result.current.isDoughTimerPaused).toBe(true);
    expect(store.traysOnLine).toBe(20);

    // Expiry is a clean re-arm only; the paused interval is never consumed.
    act(() => {
      vi.setSystemTime(firstResumeAt);
      rerender(props(firstResumeAt));
    });
    expect(result.current.isDoughTimerPaused).toBe(false);
    expect(store.traysOnLine).toBe(20);

    // Production is half a tray cadence out of phase with consumption. It
    // restarts from the corrected baseline, rather than replaying the pause.
    act(() => {
      vi.setSystemTime(firstResumeAt + TRAY_PERIOD_MS / 2 + 1);
      rerender(props(firstResumeAt + TRAY_PERIOD_MS / 2 + 1));
    });
    expect(store.traysOnLine).toBe(21);
    act(() => {
      vi.setSystemTime(firstResumeAt + TRAY_PERIOD_MS + 1);
      rerender(props(firstResumeAt + TRAY_PERIOD_MS + 1));
    });
    expect(store.traysOnLine).toBe(20);
  });

  it("4b. a second dough correction restarts the one-tray deadline", () => {
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });
    const doughSuppressRef = { current: 0 };

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number): Props => ({
      runId: "run-repeated-dough-correction",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
      externalDoughAutoSuppressRef: doughSuppressRef,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0) },
    );

    const firstCorrectionAt = T0 + 1_000;
    const secondCorrectionAt = firstCorrectionAt + 30_000;
    const secondResumeAt = secondCorrectionAt + TRAY_PERIOD_MS;
    act(() => {
      vi.setSystemTime(firstCorrectionAt);
      store.traysOnLine = 20;
      doughSuppressRef.current = firstCorrectionAt + TRAY_PERIOD_MS;
      result.current.pauseDoughTimers(TRAY_PERIOD_MS);
      rerender(props(firstCorrectionAt));
    });
    act(() => {
      vi.setSystemTime(secondCorrectionAt);
      store.traysOnLine = 14;
      doughSuppressRef.current = secondResumeAt;
      result.current.pauseDoughTimers(TRAY_PERIOD_MS);
      rerender(props(secondCorrectionAt));
    });

    // The first deadline no longer applies after the second correction.
    act(() => {
      vi.setSystemTime(firstCorrectionAt + TRAY_PERIOD_MS);
      rerender(props(firstCorrectionAt + TRAY_PERIOD_MS));
    });
    expect(result.current.isDoughTimerPaused).toBe(true);
    expect(store.traysOnLine).toBe(14);

    act(() => {
      vi.setSystemTime(secondResumeAt);
      rerender(props(secondResumeAt));
    });
    expect(result.current.isDoughTimerPaused).toBe(false);
    expect(store.traysOnLine).toBe(14);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Cases/skids keep ticking during a dough-timer-only pause
  //
  // Dough-timer pause must NOT block the cases/skids counter — the line is
  // still running; only the dough batch pipeline display is frozen.
  // Confirms the guard at line 563 (doughTimerPausedRef > 0 → return) is
  // placed AFTER the cases block, not before it.
  // ───────────────────────────────────────────────────────────────────────────
  it("5. cases/skids continue ticking normally while dough timers are paused", () => {
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    type Props = Parameters<typeof useAutoTrack>[0];
    // elapsedSec must be passed so expectedCasesRaw grows across ticks,
    // allowing the case counter to advance during the dough-timer pause period.
    const props = (
      status: "running" | "paused",
      nowMs: number,
      elapsedSec?: number,
      trays?: number,
      batches?: number,
    ): Props => ({
      runId: "run-5",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec ?? ELAPSED_SEC,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0, ELAPSED_SEC) },
    );

    // ── Tick 1 at T0+500 ─────────────────────────────────────────────────
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props("running", T1));
    });
    expect(store.traysOnLine).toBeLessThanOrEqual(5);

    // ── pauseDoughTimers() at T1+1: freeze dough ticks. ──────────────────
    act(() => {
      vi.setSystemTime(T1 + 1);
      result.current.pauseDoughTimers();
      rerender(props("running", T1 + 1, ELAPSED_SEC));
    });
    const traysWhenPaused = store.traysOnLine;
    const casesWhenPaused = store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid;

    // ── Advance 3 case periods while dough timers are paused. ─────────────
    // Cases should still tick (3 increments); trays must stay frozen.
    // elapsedSec must increase each iteration so expectedCasesRaw grows
    // and the hook writes an updated count (delta > 0 → case tick fires).
    const advanceMs = 3 * CASE_PERIOD_MS; // 18 000 ms

    // Step through case periods one at a time so each tick fires.
    for (let i = 1; i <= 3; i++) {
      const nowMs = T1 + 1 + i * CASE_PERIOD_MS + 1;
      act(() => {
        vi.setSystemTime(nowMs);
        rerender(props("running", nowMs, ELAPSED_SEC + (i * CASE_PERIOD_MS) / 1000));
      });
    }

    const casesAfterPause = store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid;
    const traysAfterPause = store.traysOnLine;

    // Cases advanced during dough-timer pause — case ticking is NOT blocked.
    expect(casesAfterPause).toBeGreaterThan(casesWhenPaused);
    // Trays frozen — dough ticks suppressed by pause guard.
    expect(traysAfterPause).toBe(traysWhenPaused);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. formResetSkippedRef is a single-use latch
  //
  // Verify that after one guard skip, the NEXT tick always writes — even when
  // the operator keeps the form at 0 deliberately (operator-corrected-to-0
  // case).  The latch must not permanently suppress auto-track.
  //
  // Uses exact multiples of 60 s for elapsed so all period boundaries are
  // whole integers — avoids IEEE 754 rounding issues with elapsedMin fractions
  // (e.g. 906/60 = 15.1 is not exactly representable, making floor() fragile).
  // ───────────────────────────────────────────────────────────────────────────
  it("3. formResetSkippedRef disarms on the next tick (never permanently suppresses)", () => {
    // elapsed=1200 → elapsedMin=20 → afterTunnel=10 → expectedCasesRaw=100
    // elapsed+60=1260 → elapsedMin=21 → afterTunnel=11 → raw=110  (Δ=10)
    // elapsed+120=1320 → elapsedMin=22 → afterTunnel=12 → raw=120 (Δ=10)
    // All arithmetic is exact integers — no floating-point surprises.
    const elapsed = 1200;

    // Initialize form with 100 cases (elapsed=1200 → raw=100) so the first-tick
    // branch baselines without writing (curTotal=100>0 → baseline only).
    const { form, store } = makeFakeForm({
      traysOnLine: 5,
      batchesReady: 2,
      skidsCompleted: 10,
      casesOnCurrentSkid: 0,
    });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (
      status: "running" | "paused",
      nowMs: number,
      elapsedSec?: number,
    ): Props => ({
      runId: "run-6",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec ?? ELAPSED_SEC,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props("running", T0, elapsed) },
    );

    // ── Initial render: case tick fires immediately (caseNextDueMsRef=0).
    // prevExpected=-1 → first-tick branch; curTotal=100>0 → baseline only.
    // lastExpectedCasesRef ← 100 (= floor(10*100/10), exact integer).
    // caseNextDueMsRef     ← T0+CASE_PERIOD_MS (= T0+6000).

    // ── SSE form reset to 0 (simulating an SSE echo while the session pauses).
    store.skidsCompleted = 0;
    store.casesOnCurrentSkid = 0;

    // ── Guard tick at T0+6001 (just past caseNextDueMsRef = T0+6000). ───
    // elapsed+60=1260 → elapsedMin=21 → afterTunnel=11 → raw=110.
    // prevExpected=100, deltaCases=110-100=10 > 0.
    // curTotal=0, prevExpected=100 > casesPerSkid=10 → guard fires!
    // → skip write; formResetSkippedRef ← true.
    // → lastExpectedCasesRef ← 110; caseNextDueMsRef ← T0+6001+6000=T0+12001.
    const Tguard = T0 + CASE_PERIOD_MS + 1; // T0+6001
    act(() => {
      vi.setSystemTime(Tguard);
      rerender(props("running", Tguard, elapsed + 60));
    });
    const afterGuardTick = store.skidsCompleted * 10 + store.casesOnCurrentSkid;
    // Guard fired: write was skipped; form stays at 0.
    expect(afterGuardTick).toBe(0);

    // ── Write tick at T0+12002 (just past caseNextDueMsRef = T0+12001). ─
    // elapsed+120=1320 → elapsedMin=22 → afterTunnel=12 → raw=120.
    // prevExpected=110, deltaCases=120-110=10 > 0.
    // formResetSkippedRef=true → else branch executes → write proceeds!
    // target = 0+10=10; newTotal = min(10, max(0,100)) = 10.
    // → setValue("skidsCompleted",1); setValue("casesOnCurrentSkid",0).
    // formResetSkippedRef ← false (latch disarmed).
    const Twrite = T0 + 2 * CASE_PERIOD_MS + 2; // T0+12002
    act(() => {
      vi.setSystemTime(Twrite);
      rerender(props("running", Twrite, elapsed + 120));
    });
    const afterWriteTick = store.skidsCompleted * 10 + store.casesOnCurrentSkid;

    // Latch disarmed: write proceeded — total is 10 (one normal delta).
    expect(afterWriteTick).toBeGreaterThan(0);
    // Exactly one delta worth (10), nowhere near the 110-case stale catch-up.
    expect(afterWriteTick).toBeLessThanOrEqual(BASE_V.casesPerSkid);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. dough-timer pause + global pause + global resume: clears dough pause
  //    and no tray jump.
  // ───────────────────────────────────────────────────────────────────────────
  // 6. Dough-timer pause + global run pause + global run resume
  //
  // Scenario:
  //   a) pauseDoughTimers() — dough ticks freeze; runStatus stays "running"
  //   b) global pause (runStatus → "paused")
  //   c) global run resumed (runStatus → "running")
  //
  // On step (c) the runStatus "running" effect fires and must:
  //   • clear doughTimerPausedRef (isDoughTimerPaused → false)
  //   • zero trayLastMsRef + trayNextDueMsRef so the first post-resume
  //     consumption tick uses ONE period (2 min), not the full pause span
  //     (5 min, capped at 2 periods = 4 min → 2 trays "jump").
  //
  // This ensures neither the global-pause cycle nor the pre-existing
  // dough-timer pause causes a double-freeze or state leak.
  // ───────────────────────────────────────────────────────────────────────────
  it("6. dough-timer pause + global pause + global resume: clears dough pause and no tray jump", () => {
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (
      status: "running" | "paused",
      nowMs: number,
      trays?: number,
      batches?: number,
    ): Props => ({
      runId: "run-6",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        traysOnLine: trays ?? store.traysOnLine,
        batchesReady: batches ?? store.batchesReady,
      },
      form,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props("running", T0, 5, 2) },
    );

    // ── Tick 1 at T0+500 ─────────────────────────────────────────────────
    // trayLastMsRef  ← T0+500
    // trayNextDueMsRef ← T0+500+TRAY_PERIOD_MS (= T0+120500)
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props("running", T1));
    });
    expect(store.traysOnLine).toBe(4);

    // ── Step (a): pauseDoughTimers() at T1+1 — runStatus stays "running" ──
    // doughTimerPausedRef becomes non-zero; tray/batch ticks suppressed.
    act(() => {
      vi.setSystemTime(T1 + 1);
      result.current.pauseDoughTimers();
      rerender(props("running", T1 + 1));
    });
    expect(result.current.isDoughTimerPaused).toBe(true);
    expect(store.traysOnLine).toBe(4); // no change — dough paused

    // ── Step (b): global pause (runStatus → "paused") at T1+2 ─────────────
    const tGlobalPause = T1 + 2;
    act(() => {
      vi.setSystemTime(tGlobalPause);
      rerender(props("paused", tGlobalPause));
    });
    expect(store.traysOnLine).toBe(4); // still unchanged

    // ── Stay paused (both dough-timer and global) for 5 minutes ───────────
    const tResume = tGlobalPause + 5 * 60_000;
    act(() => {
      vi.setSystemTime(tResume);
      rerender(props("paused", tResume));
    });
    expect(store.traysOnLine).toBe(4); // unchanged while paused

    // ── Step (c): global resume (runStatus → "running") ───────────────────
    // runStatus effect: doughTimerPausedRef ← 0, trayLastMsRef ← 0,
    //   trayNextDueMsRef ← 0.
    // tick effect: prevMs=0 → 1 period → 1 tray consumed → 4→3.
    // WITHOUT trayLastMsRef reset: elapsed≈5 min capped at 4 min → 2 trays.
    const traysBeforeResume = store.traysOnLine; // 4
    act(() => {
      vi.setSystemTime(tResume + 2);
      rerender(props("running", tResume + 2));
    });

    // Dough-timer pause must be cleared by the runStatus effect.
    expect(result.current.isDoughTimerPaused).toBe(false);

    // Resume arms the full tray period; it must not fire early.
    expect(traysBeforeResume - store.traysOnLine).toBe(0);
    expect(store.traysOnLine).toBe(4);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Screen-off / wake catch-up (no form reset)
  //
  // Scenario: run is live with ~16 cases already on the form (the device was
  // tracking normally); tablet screen turns off for 5 minutes (300 s); device
  // wakes and the hook receives a new nowTime.  The form was NOT reset — it
  // still shows the last known count.
  //
  // Because formResetSkippedRef only fires when curTotal===0 AND
  // prevExpected > casesPerSkid, the full accumulated delta (~50 cases) must
  // be written in ONE tick.  The old 2-case-per-tick cap has been removed.
  //
  // Key numbers (ppm=100, pizzasPerCase=10, freezerTime=10):
  //   elapsed=700 → elapsedMin≈11.67 → afterTunnel≈1.67 → raw≈16 (baseline)
  //   elapsed=1000 (after 5 min) → elapsedMin≈16.67 → afterTunnel≈6.67 → raw≈66
  //   delta = 66 − 16 = 50 cases applied in one wake tick
  //   curTotal stays at 16 (not 0) so the stale-delta guard never fires.
  // ───────────────────────────────────────────────────────────────────────────
  it("7. case counter jumps by the full delta (≥40) in one tick after 5-min screen-off", () => {
    // Start with 16 cases already in the form — device was tracking normally.
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    // elapsed=700 → raw≈16 (matches what is in the form)
    const elapsedBaseline = 700;
    // elapsed after 5-min screen-off: 700 + 300 = 1000 s
    // raw = floor(((1000/60) - 10) * 100 / 10) = floor(6.67 * 10) = 66
    const elapsedAfterWake = 1000;

    type Props7 = Parameters<typeof useAutoTrack>[0];
    const props7 = (nowMs: number, elapsedSec: number): Props7 => ({
      runId: "run-7",
      runStatus: "running" as const,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: BASE_V,
      form,
    });

    const { rerender: rerender7 } = renderHook(
      (p: Props7) => useAutoTrack(p),
      { initialProps: props7(T0, elapsedBaseline) },
    );

    // ── Tick 1 at T0+500: prevExpected=-1, curTotal=16>0 → baseline only.
    // lastExpectedCasesRef ← floor(1.67*100/10) = 16
    // caseNextDueMsRef     ← T0+500+CASE_PERIOD_MS = T0+6500
    const T1_7 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1_7);
      rerender7(props7(T1_7, elapsedBaseline));
    });
    // Form still at 16 (baseline-only tick, no write).
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(16);

    // ── Screen off for 5 minutes (300 000 ms). ───────────────────────────
    // No rerenders during this window — the hook simply does not fire.
    // caseNextDueMsRef is still T0+6500 (well before the wake time).
    const screenOffMs = 5 * 60_000;
    const tWake7 = T1_7 + screenOffMs; // T0 + 300_500

    // ── Wake tick: nowMs = tWake, elapsed = 1000 s.  ─────────────────────
    // caseNextDueMsRef (T0+6500) is way past-due → tick fires immediately.
    // prevExpected ≈ 16, expectedRaw ≈ 66, delta = 50.
    // curTotal = 16 (not 0) → stale-delta guard does NOT fire.
    // target = 16 + 50 = 66; newTotal = min(66, max(16, 100)) = 66.
    act(() => {
      vi.setSystemTime(tWake7);
      rerender7(props7(tWake7, elapsedAfterWake));
    });

    const totalAfterWake7 = store.skidsCompleted * 10 + store.casesOnCurrentSkid;

    // Must have jumped forward by at least 40 cases (conservative lower bound
    // accounting for integer rounding) — never capped at old+2.
    expect(totalAfterWake7).toBeGreaterThanOrEqual(16 + 40);
    // Must not overshoot casesNeeded (100).
    expect(totalAfterWake7).toBeLessThanOrEqual(BASE_V.casesNeeded);
    // Must be strictly greater than the pre-wake count.
    expect(totalAfterWake7).toBeGreaterThan(16);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Paused runs do NOT tick on wake
  //
  // Scenario: run is paused when the tablet screen turns off; device wakes
  // 5 minutes later.  The run is still paused — the tick-write effect returns
  // early (runStatus !== "running" && !drainActive) so no case increment fires.
  // ───────────────────────────────────────────────────────────────────────────
  it("8. case counter stays frozen when the run is paused during screen-off + wake", () => {
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    const elapsedBaseline8 = 700;

    type Props8 = Parameters<typeof useAutoTrack>[0];
    const props8 = (
      status: "running" | "paused",
      nowMs: number,
      elapsedSec: number,
    ): Props8 => ({
      runId: "run-8",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: BASE_V,
      form,
    });

    const { rerender: rerender8 } = renderHook(
      (p: Props8) => useAutoTrack(p),
      { initialProps: props8("running", T0, elapsedBaseline8) },
    );

    // ── Tick 1 (running): baseline tick; curTotal=16>0, no write.
    const T1_8 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1_8);
      rerender8(props8("running", T1_8, elapsedBaseline8));
    });
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(16);

    // ── Pause the run before the screen turns off. ────────────────────────
    const tPause8 = T1_8 + 1;
    act(() => {
      vi.setSystemTime(tPause8);
      rerender8(props8("paused", tPause8, elapsedBaseline8));
    });
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(16);

    // ── Screen off for 5 minutes, then wake — run still paused. ──────────
    // elapsed grows (elapsedBatchSec does NOT advance while paused in real usage,
    // but even if it did the tick-write effect returns early for paused runs).
    const tWake8 = tPause8 + 5 * 60_000;
    const elapsedAfterWake8 = elapsedBaseline8 + 300;

    act(() => {
      vi.setSystemTime(tWake8);
      rerender8(props8("paused", tWake8, elapsedAfterWake8));
    });

    const totalAfterWake8 = store.skidsCompleted * 10 + store.casesOnCurrentSkid;

    // Counter must be unchanged — no tick fires while paused.
    expect(totalAfterWake8).toBe(16);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Auto Resume clears a pre-existing dough-timer pause without jumping
  //    trays or consuming during the resume render.
  //
  // "Resume now" on the auto-track suppression banner calls fireAutoTrackNow().
  // If doughTimerPausedRef was set BEFORE the operator tapped "Resume now",
  // fireAutoTrackNow must:
  //   a) zero doughTimerPausedRef   → isDoughTimerPaused becomes false
  //   b) zero trayLastMsRef + batchLastMsRef (consumption anchors) when a
  //      dough-timer pause was active, so the first post-resume tick uses ONE
  //      clean period instead of the accumulated pause span.
  //
  // Without (b), a pause longer than 2 tray-periods would hit the 2-period cap
  // and consume 2 trays immediately — the "jump" this task targets.
  //
  // Scenario (long pause — 5 tray-periods — to expose the jump):
  //   Tick 1  — establishes trayLastMsRef = T1.  trays: 5→4.
  //   pauseDoughTimers()  — freezes dough ticks; isDoughTimerPaused → true
  //   Wait 5 × TRAY_PERIOD_MS  — far past the 2-period cap.
  //   fireAutoTrackNow("dough") — clears the pause and re-arms from a full
  //   duration. No consumption happens until that interval completes.
  //
  // Without the trayLastMsRef reset: prevMs=T1; elapsed ≈5 periods capped at
  // 4 min → floor(4*100/200) = 2 trays consumed → 4→2 (the jump).
  // With the reset: elapsed = 1 period → 1 tray consumed → 4→3. ✓
  //
  // Production (+1) ticks are suppressed by setting traysNeeded=0 and
  // batchesReady=0 so the consumption delta is observable on its own.
  // ───────────────────────────────────────────────────────────────────────────
  it("9. Auto Resume clears dough pause and starts a full tray interval before consuming", () => {
    // batchesReady=0 + traysNeeded=0 suppress the production (+1) tick that
    // checks `calc.traysNeeded > 0 || v.batchesReady > 0`; without both being
    // zero the production +1 cancels the consumption −1 and traysOnLine never
    // moves (or moves the wrong direction).
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 0 });

    // Use traysNeeded=0 / batchesNeeded=0 so no production (count-up) ticks
    // fire when fireAutoTrackNow zeros trayProdNextDueMsRef.  That isolates
    // the consumption-only path and makes the expected tray count exact.
    const calcNoProd = { ...BASE_CALC, traysNeeded: 0, batchesNeeded: 0 };

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number): Props => ({
      runId: "run-9",
      runStatus: "running" as const,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: calcNoProd,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0) },
    );

    // ── Tick 1 at T0+500: establishes trayLastMsRef ───────────────────────
    // prevMs=0 → duration=1 period (2 min) → traysConsumed=1.  trays: 5→4.
    // trayLastMsRef    ← T0+500
    // trayNextDueMsRef ← T0+500+TRAY_PERIOD_MS  (well in the future)
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props(T1));
    });
    expect(store.traysOnLine).toBe(4);

    // ── pauseDoughTimers() at T1+1 ────────────────────────────────────────
    // doughTimerPausedRef becomes non-zero; tray/batch ticks suppressed.
    act(() => {
      vi.setSystemTime(T1 + 1);
      result.current.pauseDoughTimers();
      rerender(props(T1 + 1));
    });
    expect(result.current.isDoughTimerPaused).toBe(true);
    expect(store.traysOnLine).toBe(4); // frozen — dough paused

    // ── Stay paused for 5 tray-periods (> 2-period cap of 4 min) ─────────
    // Without the trayLastMsRef reset in fireAutoTrackNow, the first
    // post-resume tick would see elapsed ≈ 5 periods, capped at 4 min:
    //   floor(4 min * 100 ppm / 200 perTray) = 2 trays consumed → "jump".
    const pauseMs = 5 * TRAY_PERIOD_MS; // 600 000 ms
    const tPaused = T1 + pauseMs;
    act(() => {
      vi.setSystemTime(tPaused);
      rerender(props(tPaused));
    });
    expect(result.current.isDoughTimerPaused).toBe(true);
    expect(store.traysOnLine).toBe(4); // still frozen during pause

    // ── Auto Resume ───────────────────────────────────────────────────────
    // The populated timer restarts from its configured duration. Repeated
    // resumes at the same instant are idempotent and cannot create a write.
    const tFire = tPaused + 1;
    act(() => {
      vi.setSystemTime(tFire);
      result.current.fireAutoTrackNow("dough");
      result.current.fireAutoTrackNow("dough");
      rerender(props(tFire));
    });

    expect(result.current.isDoughTimerPaused).toBe(false);
    expect(store.traysOnLine).toBe(4);

    act(() => {
      vi.setSystemTime(tFire + TRAY_PERIOD_MS + 1);
      rerender(props(tFire + TRAY_PERIOD_MS + 1));
    });
    expect(store.traysOnLine).toBe(3);
  });

  it("Manual → Auto re-arms every timer from its full cadence without an immediate write", () => {
    const { form, store } = makeFakeForm({
      skidsCompleted: 2,
      casesOnCurrentSkid: 3,
      traysOnLine: 4,
      batchesReady: 1,
    });
    const machine = { spinSec: 1, hopperSec: 1 };
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number): Props => ({
      runId: "manual-to-auto",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC + (nowMs - T0) / 1000,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        skidsCompleted: store.skidsCompleted,
        casesOnCurrentSkid: store.casesOnCurrentSkid,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
      machine,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0) },
    );

    // Operator switches to Manual, leaves it there longer than every normal
    // cadence, then switches back to Auto through the same handler sequence
    // (toggle state + fireAutoTrackNow("all")) used by Packaging.
    act(() => {
      result.current.setAutoTrackProgress(false);
    });
    const resumeAt = T0 + TRAY_PERIOD_MS * 2;
    const beforeResume = {
      cases: store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid,
      trays: store.traysOnLine,
      batches: store.batchesReady,
    };
    const timing = getAutoTrackTiming(
      BASE_CALC.ppm,
      BASE_V.pizzasPerCase,
      BASE_CALC.perTray,
      BASE_CALC.perBatch,
      machine,
    );

    const staleDisplayNow = resumeAt - 999;
    act(() => {
      vi.setSystemTime(resumeAt);
      result.current.setAutoTrackProgress(true);
      result.current.fireAutoTrackNow("all");
      // The display clock has not reached the resume event yet. This mirrors
      // a tap immediately before the provider's next one-second clock render.
      rerender(props(staleDisplayNow));
    });

    expect({
      cases: store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid,
      trays: store.traysOnLine,
      batches: store.batchesReady,
    }).toEqual(beforeResume);
    expect({
      case: result.current.tickDueRefs.case.current,
      tray: result.current.tickDueRefs.tray.current,
      trayProd: result.current.tickDueRefs.trayProd.current,
      batch: result.current.tickDueRefs.batch.current,
      batchProd: result.current.tickDueRefs.batchProd.current,
      hopperProd: result.current.tickDueRefs.hopperProd.current,
    }).toEqual({
      case: resumeAt + timing.caseMs,
      tray: resumeAt + timing.trayMs,
      trayProd: resumeAt + timing.trayProductionMs,
      batch: resumeAt + timing.batchConsumptionMs,
      batchProd: resumeAt + timing.batchProductionMs,
      hopperProd: resumeAt + timing.hopperMs,
    });

    // The one-second production countdown is the nearest configured boundary.
    // If the toggle effect reset refs to zero after the handler re-armed them,
    // this clock render would immediately mutate one of these counters.
    act(() => {
      vi.setSystemTime(resumeAt + timing.batchProductionMs - 1);
      rerender(props(resumeAt + timing.batchProductionMs - 1));
    });
    expect({
      cases: store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid,
      trays: store.traysOnLine,
      batches: store.batchesReady,
    }).toEqual(beforeResume);
  });

  it("global pause → resume uses the real resume instant when the display clock is stale", () => {
    const { form, store } = makeFakeForm({
      skidsCompleted: 2,
      casesOnCurrentSkid: 3,
      traysOnLine: 4,
      batchesReady: 1,
    });
    const machine = { spinSec: 1, hopperSec: 1 };
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (status: "running" | "paused", nowMs: number): Props => ({
      runId: "stale-clock-global-resume",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC + (nowMs - T0) / 1000,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        skidsCompleted: store.skidsCompleted,
        casesOnCurrentSkid: store.casesOnCurrentSkid,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
      machine,
    });
    const timing = getAutoTrackTiming(
      BASE_CALC.ppm,
      BASE_V.pizzasPerCase,
      BASE_CALC.perTray,
      BASE_CALC.perBatch,
      machine,
    );
    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props("running", T0) },
    );

    act(() => {
      vi.setSystemTime(T0 + 1);
      rerender(props("paused", T0 + 1));
    });
    const beforeResume = {
      cases: store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid,
      trays: store.traysOnLine,
      batches: store.batchesReady,
    };
    const resumeAt = T0 + TRAY_PERIOD_MS * 2;

    act(() => {
      vi.setSystemTime(resumeAt);
      rerender(props("running", resumeAt - 999));
    });

    expect(result.current.tickDueRefs.batchProd.current).toBe(resumeAt + timing.batchProductionMs);
    expect({
      cases: store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid,
      trays: store.traysOnLine,
      batches: store.batchesReady,
    }).toEqual(beforeResume);

    act(() => {
      vi.setSystemTime(resumeAt + timing.batchProductionMs - 1);
      rerender(props("running", resumeAt + timing.batchProductionMs - 1));
    });
    expect({
      cases: store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid,
      trays: store.traysOnLine,
      batches: store.batchesReady,
    }).toEqual(beforeResume);
  });

  it("Auto Resume re-arms an empty packaging timer without touching dough schedules", () => {
    const { form, store } = makeFakeForm({
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      traysOnLine: 0,
      batchesReady: 0,
    });
    const autoSuppressUntilRef = { current: T0 + 60_000 };
    const calcNoProd = { ...BASE_CALC, traysNeeded: 0, batchesNeeded: 0 };
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number): Props => ({
      runId: "empty-packaging-resume",
      runStatus: "running",
      nowTime: ms(nowMs),
      elapsedBatchSec: (nowMs - T0) / 1000,
      calc: calcNoProd,
      v: {
        ...BASE_V,
        freezerTime: 0,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
      externalAutoSuppressRef: autoSuppressUntilRef,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0) },
    );
    const doughDueBeforeResume = {
      tray: result.current.tickDueRefs.tray.current,
      trayProd: result.current.tickDueRefs.trayProd.current,
      batch: result.current.tickDueRefs.batch.current,
      batchProd: result.current.tickDueRefs.batchProd.current,
      hopperProd: result.current.tickDueRefs.hopperProd.current,
    };
    const resumeAt = T0 + CASE_PERIOD_MS - 1;

    act(() => {
      vi.setSystemTime(resumeAt);
      autoSuppressUntilRef.current = 0;
      result.current.fireAutoTrackNow("case");
      result.current.fireAutoTrackNow("case");
      rerender(props(resumeAt));
    });

    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(0);
    expect(result.current.tickDueRefs.case.current).toBe(resumeAt + CASE_PERIOD_MS);
    expect({
      tray: result.current.tickDueRefs.tray.current,
      trayProd: result.current.tickDueRefs.trayProd.current,
      batch: result.current.tickDueRefs.batch.current,
      batchProd: result.current.tickDueRefs.batchProd.current,
      hopperProd: result.current.tickDueRefs.hopperProd.current,
    }).toEqual(doughDueBeforeResume);

    act(() => {
      vi.setSystemTime(resumeAt + CASE_PERIOD_MS - 1);
      rerender(props(resumeAt + CASE_PERIOD_MS - 1));
    });
    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(0);
  });

  it("hands continued-tunnel packaging from the pause clock to the normal run clock once", () => {
    const { form, store } = makeFakeForm({
      skidsCompleted: 3,
      casesOnCurrentSkid: 1,
      traysOnLine: 5,
      batchesReady: 2,
    });
    const calcPackagingOnly = { ...BASE_CALC, pressDone: true };
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (args: {
      status: "running" | "paused";
      nowMs: number;
      elapsedBatchSec: number;
      packagingDrainActive: boolean;
      packagingDrainElapsedSec: number;
      packagingAutoTrackActive?: boolean;
    }): Props => ({
      runId: "continued-tunnel-pause-handoff",
      runStatus: args.status,
      nowTime: ms(args.nowMs),
      elapsedBatchSec: args.elapsedBatchSec,
      packagingDrainActive: args.packagingDrainActive,
      packagingDrainElapsedSec: args.packagingDrainElapsedSec,
      packagingAutoTrackActive: args.packagingAutoTrackActive,
      calc: calcPackagingOnly,
      v: { ...BASE_V, traysOnLine: store.traysOnLine, batchesReady: store.batchesReady },
      form,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      {
        initialProps: props({
          status: "paused",
          nowMs: T0,
          // 60 paused seconds = 10 packed cases. The initial paused-drain
          // render establishes this baseline and must not replay it.
          elapsedBatchSec: ELAPSED_SEC,
          packagingDrainActive: true,
          packagingDrainElapsedSec: 60,
        }),
      },
    );

    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(31);

    // Resume does not reconcile a partial paused interval. Packaging waits for
    // the physical refill sequence and must not jump immediately.
    const resumeAt = T0 + CASE_PERIOD_MS;
    act(() => {
      vi.setSystemTime(resumeAt);
      rerender(props({
        status: "running",
        nowMs: resumeAt,
        elapsedBatchSec: ELAPSED_SEC,
        packagingDrainActive: false,
        packagingDrainElapsedSec: 0,
        packagingAutoTrackActive: false,
      }));
    });
    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(31);
    expect(result.current.tickDueRefs.case.current).toBe(resumeAt + CASE_PERIOD_MS);

    // The completed physical refill transition establishes a fresh baseline.
    const packagingReadyAt = resumeAt + 20 * 60_000;
    act(() => {
      vi.setSystemTime(packagingReadyAt);
      rerender(props({
        status: "running",
        nowMs: packagingReadyAt,
        elapsedBatchSec: ELAPSED_SEC,
        packagingDrainActive: false,
        packagingDrainElapsedSec: 0,
        packagingAutoTrackActive: true,
      }));
    });
    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(31);

    // The next full ordinary interval advances from the new baseline.
    const nextCaseAt = packagingReadyAt + CASE_PERIOD_MS + 1;
    act(() => {
      vi.setSystemTime(nextCaseAt);
      rerender(props({
        status: "running",
        nowMs: nextCaseAt,
        elapsedBatchSec: ELAPSED_SEC + CASE_PERIOD_MS / 1000 + 0.001,
        packagingDrainActive: false,
        packagingDrainElapsedSec: 0,
        packagingAutoTrackActive: true,
      }));
    });
    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(32);
    expect(store.traysOnLine).toBe(5);
    expect(store.batchesReady).toBe(2);
  });

  it("re-bases after a rejected paused packaging write so manual progress is not replayed", () => {
    const { form, store } = makeFakeForm({
      skidsCompleted: 4,
      casesOnCurrentSkid: 9,
      traysOnLine: 5,
      batchesReady: 2,
    });
    const persistAutomaticProgress = vi.fn(() => false);
    const calcPackagingOnly = { ...BASE_CALC, pressDone: true };
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (args: {
      status: "running" | "paused";
      nowMs: number;
      elapsedBatchSec: number;
      packagingDrainActive: boolean;
      packagingDrainElapsedSec: number;
      packagingAutoTrackActive?: boolean;
    }): Props => ({
      runId: "manual-packaging-pause-handoff",
      runStatus: args.status,
      nowTime: ms(args.nowMs),
      elapsedBatchSec: args.elapsedBatchSec,
      packagingDrainActive: args.packagingDrainActive,
      packagingDrainElapsedSec: args.packagingDrainElapsedSec,
      packagingAutoTrackActive: args.packagingAutoTrackActive,
      calc: calcPackagingOnly,
      v: { ...BASE_V, traysOnLine: store.traysOnLine, batchesReady: store.batchesReady },
      form,
      onPackagingProgressAutoAdvance: persistAutomaticProgress,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      {
        initialProps: props({
          status: "paused",
          nowMs: T0,
          elapsedBatchSec: ELAPSED_SEC,
          packagingDrainActive: true,
          packagingDrainElapsedSec: 60,
        }),
      },
    );

    const resumeAt = T0 + CASE_PERIOD_MS;
    act(() => {
      vi.setSystemTime(resumeAt);
      rerender(props({
        status: "running",
        nowMs: resumeAt,
        elapsedBatchSec: ELAPSED_SEC,
        packagingDrainActive: false,
        packagingDrainElapsedSec: 0,
        packagingAutoTrackActive: false,
      }));
    });
    expect(persistAutomaticProgress).not.toHaveBeenCalled();
    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(49);

    const packagingReadyAt = resumeAt + 20 * 60_000;
    act(() => {
      vi.setSystemTime(packagingReadyAt);
      rerender(props({
        status: "running",
        nowMs: packagingReadyAt,
        elapsedBatchSec: ELAPSED_SEC,
        packagingDrainActive: false,
        packagingDrainElapsedSec: 0,
        packagingAutoTrackActive: true,
      }));
    });
    expect(persistAutomaticProgress).not.toHaveBeenCalled();

    // Only the next full normal interval may be accepted.
    persistAutomaticProgress.mockReturnValue(true);
    const nextCaseAt = packagingReadyAt + CASE_PERIOD_MS + 1;
    act(() => {
      vi.setSystemTime(nextCaseAt);
      rerender(props({
        status: "running",
        nowMs: nextCaseAt,
        elapsedBatchSec: ELAPSED_SEC + CASE_PERIOD_MS / 1000 + 0.001,
        packagingDrainActive: false,
        packagingDrainElapsedSec: 0,
        packagingAutoTrackActive: true,
      }));
    });
    expect(persistAutomaticProgress).toHaveBeenLastCalledWith(5, 0);
    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(50);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. batchProdNextDueMsRef is reset on global resume — no phantom +1 batch
  //
  // After tick 1, batchProdNextDueMsRef is armed at T0+500+BATCH_FULL_PROD_MS
  // (12 min into the future).  If the run is then paused for 15 min (longer
  // than one full batch period) and resumed WITHOUT zeroing batchProdNextDueMsRef,
  // the ref is past-due on the very first post-resume tick: the production
  // branch fires delta += 1 and batchesReady jumps UP — a phantom "+1 batch"
  // event that has nothing to do with real mixer output.
  //
  // The runStatus "running" effect must reset batchProdNextDueMsRef to 0 so
  // the first-encounter re-arm path fires instead (no write), and batchesReady
  // can only decrease (consumption) on that first tick, not increase.
  //
  // Constants:
  //   BATCH_FULL_PROD_MS = (perBatch/ppm)*60000 = (1200/100)*60000 = 720 000 ms
  //   batchPeriodMs      = BATCH_FULL_PROD_MS / 4                  = 180 000 ms
  //   Pause duration     = 15 min = 900 000 ms  >  12 min batch period
  //
  // Expected on first post-resume tick (batchProdNextDueMsRef reset to 0):
  //   production: arm only, no delta         → batchesReady unchanged from prod
  //   consumption: -batchPeriodMs/effDrainMs = -0.25
  //   net: batchesReady DECREASES (or stays the same if seeded)
  //
  // Counterfactual (batchProdNextDueMsRef NOT reset):
  //   production: past-due → delta += 1
  //   consumption: delta -= 0.25
  //   net: batchesReady INCREASES by ~0.75 (the phantom event)
  // ───────────────────────────────────────────────────────────────────────────
  it("10. batchesReady does not jump up after a global pause longer than one batch period", () => {
    // ppm=100, perBatch=1200 → full batch period = 12 min = 720 000 ms.
    // Pause for 15 min so batchProdNextDueMsRef is past-due at resume time
    // if it were not zeroed by the runStatus effect.
    const BATCH_FULL_PROD_MS = (BASE_CALC.perBatch / BASE_CALC.ppm) * 60_000; // 720 000 ms
    const PAUSE_MS = 15 * 60_000; // 900 000 ms  >  BATCH_FULL_PROD_MS

    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    type Props10 = Parameters<typeof useAutoTrack>[0];
    const props10 = (
      status: "running" | "paused",
      nowMs: number,
    ): Props10 => ({
      runId: "run-10",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: BASE_CALC,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
    });

    const { rerender: rerender10 } = renderHook(
      (p: Props10) => useAutoTrack(p),
      { initialProps: props10("running", T0) },
    );

    // ── Tick 1 at T0+500: arms batchProdNextDueMsRef ──────────────────────
    // batchProdNextDueMsRef.current === 0 → first-encounter path:
    //   batchProdNextDueMsRef ← T0+500+BATCH_FULL_PROD_MS  (no write)
    // batchNextDueMsRef.current === 0 → consumption fires (prevMs=0, one period):
    //   batchesReady may decrease slightly.
    // After this tick batchProdNextDueMsRef is armed and pointing 12 min ahead.
    const T1_10 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1_10);
      rerender10(props10("running", T1_10));
    });
    // batchesReady must not have increased (production arm-only, possible consumption).
    expect(store.batchesReady).toBeLessThanOrEqual(2);

    // ── Pause at T1+1 ────────────────────────────────────────────────────
    const tPause10 = T1_10 + 1;
    act(() => {
      vi.setSystemTime(tPause10);
      rerender10(props10("paused", tPause10));
    });
    const batchesAtPause = store.batchesReady;

    // ── Stay paused for 15 min (> one 12-min batch period) ───────────────
    // batchProdNextDueMsRef is now past-due. If not reset on resume,
    // the first post-resume tick would fire the production branch (delta += 1).
    const tResume10 = tPause10 + PAUSE_MS;
    act(() => {
      vi.setSystemTime(tResume10);
      rerender10(props10("paused", tResume10));
    });
    expect(store.batchesReady).toBe(batchesAtPause); // no change while paused

    // ── Resume ────────────────────────────────────────────────────────────
    // React runs effects in declaration order:
    //   a) runStatus effect (paused → running):
    //        batchProdNextDueMsRef.current ← 0  (was T0+500+720000, past-due)
    //        batchNextDueMsRef.current     ← 0
    //        batchLastMsRef.current        ← 0
    //   b) tick effect:
    //        batchProdNextDueMsRef === 0 → arm only; NO +1 delta
    //        batchNextDueMsRef === 0 → consumption fires (prevMs=0, one period):
    //          delta -= batchPeriodMs / effDrainMs  ≈ -0.25
    //        net: batchesReady DECREASES from batchesAtPause (no phantom +1).
    //
    // Without the batchProdNextDueMsRef reset the stale ref would be past-due:
    //   production delta += 1, consumption delta -= 0.25 → batchesReady RISES.
    act(() => {
      vi.setSystemTime(tResume10 + 2);
      rerender10(props10("running", tResume10 + 2));
    });

    // batchesReady must NOT have increased above its value at the time of pause.
    // (A phantom production event would push it above batchesAtPause.)
    expect(store.batchesReady).toBeLessThanOrEqual(batchesAtPause);

    // Confirm the batch production arm ran correctly: next tick should be armed
    // at tResume+2+BATCH_FULL_PROD_MS — verified by ensuring batchesReady only
    // changes by consumption on a subsequent tick well before that deadline.
    const tBeforeNextProd = tResume10 + 2 + BATCH_FULL_PROD_MS - 1000;
    act(() => {
      vi.setSystemTime(tBeforeNextProd);
      rerender10(props10("running", tBeforeNextProd));
    });
    // batchesReady still must not exceed batchesAtPause — production has not
    // fired yet (its next-due is still in the future).
    expect(store.batchesReady).toBeLessThanOrEqual(batchesAtPause);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Pace gauge (autoTrackSuggestion.expectedCases) matches the case
  //     counter written to the form in the SAME render pass after a wake tick
  //
  // Scenario: running run, device wakes after 5-min screen-off.  The hook
  // fires the case tick and writes a new total to the form.  In that same
  // render, autoTrackSuggestion.expectedCases — the value the pace gauge and
  // time-remaining read — must equal the form total.  If the hook were reading
  // a stale cached casesCompleted instead of the just-written value, the two
  // would diverge by one render cycle.
  //
  // Key numbers (ppm=100, pizzasPerCase=10, casesPerSkid=10,
  //              casesNeeded=100, freezerTime=10):
  //   elapsedBaseline=700 s → afterTunnel≈1.67 min → expectedRaw=16
  //   elapsedAfterWake=1000 s → afterTunnel≈6.67 min → expectedRaw=66
  //   delta = 66 − 16 = 50 applied in one wake tick
  //   autoTrackSuggestion.expectedCases = min(100, 66) = 66 — same as form total
  // ───────────────────────────────────────────────────────────────────────────
  it("10. pace gauge (autoTrackSuggestion.expectedCases) matches form total in the same render after wake (running→wake)", () => {
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    const elapsedBaseline = 700;
    const elapsedAfterWake = 1000;

    type Props10 = Parameters<typeof useAutoTrack>[0];
    const props10 = (nowMs: number, elapsedSec: number): Props10 => ({
      runId: "run-10",
      runStatus: "running" as const,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: BASE_V,
      form,
    });

    const { result: result10, rerender: rerender10 } = renderHook(
      (p: Props10) => useAutoTrack(p),
      { initialProps: props10(T0, elapsedBaseline) },
    );

    // ── Tick 1 at T0+500: seeds form from 0 to 16 cases; establishes baseline.
    // elapsedRaw ≈ 16 → curTotal=0, expectedCases=16 → seed path:
    //   skidsCompleted ← 1, casesOnCurrentSkid ← 6 (total=16)
    // lastExpectedCasesRef ← 16; caseNextDueMsRef ← T0+500+CASE_PERIOD_MS
    const T1_10 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1_10);
      rerender10(props10(T1_10, elapsedBaseline));
    });
    const formTotalAfterBaseline = store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid;
    expect(formTotalAfterBaseline).toBe(16);

    // ── Screen off for 5 minutes — no rerenders during screen-off. ─────────
    const tWake10 = T1_10 + 5 * 60_000;

    // ── Wake tick: elapsedAfterWake=1000 s → expectedRaw=66, delta=50. ─────
    // caseNextDueMsRef (T0+6500) is way past-due → tick fires immediately.
    // curTotal=16 (not 0), prevExpected=16 → normal increment path:
    //   target = 16 + 50 = 66; newTotal = min(66, max(16, 100)) = 66
    //   form written: skidsCompleted=6, casesOnCurrentSkid=6 (total=66)
    //
    // autoTrackSuggestion.expectedCases (from useMemo, elapsedAfterWake=1000):
    //   elapsedMinAfterTunnel = (1000/60) − 10 ≈ 6.667
    //   expectedCasesRaw = floor(6.667 * 100 / 10) = 66
    //   expectedCases = min(100, 66) = 66
    //
    // Consistency invariant: form total === autoTrackSuggestion.expectedCases
    act(() => {
      vi.setSystemTime(tWake10);
      rerender10(props10(tWake10, elapsedAfterWake));
    });

    const formTotalAfterWake = store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid;
    const suggestion10 = result10.current.autoTrackSuggestion;

    // Form total must have jumped forward by the full delta (≥40).
    expect(formTotalAfterWake).toBeGreaterThan(formTotalAfterBaseline + 40);
    // Must not overshoot casesNeeded.
    expect(formTotalAfterWake).toBeLessThanOrEqual(BASE_V.casesNeeded);

    // Pace gauge source must be non-null for a running run.
    expect(suggestion10).not.toBeNull();

    // KEY INVARIANT: autoTrackSuggestion.expectedCases must equal the form
    // total that the tick just wrote.  If the pace gauge were reading a stale
    // casesCompleted, it would still show 16 while the counter shows 66 —
    // lagging one tick behind.
    expect(suggestion10!.expectedCases).toBe(formTotalAfterWake);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 12. Auto Resume after a long screen-off + suppress window
  //     (no dough-timer pause): 2-period cap applies, ≤ 2 trays consumed.
  //
  // Unlike resumeDoughTimers() or the runStatus-"running" effect (both of which
  // zero trayLastMsRef), fireAutoTrackNow() does NOT zero trayLastMsRef when
  // doughTimerPausedRef is 0.  This means the first post-fire consumption tick
  // sees the full elapsed time since tick 1 — capped at 2 periods.
  //
  // The 2-period cap kicks in only when the device did NOT re-render during
  // the suppress window (no intermediate tick updated trayLastMsRef).  This
  // matches a "screen-off while auto-suppressed" scenario: the tablet's display
  // sleeps, the hook does not fire, and the operator later taps "Resume now".
  //
  // On the first post-fire tick:
  //   prevMs = trayLastMsRef = T1  (from tick 1; unchanged — no mid-gap rerenders)
  //   elapsed = tFire − T1 > 2 × TRAY_PERIOD_MS
  //   durationMin = Math.min(2 × TRAY_PERIOD_MS / 60000, elapsed / 60000)
  //               = 4 min  (2-period cap)
  //   traysConsumed = floor(4 * 100 / 200) = 2
  //
  // Documenting the cap as an explicit assertion makes any future change to
  // fireAutoTrackNow() (e.g. zeroing trayLastMsRef unconditionally like
  // resumeDoughTimers()) immediately visible via a test failure.
  //
  // Scenario:
  //   Tick 1 (T0+500): trayLastMsRef ← T0+500; trays: 5→4.
  //   Suppress window set, screen off — NO rerenders until tFire.
  //   tFire = T1 + 5 × TRAY_PERIOD_MS  (elapsed >> 2-period cap).
  //   fireAutoTrackNow() zeros trayNextDueMsRef but NOT trayLastMsRef.
  //   Re-render: tick fires; elapsed capped → exactly 2 trays consumed → 4→2.
  // ───────────────────────────────────────────────────────────────────────────
  it("12. Auto Resume after a long screen-off starts a clean full interval", () => {
    // Suppress production (+1) ticks so the net tray delta is purely from
    // consumption and the final count is exact and deterministic.
    const calcNoProd = { ...BASE_CALC, traysNeeded: 0, batchesNeeded: 0 };
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 0 });

    // externalAutoSuppressRef lets the test control the suppress window without
    // reaching into private hook state.
    const autoSuppressRef = { current: 0 } as React.MutableRefObject<number>;

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number): Props => ({
      runId: "run-12",
      runStatus: "running" as const,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: calcNoProd,
      v: {
        ...BASE_V,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
      externalAutoSuppressRef: autoSuppressRef,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0) },
    );

    // ── Tick 1 at T0+500: establishes trayLastMsRef ───────────────────────
    // prevMs=0 → durationMin = 1 period (2 min) → traysConsumed=1. trays: 5→4.
    // trayLastMsRef    ← T0+500
    // trayNextDueMsRef ← T0+500 + TRAY_PERIOD_MS  (well in the future)
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props(T1));
    });
    expect(store.traysOnLine).toBe(4);

    // ── Screen off + suppress window active — NO rerenders during this gap. ─
    // Activating the suppress window simulates the operator starting a manual
    // edit just as the screen turns off.  Crucially, no act()/rerender calls
    // happen here: without rerenders trayLastMsRef stays at T1.  Any rerender
    // during the gap would fire the consumption tick (because trayNextDueMsRef
    // would be past-due) and advance trayLastMsRef to that point, shrinking the
    // apparent elapsed time seen by the post-fire tick.
    autoSuppressRef.current = T1 + 6 * TRAY_PERIOD_MS; // still "suppressed" at tFire

    // ── Screen wakes: Auto Resume re-arms from a clean baseline. ───────────
    // The long hidden interval must not turn into an immediate tray write.
    const tFire = T1 + 5 * TRAY_PERIOD_MS;
    autoSuppressRef.current = 0; // expire suppress window so write proceeds
    act(() => {
      vi.setSystemTime(tFire);
      result.current.fireAutoTrackNow("dough");
      rerender(props(tFire));
    });

    const traysDropped = 4 - store.traysOnLine;
    expect(traysDropped).toBe(0);
    expect(store.traysOnLine).toBe(4);

    act(() => {
      vi.setSystemTime(tFire + TRAY_PERIOD_MS + 1);
      rerender(props(tFire + TRAY_PERIOD_MS + 1));
    });
    expect(store.traysOnLine).toBe(3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. Paused→wake: no tick fires — form counter stays frozen, pace gauge
  //     reflects elapsed time (time-based, not counter-based)
  //
  // Scenario: run paused before tablet screen turns off; device wakes 5 min
  // later with run still paused.  The tick-write effect returns early
  // (runStatus !== "running" && !drainActive) — no case write fires.
  //
  // autoTrackSuggestion IS computed for paused runs (the "ok" gate includes
  // "paused"), so the pace gauge updates to the new time-based estimate while
  // the counter stays frozen.  This is the correct no-op path: no spurious
  // counter increment.
  //
  // Key numbers: same as test 10.
  //   form shows 16 cases after baseline tick (run was running).
  //   After pause + wake: form still 16; autoTrackSuggestion.expectedCases=66.
  // ───────────────────────────────────────────────────────────────────────────
  it("11. paused→wake: case counter stays frozen; no tick fires (paused no-op path)", () => {
    const { form, store } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    const elapsedBaseline = 700;
    const elapsedAfterWake = 1000;

    type Props11 = Parameters<typeof useAutoTrack>[0];
    const props11 = (
      status: "running" | "paused",
      nowMs: number,
      elapsedSec: number,
    ): Props11 => ({
      runId: "run-11",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: BASE_V,
      form,
    });

    const { result: result11, rerender: rerender11 } = renderHook(
      (p: Props11) => useAutoTrack(p),
      { initialProps: props11("running", T0, elapsedBaseline) },
    );

    // ── Tick 1 (running) at T0+500: seeds form to 16. ─────────────────────
    const T1_11 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1_11);
      rerender11(props11("running", T1_11, elapsedBaseline));
    });
    const formTotalBeforePause = store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid;
    expect(formTotalBeforePause).toBe(16);

    // ── Pause the run before screen turns off. ────────────────────────────
    const tPause11 = T1_11 + 1;
    act(() => {
      vi.setSystemTime(tPause11);
      rerender11(props11("paused", tPause11, elapsedBaseline));
    });
    expect(store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid).toBe(16);

    // ── Screen off for 5 minutes, then wake — run still paused. ──────────
    const tWake11 = tPause11 + 5 * 60_000;

    act(() => {
      vi.setSystemTime(tWake11);
      rerender11(props11("paused", tWake11, elapsedAfterWake));
    });

    const formTotalAfterWake11 = store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid;
    const suggestion11 = result11.current.autoTrackSuggestion;

    // KEY INVARIANT: counter must be frozen — no tick fires while paused.
    // A spurious write would indicate the tick-write effect bypassed the
    // runStatus guard.
    expect(formTotalAfterWake11).toBe(16);

    // The pace gauge (autoTrackSuggestion) IS computed for paused runs and
    // reflects the time-based expected value (66), even though the counter
    // is frozen.  This is intentional: the suggestion shows where the run
    // *would* be if it were running, which is useful for planning.
    expect(suggestion11).not.toBeNull();
    expect(suggestion11!.expectedCases).toBe(66);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 12. hopperProdNextDueMsRef re-arms in the future after a global pause
  //
  // Scenario: run starts; tick 1 arms hopperProdNextDueMsRef to T1+hopperMs;
  // the run is globally paused for longer than hopperSec; the run resumes.
  //
  // On resume the runStatus "running" effect (line ~447 of useAutoTrack.ts)
  // zeros hopperProdNextDueMsRef.current, then the tick effect fires immediately
  // (current===0 → first-encounter path) and re-arms it to nowMs+hopperMs.
  //
  // Without the reset the ref would still hold T1+hopperMs, which is in the
  // PAST after a long pause. The UI would read the countdown as 0:00 and flash
  // "overdue" on the very first tick after resume.
  // ───────────────────────────────────────────────────────────────────────────
  it("12. hopperProdNextDueMsRef re-arms to a future timestamp after a global pause/resume", () => {
    const HOPPER_SEC = 10; // 10-second hopper cycle
    const HOPPER_MS = HOPPER_SEC * 1000;

    const { form } = makeFakeForm({ traysOnLine: 5, batchesReady: 2 });

    type Props12 = Parameters<typeof useAutoTrack>[0];
    const props12 = (status: "running" | "paused", nowMs: number): Props12 => ({
      runId: "run-12",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: BASE_CALC,
      v: { ...BASE_V },
      form,
      machine: { spinSec: 0, hopperSec: HOPPER_SEC },
    });

    const { result: result12, rerender: rerender12 } = renderHook(
      (p: Props12) => useAutoTrack(p),
      { initialProps: props12("running", T0) },
    );

    // ── Initial render at T0 arms the hopper ref ─────────────────────────────
    // The tick effect fires on mount (hopperProdNextDueMsRef===0, first-encounter
    // path): ref = T0 + hopperMs. The T0+500 rerender below doesn't fire the
    // hopper tick again because T0+500 < T0+HOPPER_MS.
    const hopperAfterMount = result12.current.tickDueRefs.hopperProd.current;
    expect(hopperAfterMount).toBe(T0 + HOPPER_MS);

    // ── Tick at T0+500 (no change — hopper not yet due) ───────────────────────
    const T1_12 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1_12);
      rerender12(props12("running", T1_12));
    });
    const hopperAfterTick1 = result12.current.tickDueRefs.hopperProd.current;
    expect(hopperAfterTick1).toBe(T0 + HOPPER_MS); // unchanged

    // ── Pause at T1+1 ────────────────────────────────────────────────────────
    const tPause12 = T1_12 + 1;
    act(() => {
      vi.setSystemTime(tPause12);
      rerender12(props12("paused", tPause12));
    });
    // Hopper tick only runs while running — ref stays at T0+HOPPER_MS.
    expect(result12.current.tickDueRefs.hopperProd.current).toBe(T0 + HOPPER_MS);

    // ── Stay paused 60 s (> HOPPER_MS=10 s) so the old due time is now past. ─
    const tResume12 = tPause12 + 60_000;
    act(() => {
      vi.setSystemTime(tResume12);
      rerender12(props12("paused", tResume12));
    });
    // Still paused — ref unchanged (T0+HOPPER_MS), now in the past.
    expect(result12.current.tickDueRefs.hopperProd.current).toBe(T0 + HOPPER_MS);
    expect(result12.current.tickDueRefs.hopperProd.current).toBeLessThan(tResume12);

    // ── Resume ────────────────────────────────────────────────────────────────
    // runStatus effect zeros hopperProdNextDueMsRef; tick effect fires (===0)
    // and re-arms to nowMs + hopperMs — in the future.
    const tAfterResume12 = tResume12 + 2;
    act(() => {
      vi.setSystemTime(tAfterResume12);
      rerender12(props12("running", tAfterResume12));
    });

    const hopperAfterResume = result12.current.tickDueRefs.hopperProd.current;
    // Must not be 0 (not left un-armed) and must be strictly in the future.
    expect(hopperAfterResume).not.toBe(0);
    expect(hopperAfterResume).toBeGreaterThan(tAfterResume12);
    // Specifically: re-armed to exactly nowMs + hopperMs.
    expect(hopperAfterResume).toBe(tAfterResume12 + HOPPER_MS);
  });
});
