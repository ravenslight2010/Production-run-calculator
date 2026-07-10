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

const baseCalc = { ppm: 100, perTray: 60, perBatch: 600, traysNeeded: 30, batchesNeeded: 2, pressDone: false };

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

describe("auto-track tray/batch up/down tracking", () => {
  it("counts up AND down while dough is still being made (deficit open)", () => {
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
          calc: baseCalc, // traysNeeded 30 > 0 -> press still making trays
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: now, elapsedBatchSec: elapsed, v } },
    );

    // First tick assumes one tray-period duration: one tray consumed;
    // production is armed half a period out (t0+18s), no write yet.
    expect(values.traysOnLine).toBe(49);
    // Batches: first quarter-batch tick drains 0.25 visibly (2-decimal write).
    expect(values.batchesReady).toBe(9.75);

    // Half a tray period later the press finishes a tray: count goes UP.
    now = new Date(t0 + 18 * 1000);
    elapsed += 18;
    v = makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBe(50);

    // At the full period the line eats one: count goes back DOWN.
    now = new Date(t0 + 36 * 1000);
    elapsed += 18;
    v = makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBe(49);
  });

  it("only counts down once staged dough covers the rest of the run (deficit closed)", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;

    let now = new Date(t0);
    let elapsed = 10 * 60;
    let v = makeV();

    const { rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          // No remaining deficit: all dough needed is already staged.
          calc: { ...baseCalc, traysNeeded: 0, batchesNeeded: 0 },
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: now, elapsedBatchSec: elapsed, v } },
    );

    expect(values.traysOnLine).toBe(49);

    // Production tick due at t0+18s must NOT fire (+0), so by the full period
    // the counter has only counted down.
    for (const sec of [18, 36]) {
      now = new Date(t0 + sec * 1000);
      v = makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady });
      rerender({ nowTime: now, elapsedBatchSec: elapsed + sec, v });
    }
    expect(values.traysOnLine).toBe(48);
  });

  it("bumps the batch count when the mixer finishes a batch", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 1 });
    const t0 = 1_700_000_000_000;

    const { rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          calc: baseCalc, // batchesNeeded 2 > 0 -> mixer still mixing
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: 10 * 60, v: makeV({ batchesReady: 1 }) } },
    );

    // Mount tick drains the first visible quarter batch.
    expect(values.batchesReady).toBe(0.75);

    // One full batch-time later (600/100 = 6 min) the mixer finishes a batch.
    // Consumption over the same jump is capped at 2 quarter-periods (0.5), so
    // the net move is +1 - 0.5 = +0.5.
    rerender({
      nowTime: new Date(t0 + 360 * 1000),
      elapsedBatchSec: 10 * 60 + 360,
      v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }),
    });
    expect(values.batchesReady).toBe(1.25);
  });

  it("production +1 never clamps a higher-than-max value down", () => {
    // Legacy/synced data can exceed the stepper max (3 batches). A mixer tick
    // must leave it alone, not slam it down to the cap.
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
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: 10 * 60, v: makeV({ batchesReady: 10 }) } },
    );

    // Mount tick drains a visible quarter batch first.
    expect(values.batchesReady).toBe(9.75);

    rerender({
      nowTime: new Date(t0 + 360 * 1000),
      elapsedBatchSec: 10 * 60 + 360,
      v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }),
    });
    // Net delta is +0.5 (mixer +1, drain -0.5) which would push further over
    // the 3-batch cap — the clamp must hold the value, never slam it to 3.
    expect(values.batchesReady).toBe(9.75);
  });

  it("drains batches fractionally — 0.25 per quarter-batch tick, visibly", () => {
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

    // Mount tick writes the first visible 0.25 drop.
    expect(values.batchesReady).toBe(9.75);

    // Quarter-batch ticks at 90s intervals keep stepping down by 0.25 so the
    // operator sees movement: 9.5, 9.25, then 9 after a full batch elapsed.
    const expected = [9.5, 9.25, 9];
    [90, 180, 270].forEach((sec, i) => {
      rerender({
        nowTime: new Date(t0 + sec * 1000),
        elapsedBatchSec: 10 * 60 + sec,
        v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }),
      });
      expect(values.batchesReady).toBe(expected[i]);
    });
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
    // Batches took exactly one visible quarter-tick on mount, nothing more.
    expect(values.batchesReady).toBe(9.75);
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

  it("stops decrementing once the press is done (count-based: cased + freezer ≥ needed)", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;
    // The stop is COUNT-based, not time-based: calc.pressDone flips true when
    // the real cased count plus live freezer contents reach casesNeeded. From
    // that moment the dough counters must freeze — the dough crew is on the
    // NEXT run's dough.
    const v = makeV({ casesNeeded: 100 });

    renderHook(() =>
      useAutoTrack({
        runId: "run-1",
        runStatus: "running",
        nowTime: new Date(t0),
        elapsedBatchSec: 20 * 60,
        calc: { ...baseCalc, pressDone: true },
        v,
        form,
      }),
    );

    expect(values.traysOnLine).toBe(50);
    expect(values.batchesReady).toBe(10);
  });

  it("keeps decrementing while the press is NOT done, even long past the time estimate", () => {
    // Regression guard for the old time-based stop: 20 min elapsed would have
    // satisfied the elapsed-time estimate (100 cases @ ppm 100 = 12 min), but
    // the real counts say the press is still going — dough must keep moving.
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;
    const v = makeV({ casesNeeded: 100 });

    renderHook(() =>
      useAutoTrack({
        runId: "run-1",
        runStatus: "running",
        nowTime: new Date(t0),
        elapsedBatchSec: 20 * 60,
        calc: baseCalc, // pressDone: false
        v,
        form,
      }),
    );

    expect(values.traysOnLine).toBe(49);
    expect(values.batchesReady).toBe(9.75);
  });

  it("seeds untouched 0 counters with the suggested staging on the first tick, then counts down", () => {
    // Operator never entered dough counts: both counters start at 0. The first
    // tick must seed them from the "Suggest" formula (trays=min(74,max(1,
    // round(min(40,traysNeeded))))=30, batches=min(3,max(1,ceil(min(3,
    // batchesNeeded))))=2) instead of leaving them stuck at 0 all run.
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 });
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
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: 10 * 60, v: makeV({ traysOnLine: 0, batchesReady: 0 }) } },
    );

    expect(values.traysOnLine).toBe(30);
    expect(values.batchesReady).toBe(2);

    // With the deficit still open, the next full period nets out: production
    // (+1 at 18s) balances consumption (-1 at 36s) — the seeded stock tracks
    // up and down instead of just draining.
    for (const sec of [18, 36]) {
      rerender({
        nowTime: new Date(t0 + sec * 1000),
        elapsedBatchSec: 10 * 60 + sec,
        v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }),
      });
    }
    expect(values.traysOnLine).toBe(30);
  });

  it("does not seed when there is no remaining dough need", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 });
    const t0 = 1_700_000_000_000;

    renderHook(() =>
      useAutoTrack({
        runId: "run-1",
        runStatus: "running",
        nowTime: new Date(t0),
        elapsedBatchSec: 10 * 60,
        calc: { ...baseCalc, traysNeeded: 0, batchesNeeded: 0 },
        v: makeV({ traysOnLine: 0, batchesReady: 0 }),
        form,
      }),
    );

    expect(values.traysOnLine).toBe(0);
    expect(values.batchesReady).toBe(0);
  });

  it("does not seed over an operator-entered value — first tick decrements as before", () => {
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;

    renderHook(() =>
      useAutoTrack({
        runId: "run-1",
        runStatus: "running",
        nowTime: new Date(t0),
        elapsedBatchSec: 10 * 60,
        calc: baseCalc,
        v: makeV(),
        form,
      }),
    );

    // Manual 50 stays the baseline: no jump to the 30-tray suggestion, and the
    // first tick still consumes one tray exactly like before the seed existed.
    expect(values.traysOnLine).toBe(49);
    expect(values.batchesReady).toBe(9.75);
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
          // Deficit closed -> pure countdown, so the resume is observable.
          calc: { ...baseCalc, traysNeeded: 0, batchesNeeded: 0 },
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

  it("disabled (cast screens) never writes — no decrement, no seed", () => {
    // Wall display screens pass disabled:true; they must never mutate the
    // counters or their decrements sync back over the operator's manual edits.
    const withValues = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const untouched = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 });
    const t0 = 1_700_000_000_000;

    for (const { form, values, writes, start } of [
      { ...withValues, start: { traysOnLine: 50, batchesReady: 10 } },
      { ...untouched, start: { traysOnLine: 0, batchesReady: 0 } },
    ]) {
      const { rerender } = renderHook(
        (props: { nowTime: Date; elapsedBatchSec: number }) =>
          useAutoTrack({
            runId: "run-1",
            runStatus: "running",
            nowTime: props.nowTime,
            elapsedBatchSec: props.elapsedBatchSec,
            calc: baseCalc,
            v: makeV(start),
            form,
            disabled: true,
          }),
        { initialProps: { nowTime: new Date(t0), elapsedBatchSec: 10 * 60 } },
      );

      // Mount tick + several tray periods: nothing may be written.
      for (const sec of [36, 72, 108, 270]) {
        rerender({ nowTime: new Date(t0 + sec * 1000), elapsedBatchSec: 10 * 60 + sec });
      }
      expect(writes).toEqual({});
      expect(values.traysOnLine).toBe(start.traysOnLine);
      expect(values.batchesReady).toBe(start.batchesReady);
    }
  });
});
