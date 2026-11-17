import { describe, expect, it, vi } from "vitest";
import {
  clearPendingSyncIntent,
  loadPendingSyncIntent,
  pendingSyncRecoveryCopyNotice,
  saveRebasedPendingSyncIntent,
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

  it("preserves a different pending intent and reports why the rebase copy was not saved", () => {
    const existing = {
      version: 1 as const,
      id: "newer-intent",
      scope: "live:user-c",
      date: "2030-01-01",
      epoch: 2,
      baseSnapshotId: "snapshot-3",
      baseline: payload,
      payload,
    };
    const rebased = { ...existing, id: "in-flight-intent" };
    expect(savePendingSyncIntent(existing)).toBe(true);

    const status = saveRebasedPendingSyncIntent(
      rebased,
      loadPendingSyncIntent(existing.scope, existing.date),
    );

    expect(status).toBe("different-intent-preserved");
    expect(pendingSyncRecoveryCopyNotice(status)).toBe(
      "another pending change is already saved; this rebase did not replace it",
    );
    expect(loadPendingSyncIntent(existing.scope, existing.date)?.id).toBe(existing.id);
  });

  it("distinguishes missing recovery identity and unavailable browser storage", () => {
    expect(saveRebasedPendingSyncIntent(null, null)).toBe("identity-unavailable");
    expect(pendingSyncRecoveryCopyNotice("identity-unavailable")).toContain(
      "recovery identity is unavailable",
    );
    expect(pendingSyncRecoveryCopyNotice("saved")).toBe("");

    vi.stubGlobal("localStorage", undefined);
    try {
      expect(saveRebasedPendingSyncIntent({
        version: 1,
        id: "storage-unavailable-intent",
        scope: "live:user-d",
        date: "2030-01-01",
        epoch: 3,
        baseSnapshotId: "snapshot-4",
        baseline: payload,
        payload,
      }, null)).toBe("storage-unavailable");
      expect(pendingSyncRecoveryCopyNotice("storage-unavailable")).toContain(
        "browser storage did not save",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
