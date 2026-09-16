import { describe, expect, it, vi } from "vitest";
import {
  consumeSyncWriteResponse,
  isCanonicalRecoverySyncPayload,
  isUnchangedSyncResponse,
  readCurrentRecoveryJson,
  syncPayloadMatchesSnapshot,
  syncPayloadSnapshotId,
} from "./syncWriteResponse";

describe("consumeSyncWriteResponse", () => {
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

  it("does not apply data from an unsuccessful response", async () => {
    const applyCanonical = vi.fn();
    const result = await consumeSyncWriteResponse(
      new Response(JSON.stringify({ data: { runValues: {} } }), { status: 500 }),
      { applyCanonical },
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