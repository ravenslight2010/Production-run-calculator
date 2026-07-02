// Repro test: auto-track must decrement traysOnLine / batchesReady each 5-min
// bucket while running (with fractional remainder carry for slow-depleting
// batches). Guards the "auto trays and auto batches aren't working" report.
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
  it("decrements trays on the first bucket and carries batch remainder to later buckets", () => {
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

    // First bucket assumes 5-min duration: trays -= floor(5*100/60)=8
    expect(values.traysOnLine).toBe(42);
    // Batches: 5*100/600 = 0.833 -> floors to 0, remainder carried (no write yet)
    expect(values.batchesReady).toBe(10);

    // Advance one full 5-min bucket.
    now = new Date(t0 + 5 * 60 * 1000);
    elapsed += 5 * 60;
    v = makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });

    // Trays: another 8.33 + 0.33 remainder = 8 consumed -> 34
    expect(values.traysOnLine).toBe(34);
    // Batches: remainder 0.833 + 0.833 = 1.67 -> 1 consumed -> 9
    expect(values.batchesReady).toBe(9);
  });

  it("respects a custom refresh interval (1-min buckets fire every minute)", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;

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
          intervalMin: 1,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: 10 * 60 } },
    );

    // First bucket assumes a 1-min duration: trays -= floor(1*100/60)=1 (0.667
    // remainder carried).
    expect(values.traysOnLine).toBe(49);

    // One minute later the next bucket fires: 1.667 + 0.667 = 2.33 -> 2 consumed.
    rerender({ nowTime: new Date(t0 + 60 * 1000), elapsedBatchSec: 11 * 60 });
    expect(values.traysOnLine).toBe(47);
  });

  it("applies only ONE bucket on mount — reset effects must not re-arm the same bucket", () => {
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

    expect(values.traysOnLine).toBe(42);

    // Ticks within the SAME 5-min bucket (like the app's per-second clock) must
    // not decrement again. Before the effect-order fix, the mount-time reset
    // effects wiped the bucket marker after the first write, so the very next
    // tick re-fired the same bucket and double-decremented.
    rerender({ nowTime: new Date(t0 + 1000) });
    rerender({ nowTime: new Date(t0 + 2000) });
    expect(values.traysOnLine).toBe(42);
    expect(values.batchesReady).toBe(10);
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

    expect(values.traysOnLine).toBe(42);

    // Operator takes over: suppression armed for 1 minute (real-clock based).
    result.current.autoSuppressUntilRef.current = Date.now() + 60 * 1000;

    // A bucket fires during suppression -> no write, but bookkeeping advances.
    now = new Date(t0 + 5 * 60 * 1000);
    elapsed += 5 * 60;
    v = makeV({ traysOnLine: values.traysOnLine });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBe(42);

    // Suppression expires; next bucket decrements again.
    result.current.autoSuppressUntilRef.current = Date.now() - 1;
    now = new Date(t0 + 10 * 60 * 1000);
    elapsed += 5 * 60;
    v = makeV({ traysOnLine: values.traysOnLine });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBeLessThan(42);
  });
});
