import { describe, expect, it } from "vitest";
import {
  buildSyncWriteEnvelope,
  buildSyncPeerDelta,
  syncWireBytes,
  canonicalSyncJson,
  emptySyncData,
  isValidPartialSyncContract,
  syncSnapshotId,
} from "./syncContract";

describe("sync contract", () => {
  it("uses canonical object ordering for document identity", () => {
    expect(syncSnapshotId({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(syncSnapshotId({ a: { c: 3, d: 4 }, b: 2 }));
    expect(canonicalSyncJson([{ b: 2, a: 1 }])).toBe('[{"a":1,"b":2}]');
  });

  it("provides the canonical empty day-state document", () => {
    expect(emptySyncData("2026-09-06")).toEqual({
      dayState: { date: "2026-09-06", runs: [] },
      runValues: {},
      runValuesUpdatedAt: {},
    });
  });

  it("validates partial protocol dependencies and classifies acknowledgements", () => {
    const data = emptySyncData("2026-09-06");
    const snapshotId = syncSnapshotId(data);
    expect(isValidPartialSyncContract({
      syncVersion: 1, baseSnapshotId: snapshotId, resultingSnapshotId: snapshotId,
    })).toBe(true);
    expect(isValidPartialSyncContract({
      syncVersion: 2, baseSnapshotId: snapshotId, resultingSnapshotId: snapshotId,
    })).toBe(false);
    expect(buildSyncWriteEnvelope(data, { requestedSnapshotId: snapshotId }))
      .toEqual({ ok: true, unchanged: true, snapshotId });
    expect(buildSyncWriteEnvelope(data, { partialFallback: true }))
      .toEqual({ ok: true, data, snapshotId, partialFallback: true });
  });

  it("builds sparse keyed deltas with explicit tombstones", () => {
    const before = {
      dayState: { date: "2026-09-06", runs: [] },
      runValues: { a: { casesNeeded: 1 }, removed: { casesNeeded: 2 } },
      runValuesUpdatedAt: { a: 1, removed: 1 },
      packagingProgress: { a: { completed: 1 } },
      history: [{ id: "old" }],
    };
    const after = {
      ...before,
      runValues: { a: { casesNeeded: 3 }, added: { casesNeeded: 4 } },
      runValuesUpdatedAt: { a: 2, added: 2 },
      packagingProgress: { a: { completed: 2 } },
      history: [{ id: "new" }],
    };
    const delta = buildSyncPeerDelta(before, after)!;
    expect(delta.completeness).toBe("partial");
    expect(delta.baseSnapshotId).toBe(syncSnapshotId(before));
    expect(delta.resultingSnapshotId).toBe(syncSnapshotId(after));
    expect(delta.runValues).toEqual({
      a: { casesNeeded: 3 }, removed: null, added: { casesNeeded: 4 },
    });
    expect(delta.runValuesUpdatedAt).toEqual({ a: 2, removed: null, added: 2 });
    expect(delta.packagingProgress).toEqual({ a: { completed: 2 } });
    expect(delta.history).toEqual([{ id: "new" }]);
  });

  it("is materially smaller for a one-run change in a 32-run document", () => {
    const runs = Array.from({ length: 32 }, (_, i) => ({ id: `run-${i}`, brand: "Acme", flavor: "Pep" }));
    const values = Object.fromEntries(runs.map((run) => [
      run.id, { casesNeeded: 100, doughRecipe: Array.from({ length: 8 }, (_, n) => ({ ingredient: `ingredient-${n}`, lbs: n + 1 })) },
    ]));
    const before = {
      dayState: { date: "2026-09-06", runs },
      runValues: values,
      runValuesUpdatedAt: Object.fromEntries(runs.map((run) => [run.id, 1])),
    };
    const after = {
      ...before,
      runValues: { ...values, "run-0": { ...values["run-0"], casesNeeded: 101 } },
      runValuesUpdatedAt: { ...before.runValuesUpdatedAt, "run-0": 2 },
    };
    const delta = buildSyncPeerDelta(before, after)!;
    const {
      syncVersion,
      completeness,
      baseSnapshotId,
      resultingSnapshotId,
      ...data
    } = delta;
    const partialFrame = {
      syncVersion,
      completeness,
      baseSnapshotId,
      resultingSnapshotId,
      snapshotId: resultingSnapshotId,
      senderId: "peer-a",
      data,
      canonicalRevision: 1,
      serverTime: 1,
    };
    const completeFrame = {
      completeness: "complete",
      snapshotId: resultingSnapshotId,
      senderId: "peer-a",
      data: after,
      canonicalRevision: 1,
      serverTime: 1,
    };
    expect(syncWireBytes(partialFrame) * 2).toBeLessThan(syncWireBytes(completeFrame));
  });
});