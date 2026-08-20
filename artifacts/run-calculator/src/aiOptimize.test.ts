import { describe, expect, it } from "vitest";
import { buildOptimizeRun } from "./aiOptimize";
import { DEFAULT_VALUES, type FormValues, type RunMeta } from "./types";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

function values(overrides: Partial<FormValues> = {}): FormValues {
  return {
    ...DEFAULT_VALUES,
    casesNeeded: 500,
    crustsPerCycle: 3,
    cycleSpeed: 10,
    speedAdjustment: 1,
    pizzasPerCase: 10,
    casesPerSkid: 20,
    freezerTime: 14.9,
    skidsCompleted: 9,
    casesOnCurrentSkid: 17,
    ...overrides,
  };
}

function run(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    id: "run-1",
    brand: "Acme",
    flavor: "Cheese",
    subTab: "dough",
    startedAt: NOW - 74 * MIN,
    ...overrides,
  };
}

describe("buildOptimizeRun — freezer/on-line progress", () => {
  it("keeps 197 recorded cases separate from 44 lifecycle-aware on-line cases", () => {
    const output = buildOptimizeRun(run(), values(), NOW);

    expect(output.plannedPpm).toBe(30);
    expect(output.netElapsedSec).toBe(74 * 60);
    expect(output.casesMade).toBe(197);
    expect(output.casesOnLine).toBe(44);
    expect(output.casesLeft).toBe(303);
  });

  it("freezes WIP at the pause moment instead of counting paused wall time", () => {
    const startedAt = NOW - 60 * MIN;
    const output = buildOptimizeRun(
      run({ startedAt, pausedAt: startedAt + 10 * MIN }),
      values({ freezerTime: 30 }),
      NOW,
    );

    expect(output.casesMade).toBe(197);
    expect(output.netElapsedSec).toBe(10 * 60);
    expect(output.casesOnLine).toBe(30);
  });

  it("excludes a pause still open when the run ends from net elapsed time", () => {
    const startedAt = NOW - 70 * MIN;
    const pauseStartedAt = startedAt + 10 * MIN;
    const endedAt = startedAt + 60 * MIN;
    const output = buildOptimizeRun(
      run({
        startedAt,
        endedAt,
        actualCases: 30,
        stoppages: [{ id: "pause-1", type: "pause", reason: "Break", startedAt: pauseStartedAt }],
      }),
      values({ freezerTime: 30 }),
      NOW,
    );

    expect(output.netElapsedSec).toBe(10 * 60);
    expect(output.casesOnLine).toBe(30);
  });

  it("keeps draining WIP after a run ends without adding it to recorded output", () => {
    const startedAt = NOW - 70 * MIN;
    const endedAt = NOW - 10 * MIN;
    const output = buildOptimizeRun(
      run({ startedAt, endedAt, actualCases: 197 }),
      values({ freezerTime: 30 }),
      NOW,
    );

    expect(output.status).toBe("finished");
    expect(output.casesMade).toBe(197);
    expect(output.casesOnLine).toBe(60);
  });
});