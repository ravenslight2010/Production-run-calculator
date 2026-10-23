import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readCachedProfileBlobs, reconcileLegacyProfileReads, setProfileCacheIdentity,
} from "./profileCache";
import { retireMatchingLegacyArray, retainedSharedRecordEvidence, withoutArchivedSyncHistory, LEGACY_SYNC_HISTORY_REVIEW_PREFIX } from "./sharedRecordMigration";
import { DEFAULT_VALUES, type SyncPayload } from "./types";
import { loadPendingSyncIntent, savePendingSyncIntent } from "./syncPendingIntent";
import { applyResetWipe } from "./adapters/browserResetPersistence";
import { captureMasterDataSnapshot, restoreMasterDataSnapshot } from "./storage";

beforeEach(() => {
  setProfileCacheIdentity(null);
  localStorage.clear();
  setProfileCacheIdentity({ userId: "owner", scope: "live" });
});
describe("shared record migration and recovery", () => {
  const id = "acme__cheese";
  const cacheKey = "run-calc-profile-cache-v1:live:authenticated-facility:owner";
  const queueKey = "run-calc-profilesync-queue-v1:live:authenticated-facility:owner";
  it("upgrades only an owned key-only queue to its own durable blobs before removing any reads", () => {
    setProfileCacheIdentity(null);
    localStorage.setItem(cacheKey, JSON.stringify({ [id]: { dough: '{"lineSpeed":12}', crust: "{}" } }));
    localStorage.setItem(queueKey, JSON.stringify([{ t: "up", key: id }]));
    localStorage.setItem("run-calc-profilesync-stamps-v1:live:authenticated-facility:owner", JSON.stringify({ [id]: 123 }));
    setProfileCacheIdentity({ userId: "owner", scope: "live" });
    expect(JSON.parse(localStorage.getItem(queueKey)!)[0]).toMatchObject({
      blobs: { dough: '{"lineSpeed":12}', crust: "{}" }, updatedAt: expect.any(Number),
    });
    expect(readCachedProfileBlobs(id).dough).toBe('{"lineSpeed":12}');
    expect(localStorage.getItem(cacheKey)).not.toBeNull();
  });
  it("retires matching owned reads structurally but preserves malformed/different rows", () => {
    localStorage.setItem(cacheKey, JSON.stringify({
      [id]: { dough: '{"b":2,"a":1}', crust: "{}" },
      unknown: { broken: true },
      "acme__other": { dough: '{"a":9}', crust: "{}" },
    }));
    const canonical = new Map([[id, { dough: '{"a":1,"b":2}', crust: "{}" }]]);
    reconcileLegacyProfileReads(canonical);
    expect(JSON.parse(localStorage.getItem(cacheKey)!)).toEqual({
      unknown: { broken: true }, "acme__other": { dough: '{"a":9}', crust: "{}" },
    });
    reconcileLegacyProfileReads(canonical);
    expect(JSON.parse(localStorage.getItem(cacheKey)!)).toHaveProperty("unknown");
  });
  it("does not turn a failed retirement into lost unresolved work", () => {
    localStorage.setItem("legacy", JSON.stringify([{ id: 1 }, { id: 2 }]));
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("interrupted"); });
    retireMatchingLegacyArray("legacy", () => true);
    expect(JSON.parse(localStorage.getItem("legacy")!)).toHaveLength(2);
    remove.mockRestore();
    retireMatchingLegacyArray("legacy", () => true);
    expect(localStorage.getItem("legacy")).toBeNull();
  });
  it("retains recovery and unknown-owner evidence byte-for-byte through reset and legacy undo", () => {
    const retained = [
      queueKey, cacheKey, "run-calc-templates-outbox-v1:live:owner",
      "run-calc-templates", "run-calc-completed-history-outbox.live:owner",
      `${LEGACY_SYNC_HISTORY_REVIEW_PREFIX}live%3Aowner`,
      "run-calc-completed-history-conflicts-v1.live:owner", "run-calc-history",
      "run-calculator:operational-intent-outbox:v1:owner", "run-calculator:sync-pending-v1:owner:2026-01-01",
    ];
    for (const key of retained) localStorage.setItem(key, '{"synthetic":"retain exact bytes"}');
    const before = captureMasterDataSnapshot();
    applyResetWipe();
    expect(() => restoreMasterDataSnapshot({
      ...before, "run-calc-profile-acme__cheese": '{"stale":true}',
      "run-calc-templates:live": "[]", "run-calc-completed-history-cache.live": "[]",
    })).toThrow(/Browser rollback is disabled/);
    for (const key of retained) expect(localStorage.getItem(key), key).toBe('{"synthetic":"retain exact bytes"}');
    expect(localStorage.getItem("run-calc-profile-acme__cheese")).toBeNull();
    expect(localStorage.getItem("run-calc-templates:live")).toBeNull();
    expect(localStorage.getItem("run-calc-completed-history-cache.live")).toBeNull();
  });
  it("shows only current-owner or manager-review legacy metadata, not another account's queue", () => {
    localStorage.setItem("run-calc-templates-outbox-v1:live:other", "[{}]");
    localStorage.setItem("run-calc-templates-outbox-v1:live", "[{}]");
    expect(retainedSharedRecordEvidence("live:authenticated-facility:owner", false)).toEqual([]);
    expect(retainedSharedRecordEvidence("live:authenticated-facility:owner", true))
      .toEqual([expect.objectContaining({ key: "run-calc-templates-outbox-v1:live" })]);
  });
  it("strips archives from legacy replay while durably preserving unresolved owned history for review", () => {
    const payload = {
      dayState: { date: "2026-01-01", runs: [], currentIndex: 0 },
      runValues: { active: DEFAULT_VALUES },
      history: [{ date: "2025-12-31", runs: [], runValues: {} }],
    } as unknown as SyncPayload;
    localStorage.setItem("run-calculator:sync-pending-v1:live%3Aowner:2026-01-01", JSON.stringify({
      version: 1, id: "old-intent", scope: "live:owner", date: "2026-01-01",
      epoch: 0, baseSnapshotId: "old-base", baseline: payload, payload,
    }));
    const replay = loadPendingSyncIntent("live:owner", "2026-01-01")!;
    expect(replay.payload.history).toBeUndefined();
    expect(replay.baseline.history).toBeUndefined();
    expect(replay.payload.runValues).toEqual(payload.runValues);
    expect(JSON.parse(localStorage.getItem(`${LEGACY_SYNC_HISTORY_REVIEW_PREFIX}live%3Aowner`)!)).toEqual(payload.history);
    expect(loadPendingSyncIntent("live:other", "2026-01-01")).toBeNull();
    expect(withoutArchivedSyncHistory(payload, "live:owner").history).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(`${LEGACY_SYNC_HISTORY_REVIEW_PREFIX}live%3Aowner`)!)).toHaveLength(1);
  });
});
