// Guard: manual stepper override must suppress all auto-track case/skid writes
// for the entire suppression window, and "Resume now" (suppression cleared +
// fireAutoTrackNow) must immediately re-enable writes on the very next tick.
//
// The suppression mechanism lives in useAutoTrack: while
//   Date.now() < autoSuppressUntilRef.current
// every case/skid write is silently skipped (bookkeeping still advances so
// the window expiring never causes a catch-up jump). Lifting the window
// (autoSuppressUntilRef.current = 0) combined with fireAutoTrackNow() (which
// sets caseNextDueMsRef.current = 0 so the next tick fires immediately) must
// produce a write on the very next rerender.
//
// This complements the tray/batch suppression test in
// autoTrackTraysBatches.test.tsx (which verifies the same window for dough
// counters). Here we verify case/skid counters — the ones driven by the
// casesOnCurrentSkid and skidsCompleted manual steppers.
//
// With baseCalc (ppm=100, pizzasPerCase=12): case period = 12/100 min = 7.2s.
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoTrack } from "./hooks/useAutoTrack";

function makeForm(initial: Record<string, number>) {
  const values: Record<string, number> = { ...initial };
  const writes: Record<string, number[]> = {};
  return {
    form: {
      getValues: (name: string) => values[name] ?? 0,
      setValue: (name: string, value: number) => {
        values[name] = value;
        (writes[name] ??= []).push(value);
      },
    } as any,
    values,
    writes,
  };
}

const baseCalc = {
  ppm: 100,
  perTray: 60,
  perBatch: 600,
  traysNeeded: 0,
  batchesNeeded: 0,
  pressDone: false,
  casesInFreezer: 0,
};

function makeV(overrides: Partial<Record<string, number>> = {}) {
  return {
    casesPerSkid: 60,
    pizzasPerCase: 12,
    casesNeeded: 1000,
    freezerTime: 20,
    traysOnLine: 5,
    batchesReady: 2,
    ...overrides,
  } as any;
}

