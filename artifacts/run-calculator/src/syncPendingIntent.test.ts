import { describe, expect, it } from "vitest";
import {
  clearPendingSyncIntent,
  loadPendingSyncIntent,
  savePendingSyncIntent,
} from "./syncPendingIntent";
import type { SyncPayload } from "./types";

const payload: SyncPayload = {
  dayState: { date: "2030-01-01", runs: [{ id: "run-1" }] },
  runValues: { "run-1": { casesNeeded: 20 } },
};

describe("durable pending sync intent", () => {
  it("survives reload and remains scoped by identity and date", () => {
    const intent = {
      version: 1 as const,
      id: "intent-1",
      scope: "live:user-a",
      date: "2030-01-01",
      epoch: 4,
      baseSnapshotId: "snapshot-1",
      baseline: payload,
      payload,
    };
    expect(savePendingSyncIntent(intent)).toBe(true);
    expect(loadPendingSyncIntent("live:user-a", "2030-01-01")).toEqual(intent);
    expect(loadPendingSyncIntent("sandbox:user-a", "2030-01-01")).toBeNull();
    expect(loadPendingSyncIntent("live:user-a", "2030-01-02")).toBeNull();
  });

  it("only clears the matching acknowledged intent", () => {
    const intent = {
      version: 1 as const,
      id: "intent-2",
      scope: "live:user-b",
      date: "2030-01-01",
      epoch: 1,
      baseSnapshotId: "snapshot-2",
      baseline: payload,
      payload,
    };
    expect(savePendingSyncIntent(intent)).toBe(true);
    expect(clearPendingSyncIntent(intent.scope, intent.date, "older-intent")).toBe(false);
    expect(loadPendingSyncIntent(intent.scope, intent.date)).toEqual(intent);
    expect(clearPendingSyncIntent(intent.scope, intent.date, intent.id)).toBe(true);
    expect(loadPendingSyncIntent(intent.scope, intent.date)).toBeNull();
  });
});
