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

const baseCalc = { ppm: 100, perTray: 60, perBatch: 600, traysNeeded: 30, batchesNeeded: 2, pressDone: false, casesInFreezer: 0 };

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

  it("only counts down once staged dough covers the rest of the run AND no batches remain", () => {
    // Deficit closed (traysNeeded=0) AND no ready batches: production must stop
    // entirely, so the counter only drains down.
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 0 });
    const t0 = 1_700_000_000_000;

    let now = new Date(t0);
    let elapsed = 10 * 60;
    let v = makeV({ batchesReady: 0 });

    const { rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          // No remaining deficit and no ready batches: production must stop.
          calc: { ...baseCalc, traysNeeded: 0, batchesNeeded: 0 },
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: now, elapsedBatchSec: elapsed, v } },
    );

    expect(values.traysOnLine).toBe(49);

    // Production tick due at t0+18s must NOT fire (+0) because both
    // traysNeeded=0 and batchesReady=0, so by the full period the counter
    // has only counted down.
    for (const sec of [18, 36]) {
      now = new Date(t0 + sec * 1000);
      v = makeV({ traysOnLine: values.traysOnLine, batchesReady: 0 });
      rerender({ nowTime: now, elapsedBatchSec: elapsed + sec, v });
    }
    expect(values.traysOnLine).toBe(48);
  });

  it("continues tray production while batchesReady > 0 even when deficit is closed", () => {
    // New behaviour: the dough crew keeps pulling trays from ready batches
    // until every batch is exhausted. Once traysNeeded=0 but batchesReady>0,
    // production still ticks up (same rate as when deficit is open).
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 10 });
    const t0 = 1_700_000_000_000;

    let now = new Date(t0);
    let elapsed = 10 * 60;
    let v = makeV({ batchesReady: 10 });

    const { rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          // Deficit closed, but batches remain: production must continue.
          calc: { ...baseCalc, traysNeeded: 0, batchesNeeded: 0 },
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: now, elapsedBatchSec: elapsed, v } },
    );

    // First tick: consumption fires (50→49); production armed at t0+18s.
    expect(values.traysOnLine).toBe(49);

    // t0+18s: production fires (+1) because batchesReady=9.75 > 0 → 50.
    now = new Date(t0 + 18 * 1000);
    v = makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady });
    rerender({ nowTime: now, elapsedBatchSec: elapsed + 18, v });
    expect(values.traysOnLine).toBe(50);

    // t0+36s: consumption fires (-1) → 49; production not yet due (next: t0+54s).
    now = new Date(t0 + 36 * 1000);
    v = makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady });
    rerender({ nowTime: now, elapsedBatchSec: elapsed + 36, v });
    expect(values.traysOnLine).toBe(49);
  });

  it("keeps auto-producing trays past the three-section advisory total", () => {
    const { form, values } = makeForm({
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      traysOnLine: 74,
      batchesReady: 10,
    });
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
      {
        initialProps: {
          nowTime: new Date(t0),
          elapsedBatchSec: 10 * 60,
          v: makeV({ traysOnLine: 74, batchesReady: 10 }),
        },
      },
    );

    // The first consumption tick moves 74 → 73. Half a tray period later,
    // production must add the tray back even though the aggregate is above the
    // physical 3 × 20 advisory guide and at the old hardcoded ceiling.
    expect(values.traysOnLine).toBe(73);
    rerender({
      nowTime: new Date(t0 + 18 * 1000),
      elapsedBatchSec: 10 * 60 + 18,
      v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }),
    });
    expect(values.traysOnLine).toBe(74);

    // A second production tick after an intervening consume proves 74 is no
    // longer a ceiling: 74 → 73 → 74 is not enough, so manually preserve 74
    // through the consumption tick and let the next production tick add to 75.
    rerender({
      nowTime: new Date(t0 + 36 * 1000),
      elapsedBatchSec: 10 * 60 + 36,
      v: makeV({ traysOnLine: 75, batchesReady: values.batchesReady }),
    });
    rerender({
      nowTime: new Date(t0 + 54 * 1000),
      elapsedBatchSec: 10 * 60 + 54,
      v: makeV({ traysOnLine: 74, batchesReady: values.batchesReady }),
    });
    expect(values.traysOnLine).toBe(75);
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
    // the real cased count plus live Freeze tunnel contents reach casesNeeded. From
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
    // Batches stay 0: trays were seeded to cover the full deficit (30 trays =
    // 30 traysNeeded), so the remaining deficit passed to the batch seed is 0
    // → seed = null → batchesReady stays 0. Only a run large enough that trays
    // cap at 40 would seed batches with the leftover coverage.
    expect(values.batchesReady).toBe(0);

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
    // Use batchesReady=0 so the scenario is pure countdown (deficit=0 AND no
    // ready batches). This isolates the suppression mechanism from production.
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 50, batchesReady: 0 });
    const t0 = Date.now();
    let now = new Date(t0);
    let elapsed = 10 * 60;
    let v = makeV({ batchesReady: 0 });

    const { result, rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          // Deficit closed, no ready batches -> pure countdown.
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
    v = makeV({ traysOnLine: values.traysOnLine, batchesReady: 0 });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBe(49);

    // Suppression expires; the next tray tick decrements again.
    result.current.autoSuppressUntilRef.current = Date.now() - 1;
    now = new Date(t0 + 72 * 1000);
    elapsed += 36;
    v = makeV({ traysOnLine: values.traysOnLine, batchesReady: 0 });
    rerender({ nowTime: now, elapsedBatchSec: elapsed, v });
    expect(values.traysOnLine).toBeLessThan(49);
  });

  it("counter-proof: without suppression the t0+36 s tick produces an incremental tray write (mirrors resume sequence)", () => {
    // Non-vacuousness guard for the "resumes decrementing after suppression"
    // test above. If the tray-period formula changes so that no incremental
    // writes ever fire in the t0 → t0+36s → t0+72s window, the suppression
    // test could silently become vacuous (traysOnLine stays 49 both with AND
    // without suppression, making a false-pass undetectable).
    //
    // Same time sequence and calc as the resume-now test (batchesReady=0, pure
    // countdown), but NO suppression is ever armed. The hook must decrement
    // traysOnLine below 49 by t0+72s, confirming the tray-period formula is
    // live in that window.
    const t0 = Date.now();
    const { form, values } = makeForm({
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      traysOnLine: 50,
      batchesReady: 0,
    });
    let elapsed = 10 * 60;

    const { rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: "running",
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          // Deficit closed, no ready batches -> pure countdown, matching resume-now test.
          calc: { ...baseCalc, traysNeeded: 0, batchesNeeded: 0 },
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: elapsed, v: makeV({ batchesReady: 0 }) } },
    );

    // Mount tick: first consumption fires immediately (50 → 49).
    // The batch quarter-period is 90 s, so the mount tick is also the first
    // (and only) batch-drain write in this window — capture the value now so
    // the batch counter-proof below has a concrete reference.
    expect(values.traysOnLine).toBe(49);
    const batchesAfterMount = values.batchesReady;
    // batchesReady starts at 0 — drain from 0 stays 0 (no negative), which is
    // fine; the batch-drain formula fires but clamps to 0. The important thing
    // is the tray formula is live, which the assertions below confirm.
    expect(batchesAfterMount).toBe(0);

    // t0+36 s — exactly one tray period (60/100 min = 36s): another tray consumed.
    // No suppression armed, so THIS TICK ITSELF must produce a write.
    rerender({
      nowTime: new Date(t0 + 36 * 1000),
      elapsedBatchSec: elapsed + 36,
      v: makeV({ traysOnLine: values.traysOnLine, batchesReady: 0 }),
    });

    // Assert immediately after +36s — the suppression test arms suppression
    // across exactly this tick, so proving the write fires here (not just
    // eventually by +72s) is the actual non-vacuousness proof.
    expect(values.traysOnLine).toBeLessThan(49);

    // t0+72 s — secondary guard: one more period, another decrement.
    const traysAfter36 = values.traysOnLine;
    rerender({
      nowTime: new Date(t0 + 72 * 1000),
      elapsedBatchSec: elapsed + 72,
      v: makeV({ traysOnLine: values.traysOnLine, batchesReady: 0 }),
    });
    expect(values.traysOnLine).toBeLessThan(traysAfter36);
  });

  it("global pause+resume: first post-resume tick does not drain the full pause duration", () => {
    // Regression guard: when a run is globally paused (runStatus → "paused")
    // and then resumed (runStatus → "running"), the first tick must consume at
    // most one normal tray period's worth — NOT the wall-clock duration of the
    // pause. Previously, trayLastMsRef / batchLastMsRef retained their
    // pre-pause values, so nowMs − prevMs on the first post-resume tick spanned
    // the entire pause, draining far more trays/batches than were consumed.
    //
    // Use batchesReady=0 (pure drain) so tray production doesn't fire and the
    // net tray moves are unambiguously from consumption alone.
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 20, batchesReady: 0 });
    const t0 = 1_700_000_000_000;

    // Start running; mount tick arms the refs and drains one tray + one
    // quarter-batch (same as the other tests).
    const { rerender } = renderHook(
      (props: { nowTime: Date; elapsedBatchSec: number; runStatus: "running" | "paused"; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: props.runStatus,
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          calc: { ...baseCalc, traysNeeded: 0, batchesNeeded: 0 }, // pure drain (no ready batches)
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: new Date(t0), elapsedBatchSec: 10 * 60, runStatus: "running" as const, v: makeV({ traysOnLine: 20, batchesReady: 0 }) } },
    );

    // After mount: one tray consumed (20→19).
    expect(values.traysOnLine).toBe(19);

    // Advance clock by one tray period so the next consumption tick is armed.
    rerender({
      nowTime: new Date(t0 + 36 * 1000),
      elapsedBatchSec: 10 * 60 + 36,
      runStatus: "running",
      v: makeV({ traysOnLine: values.traysOnLine, batchesReady: 0 }),
    });
    // One more tray consumed (19→18).
    expect(values.traysOnLine).toBe(18);
    const traysBeforePause = values.traysOnLine;
    const batchesBeforePause = values.batchesReady;

    // Pause the run: tick loop freezes, wall clock keeps advancing.
    rerender({
      nowTime: new Date(t0 + 36 * 1000),
      elapsedBatchSec: 10 * 60 + 36,
      runStatus: "paused",
      v: makeV({ traysOnLine: traysBeforePause, batchesReady: batchesBeforePause }),
    });

    // Simulate a 5-minute pause (5 tray periods + 3.3 quarter-batch periods).
    const pauseMs = 5 * 60 * 1000;

    // Resume: the useEffect that reacts to runStatus → "running" should zero
    // the consumption anchor refs, preventing the first tick from spanning the
    // pause duration.
    rerender({
      nowTime: new Date(t0 + 36 * 1000 + pauseMs),
      elapsedBatchSec: 10 * 60 + 36,
      runStatus: "running",
      v: makeV({ traysOnLine: traysBeforePause, batchesReady: batchesBeforePause }),
    });

    // First post-resume tick: refs were zeroed, so the consumption delta is
    // treated as "first tick" (one full tray period assumed) — at most one tray.
    // Without the fix the drift would drain 5 trays (the 5-minute pause).
    const traysDropped = traysBeforePause - values.traysOnLine;
    expect(traysDropped).toBeLessThanOrEqual(1);

    // Batch counter: the drift from a 5-minute pause would be ~3.33 quarter
    // batches (5min / 1.5min per quarter). After the fix it must be ≤ 1 quarter
    // batch (0.25).
    const batchesDropped = batchesBeforePause - values.batchesReady;
    expect(batchesDropped).toBeLessThanOrEqual(0.25 + 1e-9);
  });

  it("global pause+resume: production ref re-arms at half-period offset and does not catch-up write on resume", () => {
    // Regression guard: when a run is globally paused and then resumed, the
    // production ticker (trayProdNextDueMsRef) used to carry its pre-pause value.
    // If both tickers were simultaneously overdue on resume, both fired at the
    // same nowMs and both re-armed to nowMs+period, collapsing the half-period
    // offset to zero — the two TickBars showed identical countdowns from that
    // point forward.
    //
    // Fix: reset trayProdNextDueMsRef=0 on resume (alongside trayNextDueMsRef).
    // The first-encounter arm then re-establishes the half-period offset cleanly:
    //   tray ref  → nowMs + period   (consumption fires immediately, re-arms)
    //   trayProd  → nowMs + period/2 (production first-encounter arm, no write)
    //
    // tray period  = 60/100 min × 60 = 36 s  → half = 18 s
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 20, batchesReady: 5 });
    const t0 = 1_700_000_000_000;
    const PERIOD_MS = 36_000; // (60 perTray / 100 ppm) * 60000

    const { result, rerender } = renderHook(
      (props: { nowTime: Date; runStatus: "running" | "paused"; v: any }) =>
        useAutoTrack({
          runId: "run-1",
          runStatus: props.runStatus,
          nowTime: props.nowTime,
          elapsedBatchSec: 10 * 60,
          calc: baseCalc, // traysNeeded: 30 > 0 → production ticks fire
          v: props.v,
          form,
        }),
      { initialProps: { nowTime: new Date(t0), runStatus: "running" as const, v: makeV({ traysOnLine: 20, batchesReady: 5 }) } },
    );

    // Mount: consumption fires (t0), production arms at t0+18s.
    expect(values.traysOnLine).toBe(19); // consumption decremented

    // Let production fire its first write tick at t0+18s.
    rerender({ nowTime: new Date(t0 + 18_000), runStatus: "running", v: makeV({ traysOnLine: values.traysOnLine, batchesReady: values.batchesReady }) });
    expect(values.traysOnLine).toBe(20); // production +1

    const traysBeforePause = values.traysOnLine;

    // Pause for 3 full tray periods (108 s) — both tickers become overdue.
    rerender({ nowTime: new Date(t0 + 18_000), runStatus: "paused", v: makeV({ traysOnLine: traysBeforePause, batchesReady: values.batchesReady }) });

    const resumeMs = t0 + 18_000 + 108_000; // 3 periods later

    // Resume: the useEffect zeros both refs.
    rerender({ nowTime: new Date(resumeMs), runStatus: "running", v: makeV({ traysOnLine: traysBeforePause, batchesReady: values.batchesReady }) });

    // After resume tick:
    // • Consumption (ref=0) fires immediately → re-arms to resumeMs + PERIOD_MS
    // • Production (ref=0) hits first-encounter path → arms to resumeMs + PERIOD_MS/2 (no write)
    // Tray count must drop by at most 1 (one consumption tick), NOT jump by
    // multiple trays (catch-up production writes would push it UP, not down —
    // but we assert no extra +1 production writes occurred).
    const traysAfterResume = values.traysOnLine;
    expect(traysAfterResume).toBeLessThanOrEqual(traysBeforePause); // at most one consumption decrement
    expect(traysAfterResume).toBeGreaterThanOrEqual(traysBeforePause - 1);

    // Half-period separation: after the resume tick the refs must differ by
    // exactly half a tray period (18 s = PERIOD_MS/2).
    const { tickDueRefs } = result.current;
    const trayRef = tickDueRefs.tray.current;
    const trayProdRef = tickDueRefs.trayProd.current;
    // tray ref (consumption re-armed) should be resumeMs + PERIOD_MS
    // trayProd ref (first-encounter arm) should be resumeMs + PERIOD_MS/2
    expect(trayRef - trayProdRef).toBeCloseTo(PERIOD_MS / 2, -1); // within 10 ms
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
