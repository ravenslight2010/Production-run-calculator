import { describe, expect, it } from "vitest";
import { protectRunValues } from "./protectRunValues";

describe("command-owned snapshot compatibility", () => {
  const stored = {
    dayState: { runs: [{ id: "run", startedAt: 100, pausedAt: 120, metaUpdatedAt: 125,
      stoppages: [{ id: "pause", type: "pause", startedAt: 120 }], notes: "old" }] },
    runValues: { run: { traysOnLine: 4, batchesReady: 2, app1BatchesMade: 3, casesNeeded: 100 } },
    packagingProgress: { run: { skidsCompleted: 1, casesOnCurrentSkid: 2, correctionGeneration: 2 } },
    doughTimerControls: { run: { generation: "run:125", pausedAt: 130, resumeAt: 0, updatedAt: 130 } },
  };
  it.each([false, true])("ignores old operational facts even with exact-base=%s while retaining setup", (exact) => {
    const incoming = structuredClone(stored);
    Object.assign(incoming.dayState.runs[0], { startedAt: 10, pausedAt: 0, endedAt: 999, metaUpdatedAt: 999999, notes: "new" });
    Object.assign(incoming.runValues.run, { traysOnLine: 90, batchesReady: 90, app1BatchesMade: 90, casesNeeded: 200 });
    incoming.packagingProgress.run.correctionGeneration = 99;
    incoming.doughTimerControls.run.pausedAt = 0;
    const result = protectRunValues(incoming, stored, {
      enforceOperationalAuthority: true, acceptCurrentBaseRunValueEdits: exact, nowMs: 1000,
    }) as typeof stored;
    expect(result.dayState.runs[0]).toMatchObject({ startedAt: 100, pausedAt: 120, metaUpdatedAt: 125, notes: "new" });
    expect(result.dayState.runs[0]).not.toHaveProperty("endedAt");
    expect(result.runValues.run).toMatchObject({ traysOnLine: 4, batchesReady: 2, app1BatchesMade: 3 });
    expect(result.packagingProgress).toEqual(stored.packagingProgress);
    expect(result.doughTimerControls).toEqual(stored.doughTimerControls);
  });
  it("does not finalize a first snapshot or let a tombstone delete a live run", () => {
    const first = protectRunValues({ dayState: { runs: [{ id: "new", startedAt: 1, endedAt: 2 }] },
      runValues: { new: { traysOnLine: 99 } } }, undefined, { enforceOperationalAuthority: true }) as any;
    expect(first.dayState.runs[0]).toEqual({ id: "new" });
    expect(first.runValues.new).not.toHaveProperty("traysOnLine");
    const result = protectRunValues({ dayState: { runs: [] }, runValues: {}, deletedItems: { runs: ["run"] } },
      stored, { enforceOperationalAuthority: true }) as any;
    expect(result.dayState.runs).toContainEqual(stored.dayState.runs[0]);
    expect(result.runValues.run).toMatchObject(stored.runValues.run);
    expect(result.deletedItems.runs).toEqual([]);
  });
});
