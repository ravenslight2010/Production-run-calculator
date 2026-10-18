import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES, type DayState, type SyncPayload } from "../types";
import {
  acceptRemoteRunValueOnSync,
  reconcileOperationalIntentCanonical,
  serverOwnedApp1BatchProgress,
  shouldKeepLocalRunLifecycle,
} from "./runSyncPolicy";

describe("operational intent forced canonical reconciliation", () => {
  it("restores a stale correction without overwriting unrelated values", () => {
    const local = {
      ...DEFAULT_VALUES,
      traysOnLine: 9,
      batchesReady: 4,
      casesNeeded: 800,
    };
    const canonical = {
      ...local,
      traysOnLine: 3,
      batchesReady: 2,
      casesNeeded: 700,
    };
    const payload = {
      dayState: { runs: [] },
      runValues: { run1: canonical },
      runValuesUpdatedAt: { run1: 40 },
    } as SyncPayload;

    const result = reconcileOperationalIntentCanonical({
      dayState: { runs: [], currentIndex: 0 },
      runValues: local,
      runValuesUpdatedAt: { run1: 90 },
      payload,
      intent: {
        runId: "run1",
        action: "correction",
        values: { traysOnLine: 9, batchesReady: 4 },
      },
      outcome: "review-required",
    });

    expect(result.runValues).toMatchObject({
      traysOnLine: 3,
      batchesReady: 2,
      casesNeeded: 800,
    });
    expect(result.runValuesUpdatedAt.run1).toBe(40);
    expect(acceptRemoteRunValueOnSync(
      canonical,
      result.runValues,
      payload.runValuesUpdatedAt!.run1,
      result.runValuesUpdatedAt.run1,
    )).toBe(true);
  });

  it("restores canonical running lifecycle after an offline end review", () => {
    const localDay: DayState = {
      runs: [
        {
          id: "run1",
          brand: "Keep Brand",
          flavor: "Keep Flavor",
          startedAt: 10,
          endedAt: 99,
          notes: "unrelated local note",
          metaUpdatedAt: 90,
        },
        { id: "run2", brand: "Other", flavor: "Run", startedAt: 5, metaUpdatedAt: 80 },
      ],
      currentIndex: 0,
    };
    const canonicalRun = {
      id: "run1",
      brand: "server brand must not replace unrelated metadata",
      flavor: "server flavor",
      startedAt: 10,
      metaUpdatedAt: 40,
    };
    const payload = {
      dayState: { runs: [canonicalRun] },
      runValues: { run1: DEFAULT_VALUES },
      runValuesUpdatedAt: { run1: 20 },
    } as SyncPayload;

    const result = reconcileOperationalIntentCanonical({
      dayState: localDay,
      runValues: DEFAULT_VALUES,
      runValuesUpdatedAt: { run1: 20 },
      payload,
      intent: { runId: "run1", action: "lifecycle", lifecycle: "end" },
      outcome: "rebased",
    });

    expect(result.dayState.runs[0]).toMatchObject({
      id: "run1",
      brand: "Keep Brand",
      flavor: "Keep Flavor",
      notes: "unrelated local note",
      startedAt: 10,
      metaUpdatedAt: 40,
    });
    expect(result.dayState.runs[0].endedAt).toBeUndefined();
    expect(result.dayState.runs[1]).toBe(localDay.runs[1]);
    expect(shouldKeepLocalRunLifecycle(result.dayState.runs[0], canonicalRun)).toBe(false);
  });

  it("restores canonical lifecycle for an explicit conflict despite a newer optimistic browser stamp", () => {
    const localDay: DayState = {
      runs: [{ id: "run1", brand: "Acme", flavor: "Pep", startedAt: 10, endedAt: 99, metaUpdatedAt: 999 }],
      currentIndex: 0,
    };
    const canonicalRun = {
      id: "run1", brand: "Acme", flavor: "Pep", startedAt: 10, metaUpdatedAt: 40,
    };
    const result = reconcileOperationalIntentCanonical({
      dayState: localDay,
      runValues: DEFAULT_VALUES,
      runValuesUpdatedAt: { run1: 20 },
      payload: {
        dayState: { runs: [canonicalRun] },
        runValues: { run1: DEFAULT_VALUES },
        runValuesUpdatedAt: { run1: 20 },
      },
      intent: { runId: "run1", action: "lifecycle", lifecycle: "end" },
      outcome: "conflicted",
    });
    expect(result.lifecycleChanged).toBe(true);
    expect(result.dayState.runs[0].endedAt).toBeUndefined();
    expect(result.dayState.runs[0].metaUpdatedAt).toBe(40);
  });

  it("adopts the server-owned stamp for an accepted atomic End", () => {
    const localDay: DayState = {
      runs: [{ id: "run1", brand: "Acme", flavor: "Pep", startedAt: 10, endedAt: 90, metaUpdatedAt: 91 }],
      currentIndex: 0,
    };
    const canonicalRun = {
      id: "run1", brand: "Acme", flavor: "Pep", startedAt: 10, endedAt: 90, metaUpdatedAt: 120,
    };
    const result = reconcileOperationalIntentCanonical({
      dayState: localDay,
      runValues: DEFAULT_VALUES,
      runValuesUpdatedAt: { run1: 20 },
      payload: {
        dayState: { runs: [canonicalRun] },
        runValues: { run1: DEFAULT_VALUES },
        runValuesUpdatedAt: { run1: 20 },
      },
      intent: { runId: "run1", action: "lifecycle", lifecycle: "end" },
      outcome: "accepted",
    });
    expect(result.lifecycleChanged).toBe(true);
    expect(result.dayState.runs[0]).toMatchObject({ endedAt: 90, metaUpdatedAt: 120 });
  });
});

