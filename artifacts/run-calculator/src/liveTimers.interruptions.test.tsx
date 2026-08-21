/**
 * Live timer interruption regression coverage.
 *
 * These tests model the values that the live form autosaves without waiting on
 * real time. The hook's rendered inputs and the fake persisted store are
 * asserted together so a lifecycle interruption cannot hide a bookkeeping
 * mismatch.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { UseFormReturn } from "react-hook-form";
import { useAutoTrack } from "./hooks/useAutoTrack";
import type { FormValues } from "./types";

const T0 = 1_700_000_000_000;
const CASE_PERIOD_MS = 6_000;
const TRAY_PERIOD_MS = 120_000;

const calc = {
  ppm: 100,
  perTray: 200,
  perBatch: 1_200,
  traysNeeded: 5,
  batchesNeeded: 2,
  pressDone: false,
  casesInFreezer: 0,
};

const baseValues = {
  casesPerSkid: 10,
  pizzasPerCase: 10,
  casesNeeded: 100,
  freezerTime: 10,
  traysOnLine: 5,
  batchesReady: 2,
};

function makePersistedForm(initial: {
  runId: string;
  skidsCompleted?: number;
  casesOnCurrentSkid?: number;
  traysOnLine?: number;
  batchesReady?: number;
}) {
  const values: Record<string, number> = {
    skidsCompleted: initial.skidsCompleted ?? 0,
    casesOnCurrentSkid: initial.casesOnCurrentSkid ?? 0,
    traysOnLine: initial.traysOnLine ?? 5,
    batchesReady: initial.batchesReady ?? 2,
  };
  const persisted: Record<string, Record<string, number>> = {
    [initial.runId]: { ...values },
  };
  let activeRunId = initial.runId;

  const form = {
    getValues: vi.fn((name: string) => values[name] ?? 0),
    setValue: vi.fn((name: string, value: number) => {
      values[name] = value;
      persisted[activeRunId] = { ...values };
    }),
  } as unknown as UseFormReturn<FormValues>;

  return {
    form,
    values,
    persisted,
    switchPersistedRun(runId: string, nextValues: Partial<typeof values> = {}) {
      activeRunId = runId;
      Object.assign(values, {
        skidsCompleted: 0,
        casesOnCurrentSkid: 0,
        traysOnLine: 5,
        batchesReady: 2,
        ...nextValues,
      });
      persisted[runId] = { ...values };
    },
  };
}

function totalCases(values: Record<string, number>) {
  return values.skidsCompleted * 10 + values.casesOnCurrentSkid;
}

describe("live timer interruption invariants", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads an active run from persisted counters without seeding or double-counting", () => {
    const state = makePersistedForm({
      runId: "run-reload",
      skidsCompleted: 3,
      casesOnCurrentSkid: 1,
    });
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, elapsedBatchSec: number): Props => ({
      runId: "run-reload",
      runStatus: "running",
      nowTime: new Date(nowMs),
      elapsedBatchSec,
      calc,
      v: { ...baseValues, traysOnLine: state.values.traysOnLine, batchesReady: state.values.batchesReady },
      form: state.form,
    });

    const first = renderHook((p: Props) => useAutoTrack(p), {
      initialProps: props(T0, 780),
    });
    expect(totalCases(state.values)).toBe(31);
    expect(state.persisted["run-reload"]).toMatchObject({ skidsCompleted: 3, casesOnCurrentSkid: 1 });

    // A page reload remounts the hook against the same persisted form values.
    first.unmount();
    const reloaded = renderHook((p: Props) => useAutoTrack(p), {
      initialProps: props(T0 + 500, 780),
    });
    expect(totalCases(state.values)).toBe(31);
    expect(state.persisted["run-reload"]).toMatchObject({ skidsCompleted: 3, casesOnCurrentSkid: 1 });

    // Only the next ordinary case interval may add one case.
    act(() => {
      reloaded.rerender(props(T0 + 500 + CASE_PERIOD_MS + 1, 787));
    });
    expect(totalCases(state.values)).toBe(32);
    expect(totalCases(state.values)).toBe(totalCases(state.persisted["run-reload"]));
  });

  it("rebases on a run switch so the next run cannot inherit the prior run's delta", () => {
    const state = makePersistedForm({
      runId: "run-a",
      skidsCompleted: 3,
      casesOnCurrentSkid: 1,
    });
    type Props = Parameters<typeof useAutoTrack>[0];
    let activeRunId = "run-a";
    const props = (nowMs: number, elapsedBatchSec: number): Props => ({
      runId: activeRunId,
      runStatus: "running",
      nowTime: new Date(nowMs),
      elapsedBatchSec,
      calc,
      v: { ...baseValues, traysOnLine: state.values.traysOnLine, batchesReady: state.values.batchesReady },
      form: state.form,
    });

    const hook = renderHook((p: Props) => useAutoTrack(p), {
      initialProps: props(T0, 780),
    });
    expect(totalCases(state.values)).toBe(31);

    activeRunId = "run-b";
    state.switchPersistedRun("run-b", {
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      traysOnLine: 4,
      batchesReady: 1,
    });
    act(() => {
      hook.rerender(props(T0 + 500, 900));
    });

    // Run B seeds only from its own timeline; run A's 31 cases are not added.
    expect(totalCases(state.values)).toBe(50);
    expect(totalCases(state.persisted["run-a"])).toBe(31);
    expect(totalCases(state.values)).toBe(totalCases(state.persisted["run-b"]));

    // A normal B tick advances B by one case and still leaves A untouched.
    act(() => {
      hook.rerender(props(T0 + 500 + CASE_PERIOD_MS + 1, 907));
    });
    expect(totalCases(state.values)).toBe(51);
    expect(totalCases(state.persisted["run-a"])).toBe(31);
    expect(totalCases(state.persisted["run-b"])).toBe(51);
  });

  it("keeps the rendered counters and persisted values aligned through a pause and resume", () => {
    const state = makePersistedForm({ runId: "run-pause", traysOnLine: 5, batchesReady: 2 });
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (status: "running" | "paused", nowMs: number): Props => ({
      runId: "run-pause",
      runStatus: status,
      nowTime: new Date(nowMs),
      elapsedBatchSec: 700,
      calc,
      v: { ...baseValues, traysOnLine: state.values.traysOnLine, batchesReady: state.values.batchesReady },
      form: state.form,
    });

    const hook = renderHook((p: Props) => useAutoTrack(p), {
      initialProps: props("running", T0),
    });
    const traysBeforePause = state.values.traysOnLine;
    const batchesBeforePause = state.values.batchesReady;
    expect(state.persisted["run-pause"]).toMatchObject({
      traysOnLine: traysBeforePause,
      batchesReady: batchesBeforePause,
    });

    act(() => {
      hook.rerender(props("paused", T0 + 1));
      hook.rerender(props("paused", T0 + 5 * 60_000));
    });
    expect(state.values.traysOnLine).toBe(traysBeforePause);
    expect(state.values.batchesReady).toBe(batchesBeforePause);
    expect(state.persisted["run-pause"]).toMatchObject({
      traysOnLine: traysBeforePause,
      batchesReady: batchesBeforePause,
    });

    act(() => {
      hook.rerender(props("running", T0 + 5 * 60_000 + 2));
    });
    expect(traysBeforePause - state.values.traysOnLine).toBe(1);
    expect(state.persisted["run-pause"]).toMatchObject({
      traysOnLine: state.values.traysOnLine,
      batchesReady: state.values.batchesReady,
    });
  });

  it("stops dough consumption exactly at press completion", () => {
    const state = makePersistedForm({ runId: "run-complete", traysOnLine: 5, batchesReady: 2 });
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (pressDone: boolean, nowMs: number): Props => ({
      runId: "run-complete",
      runStatus: "running",
      nowTime: new Date(nowMs),
      elapsedBatchSec: 700,
      calc: { ...calc, pressDone },
      v: { ...baseValues, traysOnLine: state.values.traysOnLine, batchesReady: state.values.batchesReady },
      form: state.form,
    });

    const hook = renderHook((p: Props) => useAutoTrack(p), {
      initialProps: props(false, T0),
    });
    const completedTrays = state.values.traysOnLine;
    const completedBatches = state.values.batchesReady;

    // Completion is count-based. Once it flips true, neither the next tray
    // boundary nor a long wake interval may decrement dough supply.
    act(() => {
      hook.rerender(props(true, T0 + TRAY_PERIOD_MS + 1));
      hook.rerender(props(true, T0 + 10 * TRAY_PERIOD_MS + 1));
    });
    expect(state.values.traysOnLine).toBe(completedTrays);
    expect(state.values.batchesReady).toBe(completedBatches);
    expect(state.persisted["run-complete"]).toMatchObject({
      traysOnLine: completedTrays,
      batchesReady: completedBatches,
    });
  });
});