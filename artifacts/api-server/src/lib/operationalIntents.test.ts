import { describe, expect, it } from "vitest";
import { applyOperationalIntent, parseOperationalIntent } from "./operationalIntents";

const run = { id: "run-1", startedAt: 100, metaUpdatedAt: 100 };
const base = () => ({ dayState: { runs: [{ ...run }] }, runValues: { "run-1": { traysOnLine: 2 } } });
const pause = { version: 1, id: "offline:one", date: "2026-01-01", runId: "run-1", observedGeneration: "run-1:100", resetEpoch: 0, effectiveAt: 200, action: "pause" } as const;

describe("operational intents", () => {
  it("applies an offline pause once and retains its outcome for restart replay", () => {
    const first = applyOperationalIntent(base(), pause, 300);
    expect(first.outcome).toBe("accepted");
    expect(first.data.dayState.runs[0].pausedAt).toBe(200);
    const replay = applyOperationalIntent(first.data, pause, 400);
    expect(replay.duplicate).toBe(true);
    expect(replay.data.dayState.runs[0].stoppages).toHaveLength(1);
  });
  it("requires review for a stale run generation and rejects malformed/cross-day dates at the boundary", () => {
    expect(applyOperationalIntent(base(), { ...pause, id: "offline:two", observedGeneration: "run-1:old" }, 300).outcome).toBe("review-required");
    expect(parseOperationalIntent({ ...pause, effectiveAt: 200_000_000 }, 300)).toBeNull();
  });
  it("accepts an exact-generation end for transactional inventory finalization", () => {
    const out = applyOperationalIntent(base(), {
      ...pause, id: "offline:end", action: "lifecycle", lifecycle: "end",
      inventoryLines: [{ itemKey: "ingredient:Flour:lbs", qty: 2 }],
    }, 300);
    expect(out.outcome).toBe("accepted");
    expect(out.data.dayState.runs[0].endedAt).toBe(200);
    const projected = {
      ...base(),
      dayState: { runs: [{ ...run, endedAt: 250 }] },
    };
    const projectedOut = applyOperationalIntent(projected, {
      ...pause, id: "offline:end-projected", action: "lifecycle", lifecycle: "end",
      inventoryLines: [],
    }, 300);
    expect(projectedOut.outcome).toBe("review-required");
    expect(projectedOut.data.dayState.runs[0].endedAt).toBe(250);
  });
  it("accepts an exact-generation correction once and requires review after a run switch", () => {
    const correction = { ...pause, id: "offline:correction", action: "correction", values: { traysOnLine: 9 } } as const;
    const first = applyOperationalIntent(base(), correction, 300);
    expect(first.outcome).toBe("accepted");
    expect(first.data.runValues["run-1"].traysOnLine).toBe(9);
    expect(applyOperationalIntent(first.data, correction, 400).duplicate).toBe(true);
    expect(applyOperationalIntent(first.data, { ...correction, id: "offline:late", observedGeneration: "run-1:old" }, 400).outcome).toBe("review-required");
  });
  it("rebases a paired offline resume by excluding paused time, but reviews a claimed interval", () => {
    const paused = applyOperationalIntent(base(), pause, 300).data;
    const resume = { ...pause, id: "offline:resume", action: "resume", effectiveAt: 260 } as const;
    const resumed = applyOperationalIntent(paused, resume, 300);
    expect(resumed.outcome).toBe("rebased");
    expect(resumed.data.dayState.runs[0].startedAt).toBe(160);
    const unsafe = { ...paused, autoTrackCoordination: { runs: { "run-1": { case: { updatedAt: 230 } } } } };
    expect(applyOperationalIntent(unsafe, { ...resume, id: "offline:unsafe" }, 300).outcome).toBe("review-required");
  });
});