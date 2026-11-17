import { describe, expect, it } from "vitest";
import type { DayState, RunMeta } from "./types";
import {
  adoptStrictlyNewerRemoteLifecycles,
  selectInboundRunLifecycles,
  shouldKeepLocalRunLifecycle,
} from "./storage";

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

  it("keeps an active pause when a delayed running snapshot has the same start", () => {
    const paused = {
      id: "run-1",
      brand: "A",
      flavor: "B",
      startedAt: 100,
      pausedAt: 200,
      metaUpdatedAt: 200,
    };
    // A late copy of the run may carry a later wall-clock stamp from another
    // device, but with the same start and no ended/paused lifecycle it cannot
    // represent a real resume. Resuming shifts startedAt forward.
    const staleRunning = {
      id: "run-1",
      brand: "A",
      flavor: "B",
      startedAt: 100,
      metaUpdatedAt: 300,
    };

    expect(shouldKeepLocalRunLifecycle(paused, staleRunning)).toBe(true);

    const result = adoptStrictlyNewerRemoteLifecycles(
      day([paused]),
      [staleRunning],
    );
    expect(result.adoptedRunIds).toEqual([]);
    expect(result.dayState.runs[0]).toEqual(paused);

    // This is the ordinary inbound sync path used while restoring a reloaded
    // page: keep the persisted pause and re-push it instead of showing a full,
    // running line from the stale server snapshot.
    expect(selectInboundRunLifecycles([paused], [staleRunning]))
      .toEqual([paused]);
  });

  it("still accepts a real resume because it advances the effective start", () => {
    const paused = {
      id: "run-1",
      brand: "A",
      flavor: "B",
      startedAt: 100,
      pausedAt: 200,
      metaUpdatedAt: 200,
    };
    const resumed = {
      id: "run-1",
      brand: "A",
      flavor: "B",
      startedAt: 300,
      metaUpdatedAt: 300,
    };

    expect(shouldKeepLocalRunLifecycle(paused, resumed)).toBe(false);
    expect(adoptStrictlyNewerRemoteLifecycles(day([paused]), [resumed]))
      .toMatchObject({ adoptedRunIds: ["run-1"] });
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