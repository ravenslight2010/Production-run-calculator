import { describe, expect, it, vi } from "vitest";
import { SYNC_DELTA_MAP_SECTIONS } from "@workspace/sync-contract";
import {
  consumeSyncWriteResponse,
  isCanonicalRecoverySyncPayload,
  isUnchangedSyncResponse,
  persistedSyncPayload,
  readCurrentRecoveryJson,
  reconstructPartialSyncPayload,
  syncPayloadMatchesSnapshot,
  syncPayloadSnapshotId,
} from "./syncWriteResponse";

describe("consumeSyncWriteResponse", () => {
  it("immediately self-applies the server canonical payload on a successful write", async () => {
    const applyCanonical = vi.fn();
    const canonical = {
      syncVersion: 1,
      completeness: "complete",
      dayState: {
        date: "2026-09-15",
        runs: [{ id: "run-1", brand: "Brand", flavor: "Flavor" }],
      },
      runValues: { "run-1": { casesNeeded: 31 } },
    };

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
    expect(result.body).toEqual({ data: { runValues: {} } });
    expect(applyCanonical).not.toHaveBeenCalled();
  });

  it("leaves a failed save unapplied and permits a later successful retry", async () => {
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
    expect(result.body).toEqual({ data: { runValues: {} } });
    expect(applyCanonical).not.toHaveBeenCalled();
  });

  it("leaves a failed save unapplied and permits a later successful retry", async () => {
    const applyCanonical = vi.fn();
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
    let baseline: any = {
      syncVersion: 1,
      completeness: "complete",
      dayState: {
        date: "2026-09-15",
        runs: [{ id: "r1", brand: "Synthetic", flavor: "One", metaUpdatedAt: 1 }],
      },
      runValues: { r1: { casesNeeded: 10 } },
      runValuesUpdatedAt: { r1: 1 },
    };

    let baselineId = await syncPayloadSnapshotId(baseline);
    expect(await syncPayloadMatchesSnapshot(baseline, snapshotId)).toBe(true);
  });

  it("reconstructs only a v1 delta based on the exact adopted snapshot", async () => {
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
    const baseId = await syncPayloadSnapshotId(base as any);
    const target = {
      ...base,
      runValues: { r1: { casesNeeded: 11 } },
      runValuesUpdatedAt: { r1: 2 },
      packagingProgress: { r1: { skidsCompleted: 3 } },
    };
      const targetId = await syncPayloadSnapshotId(built.target);

      const reconstructed = await reconstructPartialSyncPayload(baseline, baselineId, {
        syncVersion: 1,
        completeness: "partial",
        baseSnapshotId: baselineId,
        snapshotId: targetId,
        resultingSnapshotId: targetId,
        data: built.data,
      });
    await expect(reconstructPartialSyncPayload(base as any, baseId, {
      syncVersion: 1,
      completeness: "partial",
      baseSnapshotId: baseId,
      snapshotId: targetId,
      resultingSnapshotId: targetId,
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
      const targetId = await syncPayloadSnapshotId(built.target);

      const reconstructed = await reconstructPartialSyncPayload(baseline, baselineId, {
        syncVersion: 1,
        completeness: "partial",
        baseSnapshotId: baselineId,
        snapshotId: targetId,
        resultingSnapshotId: targetId,
        data: built.data,
      });
    const applyCanonical = vi.fn();
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
    expect(result.body).toEqual({ data: { runValues: {} } });
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

    const transitions = [
      {
        target: {
          ...baseline,
          dayState: {
            ...baseline.dayState,
            runs: [{ ...baseline.dayState.runs[0], startedAt: 10, metaUpdatedAt: 10 }],
          },
        },
        data: {
          dayState: {
            ...baseline.dayState,
            runs: [{ ...baseline.dayState.runs[0], startedAt: 10, metaUpdatedAt: 10 }],
          },
        },
      },
      {
        build(previous: any) {
          const r2 = { id: "r2", brand: "Synthetic", flavor: "Two", metaUpdatedAt: 20 };
          return {
            target: {
              ...previous,
              dayState: { ...previous.dayState, runs: [...previous.dayState.runs, r2] },
              runValues: { ...previous.runValues, r2: { casesNeeded: 20 } },
              runValuesUpdatedAt: { ...previous.runValuesUpdatedAt, r2: 20 },
            },
            data: {
              dayState: { ...previous.dayState, runs: [...previous.dayState.runs, r2] },
              runValues: { r2: { casesNeeded: 20 } },
              runValuesUpdatedAt: { r2: 20 },
            },
          };
        },
      },
      {
        build(previous: any) {
          const runs = previous.dayState.runs.map((run: any) =>
            run.id === "r1" ? { ...run, endedAt: 30, metaUpdatedAt: 30 } : run);
          return {
            target: { ...previous, dayState: { ...previous.dayState, runs } },
            data: { dayState: { ...previous.dayState, runs } },
          };
        },
      },
      {
        build(previous: any) {
          const target = {
            ...previous,
            dayState: {
              ...previous.dayState,
              runs: previous.dayState.runs.filter((run: any) => run.id !== "r2"),
            },
            runValues: { r1: previous.runValues.r1 },
            runValuesUpdatedAt: { r1: previous.runValuesUpdatedAt.r1 },
          };
          return {
            target,
            data: {
              dayState: target.dayState,
              runValues: { r2: null },
              runValuesUpdatedAt: { r2: null },
            },
          };
        },
      },
    ];

      const built = "build" in transition ? transition.build(baseline) : transition;
