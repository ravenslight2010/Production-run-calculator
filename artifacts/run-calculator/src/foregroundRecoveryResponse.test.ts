import { describe, expect, it, vi } from "vitest";
import { consumeForegroundRecoveryResponse } from "./foregroundRecoveryResponse";
import { syncPayloadSnapshotId } from "./syncWriteResponse";
import type { SyncPayload } from "./types";

const DATE = "2026-09-15";

function canonicalPayload(): SyncPayload {
  return {
    syncVersion: 1,
    completeness: "complete",
    dayState: {
      date: DATE,
      currentIndex: 0,
      runs: [{ id: "run-1", brand: "Brand", flavor: "Flavor" }],
    },
    runValues: { "run-1": { casesNeeded: 31 } as any },
  };
}

type MutableRecoveryState = {
  snapshotId: string;
  canonicalRevision: number;
  runValues: Record<string, unknown>;
  queuedWrite: { pending: boolean; generation: number };
  fenceReleased: boolean;
};

function stateHarness() {
  const state: MutableRecoveryState = {
    snapshotId: "local-snapshot",
    canonicalRevision: 4,
    runValues: { "run-local": { casesNeeded: 12 } },
    queuedWrite: { pending: true, generation: 9 },
    fenceReleased: false,
  };
  const before = structuredClone(state);
  const adoptUnchanged = vi.fn((body: { snapshotId: string; canonicalRevision?: number }) => {
    state.snapshotId = body.snapshotId;
    state.canonicalRevision = body.canonicalRevision ?? state.canonicalRevision;
  });
  const adoptCanonical = vi.fn((payload: SyncPayload, snapshotId: string) => {
    state.snapshotId = snapshotId;
    state.canonicalRevision = payload.canonicalRevision ?? state.canonicalRevision;
    state.runValues = payload.runValues;
  });
  const consume = async (
    response: Response,
    options: { current?: () => boolean; requestedSnapshotId?: string } = {},
  ) => {
    const result = await consumeForegroundRecoveryResponse({
      response,
      expectedDate: DATE,
      requestedSnapshotId: options.requestedSnapshotId ?? state.snapshotId,
      isCurrent: options.current ?? (() => true),
      adoptUnchanged,
      adoptCanonical,
      adoptReset: vi.fn(() => false),
    });
    if (result.accepted) {
      state.queuedWrite.pending = false;
      state.fenceReleased = true;
    }
    return result;
  };
  return { state, before, consume, adoptUnchanged, adoptCanonical };
}

function expectRejectedStateUnchanged(harness: ReturnType<typeof stateHarness>) {
  expect(harness.state).toEqual(harness.before);
  expect(harness.adoptUnchanged).not.toHaveBeenCalled();
  expect(harness.adoptCanonical).not.toHaveBeenCalled();
}

async function canonicalResponse(
  payload: SyncPayload,
  headers: Record<string, string> = {},
): Promise<Response> {
  const snapshotId = await syncPayloadSnapshotId(payload, { stripReadModel: true });
  return new Response(JSON.stringify({ ...payload, resetEpoch: 0, rollover: false }), {
    status: 200,
    headers: {
      "X-Sync-Response": "complete",
      "X-Sync-Snapshot": snapshotId,
      ...headers,
    },
  });
}

describe("foreground recovery response transaction", () => {
  it("rejects invalid snapshot headers without changing refs, queued writes, or the fence", async () => {
    const harness = stateHarness();
    await expect(harness.consume(await canonicalResponse(canonicalPayload(), {
      "X-Sync-Snapshot": "not-a-digest",
    }))).rejects.toThrow("invalid snapshot identity");
    expectRejectedStateUnchanged(harness);
  });

  it("rejects the wrong date without changing refs, queued writes, or the fence", async () => {
    const harness = stateHarness();
    const payload = canonicalPayload();
    payload.dayState.date = "2026-09-14";
    await expect(harness.consume(await canonicalResponse(payload))).rejects.toThrow(
      "malformed canonical response",
    );
    expectRejectedStateUnchanged(harness);
  });

  it("rejects missing run values without changing refs, queued writes, or the fence", async () => {
    const harness = stateHarness();
    const payload = canonicalPayload();
    payload.runValues = {};
    await expect(harness.consume(await canonicalResponse(payload))).rejects.toThrow(
      "malformed canonical response",
    );
    expectRejectedStateUnchanged(harness);
  });

  it("rejects a delayed reset JSON body superseded while parsing", async () => {
    const harness = stateHarness();
    let release!: (body: unknown) => void;
    let current = true;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => new Promise((resolve) => { release = resolve; }),
    } as Response;
    const pending = harness.consume(response, { current: () => current });
    current = false;
    release({ epoch: 7, rollover: false });
    await expect(pending).resolves.toEqual({ accepted: false, reason: "obsolete" });
    expectRejectedStateUnchanged(harness);
  });

  it("rejects an obsolete canonical response after digest validation", async () => {
    const harness = stateHarness();
    const payload = canonicalPayload();
    const response = await canonicalResponse(payload);
    let checks = 0;
    const result = await harness.consume(response, {
      current: () => {
        checks += 1;
        return checks < 3;
      },
    });
    expect(result).toEqual({ accepted: false, reason: "obsolete" });
    expectRejectedStateUnchanged(harness);
  });

  it("adopts a fully validated canonical response before authorizing fence release", async () => {
    const harness = stateHarness();
    const payload = canonicalPayload();
    payload.canonicalRevision = 8;
    const result = await harness.consume(await canonicalResponse(payload));
    expect(result).toMatchObject({ accepted: true, kind: "canonical" });
    expect(harness.state.canonicalRevision).toBe(8);
    expect(harness.state.runValues).toEqual(payload.runValues);
    expect(harness.state.queuedWrite.pending).toBe(false);
    expect(harness.state.fenceReleased).toBe(true);
  });

  it("processes a newer reset before canonical adoption and keeps the fence raised", async () => {
    const harness = stateHarness();
    const payload = canonicalPayload();
    const response = await canonicalResponse(payload);
    const body = await response.json() as Record<string, unknown>;
    const resetResponse = new Response(JSON.stringify({ ...body, resetEpoch: 7 }), {
      status: 200,
      headers: response.headers,
    });
    const adoptReset = vi.fn(() => true);
    const result = await consumeForegroundRecoveryResponse({
      response: resetResponse,
      expectedDate: DATE,
      requestedSnapshotId: harness.state.snapshotId,
      isCurrent: () => true,
      adoptUnchanged: harness.adoptUnchanged,
      adoptCanonical: harness.adoptCanonical,
      adoptReset,
    });
    expect(result).toEqual({ accepted: false, reason: "reset" });
    expect(adoptReset).toHaveBeenCalledWith({ resetEpoch: 7, rollover: false });
    expectRejectedStateUnchanged(harness);
  });

  it("rejects a canonical response without authoritative reset state", async () => {
    const harness = stateHarness();
    const payload = canonicalPayload();
    const snapshotId = await syncPayloadSnapshotId(payload, { stripReadModel: true });
    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "X-Sync-Response": "complete", "X-Sync-Snapshot": snapshotId },
    });
    await expect(harness.consume(response)).rejects.toThrow("malformed reset state");
    expectRejectedStateUnchanged(harness);
  });
});