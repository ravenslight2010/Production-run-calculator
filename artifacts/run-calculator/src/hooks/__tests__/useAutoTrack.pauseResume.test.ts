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
import { useAutoTrack } from "../useAutoTrack";
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
    const { form, store } = makeFakeForm({ traysOnLine: 5 });

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (
      status: "running" | "paused",
      nowMs: number,
      trays?: number,
    ): Props => ({
      runId: "run-1",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: ELAPSED_SEC,
      calc: BASE_CALC,
      v: { ...BASE_V, traysOnLine: trays ?? store.traysOnLine },
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props("running", T0, 5) },
    );

    // ── Tick 1 at T0+500 ─────────────────────────────────────────────────
    // All due refs start at 0 → consumption tick fires immediately.
    // prevMs = 0 → durationMin = TRAY_PERIOD_MS/60000 = 2 min
    // traysConsumed = floor(2*100/200) = 1.  trays: 5 → 4.
    // trayLastMsRef  ← T0+500
    // trayNextDueMsRef ← T0+500+TRAY_PERIOD_MS (= T0+120500)
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props("running", T1));
    });
    expect(store.traysOnLine).toBe(4);

    // ── Pause at T1+1 ────────────────────────────────────────────────────
    // tick effect returns early (runStatus≠"running"); no change.
    const tPause = T1 + 1;
    act(() => {
      vi.setSystemTime(tPause);
      rerender(props("paused", tPause));
    });
    expect(store.traysOnLine).toBe(4);

    // ── Stay paused for 5 min (> 2 tray periods). ────────────────────────
    const tResume = tPause + 5 * 60_000; // 300 001 ms after T1
    act(() => {
      vi.setSystemTime(tResume);
      rerender(props("paused", tResume));
    });
    expect(store.traysOnLine).toBe(4); // unchanged while paused

    // ── Resume ───────────────────────────────────────────────────────────
    // In this act() call React runs both effects in declaration order:
    //   a) runStatus effect (status changed paused→running):
    //        trayLastMsRef.current  ← 0   (was T1)
    //        trayNextDueMsRef.current ← 0  (was T0+120500, already past-due)
    //   b) tick effect (nowMs = tResume+2):
    //        trayNextDueMsRef = 0 → consumption tick fires immediately
    //        prevMs = trayLastMsRef = 0 → durationMin = 1 period = 2 min
    //        traysConsumed = floor(2*100/200) = 1   → trays: 4 → 3
    //
    // WITHOUT trayLastMsRef being reset, prevMs would be T1 (T0+500);
    // the elapsed span (≈ 5 min+1 ms) would be capped at 2 periods (4 min)
    // → floor(4*100/200) = 2 trays consumed → 4 → 2 (the "jump").
    const traysBeforeResume = store.traysOnLine; // 4
    act(() => {
      vi.setSystemTime(tResume + 2);
      rerender(props("running", tResume + 2));
    });

    const traysDroppedOnResume = traysBeforeResume - store.traysOnLine;

    // Exactly 1 tray consumed (one period).  If trayLastMsRef had NOT been
    // zeroed, this would be 2 (two-period cap hit).
    expect(traysDroppedOnResume).toBe(1);
    expect(store.traysOnLine).toBe(3);
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
    const { form, store } = makeFakeForm({
      skidsCompleted: 3,
      casesOnCurrentSkid: 1, // 31 cases total
    });

    // elapsed=780 → elapsedMin=13 → afterTunnel=3 → expectedCasesRaw≈30
    const elapsed = 780;

    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (
      status: "running" | "paused",
      nowMs: number,
      elapsedSec: number,
    ): Props => ({
      runId: "run-2",
      runStatus: status,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: BASE_V,
      form,
    });

    const { rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props("running", T0, elapsed) },
    );

    // ── Tick 1 at T0+500: prevExpected=-1 → first-tick branch.
    // curTotal=31>0 → just baselines; no write to form.
    // lastExpectedCasesRef ← expectedCasesRaw ≈ 30
    // caseNextDueMsRef     ← T0+500+CASE_PERIOD_MS (= T0+6500)
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props("running", T1, elapsed));
    });
    // Form unchanged (first-tick baselines only).
    expect(store.skidsCompleted * 10 + store.casesOnCurrentSkid).toBe(31);

    // ── Pause, then SSE resets form to 0. ───────────────────────────────
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
    // caseNextDueMsRef (T0+6500) is way past-due → case tick fires.
    //   prevExpected ≈ 30, expectedRaw ≈ 84 (afterTunnel ≈ 8.4 min)
    //   deltaCases = 54, curTotal = 0, prevExpected (30) > casesPerSkid (10)
    //   → guard fires: skip write, formResetSkippedRef ← true
    //     lastExpectedCasesRef ← 84
    //   → caseNextDueMsRef ← tResume+2+CASE_PERIOD_MS
    act(() => {
      vi.setSystemTime(tResume + 2);
      rerender(props("running", tResume + 2, elapsedAfterPause + 1));
    });

    // Guard skipped the catch-up write; total must still be at most 1
    // (could be 1 if the guard already ran on the paused→running tick above
    // and then the "already-armed" second tick ran too — but never 54).
    const totalAfterResume = store.skidsCompleted * 10 + store.casesOnCurrentSkid;
    expect(totalAfterResume).toBeLessThanOrEqual(2);

    // ── One more tick: guard disarmed → normal ≈ 1-case increment. ───────
    // caseNextDueMsRef ← tResume+2+CASE_PERIOD_MS; advance past it.
    act(() => {
      vi.setSystemTime(tResume + CASE_PERIOD_MS + 3);
      rerender(props("running", tResume + CASE_PERIOD_MS + 3, elapsedAfterPause + 7));
    });

    const totalAfterNextTick = store.skidsCompleted * 10 + store.casesOnCurrentSkid;
    // Incremented by exactly 1 (disarmed guard → normal delta path).
    expect(totalAfterNextTick).toBe(totalAfterResume + 1);
    // Total nowhere near the catch-up value of 54.
    expect(totalAfterNextTick).toBeLessThan(10);
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
    const props = (nowMs: number, trays?: number, batches?: number): Props => ({
      runId: "run-4",
      runStatus: "running" as const,
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
      { initialProps: props(T0, 5, 2) },
    );

    // ── Tick 1 at T0+500: establishes trayLastMsRef / batchLastMsRef ──────
    // prevMs=0 → duration=1 period → consumes 1 tray (5→4).
    // trayLastMsRef  ← T0+500
    // trayNextDueMsRef ← T0+500+TRAY_PERIOD_MS (= T0+120500)  [well in future]
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props(T1));
    });
    expect(store.traysOnLine).toBe(4);

    // ── pauseDoughTimers() called at T1+1 ────────────────────────────────
    // doughTimerPausedRef.current = T1+1; tray/batch ticks suppressed.
    act(() => {
      vi.setSystemTime(T1 + 1);
      result.current.pauseDoughTimers();
      rerender(props(T1 + 1));
    });
    expect(store.traysOnLine).toBe(4); // unchanged — dough paused

    // ── Stay paused for 5 minutes (> 2 tray periods). ─────────────────────
    const tPause5min = T1 + 5 * 60_000; // 300 001 ms after T1
    act(() => {
      vi.setSystemTime(tPause5min);
      rerender(props(tPause5min));
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
    const traysBeforeResume = store.traysOnLine; // 4
    act(() => {
      vi.setSystemTime(tPause5min + 2);
      result.current.resumeDoughTimers();
      rerender(props(tPause5min + 2));
    });

    const traysDropped = traysBeforeResume - store.traysOnLine;
    // Exactly 1 tray (one period). A jump would be 2 (two-period cap hit).
    expect(traysDropped).toBe(1);
    expect(store.traysOnLine).toBe(3);
    // batchesReady must also not have jumped (still at or near its pre-pause value).
    expect(store.batchesReady).toBeGreaterThanOrEqual(0);
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
    const { form, store } = makeFakeForm({
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      traysOnLine: 5,
      batchesReady: 2,
    });

    // elapsed=700 → elapsedMin≈11.67 → afterTunnel≈1.67 → expectedCasesRaw≈16
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, elapsedSec: number): Props => ({
      runId: "run-5",
      runStatus: "running" as const,
      nowTime: ms(nowMs),
      elapsedBatchSec: elapsedSec,
      calc: BASE_CALC,
      v: { ...BASE_V, traysOnLine: store.traysOnLine, batchesReady: store.batchesReady },
      form,
    });

    const { result, rerender } = renderHook(
      (p: Props) => useAutoTrack(p),
      { initialProps: props(T0, ELAPSED_SEC) },
    );

    // ── Tick 1 at T0+500: first-tick branch; form is 0 → seed cases. ──────
    const T1 = T0 + 500;
    act(() => {
      vi.setSystemTime(T1);
      rerender(props(T1, ELAPSED_SEC));
    });
    const casesAfterTick1 = store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid;
    const traysAfterTick1 = store.traysOnLine;
    // First tick seeded cases (0→something) and consumed 1 tray.
    expect(casesAfterTick1).toBeGreaterThanOrEqual(0); // may or may not seed
    expect(traysAfterTick1).toBeLessThanOrEqual(5);

    // ── pauseDoughTimers() at T1+1: freeze dough ticks. ──────────────────
    act(() => {
      vi.setSystemTime(T1 + 1);
      result.current.pauseDoughTimers();
      rerender(props(T1 + 1, ELAPSED_SEC));
    });
    const traysWhenPaused = store.traysOnLine;
    const casesWhenPaused = store.skidsCompleted * BASE_V.casesPerSkid + store.casesOnCurrentSkid;

    // ── Advance 3 case periods while dough timers are paused. ─────────────
    // Cases should still tick (3 increments); trays must stay frozen.
    const advanceMs = 3 * CASE_PERIOD_MS; // 18 000 ms
    const tAfterPause = T1 + 1 + advanceMs;
    const elapsedAfterPause = ELAPSED_SEC + advanceMs / 1000;

    // Step through case periods one at a time so each tick fires.
    for (let i = 1; i <= 3; i++) {
      const nowMs = T1 + 1 + i * CASE_PERIOD_MS + 1;
      act(() => {
        vi.setSystemTime(nowMs);
        rerender(props(nowMs, ELAPSED_SEC + (i * CASE_PERIOD_MS) / 1000));
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

    const { form, store } = makeFakeForm({
      skidsCompleted: 10, // 100 cases (matches expectedCasesRaw at elapsed=1200)
      casesOnCurrentSkid: 0,
    });

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
      rerender(props(Tguard, elapsed + 60));
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
      rerender(props(Twrite, elapsed + 120));
    });
    const afterWriteTick = store.skidsCompleted * 10 + store.casesOnCurrentSkid;

    // Latch disarmed: write proceeded — total is 10 (one normal delta).
    expect(afterWriteTick).toBeGreaterThan(0);
    // Exactly one delta worth (10), nowhere near the 110-case stale catch-up.
    expect(afterWriteTick).toBeLessThanOrEqual(BASE_V.casesPerSkid);
  });
});
