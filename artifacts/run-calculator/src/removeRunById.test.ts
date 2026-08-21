import { beforeEach, describe, expect, it } from "vitest";
import type { DayState, RunMeta } from "./types";
import {
  loadDeletedItems,
  removeRunByIdFromDayState,
  tombstoneDeleted,
} from "./storage";

function day(runs: RunMeta[], currentIndex: number): DayState {
  return {
    runs,
    currentIndex,
    date: "2026-08-21",
    substitutions: [],
    substitutionLog: [],
    stagedItems: {},
  };
}

describe("removeRunById", () => {
  beforeEach(() => localStorage.clear());

  it("removes only the requested pending run, preserves survivors, and tombstones its id", () => {
    const state = day([
      { id: "run-1", brand: "Alpha", flavor: "Original" },
      { id: "run-2", brand: "Bravo", flavor: "Spicy" },
      { id: "run-3", brand: "Charlie", flavor: "Classic" },
    ], 1);

    const result = removeRunByIdFromDayState(state, "run-1");
    expect(result).not.toBeNull();
    expect(result?.dayState.runs.map((run) => run.id)).toEqual(["run-2", "run-3"]);
    expect(result?.dayState.currentIndex).toBe(0);

    tombstoneDeleted("runs", result!.removedRun.id);
    expect(loadDeletedItems().runs).toEqual(["run-1"]);
  });

  it("refocuses on the nearest remaining run when removing the current run", () => {
    const state = day([
      { id: "run-1", brand: "Alpha", flavor: "Original" },
      { id: "run-2", brand: "Bravo", flavor: "Spicy" },
      { id: "run-3", brand: "Charlie", flavor: "Classic" },
    ], 1);

    const result = removeRunByIdFromDayState(state, "run-2");
    expect(result?.removedCurrent).toBe(true);
    expect(result?.dayState.runs.map((run) => run.id)).toEqual(["run-1", "run-3"]);
    expect(result?.dayState.currentIndex).toBe(0);
  });

  it.each([
    ["active", { startedAt: 100 }],
    ["completed", { endedAt: 200 }],
  ])("does not remove an %s run", (_status, lifecycle) => {
    const state = day([
      { id: "run-1", brand: "Alpha", flavor: "Original", ...lifecycle },
      { id: "run-2", brand: "Bravo", flavor: "Spicy" },
    ], 0);

    expect(removeRunByIdFromDayState(state, "run-1")).toBeNull();
    expect(state.runs.map((run) => run.id)).toEqual(["run-1", "run-2"]);
    expect(loadDeletedItems()).toEqual({});
  });
});