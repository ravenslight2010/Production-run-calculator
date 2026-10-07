import { describe, expect, it } from "vitest";
import { applyOperationalIntent, parseOperationalIntent } from "./operationalIntents";

const run = { id: "run-1", startedAt: 100, metaUpdatedAt: 100 };
const base = () => ({ dayState: { runs: [{ ...run }] }, runValues: { "run-1": { traysOnLine: 2 } } });
const pause = { version: 1, id: "offline:one", date: "2026-01-01", runId: "run-1", observedGeneration: "run-1:100", resetEpoch: 0, effectiveAt: 200, action: "pause" } as const;

describe("operational intents", () => {
  it("applies an offline pause once and retains its outcome for restart replay", () => {
    const first = applyOperationalIntent(base(), pause, 300);
    expect(first.outcome).toBe("accepted");
    expect(first.data.dayState.runs[0].pausedAt).toBe(300);
    const replay = applyOperationalIntent(first.data, pause, 400);
    expect(replay.duplicate).toBe(true);
    expect(replay.data.dayState.runs[0].stoppages).toHaveLength(1);
  });
  it("strictly advances the lifecycle generation even when commands share a server millisecond", () => {
    const first = applyOperationalIntent(base(), pause, 100);
    expect(first.data.dayState.runs[0].metaUpdatedAt).toBe(101);
    const staleEnd = applyOperationalIntent(first.data, {
      ...pause,
      id: "offline:same-ms-end",
      action: "lifecycle",
      lifecycle: "end",
      inventoryLines: [],
    }, 100);
    expect(staleEnd.outcome).toBe("conflicted");
    expect(staleEnd.data.dayState.runs[0].endedAt).toBeUndefined();
  });
  it("reports a stale run generation as conflicted and rejects malformed dates at the boundary", () => {
    expect(applyOperationalIntent(base(), { ...pause, id: "offline:two", observedGeneration: "run-1:old" }, 300).outcome).toBe("conflicted");
    expect(parseOperationalIntent({ ...pause, effectiveAt: 200_000_000 }, 300)).toBeNull();
  });
  it("accepts an exact-generation end for transactional inventory finalization", () => {
    const out = applyOperationalIntent(base(), {
      ...pause, id: "offline:end", action: "lifecycle", lifecycle: "end",
      inventoryLines: [{ itemKey: "ingredient:Flour:lbs", qty: 2 }],
    }, 300);
    expect(out.outcome).toBe("accepted");
    expect(out.data.dayState.runs[0].endedAt).toBe(300);
    const projected = {
      ...base(),
      dayState: { runs: [{ ...run, endedAt: 250 }] },
    };
    const projectedOut = applyOperationalIntent(projected, {
      ...pause, id: "offline:end-projected", action: "lifecycle", lifecycle: "end",
      inventoryLines: [],
    }, 300);
    expect(projectedOut.outcome).toBe("superseded");
    expect(projectedOut.data.dayState.runs[0].endedAt).toBe(250);
  });
  it("seeds configured applicator stock once on start without reinterpreting old counters", () => {
    const pending = {
      dayState: { runs: [{ id: "run-1", metaUpdatedAt: 100 }] },
      runValues: {
        "run-1": {
          app1Type: "Cheese", app1BatchLbs: 25, app1CheeseRecipe: [],
          app2Type: "Mix", app2BatchLbs: 25,
          pep1Type: "Pepperoni", pep1TypeB: "Beef",
          app1BatchesMade: 7,
        },
      },
    };
    const start = {
      ...pause,
      id: "offline:start",
      action: "lifecycle" as const,
      lifecycle: "start" as const,
      observedGeneration: "run-1:100",
      effectiveAt: 200,
    };
    const started = applyOperationalIntent(pending, start, 300);
    expect(started.outcome).toBe("accepted");
    expect(started.data.runValues["run-1"]).toMatchObject({
      app1StockLbs: 50,
      app2StockLbs: 100,
      pep1StockLbs: 50,
      pep1bStockLbs: 50,
      app4StockLbs: 0,
      applicatorStockInitialized: true,
      app1BatchesMade: 7,
    });

    const corrected = {
      ...started.data,
      runValues: {
        ...started.data.runValues,
        "run-1": { ...started.data.runValues["run-1"], app1StockLbs: 12, app1StockCorrectionGeneration: 1 },
      },
    };
    const replay = applyOperationalIntent(corrected, {
      ...start, id: "offline:start-replay", observedGeneration: "run-1:300",
    }, 400);
    expect(replay.data.runValues["run-1"].app1StockLbs).toBe(12);
    expect(replay.data.runValues["run-1"].app1StockCorrectionGeneration).toBe(1);
  });
  it("does not initialize a previously started run during an unrelated lifecycle change", () => {
    const oldRun = {
      dayState: { runs: [{ id: "run-1", startedAt: 100, metaUpdatedAt: 100 }] },
      runValues: { "run-1": { app1Type: "Cheese", app1BatchLbs: 50, app1StockLbs: 0 } },
    };
    const result = applyOperationalIntent(oldRun, pause, 300);
    expect(result.data.runValues["run-1"].applicatorStockInitialized).toBeUndefined();
    expect(result.data.runValues["run-1"].app1StockLbs).toBe(0);
  });
  it("accepts an exact-generation correction once and requires review after a run switch", () => {
    const correction = { ...pause, id: "offline:correction", action: "correction", values: { traysOnLine: 9 } } as const;
    const first = applyOperationalIntent(base(), correction, 300);
    expect(first.outcome).toBe("accepted");
    expect(first.data.runValues["run-1"].traysOnLine).toBe(9);
    expect(applyOperationalIntent(first.data, correction, 400).duplicate).toBe(true);
    expect(applyOperationalIntent(first.data, { ...correction, id: "offline:late", observedGeneration: "run-1:old" }, 400).outcome).toBe("conflicted");
  });
  it("rebases a paired offline resume by excluding paused time, but reviews a claimed interval", () => {
    const paused = applyOperationalIntent(base(), pause, 200).data;
    const resume = { ...pause, id: "offline:resume", action: "resume", effectiveAt: 260 } as const;
    const resumed = applyOperationalIntent(paused, resume, 300);
    expect(resumed.outcome).toBe("rebased");
    expect(resumed.data.dayState.runs[0].startedAt).toBe(200);
    const unsafe = { ...paused, autoTrackCoordination: { runs: { "run-1": { case: { updatedAt: 230 } } } } };
    expect(applyOperationalIntent(unsafe, { ...resume, id: "offline:unsafe" }, 300).outcome).toBe("conflicted");
  });
});