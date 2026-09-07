import { describe, expect, it } from "vitest";
import {
  buildSyncWriteEnvelope,
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
    expect(isValidPartialSyncContract({ syncVersion: 1, baseSnapshotId: snapshotId })).toBe(true);
    expect(isValidPartialSyncContract({ syncVersion: 2, baseSnapshotId: snapshotId })).toBe(false);
    expect(buildSyncWriteEnvelope(data, { requestedSnapshotId: snapshotId }))
      .toEqual({ ok: true, unchanged: true, snapshotId });
    expect(buildSyncWriteEnvelope(data, { partialFallback: true }))
      .toEqual({ ok: true, data, snapshotId, partialFallback: true });
  });
});