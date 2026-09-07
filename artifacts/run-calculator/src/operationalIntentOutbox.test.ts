import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushOperationalIntentOutbox,
  fencePendingEndSnapshots,
  capturePreEndLifecycle,
  operationalIntentSummary,
  operationalIntentStorageHealth,
  operationalIntentRecoveryTelemetry,
  queueOperationalIntent,
  readOperationalIntentOutbox,
  retryOperationalIntent,
  discardOperationalIntent,
  setOperationalIntentIdentity,
} from "./operationalIntentOutbox";

describe("operational intent outbox", () => {
  beforeEach(() => setOperationalIntentIdentity({ scope: "live", userId: "operator-1" }));
  afterEach(() => {
    setOperationalIntentIdentity(null);
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("persists the exact correction and retains it for retry until canonical outcome", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ outcome: "accepted" }) });
    vi.stubGlobal("fetch", fetch);
    const replaySignal = vi.fn();
    window.addEventListener("calculator-field-check-signal", replaySignal);
    const intent = queueOperationalIntent({
      runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 123,
      action: "correction", values: { traysOnLine: 5, batchesReady: 2 },
    });
    expect(readOperationalIntentOutbox()[0]).toMatchObject({ id: intent.id, values: { traysOnLine: 5, batchesReady: 2 }, state: "pending" });
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().pending).toBe(1);
    expect(readOperationalIntentOutbox()[0]).toMatchObject({ failure: "network", attempts: 1 });
    retryOperationalIntent(intent.id);
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().accepted).toBe(1);
    expect(fetch.mock.calls[0][1].body).toContain('"traysOnLine":5');
    expect(replaySignal).not.toHaveBeenCalled();
  });
  it("reports an offline queue replay only after an offline-deferred intent is acknowledged", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const replaySignal = vi.fn();
    window.addEventListener("calculator-field-check-signal", replaySignal);
    const intent = queueOperationalIntent({
      runId: "offline-run",
      observedGeneration: "offline-run:1",
      effectiveAt: 123,
      action: "pause",
    });
    expect(intent.deferredOffline).toBe(true);
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox()[0]).toMatchObject({
      id: intent.id,
      state: "pending",
      deferredOffline: true,
    });
    expect(replaySignal).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outcome: "accepted" }),
    }));
    await flushOperationalIntentOutbox();

    expect(replaySignal).toHaveBeenCalledOnce();
    expect((replaySignal.mock.calls[0][0] as CustomEvent).detail).toEqual({
      checkName: "offline-queue-replay",
      outcome: "success",
    });
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
  it("uses bounded backoff and honors Retry-After instead of retrying in a storm", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 429, headers: { get: () => "120" }, json: async () => ({}),
    }));
    const intent = queueOperationalIntent({ runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 123, action: "pause" });
    await flushOperationalIntentOutbox();
    const saved = readOperationalIntentOutbox().find((x) => x.id === intent.id)!;
    expect(saved).toMatchObject({ state: "pending", failure: "rate-limited", attempts: 1 });
    expect(saved.nextRetryAt!).toBeGreaterThanOrEqual(Date.now() + 119_000);
    expect(retryOperationalIntent(intent.id)).toBe(false);
    await flushOperationalIntentOutbox();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("terminalizes validation and auth failures, with auth recoverable only by manual retry", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 422, headers: { get: () => null }, json: async () => ({}) });
    vi.stubGlobal("fetch", fetch);
    const auth = queueOperationalIntent({ runId: "auth", observedGeneration: "auth:1", effectiveAt: 1, action: "pause" });
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox().find((x) => x.id === auth.id)).toMatchObject({ state: "blocked", failure: "authentication" });
    await flushOperationalIntentOutbox();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(retryOperationalIntent(auth.id)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox().find((x) => x.id === auth.id)).toMatchObject({ state: "permanently-rejected", failure: "validation" });
  });
  it("keeps blocked and rejected Ends fenced until explicit discard", () => {
    const base = {
      version: 1 as const,
      id: "offline:end",
      date: "2026-09-06",
      runId: "run-1",
      observedGeneration: "run-1:100",
      resetEpoch: 0,
      effectiveAt: 200,
      action: "lifecycle" as const,
      lifecycle: "end" as const,
      inventoryLines: [],
      preEndLifecycle: { startedAt: 50, metaUpdatedAt: 100 },
    };
    const projected = [{ id: "run-1", startedAt: 50, endedAt: 200, metaUpdatedAt: 201 }];
    expect(fencePendingEndSnapshots(projected, [{ ...base, state: "blocked" }])[0].endedAt).toBeUndefined();
    expect(fencePendingEndSnapshots(projected, [{ ...base, state: "permanently-rejected" }])[0].endedAt).toBeUndefined();
  });
  it("discards only discardable work and keeps review-required evidence", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "review-required" }) });
    vi.stubGlobal("fetch", fetch);
    const review = queueOperationalIntent({ runId: "review", observedGeneration: "review:1", effectiveAt: 1, action: "pause" });
    const pending = queueOperationalIntent({ runId: "discard", observedGeneration: "discard:1", effectiveAt: 2, action: "resume" });
    expect(discardOperationalIntent(pending.id)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(discardOperationalIntent(review.id)).toBe(false);
    expect(readOperationalIntentOutbox()).toHaveLength(1);
  });
  it("uses per-ID terminal keys so another tab's terminal record is not clobbered", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "accepted" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "rebased" }) });
    vi.stubGlobal("fetch", fetch);
    queueOperationalIntent({ runId: "one", observedGeneration: "one:1", effectiveAt: 1, action: "pause" });
    queueOperationalIntent({ runId: "two", observedGeneration: "two:1", effectiveAt: 2, action: "resume" });
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary()).toMatchObject({ accepted: 1, rebased: 1 });
    expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).filter((key) => key?.includes(":terminal:"))).toHaveLength(2);
  });
  it("does not expose or flush another authenticated user's queued work", () => {
    const intent = queueOperationalIntent({ runId: "one", observedGeneration: "one:1", effectiveAt: 1, action: "pause" });
    setOperationalIntentIdentity({ scope: "live", userId: "operator-2" });
    expect(readOperationalIntentOutbox()).toEqual([]);
    expect(retryOperationalIntent(intent.id)).toBe(false);
  });
  it("does not discard an in-flight action or apply its response after identity changes", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    let release!: (value: unknown) => void;
    const response = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response));
    const intent = queueOperationalIntent({ runId: "one", observedGeneration: "one:1", effectiveAt: 1, action: "pause" });
    const flushing = flushOperationalIntentOutbox();
    await vi.waitFor(() => expect(readOperationalIntentOutbox()[0]?.state).toBe("sending"));
    expect(discardOperationalIntent(intent.id)).toBe(false);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-2" });
    release({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "accepted" }) });
    await flushing;
    expect(readOperationalIntentOutbox()).toEqual([]);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    expect(readOperationalIntentOutbox()[0]).toMatchObject({ id: intent.id, state: "sending" });
  });
  it("keeps a pending action across an offline reload boundary and adopts canonical data only after retry", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const canonical = { runValues: { "run-1": { casesOnCurrentSkid: 12 } } };
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("browser went offline"))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "accepted", data: canonical }) });
    const adopt = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { setOperationalIntentCanonicalAdopter } = await import("./operationalIntentOutbox");
    setOperationalIntentCanonicalAdopter(adopt);
    const intent = queueOperationalIntent({ runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 1, action: "correction", values: { casesOnCurrentSkid: 12 } });
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state: "pending", failure: "network" })]);

    // A reload creates a new owner binding but does not clear the durable key.
    setOperationalIntentIdentity(null);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state: "pending" })]);
    expect(retryOperationalIntent(intent.id)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(adopt).toHaveBeenCalledWith(canonical, expect.objectContaining({ id: intent.id }), "accepted");
    expect(operationalIntentSummary().accepted).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("replays a sending record after a browser death without losing an accepted server action", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    let release!: (value: unknown) => void;
    const firstResponse = new Promise((resolve) => { release = resolve; });
    const fetch = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "accepted" }) });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({ runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 1, action: "pause" });
    const firstFlush = flushOperationalIntentOutbox();
    await vi.waitFor(() => expect(readOperationalIntentOutbox()[0]?.state).toBe("sending"));
    setOperationalIntentIdentity(null);
    release({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "accepted" }) });
    await firstFlush;
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state: "sending" })]);
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().accepted).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("pauses on token expiry and resumes only after explicit auth retry", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "accepted" }) });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({ runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 1, action: "resume" });
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({
      id: intent.id,
      state: "blocked",
      failure: "authentication",
      guidance: "Sign in again, then choose Retry.",
    })]);
    await flushOperationalIntentOutbox();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(retryOperationalIntent(intent.id)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().accepted).toBe(1);
  });
  it("keeps an accepted action replayable when terminal storage is quota-exhausted", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "accepted" }),
    });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({ runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 1, action: "pause" });
    const originalSetItem = Storage.prototype.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key.includes(":terminal:")) throw new DOMException("quota", "QuotaExceededError");
      originalSetItem(key, value);
    });
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state: "sending" })]);
    expect(operationalIntentStorageHealth().writeFailures).toBeGreaterThan(0);

    vi.restoreAllMocks();
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().accepted).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("fences pending intents across reset and makes an explicit retry adopt the new epoch", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ outcome: "accepted" }) });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({ runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 1, action: "pause" });
    const { applyResetWipe } = await import("./adapters/browserResetPersistence");
    expect(applyResetWipe(7)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({
      id: intent.id,
      state: "blocked",
      resetEpoch: 0,
      guidance: expect.stringContaining("before a reset"),
    })]);
    expect(fetch).not.toHaveBeenCalled();
    expect(retryOperationalIntent(intent.id)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state: "accepted", resetEpoch: 7 })]);
  });
  it("surfaces corrupt records and bounds recovery telemetry without deleting valid work", () => {
    const validIntent = queueOperationalIntent({ runId: "valid", observedGeneration: "valid:1", effectiveAt: 1, action: "pause" });
    localStorage.setItem("run-calculator:operational-intent-outbox:v1:pending:corrupt", "{not-json");
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: validIntent.id })]);
    expect(operationalIntentStorageHealth().corruptRecords).toBeGreaterThan(0);
    expect(operationalIntentRecoveryTelemetry()).toMatchObject({
      unresolved: 1,
      pending: 1,
      sending: 0,
      corruptRecords: expect.any(Number),
    });
  });
});