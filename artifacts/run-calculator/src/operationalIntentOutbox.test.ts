import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushOperationalIntentOutbox,
  fencePendingEndSnapshots,
  capturePreEndLifecycle,
  operationalIntentSummary,
  queueOperationalIntent,
  readOperationalIntentOutbox,
} from "./operationalIntentOutbox";

describe("operational intent outbox", () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
  it("persists the exact correction and retains it for retry until canonical outcome", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ outcome: "accepted" }) });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({
      runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 123,
      action: "correction", values: { traysOnLine: 5, batchesReady: 2 },
    });
    expect(readOperationalIntentOutbox()[0]).toMatchObject({ id: intent.id, values: { traysOnLine: 5, batchesReady: 2 }, state: "pending" });
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().pending).toBe(1);
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().accepted).toBe(1);
    expect(fetch.mock.calls[0][1].body).toContain('"traysOnLine":5');
  });
  it("restores the complete paused lifecycle while an offline End awaits finalization", async () => {
    const canonicalLifecycle = {
      startedAt: 50,
      pausedAt: 150,
      pausedStoppageId: "stop-1",
      stoppages: [{ id: "stop-1", type: "pause", reason: "Break", startedAt: 150 }],
      metaUpdatedAt: 100,
    };
    const intent = queueOperationalIntent({
      runId: "run-1", observedGeneration: "run-1:100", effectiveAt: 200,
      action: "lifecycle", lifecycle: "end",
      preEndLifecycle: capturePreEndLifecycle(canonicalLifecycle),
      inventoryLines: [
        { itemKey: "ingredient:Flour:lbs", qty: 1 },
        { itemKey: "ingredient:Flour:lbs", qty: 3 },
      ],
    });
    const [fenced] = fencePendingEndSnapshots([
      {
        id: "run-1",
        startedAt: 50,
        endedAt: 200,
        metaUpdatedAt: 201,
        stoppages: canonicalLifecycle.stoppages,
      },
    ]);
    expect(fenced).toEqual({ id: "run-1", ...canonicalLifecycle });
    expect(readOperationalIntentOutbox()[0]).toMatchObject({
      id: intent.id,
      state: "pending",
      preEndLifecycle: canonicalLifecycle,
      inventoryLines: [{ itemKey: "ingredient:Flour:lbs", qty: 4 }],
    });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outcome: "accepted" }),
    });
    vi.stubGlobal("fetch", fetch);
    await flushOperationalIntentOutbox();
    expect(fetch.mock.calls[0][1].body).not.toContain("preEndLifecycle");
  });
});