// Regression tests: after End Run the case/skid auto-track keeps ticking while
// the freezer tunnel drains (freezerTime minutes after endedAt), advancing by
// exactly what EXITED the tunnel (calc.casesInFreezer drop between ticks).
// It must: keep climbing during the drain, stop at freezer-empty, never exceed
// what was pressed (cased + in-freezer) or the run target, never tick a run
// ended longer than freezerTime ago, and never move the dough counters.
//
// With makeV (pizzasPerCase=12, ppm=100): case period = 12/100 min = 7.2s.
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoTrack } from "./hooks/useAutoTrack";

function makeForm(initial: Record<string, number>) {
  const values: Record<string, number> = { ...initial };
  const writes: Record<string, number> = {};
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

const baseCalc = {
  ppm: 100,
  perTray: 60,
  perBatch: 600,
  traysNeeded: 30,
  batchesNeeded: 2,
  pressDone: true,
  casesInFreezer: 0,
};

function makeV(overrides: Partial<Record<string, number>> = {}) {
  return {
    casesPerSkid: 60,
    pizzasPerCase: 12,
    casesNeeded: 100,
    freezerTime: 20, // minutes
    traysOnLine: 5,
    batchesReady: 1,
    ...overrides,
  } as any;
}

type Props = {
  nowTime: Date;
  elapsedBatchSec: number;
  v: any;
  calc: any;
  runStatus: "pending" | "running" | "paused" | "ended";
  endedAt: number | null;
};

function renderTrack(form: any, initial: Props) {
  return renderHook(
    (props: Props) =>
      useAutoTrack({
        runId: "run-1",
        runStatus: props.runStatus,
        endedAt: props.endedAt,
        nowTime: props.nowTime,
        elapsedBatchSec: props.elapsedBatchSec,
        calc: props.calc,
        v: props.v,
        form,
      }),
    { initialProps: initial },
  );
}

const total = (values: Record<string, number>, cps = 60) =>
  (values.skidsCompleted ?? 0) * cps + (values.casesOnCurrentSkid ?? 0);

describe("auto-track freezer-drain phase", () => {
  it("continues packaging during a paused Stage 3 drain without moving dough", () => {
    const t0 = 1_700_000_000_000;
    const { form, values } = makeForm({
      skidsCompleted: 1,
      casesOnCurrentSkid: 0,
      traysOnLine: 12,
      batchesReady: 2,
    });
    const pausedDrain = {
      runStatus: "paused" as const,
      endedAt: null,
      nowTime: new Date(t0 + 4 * 60_000),
      elapsedBatchSec: 20 * 60,
      packagingDrainElapsedSec: 4 * 60,
      v: makeV(),
      calc: { ...baseCalc, pressDone: true, casesInFreezer: 40 },
    };
    const { result, rerender } = renderHook(
      (props: typeof pausedDrain) =>
        useAutoTrack({
          runId: "run-1",
          ...props,
          packagingDrainActive: true,
          form,
        }),
      { initialProps: pausedDrain },
    );

    // Opening during a drain establishes the shared baseline; it must not
    // replay product that exited before this device was watching.
    expect(total(values)).toBe(60);
    rerender({
      ...pausedDrain,
      nowTime: new Date(t0 + 4 * 60_000 + 9_000),
      packagingDrainElapsedSec: 4 * 60 + 9,
    });
    rerender({
      ...pausedDrain,
      nowTime: new Date(t0 + 4 * 60_000 + 30_000),
      packagingDrainElapsedSec: 4 * 60 + 30,
    });
    expect(total(values)).toBe(64);
    expect(values.traysOnLine).toBe(12);
    expect(values.batchesReady).toBe(2);
  });

  it("keeps counting cases as the freezer drains, and product moves freezer→done without double-counting", () => {
    const t0 = 1_700_000_000_000;
    const endedAt = t0;
    // 60 cases cased at line-stop, 40 still in the tunnel; target 100.
    const { form, values } = makeForm({ skidsCompleted: 1, casesOnCurrentSkid: 0, traysOnLine: 5, batchesReady: 1 });

    const { rerender } = renderTrack(form, {
      nowTime: new Date(t0 + 1000),
      elapsedBatchSec: 600,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 40 },
      runStatus: "ended",
      endedAt,
    });

    // Mount tick: no prior freezer baseline → baseline only, no jump.
    expect(total(values)).toBe(60);

    // Next case tick (≥7.2s later): 3 cases exited the tunnel.
    rerender({
      nowTime: new Date(t0 + 9000),
      elapsedBatchSec: 609,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 37 },
      runStatus: "ended",
      endedAt,
    });
    expect(total(values)).toBe(63);
    // pressed total invariant: cased + in-freezer stays constant (100 → wait,
    // 60+40=100... use 63+37=100). No double counting.
    expect(total(values) + 37).toBe(100);

    // Another tick, 5 more exited.
    rerender({
      nowTime: new Date(t0 + 17000),
      elapsedBatchSec: 617,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 32 },
      runStatus: "ended",
      endedAt,
    });
    expect(total(values)).toBe(68);
  });

  it("stops ticking once the freezer-drain window has elapsed", () => {
    const t0 = 1_700_000_000_000;
    const endedAt = t0;
    const { form, values } = makeForm({ skidsCompleted: 1, casesOnCurrentSkid: 30, traysOnLine: 0, batchesReady: 0 });

    const { rerender } = renderTrack(form, {
      nowTime: new Date(t0 + 19 * 60000),
      elapsedBatchSec: 600,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 10 },
      runStatus: "ended",
      endedAt,
    });
    rerender({
      nowTime: new Date(t0 + 19 * 60000 + 9000),
      elapsedBatchSec: 609,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 8 },
      runStatus: "ended",
      endedAt,
    });
    expect(total(values)).toBe(92);

    // Past endedAt + freezerTime (20 min): drain over, no further writes even
    // if the freezer model were to report residue.
    rerender({
      nowTime: new Date(t0 + 21 * 60000),
      elapsedBatchSec: 660,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 0 },
      runStatus: "ended",
      endedAt,
    });
    rerender({
      nowTime: new Date(t0 + 22 * 60000),
      elapsedBatchSec: 720,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 0 },
      runStatus: "ended",
      endedAt,
    });
    expect(total(values)).toBe(92);
  });

  it("never counts past the run target even when more exits the tunnel", () => {
    const t0 = 1_700_000_000_000;
    const { form, values } = makeForm({ skidsCompleted: 1, casesOnCurrentSkid: 38, traysOnLine: 0, batchesReady: 0 });

    const { rerender } = renderTrack(form, {
      nowTime: new Date(t0 + 1000),
      elapsedBatchSec: 600,
      v: makeV({ casesNeeded: 100 }),
      calc: { ...baseCalc, casesInFreezer: 10 },
      runStatus: "ended",
      endedAt: t0,
    });
    rerender({
      nowTime: new Date(t0 + 9000),
      elapsedBatchSec: 609,
      v: makeV({ casesNeeded: 100 }),
      calc: { ...baseCalc, casesInFreezer: 4 },
      runStatus: "ended",
      endedAt: t0,
    });
    // 98 + 6 exited = 104 → capped at target 100.
    expect(total(values)).toBe(100);
  });

  it("does not tick (or back-fill) a run that ended longer than freezerTime ago", () => {
    const t0 = 1_700_000_000_000;
    const { form, values, writes } = makeForm({ skidsCompleted: 1, casesOnCurrentSkid: 0, traysOnLine: 5, batchesReady: 1 });

    // Page opens 2 hours after the run ended.
    const { rerender } = renderTrack(form, {
      nowTime: new Date(t0 + 2 * 3600_000),
      elapsedBatchSec: 600,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 0 },
      runStatus: "ended",
      endedAt: t0,
    });
    rerender({
      nowTime: new Date(t0 + 2 * 3600_000 + 10_000),
      elapsedBatchSec: 610,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 0 },
      runStatus: "ended",
      endedAt: t0,
    });
    expect(total(values)).toBe(60);
    expect(Object.keys(writes)).toHaveLength(0);
  });

  it("a fresh device opening mid-drain baselines first — no catch-up jump", () => {
    const t0 = 1_700_000_000_000;
    const { form, writes } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 55, traysOnLine: 0, batchesReady: 0 });

    // First tick mid-drain: freezer shows 20, but no prior baseline → no write.
    renderTrack(form, {
      nowTime: new Date(t0 + 10 * 60000),
      elapsedBatchSec: 600,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 20 },
      runStatus: "ended",
      endedAt: t0,
    });
    expect(Object.keys(writes)).toHaveLength(0);
  });

  it("manual corrections during the drain stick (delta stays incremental)", () => {
    const t0 = 1_700_000_000_000;
    const { form, values } = makeForm({ skidsCompleted: 1, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 });

    const { rerender } = renderTrack(form, {
      nowTime: new Date(t0 + 1000),
      elapsedBatchSec: 600,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 30 },
      runStatus: "ended",
      endedAt: t0,
    });

    // Operator corrects the count down to 50 between ticks.
    values.skidsCompleted = 0;
    values.casesOnCurrentSkid = 50;

    rerender({
      nowTime: new Date(t0 + 9000),
      elapsedBatchSec: 609,
      v: makeV(),
      calc: { ...baseCalc, casesInFreezer: 27 },
      runStatus: "ended",
      endedAt: t0,
    });
    // 3 exited on top of the corrected 50 — not on top of the old 60.
    expect(total(values)).toBe(53);
  });

  it("dough tray/batch counters never move during the drain", () => {
    const t0 = 1_700_000_000_000;
    const { form, values } = makeForm({ skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 12, batchesReady: 2 });

    const { rerender } = renderTrack(form, {
      nowTime: new Date(t0 + 1000),
      elapsedBatchSec: 600,
      v: makeV(),
      calc: { ...baseCalc, pressDone: false, casesInFreezer: 30 },
      runStatus: "ended",
      endedAt: t0,
    });
    // Several minutes of drain ticks.
    for (let i = 1; i <= 5; i++) {
      rerender({
        nowTime: new Date(t0 + 1000 + i * 60_000),
        elapsedBatchSec: 600 + i * 60,
        v: makeV(),
        calc: { ...baseCalc, pressDone: false, casesInFreezer: Math.max(0, 30 - i * 5) },
        runStatus: "ended",
        endedAt: t0,
      });
    }
    expect(values.traysOnLine).toBe(12);
    expect(values.batchesReady).toBe(2);
  });

  it("running→ended transition keeps ticking seamlessly through the drain", () => {
    const t0 = 1_700_000_000_000;
    const { form, values } = makeForm({ skidsCompleted: 1, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 });

    const { rerender } = renderTrack(form, {
      nowTime: new Date(t0),
      elapsedBatchSec: 30 * 60, // 30 min in (past the 20-min tunnel)
      v: makeV({ casesNeeded: 1000 }),
      calc: { ...baseCalc, pressDone: false, casesInFreezer: 40 },
      runStatus: "running",
      endedAt: null,
    });
    const afterRunning = total(values);

    // End the run; a tick later 2 cases exit the tunnel.
    rerender({
      nowTime: new Date(t0 + 1000),
      elapsedBatchSec: 30 * 60 + 1,
      v: makeV({ casesNeeded: 1000 }),
      calc: { ...baseCalc, casesInFreezer: 40 },
      runStatus: "ended",
      endedAt: t0 + 1000,
    });
    rerender({
      nowTime: new Date(t0 + 10_000),
      elapsedBatchSec: 30 * 60 + 10,
      v: makeV({ casesNeeded: 1000 }),
      calc: { ...baseCalc, casesInFreezer: 38 },
      runStatus: "ended",
      endedAt: t0 + 1000,
    });
    expect(total(values)).toBe(afterRunning + 2);
  });

  it("preserves the freezer baseline when End Run changes the lifecycle stamp", () => {
    const t0 = 1_700_000_000_000;
    const { form, values } = makeForm({
      skidsCompleted: 1,
      casesOnCurrentSkid: 0,
      traysOnLine: 0,
      batchesReady: 0,
    });

    const { rerender } = renderHook(
      (props: Props & { runGeneration?: string }) =>
        useAutoTrack({
          runId: "run-1",
          runGeneration: props.runGeneration,
          runStatus: props.runStatus,
          endedAt: props.endedAt,
          nowTime: props.nowTime,
          elapsedBatchSec: props.elapsedBatchSec,
          calc: props.calc,
          v: props.v,
          form,
        }),
      {
        initialProps: {
          nowTime: new Date(t0),
          elapsedBatchSec: 30 * 60,
          v: makeV({ casesNeeded: 1000 }),
          calc: { ...baseCalc, casesInFreezer: 40 },
          runStatus: "running" as const,
          endedAt: null,
          runGeneration: "running-1",
        },
      },
    );

    rerender({
      nowTime: new Date(t0 + 1000),
      elapsedBatchSec: 30 * 60 + 1,
      v: makeV({ casesNeeded: 1000 }),
      calc: { ...baseCalc, casesInFreezer: 40 },
      runStatus: "ended" as const,
      endedAt: t0 + 1000,
      runGeneration: "ended-2",
    });
    rerender({
      nowTime: new Date(t0 + 10_000),
      elapsedBatchSec: 30 * 60 + 10,
      v: makeV({ casesNeeded: 1000 }),
      calc: { ...baseCalc, casesInFreezer: 37 },
      runStatus: "ended" as const,
      endedAt: t0 + 1000,
      runGeneration: "ended-2",
    });

    // The 3 cases that exited after End Run are applied. If the generation
    // effect reset the drain baseline, this would incorrectly stay at 60.
    expect(total(values)).toBe(63);
  });
});