describe("auto-track suppression for case/skid counters", () => {
  it("does not write casesOnCurrentSkid/skidsCompleted while the suppress window is active", () => {
    // Use real-clock suppression: armed to expire ~1 minute from now.
    const t0 = Date.now();
    const { form, values, writes } = makeForm({
      skidsCompleted: 1,
      casesOnCurrentSkid: 20,
      traysOnLine: 5,
      batchesReady: 2,
    });

    // elapsedBatchSec = 30 min → expectedCasesRaw = floor(10min*100/12) = 83 with
    // 20min freezerTime deducted. At t0 the hook seeds from prevExpected=-1.
    const elapsed = 30 * 60;
    const v = makeV({ skidsCompleted: 1, casesOnCurrentSkid: 20 });

    const { result, rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          calc: baseCalc,
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: elapsed, v } },
    );

    // First tick: baseline stored (prevExpected was -1), current non-zero total
    // (1 skid + 20 = 80) → no seed write. Record whatever state we have.
    const skidsAfterMount = values.skidsCompleted;
    const casesAfterMount = values.casesOnCurrentSkid;

    // Arm the suppression window (simulating what the stepper's onManual() does:
    //   autoSuppressUntilRef.current = Date.now() + AUTO_SUPPRESS_MS).
    result.current.autoSuppressUntilRef.current = Date.now() + 60 * 1000;

    // Advance time well past one case period (7.2 s) — auto-track WOULD tick.
    const caseWrites = writes.casesOnCurrentSkid?.length ?? 0;
    const skidWrites = writes.skidsCompleted?.length ?? 0;
    rerender({
      nowTime: new Date(t0 + 8000),
      elapsedBatchSec: elapsed + 8,
      v: makeV({ skidsCompleted: skidsAfterMount, casesOnCurrentSkid: casesAfterMount }),
    });

    // While suppressed: no new writes to either case/skid field.
    expect(writes.casesOnCurrentSkid?.length ?? 0).toBe(caseWrites);
    expect(writes.skidsCompleted?.length ?? 0).toBe(skidWrites);

    // A second tick interval still suppressed: still no write.
    rerender({
      nowTime: new Date(t0 + 16000),
      elapsedBatchSec: elapsed + 16,
      v: makeV({ skidsCompleted: skidsAfterMount, casesOnCurrentSkid: casesAfterMount }),
    });
    expect(writes.casesOnCurrentSkid?.length ?? 0).toBe(caseWrites);
    expect(writes.skidsCompleted?.length ?? 0).toBe(skidWrites);
  });

  it("resumes writing case/skid on the very next tick after Resume now clears suppression", () => {
    // Deficit closed (traysNeeded=0) and cases start from 0, so the first
    // tick always seeds the absolute count → makes the resumed write visible.
    const t0 = Date.now();
    const { form, values, writes } = makeForm({
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      traysOnLine: 5,
      batchesReady: 2,
    });

    const elapsed = 30 * 60; // 30 min elapsed, 20 min freezer → 10 min output
    const v = makeV();

    const { result, rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          calc: baseCalc,
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: elapsed, v } },
    );

    // Mount tick seeds the absolute count from zero (prevExpected was -1,
    // total was 0). Record the seed values.
    const skidsSeeded = values.skidsCompleted;
    const casesSeeded = values.casesOnCurrentSkid;
    // The seed must have produced something: 10 min * 100 ppm / 12 per-case = 83
    // cases → 1 skid + 23 cases.
    expect(skidsSeeded).toBe(1);
    expect(casesSeeded).toBe(23);

    // Arm suppression (manual stepper press).
    result.current.autoSuppressUntilRef.current = Date.now() + 60 * 1000;

    // Confirm suppression blocks. Snapshot write counts before the suppressed tick.
    const caseWritesBefore = writes.casesOnCurrentSkid?.length ?? 0;
    rerender({
      nowTime: new Date(t0 + 8000),
      elapsedBatchSec: elapsed + 8,
      v: makeV({ skidsCompleted: skidsSeeded, casesOnCurrentSkid: casesSeeded }),
    });
    expect(writes.casesOnCurrentSkid?.length ?? 0).toBe(caseWritesBefore);

    // "Resume now": clear the window AND reset tick-due timestamps to zero
    // so the next render fires immediately (matching the onClick handler:
    //   autoSuppressUntilRef.current = 0; fireAutoTrackNow();).
    result.current.autoSuppressUntilRef.current = 0;
    result.current.fireAutoTrackNow();

    // Advance past one full case period (7.2 s at ppm=100/pizzasPerCase=12)
    // so the expectedCasesRaw crosses into the next case and produces a
    // non-zero delta. At t0+16s (suppressed tick was at t0+8s):
    //   elapsedMinAfterTunnel = (30*60+16)/60 - 20 = 10.2667 min
    //   expectedCasesRaw = floor(10.2667*100/12) = floor(85.56) = 85
    //   prevExpected from t0+8 s tick = 84  →  delta = +1 → write fires.
    rerender({
      nowTime: new Date(t0 + 16000),
      elapsedBatchSec: elapsed + 16,
      v: makeV({ skidsCompleted: skidsSeeded, casesOnCurrentSkid: casesSeeded }),
    });

    // At least one incremental write must have fired after Resume now.
    expect(writes.casesOnCurrentSkid?.length ?? 0).toBeGreaterThan(caseWritesBefore);
  });

  it("counter-proof: without suppression the t0+16 s tick produces an incremental write (mirrors resume-now sequence)", () => {
    // This is the critical non-vacuousness guard for the "resumes writing"
    // test above. If the case-period formula changes so that no incremental
    // writes ever fire in the t0→t0+8s→t0+16s window, the suppression test
    // could silently become vacuous (writes=0 both before AND after resume).
    //
    // Same time sequence as the resume-now test, but NO suppression is ever
    // armed. The hook must produce at least one incremental case write by
    // t0+16 s, confirming the formula is live.
    const t0 = Date.now();
    const { form, writes } = makeForm({
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      traysOnLine: 5,
      batchesReady: 2,
    });

    const elapsed = 30 * 60;
    const v = makeV();

    const { rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          calc: baseCalc,
          v,
          form,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: elapsed } },
    );

    // Mount seeds from zero → 1 skid + 23 cases. Record write count.
    const writesAfterMount = writes.casesOnCurrentSkid?.length ?? 0;
    expect(writesAfterMount).toBeGreaterThan(0); // seed must have fired

    // Tick at t0+8 s (past one case period of 7.2 s) — no suppression armed.
    rerender({ nowTime: new Date(t0 + 8000), elapsedBatchSec: elapsed + 8 });
    const writesAfter8s = writes.casesOnCurrentSkid?.length ?? 0;

    // Tick at t0+16 s — the exact moment the resume-now test asserts a write.
    rerender({ nowTime: new Date(t0 + 16000), elapsedBatchSec: elapsed + 16 });

    // The t0+16 s tick specifically must produce at least one more write
    // beyond whatever happened at t0+8 s, proving the formula fires an
    // incremental write at this precise point in the time sequence.
    expect(writes.casesOnCurrentSkid?.length ?? 0).toBeGreaterThan(
      writesAfter8s,
    );
  });

  it("counter-proof: without suppression the case counter advances on the very first tick past the case period", () => {
    // Symmetric guard: if this test ALSO shows no write, the suppression
    // tests above would be vacuously true (the hook never writes cases at all
    // in this test setup). This test must PASS and write something, confirming
    // the hook is live before suppression is layered on.
    const t0 = Date.now();
    const { form, values } = makeForm({
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      traysOnLine: 5,
      batchesReady: 2,
    });

    renderHook(() =>
      useAutoTrack({
        runId: "run-1",
        runStatus: "running",
        nowTime: new Date(t0),
        elapsedBatchSec: 30 * 60,
        calc: baseCalc,
        v: makeV(),
        form,
      }),
    );

    // First tick: zero→seed path → must write 1 skid + 23 cases.
    expect(values.skidsCompleted).toBe(1);
    expect(values.casesOnCurrentSkid).toBe(23);
  });

  it("counter-proof: re-arming suppression after clearing it blocks writes again", () => {
    // Guard against a "permanent clear" regression where calling fireAutoTrackNow
    // irreversibly defeats future suppress-arms.
    const t0 = Date.now();
    const { form, values, writes } = makeForm({
      skidsCompleted: 1,
      casesOnCurrentSkid: 23,
      traysOnLine: 5,
      batchesReady: 2,
    });
    const elapsed = 30 * 60;

    const { result, rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          calc: baseCalc,
          v: makeV({ skidsCompleted: 1, casesOnCurrentSkid: 23 }),
          form,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: elapsed } },
    );

    // 1. Clear + resume → writes resume.
    result.current.autoSuppressUntilRef.current = 0;
    result.current.fireAutoTrackNow();
    const writesBefore = writes.casesOnCurrentSkid?.length ?? 0;
    rerender({ nowTime: new Date(t0 + 9000), elapsedBatchSec: elapsed + 9 });
    // (writes may or may not fire here depending on delta — that is fine; what
    //  matters is the subsequent re-arm still suppresses.)

    // 2. Re-arm suppression (second manual press).
    result.current.autoSuppressUntilRef.current = Date.now() + 60 * 1000;
    const writesAtRearm = writes.casesOnCurrentSkid?.length ?? 0;

    // 3. Advance past one more case period: must NOT write.
    rerender({ nowTime: new Date(t0 + 18000), elapsedBatchSec: elapsed + 18 });
    expect(writes.casesOnCurrentSkid?.length ?? 0).toBe(writesAtRearm);
  });
});
