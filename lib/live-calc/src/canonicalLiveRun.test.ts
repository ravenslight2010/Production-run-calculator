import { describe, expect, it } from "vitest";
import {
  buildOperationalProjection,
  computeAutoTrackSchedule,
  computeServerCalc,
  computeSharedServerCalc,
  selectCanonicalLiveRun,
  type CalcFormValues,
} from "./index";

const NOW = 1_800_000_000_000;
const previous = { id: "old", startedAt: NOW - 900_000, endedAt: NOW - 60_000 };
const active = { id: "live", startedAt: NOW - 30_000, subTab: "crusts" };
const pending = { id: "next" };
const values = {
  old: { casesNeeded: 100, approxLineSpeed: 30, pizzasPerCase: 6, freezerTime: 12 },
  live: {
    casesNeeded: 200, approxLineSpeed: 90, pizzasPerCase: 12, freezerTime: 7,
    casesPerSkid: 40, sauceOzPerPizza: 2, sauceBarrelLbs: 50,
    tempFreezerTime: 9,
  },
};
const payload = {
  dayState: { runs: [previous, active, pending] },
  runValues: values,
  packagingProgress: { live: { skidsCompleted: 1, casesOnCurrentSkid: 3 } },
};

describe("canonical shared live-run calculations", () => {
  it("reproduces the index-zero error and calculates the later active run with its own settings", () => {
    // Explicit-run callers retain the old API; it demonstrates why canonical
    // payloads without a device selection must not use that API directly.
    expect(computeServerCalc(payload, [], NOW)?.runId).toBe("old");
    const before = JSON.stringify(payload);
    const actual = computeSharedServerCalc(payload, [], NOW)!;
    const explicit = computeServerCalc({
      ...payload, dayState: { ...payload.dayState, currentIndex: 1 },
    }, [], NOW)!;
    expect(actual).toEqual(explicit);
    expect(actual.runId).toBe("live");
    expect(actual.calc.ppm).toBe(90);
    expect(actual.calc.casesCompleted).toBe(43);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it.each([-1, 0, 2, 99])("ignores a legacy device selection of %s", (currentIndex) => {
    expect(computeSharedServerCalc({
      ...payload, dayState: { ...payload.dayState, currentIndex },
    }, [], NOW)?.runId).toBe("live");
  });

  it("keeps paused runs, chooses the latest active lifecycle, and breaks ties by schedule order", () => {
    const paused = { ...active, id: "paused", pausedAt: NOW };
    expect(selectCanonicalLiveRun([active, paused, pending])).toBe(paused);
    expect(selectCanonicalLiveRun([paused, { ...active, startedAt: NOW - 100_000 }])).toBe(paused);
  });

  it("retains the latest ended run for drain, then uses first pending only on an unstarted day", () => {
    const ended = { ...active, endedAt: NOW - 1_000 };
    expect(selectCanonicalLiveRun([previous, ended, pending])).toBe(ended);
    expect(selectCanonicalLiveRun([pending, { id: "next-2" }])).toBe(pending);
    expect(selectCanonicalLiveRun([])).toBeUndefined();
  });

  it("does not substitute old values when the active run has none", () => {
    expect(computeSharedServerCalc({ ...payload, runValues: { old: values.old } }, [], NOW)).toBeNull();
  });

  it("binds projection lifecycle/timing to the calculation ID, not currentIndex", () => {
    const serverCalc = computeSharedServerCalc(payload, [], NOW)!;
    const schedule = computeAutoTrackSchedule({
      runId: active.id, startedAt: active.startedAt, nowMs: NOW,
      v: values.live as CalcFormValues, calc: serverCalc.calc,
    });
    const projection = buildOperationalProjection({ payload, serverCalc, schedule, nowMs: NOW });
    expect(projection.runId).toBe("live");
    expect(projection.facts.runStatus).toBe("running");
    expect(projection.effectiveElapsedSec).toBe(30);
    expect(projection.timers.freezerElapsedSec + projection.timers.freezerRemainingSec).toBe(9 * 60);
    expect(projection.lifecycleGeneration).toBe(schedule.generation);
    expect(projection.calc).toEqual(serverCalc.calc);
    expect(() => buildOperationalProjection({
      payload, serverCalc, schedule: { ...schedule, runId: "old" }, nowMs: NOW,
    })).toThrow(/matching run/);
    expect(() => buildOperationalProjection({
      payload, serverCalc, schedule: { ...schedule, generation: "live:old" }, nowMs: NOW,
    })).toThrow(/matching run/);
    expect(() => buildOperationalProjection({
      payload: { dayState: { runs: [] } }, serverCalc, schedule, nowMs: NOW,
    })).toThrow(/matching run/);
  });
});
