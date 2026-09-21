import { describe, expect, it, vi } from "vitest";
import { SYNC_DELTA_MAP_SECTIONS } from "@workspace/sync-contract";
import {
  consumeSyncWriteResponse,
  isCanonicalRecoverySyncPayload,
  isUnchangedSyncResponse,
  mergeSparseServerRunMap,
  persistedSyncPayload,
  readCurrentRecoveryJson,
  reconstructPartialSyncPayload,
  syncWriteFieldCheck,
  shouldReplaySyncWrite,
  syncPayloadMatchesSnapshot,
  syncPayloadSnapshotId,
} from "./syncWriteResponse";

describe("consumeSyncWriteResponse", () => {
  it.each([
    ["authorization rejection", { ok: false, status: 403 }],
    ["reset-stale rejection", { ok: true, status: 200, stale: true }],
    ["exhausted retry", { ok: false, status: 0, retriesExhausted: true }],
  ])("classifies %s as a failed sync acknowledgment", (_label, input) => {
    expect(syncWriteFieldCheck(input)).toEqual({
      checkName: "sync-acknowledgment",
      outcome: "failure",
    });
  });

  it("classifies a successful local write as a successful sync acknowledgment", () => {
    expect(syncWriteFieldCheck({ ok: true, status: 200 })).toEqual({
      checkName: "sync-acknowledgment",
      outcome: "success",
    });
  });

  it("does not classify non-terminal diagnostics as a sync acknowledgment", () => {
    expect(syncWriteFieldCheck({ ok: false, status: 503 })).toBeUndefined();
  });

  it("replays stale-base fallbacks after canonical adoption but not ordinary acknowledgements", () => {
    expect(shouldReplaySyncWrite({ partialFallback: true, data: { runValues: {} } })).toBe(true);
    expect(shouldReplaySyncWrite({ partialFallback: true })).toBe(true);
    expect(shouldReplaySyncWrite({ data: { runValues: {} } })).toBe(false);
    expect(shouldReplaySyncWrite(null)).toBe(false);
  });

  it("immediately self-applies the server canonical payload on a successful write", async () => {
    const applyCanonical = vi.fn();
    const canonical = {
      runValues: {
        run1: { skidsCompleted: 1, casesOnCurrentSkid: 24 },
      },
      packagingProgress: {
        run1: {
          skidsCompleted: 1,
          casesOnCurrentSkid: 24,
          correctionGeneration: 2,
          updatedAt: 200,
          manualOverrideUntil: 60_200,
        },
      },
    };

    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ ok: true, data: canonical }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      { applyCanonical },
    );

    expect(result.stale).toBe(false);
    expect(applyCanonical).toHaveBeenCalledOnce();
    expect(applyCanonical).toHaveBeenCalledWith(canonical);
  });

  it("handles reset-stale responses without applying their data", async () => {
    const applyCanonical = vi.fn();
    const onStale = vi.fn();
    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ ok: true, stale: true, epoch: 7 }), {
        status: 200,
      }),
      { applyCanonical, onStale },
    );

    expect(result.stale).toBe(true);
    expect(onStale).toHaveBeenCalledWith(
      expect.objectContaining({ stale: true, epoch: 7 }),
    );
    expect(applyCanonical).not.toHaveBeenCalled();
  });

  it("recognizes a valid unchanged response without applying a canonical payload", async () => {
    const applyCanonical = vi.fn();
    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ ok: true, unchanged: true, snapshotId: "a".repeat(64) }), { status: 200 }),
      { applyCanonical },
    );
    expect(result.stale).toBe(false);
    expect(isUnchangedSyncResponse(result.body)).toBe(true);
    expect(applyCanonical).not.toHaveBeenCalled();
  });

  it("does not treat malformed unchanged responses as a successful snapshot", () => {
    expect(isUnchangedSyncResponse({ unchanged: true })).toBe(false);
    expect(isUnchangedSyncResponse({ unchanged: true, snapshotId: "not-a-hash" })).toBe(false);
    expect(isUnchangedSyncResponse({ unchanged: true, snapshotId: "a".repeat(64) })).toBe(true);
    expect(isUnchangedSyncResponse({
      unchanged: true,
      snapshotId: "a".repeat(64),
      data: { unexpected: true },
    })).toBe(false);
    expect(isUnchangedSyncResponse(null)).toBe(false);
  });

  it("accepts only complete, date-matched canonical recovery payloads", () => {
    const canonical = {
      syncVersion: 1,
      completeness: "complete",
      dayState: {
        date: "2026-09-15",
        runs: [{ id: "run-1", brand: "Brand", flavor: "Flavor" }],
      },
      runValues: { "run-1": { casesNeeded: 31 } },
    };
    expect(isCanonicalRecoverySyncPayload(canonical, "2026-09-15", "complete")).toBe(true);
    expect(isCanonicalRecoverySyncPayload(
      { ...canonical, completeness: "partial" },
      "2026-09-15",
      "complete",
    )).toBe(false);
    expect(isCanonicalRecoverySyncPayload(
      { ...canonical, dayState: { ...canonical.dayState, date: "2026-09-14" } },
      "2026-09-15",
      "complete",
    )).toBe(false);
    expect(isCanonicalRecoverySyncPayload(
      { ...canonical, dayState: { ...canonical.dayState, runs: [{ id: "run-1" }] } },
      "2026-09-15",
      "complete",
    )).toBe(false);
    expect(isCanonicalRecoverySyncPayload(
      { ...canonical, runValues: {} },
      "2026-09-15",
      "complete",
    )).toBe(false);
    expect(isCanonicalRecoverySyncPayload(
      { dayState: { date: "2026-09-15", runs: [] }, runValues: [] },
      "2026-09-15",
      "complete",
    )).toBe(false);
    expect(isCanonicalRecoverySyncPayload(canonical, "2026-09-15", undefined)).toBe(false);
    expect(isCanonicalRecoverySyncPayload(
      {
        ...canonical,
        dayState: {
          ...canonical.dayState,
          runs: [
            canonical.dayState.runs[0],
            canonical.dayState.runs[0],
          ],
        },
      },
      "2026-09-15",
      "complete",
    )).toBe(false);
    expect(isCanonicalRecoverySyncPayload(
      { ...canonical, runValues: { ...canonical.runValues, orphan: {} } },
      "2026-09-15",
      "complete",
    )).toBe(false);
  });

  it("marks a delayed recovery body obsolete when its owner is superseded during parsing", async () => {
    let release!: () => void;
    let current = true;
    const response = {
      json: () => new Promise((resolve) => {
        release = () => resolve({ epoch: 7 });
      }),
    } as Response;

    const reading = readCurrentRecoveryJson(response, () => current);
    current = false;
    release();

    await expect(reading).resolves.toEqual({
      current: false,
      body: { epoch: 7 },
    });
  });

  it("verifies a canonical snapshot digest against object-key-independent payload content", async () => {
    const payload = {
      dayState: {
        date: "2026-09-15",
        runs: [{ id: "run-1", brand: "Brand", flavor: "Flavor" }],
      },
      runValues: { "run-1": { casesNeeded: 31 } },
    } as any;
    const snapshot = await syncPayloadSnapshotId(payload);
    expect(await syncPayloadMatchesSnapshot(payload, snapshot)).toBe(true);
    expect(await syncPayloadMatchesSnapshot({
      ...payload,
      runValues: { "run-1": { casesNeeded: 30 } },
    }, snapshot)).toBe(false);
  });

  it("retains a foreground recovery baseline that matches the persisted snapshot identity", async () => {
    const persisted = {
      syncVersion: 1 as const,
      completeness: "complete" as const,
      dayState: { date: "2026-09-15", runs: [{ id: "r1", brand: "A", flavor: "F" }] },
      runValues: { r1: { casesNeeded: 10 } },
    };
    const recovery = {
      ...persisted,
      operationalProjection: { version: 1, runId: "r1" },
      serverTime: 123,
      canonicalRevision: 7,
    } as any;
    const snapshotId = await syncPayloadSnapshotId(persisted as any);
    const baseline = persistedSyncPayload(recovery);
    expect(await syncPayloadMatchesSnapshot(baseline, snapshotId)).toBe(true);
  });

  it("reconstructs only a v1 delta based on the exact adopted snapshot", async () => {
    const base = {
      syncVersion: 1 as const,
      completeness: "complete" as const,
      dayState: { date: "2026-09-15", runs: [{ id: "r1", brand: "A", flavor: "F" }] },
      runValues: { r1: { casesNeeded: 10 } },
    };
    const baseId = await syncPayloadSnapshotId(base as any);
    const target = {
      ...base,
      runValues: { r1: { casesNeeded: 12 } },
    };
    const targetId = await syncPayloadSnapshotId(target as any);
    await expect(reconstructPartialSyncPayload(base as any, baseId, {
      syncVersion: 1,
      completeness: "partial",
      baseSnapshotId: baseId,
      snapshotId: targetId,
      data: { runValues: { r1: { casesNeeded: 12 } } },
    })).resolves.toEqual(target);
    await expect(reconstructPartialSyncPayload(base as any, "b".repeat(64), {
      syncVersion: 1,
      completeness: "partial",
      baseSnapshotId: baseId,
      snapshotId: targetId,
      resultingSnapshotId: targetId,
      data: { runValues: { r1: { casesNeeded: 12 } } },
    })).resolves.toBeNull();
  });

  it("retains unchanged run totals while updating and removing changed entries", () => {
    const currentSummaryStats = {
      unchanged: { total: 1 },
      changed: { total: 2 },
      removed: { total: 3 },
    };
    const currentRunLines = {
      unchanged: [{ itemKey: "cheese", qty: 1 }],
      changed: [{ itemKey: "pepperoni", qty: 2 }],
      removed: [{ itemKey: "sauce", qty: 3 }],
    };

    expect(mergeSparseServerRunMap(currentSummaryStats, {
      changed: { total: 4 },
      removed: null,
    })).toEqual({
      unchanged: { total: 1 },
      changed: { total: 4 },
    });
    expect(mergeSparseServerRunMap(currentRunLines, {
      changed: [{ itemKey: "pepperoni", qty: 5 }],
      removed: null,
    })).toEqual({
      unchanged: [{ itemKey: "cheese", qty: 1 }],
      changed: [{ itemKey: "pepperoni", qty: 5 }],
    });
  });

  it("applies sparse peer map tombstones without dropping omitted values", async () => {
    expect(SYNC_DELTA_MAP_SECTIONS).toEqual([
      "runValues",
      "runValuesUpdatedAt",
      "packagingProgress",
    ]);
    const base = {
      syncVersion: 1 as const,
      completeness: "complete" as const,
      dayState: {
        date: "2026-09-15",
        runs: [
          { id: "r1", brand: "A", flavor: "F" },
          { id: "r2", brand: "A", flavor: "G" },
        ],
      },
      runValues: { r1: { casesNeeded: 10 }, r2: { casesNeeded: 20 } },
      runValuesUpdatedAt: { r1: 1, r2: 1 },
      packagingProgress: { r1: { skidsCompleted: 1 }, r2: { skidsCompleted: 2 } },
      history: [{ message: "preserved" }],
    };
    const target = {
      ...base,
      runValues: { r1: { casesNeeded: 11 } },
      runValuesUpdatedAt: { r1: 2 },
      packagingProgress: { r1: { skidsCompleted: 3 } },
    };
    const baseId = await syncPayloadSnapshotId(base as any);
    const targetId = await syncPayloadSnapshotId(target as any);

    await expect(reconstructPartialSyncPayload(base as any, baseId, {
      syncVersion: 1,
      completeness: "partial",
      baseSnapshotId: baseId,
      snapshotId: targetId,
      resultingSnapshotId: targetId,
      data: {
        runValues: { r1: { casesNeeded: 11 }, r2: null },
        runValuesUpdatedAt: { r1: 2, r2: null },
        packagingProgress: { r1: { skidsCompleted: 3 }, r2: null },
      },
    })).resolves.toEqual(target);
  });

  it("adopts the complete lifecycle fallback when a third peer reconnects late", async () => {
    const baseline = {
      syncVersion: 1 as const,
      completeness: "complete" as const,
      dayState: {
        date: "2026-09-15",
        runs: [
          { id: "active", brand: "Synthetic", flavor: "Active", metaUpdatedAt: 1_000 },
        ],
      },
      runValues: { active: { casesNeeded: 40 } },
      runValuesUpdatedAt: { active: 1_000 },
    };
    const canonical = {
      ...baseline,
      dayState: {
        ...baseline.dayState,
        runs: [{
          ...baseline.dayState.runs[0],
          startedAt: 2_000,
          endedAt: 3_000,
          metaUpdatedAt: 3_000,
        }],
      },
      deletedItems: { runs: ["concurrent-added"] },
    };
    const peerA = { current: baseline as any };
    const peerB = { current: baseline as any };
    const peerC = { current: baseline as any };
    const fallbackBody = {
      ok: true,
      partialFallback: true,
      data: canonical,
    };

    await Promise.all([
      consumeSyncWriteResponse(
        new Response(JSON.stringify(fallbackBody), { status: 200 }),
        { applyCanonical: (data) => { peerA.current = data; } },
      ),
      consumeSyncWriteResponse(
        new Response(JSON.stringify(fallbackBody), { status: 200 }),
        { applyCanonical: (data) => { peerB.current = data; } },
      ),
    ]);

    expect(peerA.current).toEqual(canonical);
    expect(peerB.current).toEqual(canonical);
    expect(peerA.current.dayState.runs[0]).toMatchObject({
      startedAt: 2_000,
      endedAt: 3_000,
      metaUpdatedAt: 3_000,
    });
    expect(peerA.current.dayState.runs.some(
      (run: { id: string }) => run.id === "concurrent-added",
    )).toBe(false);

    await consumeSyncWriteResponse(
      new Response(JSON.stringify(fallbackBody), { status: 200 }),
      { applyCanonical: (data) => { peerC.current = data; } },
    );

    expect(peerC.current).toEqual(canonical);
    expect(peerC.current.completeness).toBe("complete");
    expect(peerC.current.dayState.runs[0]).toMatchObject({
      endedAt: 3_000,
      metaUpdatedAt: 3_000,
    });
    expect(peerC.current.dayState.runs.some(
      (run: { id: string }) => run.id === "concurrent-added",
    )).toBe(false);

    // A stale queued replay receives the same canonical response and cannot
    // restore the peer's pre-conflict baseline.
    await consumeSyncWriteResponse(
      new Response(JSON.stringify(fallbackBody), { status: 200 }),
      { applyCanonical: (data) => { peerC.current = data; } },
    );
    expect(peerC.current).toEqual(canonical);
  });

  it("adopts canonical schedule deletions and does not repaint removed runs on stale replay", async () => {
    const canonical = {
      syncVersion: 1,
      completeness: "complete",
      dayState: {
        date: "2026-09-21",
        runs: [{ id: "survivor", brand: "Acme", flavor: "Cheese" }],
      },
      runValues: { survivor: { casesNeeded: 10 } },
      deletedItems: { runs: ["unnamed-1", "unnamed-2"] },
      deletedStamps: {
        runs: { "unnamed-1": 100, "unnamed-2": 100 },
      },
    };
    const peer = {
      current: {
        ...canonical,
        dayState: {
          ...canonical.dayState,
          runs: [
            canonical.dayState.runs[0],
            { id: "unnamed-1", brand: "", flavor: "" },
            { id: "unnamed-2", brand: "", flavor: "" },
          ],
        },
      } as any,
    };
    const response = () => new Response(JSON.stringify({
      ok: true,
      partialFallback: true,
      data: canonical,
    }), { status: 200 });

    await consumeSyncWriteResponse(response(), {
      applyCanonical: (data) => { peer.current = data; },
    });
    expect(peer.current.dayState.runs.map((run: { id: string }) => run.id)).toEqual(["survivor"]);

    await consumeSyncWriteResponse(response(), {
      applyCanonical: (data) => { peer.current = data; },
    });
    expect(peer.current).toEqual(canonical);
  });

  it("converges Pause and Resume peers on the newer resumed canonical snapshot", async () => {
    const pauseId = "pause-1";
    const baseline = {
      syncVersion: 1 as const,
      completeness: "complete" as const,
      dayState: {
        date: "2026-09-15",
        runs: [{
          id: "active",
          brand: "Synthetic",
          flavor: "Active",
          startedAt: 1_000,
          metaUpdatedAt: 1_000,
        }],
      },
      runValues: { active: { casesNeeded: 40 } },
      runValuesUpdatedAt: { active: 1_000 },
    };
    const pausedPeer = {
      current: {
        ...baseline,
        dayState: {
          ...baseline.dayState,
          runs: [{
            ...baseline.dayState.runs[0],
            pausedAt: 2_000,
            pausedStoppageId: pauseId,
            stoppages: [{ id: pauseId, type: "pause", startedAt: 2_000 }],
            metaUpdatedAt: 2_000,
          }],
        },
      } as any,
    };
    const resumedPeer = {
      current: {
        ...baseline,
        dayState: {
          ...baseline.dayState,
          runs: [{
            ...baseline.dayState.runs[0],
            startedAt: 2_000,
            stoppages: [{
              id: pauseId,
              type: "pause",
              startedAt: 2_000,
              endedAt: 3_000,
            }],
            metaUpdatedAt: 3_000,
          }],
        },
      } as any,
    };
    const canonical = resumedPeer.current;
    const responseBody = { ok: true, partialFallback: true, data: canonical };

    await Promise.all([
      consumeSyncWriteResponse(
        new Response(JSON.stringify(responseBody), { status: 200 }),
        { applyCanonical: (data) => { pausedPeer.current = data; } },
      ),
      consumeSyncWriteResponse(
        new Response(JSON.stringify(responseBody), { status: 200 }),
        { applyCanonical: (data) => { resumedPeer.current = data; } },
      ),
    ]);

    expect(pausedPeer.current).toEqual(resumedPeer.current);
    expect(pausedPeer.current.dayState.runs[0]).toMatchObject({
      startedAt: 2_000,
      metaUpdatedAt: 3_000,
      stoppages: [expect.objectContaining({
        id: pauseId,
        startedAt: 2_000,
        endedAt: 3_000,
      })],
    });
    expect(pausedPeer.current.dayState.runs[0].pausedAt).toBeUndefined();
    expect(pausedPeer.current.dayState.runs[0].pausedStoppageId).toBeUndefined();
  });

  it("does not apply data from an unsuccessful response", async () => {
    const applyCanonical = vi.fn();
    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ data: { runValues: {} } }), { status: 500 }),
      { applyCanonical },
    );
    expect(result.body).toEqual({ data: { runValues: {} } });
    expect(applyCanonical).not.toHaveBeenCalled();
  });

  it("does not treat a successful response without a sync envelope as acknowledged", async () => {
    const applyCanonical = vi.fn();
    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      { applyCanonical },
    );

    expect(result.malformed).toBe(true);
    expect(result.stale).toBe(false);
    expect(applyCanonical).not.toHaveBeenCalled();
  });

  it("leaves a failed save unapplied and permits a later successful retry", async () => {
    const applyCanonical = vi.fn();
    const intended = { runValues: { run1: { casesOnCurrentSkid: 12 } } };

    const failed = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ data: intended }), { status: 503 }),
      { applyCanonical },
    );
    expect(failed.stale).toBe(false);
    expect(applyCanonical).not.toHaveBeenCalled();

    await consumeSyncWriteResponse(
      new Response(JSON.stringify({ ok: true, data: intended }), { status: 200 }),
      { applyCanonical },
    );
    expect(applyCanonical).toHaveBeenCalledOnce();
    expect(applyCanonical).toHaveBeenCalledWith(intended);
  });

  it("ignores a response invalidated while its body was being read", async () => {
    const applyCanonical = vi.fn();
    const onStale = vi.fn();
    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({
        stale: true,
        data: { runValues: { run1: { casesOnCurrentSkid: 99 } } },
      }), { status: 200 }),
      {
        applyCanonical,
        onStale,
        shouldConsume: () => false,
      },
    );

    expect(result.stale).toBe(false);
    expect(applyCanonical).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
  });
});
