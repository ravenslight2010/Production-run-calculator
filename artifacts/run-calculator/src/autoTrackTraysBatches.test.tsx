// Repro test: auto-track must decrement traysOnLine / batchesReady at each
// counter's own production-paced cadence while running (trays once per
// time-to-consume-one-tray, batches once per quarter-batch duration, with
// fractional remainder carry for slow-depleting batches). Guards the "auto
// trays and auto batches aren't working" report.
//
// With baseCalc (ppm=100, perTray=60, perBatch=600, pizzasPerCase=12):
//  • tray period   = 60/100 min  = 36s (one tray per tick)
//  • batch period  = 600/100/4   = 1.5 min = 90s (quarter batch per tick)
//  • case period   = 12/100 min  = 7.2s
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoTrack } from "./hooks/useAutoTrack";

type Written = Record<string, number>;

function makeForm(initial: Record<string, number>) {
  const values: Record<string, number> = { ...initial };
  const writes: Written = {};
  return {
    form: {
      getValues: (name: string) => values[name] ?? 0,
      setValue: (name: string, value: number) => {
        values[name] = value;
        writes[name] = value;
      },
    } as any,
    values,
    writes,
  };
}

const baseCalc = { ppm: 100, perTray: 60, perBatch: 600 };

function makeV(overrides: Partial<Record<string, number>> = {}) {
  return {
    casesPerSkid: 60,
    pizzasPerCase: 12,
    casesNeeded: 1000,
    freezerTime: 20,
    traysOnLine: 50,
    batchesReady: 10,
    ...overrides,
  } as any;
}

describe("auto-track tray/batch decrement", () => {
  it("decrements one tray per tray-time tick", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;

    let now = new Date(t0);
    let elapsed = 10 * 60; // 10 min in — feeding far from complete
    let v = makeV();

    const { rerender } = renderHook(
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
      { initialProps: { nowTime: now, elapsedBatchSec: elapsed, v } },
    );

    // First tick assumes one tray-period duration: exactly one tray consumed.
    expect(values.traysOnLine).toBe(49);
    // Batches: first quarter-batch tick = 0.25 -> floors to 0, remainder carried.
    expect(values.batchesReady).toBe(10);

    // Advance one full tray period (36s) — the next tray tick fires.
    now = new Date(t0 + 36 * 1000);
    elapsed += 36;
    v = makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBe(48);
  });

  it("carries the quarter-batch remainder so batches drop once per full batch", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;

    const { rerender } = renderHook(
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
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: 10 * 60, v: makeV() } },
    );

    // Mount tick = 0.25 batch remainder, no write yet.
    expect(values.batchesReady).toBe(10);

    // Quarter-batch ticks at 90s intervals: 0.5, 0.75, then 1.0 -> one batch
    // consumed on the 4th tick (t0 + 270s).
    for (const sec of [90, 180, 270]) {
      rerender({
        nowTime: new Date(t0 + sec * 1000),
        elapsedBatchSec: 10 * 60 + sec,
        v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }),
      });
    }
    expect(values.batchesReady).toBe(9);
  });

  it("applies only ONE tick on mount — reset effects must not re-arm the same tick", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;

    const { rerender } = renderHook(
      (props: { nowTime: Date }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: 10 * 60,
          calc: baseCalc,
          v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }),
          form,
        }),
      { initialProps: { nowTime: new Date(t0) } },
    );

    expect(values.traysOnLine).toBe(49);

    // Ticks BEFORE the next tray period is due (like the app's per-second clock)
    // must not decrement again. Before the effect-order fix, the mount-time reset
    // effects wiped the due markers after the first write, so the very next
    // tick re-fired immediately and double-decremented.
    rerender({ nowTime: new Date(t0 + 1000) });
    rerender({ nowTime: new Date(t0 + 2000) });
    expect(values.traysOnLine).toBe(49);
    expect(values.batchesReady).toBe(10);
  });

  it("advances cases once per case-time tick and rolls the skid from the same total", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;
    // 30 min elapsed, 20 min tunnel -> 10 min of output = floor(10*100/12) = 83
    // cases. casesPerSkid=60 -> seed lands at 1 skid + 23 cases.
    let elapsed = 30 * 60;

    const { rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          calc: baseCalc,
          v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }),
          form,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: elapsed } },
    );

    // Mount tick seeds the absolute count (no prior progress).
    expect(values.skidsCompleted).toBe(1);
    expect(values.casesOnCurrentSkid).toBe(23);

    // Before the case period (12/100 min = 7.2s) elapses: no write.
    rerender({ nowTime: new Date(t0 + 1000), elapsedBatchSec: elapsed + 1 });
    expect(values.casesOnCurrentSkid).toBe(23);

    // One case period later the next tick fires: one more case produced
    // (floor((10min+7.3s)*100/12) = 84) -> incremental +1.
    rerender({ nowTime: new Date(t0 + 7300), elapsedBatchSec: elapsed + 7.3 });
    expect(values.skidsCompleted).toBe(1);
    expect(values.casesOnCurrentSkid).toBe(24);
  });

  it("stops decrementing once the dough feed is complete", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;
    // casesNeeded 100 @ ppm 100 / 12 per case => feed complete after 12 min.
    const v = makeV({ casesNeeded: 100 });

    renderHook(() =>
      useAutoTrack({
        runId: "run-1",
        runStatus: "running",
        nowTime: new Date(t0),
        elapsedBatchSec: 20 * 60,
        calc: baseCalc,
        v,
        form,
      }),
    );

    expect(values.traysOnLine).toBe(50);
    expect(values.batchesReady).toBe(10);
  });

  it("resumes decrementing after the 1-min suppression window expires", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = Date.now();
    let now = new Date(t0);
    let elapsed = 10 * 60;
    let v = makeV();

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
      { initialProps: { nowTime: now, elapsedBatchSec: elapsed, v } },
    );

    expect(values.traysOnLine).toBe(49);

    // Operator takes over: suppression armed for 1 minute (real-clock based).
    result.current.autoSuppressUntilRef.current = Date.now() + 60 * 1000;

    // A tray tick fires during suppression -> no write, but bookkeeping advances.
    now = new Date(t0 + 36 * 1000);
    elapsed += 36;
    v = makeV({ traysOnLine: values.traysOnLine });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBe(49);

    // Suppression expires; the next tray tick decrements again.
    result.current.autoSuppressUntilRef.current = Date.now() - 1;
    now = new Date(t0 + 72 * 1000);
    elapsed += 36;
    v = makeV({ traysOnLine: values.traysOnLine });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBeLessThan(49);
  });
});