describe("server-owned App 1 batch sync convergence", () => {
  const canonicalPayload = {
    runValues: {
      run1: {
        ...DEFAULT_VALUES,
        app1BatchesMade: 3,
        app1BatchCorrectionGeneration: 2,
      },
    },
    runValuesUpdatedAt: { run1: 40 },
    autoTrackCoordination: {
      version: 1 as const,
      runs: {
        run1: {
          "app1-batch": {
            generation: "run1:10",
            sequence: 3,
            nextDueAt: 5_000,
            acceptedEventId: "srv:wc:app1-batch:accepted",
            acceptedRunValuesUpdatedAt: 40,
            updatedAt: 40,
          },
        },
      },
    },
    autoTrackServerState: {
      netOwnership: {
        run1: { "app1-batch": { generation: "run1:10", sequence: 3, updatedAt: 40 } },
      },
    },
  };

  it("adopts only the verified App 1 counter despite an unrelated newer local edit", () => {
    const local = {
      ...DEFAULT_VALUES,
      app1BatchesMade: 2,
      app1BatchCorrectionGeneration: 2,
      cheeseOzPerPizza: 6,
    };
    expect(acceptRemoteRunValueOnSync(
      canonicalPayload.runValues.run1,
      local,
      40,
      50,
    )).toBe(false);

    const progress = serverOwnedApp1BatchProgress(canonicalPayload, "run1", local);
    expect(progress).toEqual({ app1BatchesMade: 3 });
    expect({ ...local, ...progress }).toMatchObject({
      app1BatchesMade: 3,
      app1BatchCorrectionGeneration: 2,
      cheeseOzPerPizza: 6,
    });
  });

  it("does not bypass a newer local manual correction or an unproven projection", () => {
    const correctedLocally = {
      ...DEFAULT_VALUES,
      app1BatchesMade: 1,
      app1BatchCorrectionGeneration: 3,
    };
    expect(serverOwnedApp1BatchProgress(
      canonicalPayload,
      "run1",
      correctedLocally,
    )).toBeNull();

    expect(serverOwnedApp1BatchProgress({
      ...canonicalPayload,
      autoTrackServerState: undefined,
    }, "run1", {
      ...DEFAULT_VALUES,
      app1BatchesMade: 2,
      app1BatchCorrectionGeneration: 2,
    })).toBeNull();
    expect(serverOwnedApp1BatchProgress({
      ...canonicalPayload,
      autoTrackServerState: {
        netOwnership: {
          run1: { "app1-batch": { generation: "run1:10", sequence: 2, updatedAt: 40 } },
        },
      },
    }, "run1", {
      ...DEFAULT_VALUES,
      app1BatchesMade: 2,
      app1BatchCorrectionGeneration: 2,
    })).toBeNull();
  });
});