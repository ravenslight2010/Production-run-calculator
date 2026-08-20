import { describe, expect, it } from "vitest";
import type { DayState, RunMeta } from "./types";
import { adoptStrictlyNewerRemoteLifecycles } from "./storage";

function day(runs: RunMeta[], currentIndex = 0): DayState {
  return {
    runs,
    currentIndex,
    date: "2026-08-20",
    substitutions: [],
    substitutionLog: [],
    stagedItems: {},
  };
}

describe("foreground lifecycle adoption", () => {
  it("atomically adopts a strictly-newer remote Stop for the selected run", () => {
    const local = day([
      { id: "run-1", brand: "A", flavor: "B", startedAt: 100, metaUpdatedAt: 200 },
      { id: "run-2", brand: "C", flavor: "D" },
    ]);
    const stopped = {
      id: "run-1",
      brand: "A",
      flavor: "B",
      startedAt: 100,
      endedAt: 300,
      metaUpdatedAt: 400,
    };

    const result = adoptStrictlyNewerRemoteLifecycles(local, [stopped]);

    expect(result.adoptedRunIds).toEqual(["run-1"]);
    expect(result.dayState.runs[0]).toEqual(stopped);
    expect(result.dayState.currentIndex).toBe(0);
    expect(local.runs[0].endedAt).toBeUndefined();
  });

  it("does not introduce stop-wins behavior for equal or older stamps", () => {
    const running = {
      id: "run-1",
      brand: "A",
      flavor: "B",
      startedAt: 100,
      metaUpdatedAt: 500,
    };
    const local = day([running]);

    for (const stamp of [400, 500]) {
      const result = adoptStrictlyNewerRemoteLifecycles(local, [{
        ...running,
        endedAt: 300,
        metaUpdatedAt: stamp,
      }]);
      expect(result.adoptedRunIds).toEqual([]);
      expect(result.dayState).toBe(local);
    }
  });

  it("leaves progress-only remote changes to the run-value merge", () => {
    const running = {
      id: "run-1",
      brand: "A",
      flavor: "B",
      startedAt: 100,
      notes: "local",
      metaUpdatedAt: 500,
    };
    const local = day([running]);
    const result = adoptStrictlyNewerRemoteLifecycles(local, [{
      ...running,
      notes: "remote",
      metaUpdatedAt: 600,
    }]);

    expect(result.adoptedRunIds).toEqual([]);
    expect(result.dayState).toBe(local);
  });
});