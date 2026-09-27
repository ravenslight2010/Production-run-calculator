import { describe, expect, it } from "vitest";
import type { DayState, RunMeta } from "./types";
import {
  adoptAcceptedIntentRunLifecycle,
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

// Mirrors the server's generation() in artifacts/api-server/src/lib/operationalIntents.ts.
function serverGeneration(run: RunMeta): string {
  return `${run.id}:${String(run.metaUpdatedAt ?? run.startedAt ?? 0)}`.slice(0, 160);
}

describe("accepted operational intent adoption", () => {
  // Real numbers from the WebKit release-gate trace: the client pressed Start
  // (optimistic startedAt 1790515845593, saveDayState stamped metaUpdatedAt
  // ...594) and Pause 274ms later. The server accepted the start and stamped
  // metaUpdatedAt with its OWN clock (1790515845643), so the pause's
  // observedGeneration no longer matched and the server answered "conflicted"
  // — a terminal outbox state, which silently dropped the pause.
  const RUN_ID = "webkit_run_mujuwjpg_kqfxjxod";

  it("makes the next command's generation match the server after an accepted start", () => {
    const afterLocalStart = day([
      {
        id: RUN_ID,
        brand: "WebKit",
        flavor: "Release Smoke",
        startedAt: 1790515845593,
        metaUpdatedAt: 1790515845594,
      },
    ]);
    // The accepted start's canonical response, as the server returned it.
    const canonical = [{
      id: RUN_ID,
      brand: "WebKit",
      flavor: "Release Smoke",
      startedAt: 1790515845643,
      metaUpdatedAt: 1790515845643,
    }];

    // Before adoption the pause would have been built from the stale local
    // generation, which is exactly what the server rejected.
    expect(serverGeneration(afterLocalStart.runs[0])).not.toBe(
      serverGeneration(canonical[0]),
    );

    const result = adoptAcceptedIntentRunLifecycle(afterLocalStart, canonical, RUN_ID);

    expect(result.adopted).toBe(true);
    // The generation the next lifecycle command is built from now matches.
    expect(serverGeneration(result.dayState.runs[0])).toBe(serverGeneration(canonical[0]));
  });

  it("clears a lifecycle field the canonical copy dropped", () => {
    const local = day([{
      id: RUN_ID, brand: "W", flavor: "R",
      startedAt: 100, pausedAt: 200, pausedStoppageId: "s-1", metaUpdatedAt: 300,
    }]);
    const result = adoptAcceptedIntentRunLifecycle(local, [{
      id: RUN_ID, brand: "W", flavor: "R", startedAt: 100, metaUpdatedAt: 400,
    }], RUN_ID);

    expect(result.adopted).toBe(true);
    expect(result.dayState.runs[0].pausedAt).toBeUndefined();
    expect(result.dayState.runs[0].pausedStoppageId).toBeUndefined();
    expect(result.dayState.runs[0].metaUpdatedAt).toBe(400);
  });

  it("preserves local fields an intent response does not describe", () => {
    const local = day([{
      id: RUN_ID, brand: "W", flavor: "R",
      startedAt: 100, notes: "operator note", subTab: "dough", metaUpdatedAt: 300,
    }]);
    const result = adoptAcceptedIntentRunLifecycle(local, [{
      id: RUN_ID, brand: "W", flavor: "R", startedAt: 100, metaUpdatedAt: 400,
    }], RUN_ID);

    expect(result.adopted).toBe(true);
    expect(result.dayState.runs[0].notes).toBe("operator note");
    expect(result.dayState.runs[0].subTab).toBe("dough");
  });

  it("leaves a strictly newer local edit to the ordinary LWW merge", () => {
    const local = day([{ id: RUN_ID, brand: "W", flavor: "R", startedAt: 100, metaUpdatedAt: 500 }]);
    const result = adoptAcceptedIntentRunLifecycle(local, [{
      id: RUN_ID, brand: "W", flavor: "R", startedAt: 100, metaUpdatedAt: 400,
    }], RUN_ID);

    expect(result.adopted).toBe(false);
    expect(result.dayState).toBe(local);
  });

  it("is a no-op for an unknown run, a missing stamp, or identical state", () => {
    const local = day([{ id: RUN_ID, brand: "W", flavor: "R", startedAt: 100, metaUpdatedAt: 300 }]);
    expect(adoptAcceptedIntentRunLifecycle(local, [], RUN_ID).adopted).toBe(false);
    expect(adoptAcceptedIntentRunLifecycle(local, undefined, RUN_ID).adopted).toBe(false);
    expect(adoptAcceptedIntentRunLifecycle(local, [{ id: "other", brand: "W", flavor: "R", metaUpdatedAt: 900 }], RUN_ID).adopted).toBe(false);
    expect(adoptAcceptedIntentRunLifecycle(local, [{ id: RUN_ID, brand: "W", flavor: "R", startedAt: 100 }], RUN_ID).adopted).toBe(false);
    expect(adoptAcceptedIntentRunLifecycle(local, [{ id: RUN_ID, brand: "W", flavor: "R", startedAt: 100, metaUpdatedAt: 300 }], RUN_ID).adopted).toBe(false);
  });
});
