import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseOperationalIntent } from "../../api-server/src/lib/operationalIntents";
import { todayStr } from "./utils";
import {
  flushOperationalIntentOutbox,
  fencePendingEndSnapshots,
  capturePreEndLifecycle,
  operationalIntentBlocksLifecycle,
  operationalIntentBlocksLifecycleAdoption,
  retainOperationalSnapshotReview,
  operationalIntentSummary,
  operationalIntentStorageHealth,
  operationalIntentRecoveryTelemetry,
  queueOperationalIntent,
  readOperationalIntentOutbox,
  retryOperationalIntent,
  discardOperationalIntent,
  setOperationalIntentIdentity,
  setOperationalIntentCanonicalAdopter,
  submitManualSection,
} from "./operationalIntentOutbox";

const canonicalData = (data: Record<string, unknown> = {}) => ({
  dayState: { date: todayStr(), runs: [] }, runValues: {}, ...data,
});
const confirmed = (outcome = "accepted", data: Record<string, unknown> = canonicalData()) => ({
  outcome, data, canonicalRevision: 3, serverTime: Date.now(), snapshotId: "a".repeat(64), cursor: 1,
});

describe("operational intent outbox", () => {
  beforeEach(() => setOperationalIntentIdentity({ scope: "live", userId: "operator-1" }));
  it("retains older snapshot evidence in scoped, immutable, non-replayable review history", async () => {
    const source = {
      version: 1 as const, id: "legacy-snapshot", scope: "live:operator-1",
      date: todayStr(), epoch: 0, baseSnapshotId: "a".repeat(64),
      baseline: canonicalData(), payload: canonicalData({ runValues: { r: { traysOnLine: 9 } } }),
    };
    expect(retainOperationalSnapshotReview(source)).toBe(true);
    const review = readOperationalIntentOutbox()[0];
    expect(review.state).toBe("review-required");
    expect(review.localSnapshotReview).toEqual(source);
    expect(retryOperationalIntent(review.id)).toBe(false);
    expect(discardOperationalIntent(review.id)).toBe(false);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await flushOperationalIntentOutbox();
    expect(fetcher).not.toHaveBeenCalled();
    expect(retainOperationalSnapshotReview(source)).toBe(true);
    expect(retainOperationalSnapshotReview({ ...source, payload: canonicalData() })).toBe(false);
    expect(retainOperationalSnapshotReview({ ...source, operationalReviewRequired: true })).toBe(true);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-2" });
    expect(retainOperationalSnapshotReview(source)).toBe(false);
    expect(readOperationalIntentOutbox()).toEqual([]);
  });

  it("never lets control evidence fence canonical adoption or terminal controls block a new lifecycle", () => {
    const record = {
      version: 1 as const, id: "control-evidence", date: todayStr(), runId: "r",
      observedGeneration: "r:1", resetEpoch: 0, effectiveAt: Date.now(),
      action: "control" as const, control: { kind: "auto-track" as const, enabled: false },
      commandCategory: "correction" as const, deviceId: "device", baseRevision: 1,
      occurredAt: Date.now(), state: "pending" as const,
    };
    expect(operationalIntentBlocksLifecycle("r", [record])).toBe(true);
    expect(operationalIntentBlocksLifecycleAdoption("r", [record])).toBe(false);
    for (const state of ["conflicted", "review-required", "permanently-rejected"] as const) {
      expect(operationalIntentBlocksLifecycle("r", [{ ...record, state }])).toBe(false);
      expect(operationalIntentBlocksLifecycleAdoption("r", [{ ...record, state }])).toBe(false);
    }
  });
  afterEach(() => {
    setOperationalIntentCanonicalAdopter(undefined);
    setOperationalIntentIdentity(null);
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("adopts a rejected correction's canonical totals while preserving its attempted entry", async () => {
    const adopt = vi.fn();
    setOperationalIntentCanonicalAdopter(adopt);
    const data = canonicalData({ runValues: { "run-1": { traysOnLine: 2, batchesReady: 0 } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...confirmed("conflicted", data), code: "section_changed",
    }), { status: 409 })));
    expect(await submitManualSection({
      runId: "run-1", section: "dough", observedGeneration: "run-1:100",
      baseRevision: 2, values: { traysOnLine: 7, batchesReady: 0 },
      baseValues: { traysOnLine: 1, batchesReady: 0 },
    })).toBe("conflicted");
    expect(adopt).toHaveBeenCalledWith(data, expect.objectContaining({
      state: "conflicted", values: { traysOnLine: 2, batchesReady: 0 },
    }), "conflicted");
    const evidence = Object.keys(localStorage).map((key) => {
      try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
    }).find((record) => record?.deliveryState === "rejected");
    expect(evidence?.values.traysOnLine).toBe(7);
  });

  it("fences a manual-section reply across leaving and returning to the same account", async () => {
    const adopt = vi.fn(); setOperationalIntentCanonicalAdopter(adopt);
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const pending = submitManualSection({
      runId: "run-1", section: "dough", observedGeneration: "run-1:100",
      values: { traysOnLine: 7, batchesReady: 0 },
      baseValues: { traysOnLine: 1, batchesReady: 0 },
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const finishOriginal = release;
    setOperationalIntentIdentity(null);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    finishOriginal(new Response(JSON.stringify(confirmed("accepted", canonicalData({
      runValues: { "run-1": { traysOnLine: 7, batchesReady: 0 } },
    })))));
    expect(await pending).toBe("identity-mismatch");
    expect(adopt).not.toHaveBeenCalled();
  });

  it("emits locale-independent completion lines accepted by the server contract", () => {
    const intent = queueOperationalIntent({
      runId: "run-1", observedGeneration: "run-1:100", effectiveAt: Date.now(),
      action: "lifecycle", lifecycle: "end",
      preEndLifecycle: capturePreEndLifecycle({ startedAt: 50, metaUpdatedAt: 100 }),
      inventoryLines: [
        { itemKey: "ingredient:é:lbs", qty: 1 },
        { itemKey: "ingredient:a:lbs", qty: 2 },
        { itemKey: "ingredient:Z:lbs", qty: 3 },
        { itemKey: "ingredient:_:lbs", qty: 4 },
        { itemKey: "ingredient:a:lbs", qty: 5 },
      ],
    });
    expect(intent.inventoryLines?.map((line) => line.itemKey)).toEqual([
      "ingredient:Z:lbs", "ingredient:_:lbs", "ingredient:a:lbs", "ingredient:é:lbs",
    ]);
    expect(intent.inventoryLines?.find((line) => line.itemKey === "ingredient:a:lbs")?.qty).toBe(7);
    expect(parseOperationalIntent(intent)).not.toBeNull();
  });

  it("does not rebase queued same-section deltas from rejected conflict data", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const requests: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, any>;
      requests.push(body);
      const cases = Number(body.values.casesOnCurrentSkid);
      const canonicalCases = requests.length === 1 ? 24 : cases;
      return {
        ok: requests.length > 1,
        status: requests.length === 1 ? 409 : 200,
        json: async () => ({
          canonicalRevision: 3, serverTime: Date.now(),
          ...(requests.length === 1 ? { code: "section_changed" } : { outcome: "accepted" }),
          data: {
            runValues: {
              "run-1": { skidsCompleted: 0, casesOnCurrentSkid: canonicalCases },
            },
          },
        }),
      };
    }));
    const base = { skidsCompleted: 0, casesOnCurrentSkid: 30 };
    await Promise.all([
      submitManualSection({
        runId: "run-1", section: "packaging",
        values: { ...base, casesOnCurrentSkid: 29 }, baseValues: base,
        observedGeneration: "run-1:1",
      }),
      submitManualSection({
        runId: "run-1", section: "packaging",
        values: { ...base, casesOnCurrentSkid: 28 }, baseValues: { ...base, casesOnCurrentSkid: 29 },
        observedGeneration: "run-1:1",
      }),
      submitManualSection({
        runId: "run-1", section: "packaging",
        values: { ...base, casesOnCurrentSkid: 27 }, baseValues: { ...base, casesOnCurrentSkid: 28 },
        observedGeneration: "run-1:1",
      }),
    ]);
    expect(requests.map((request) => request.values.casesOnCurrentSkid)).toEqual([29, 28, 27]);
    expect(requests.map((request) => request.baseValues.casesOnCurrentSkid)).toEqual([30, 29, 28]);
  });

  it("preserves untouched Dough fields when a manual edit supplies only one field", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const requests: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, any>);
      return {
        ok: true,
        status: 200,
        json: async () => ({ outcome: "accepted" }),
      };
    }));

    await submitManualSection({
      runId: "dough-run", section: "dough",
      values: { batchesReady: 1 },
      baseValues: { traysOnLine: 5, batchesReady: 0 },
      observedGeneration: "dough-run:1",
    });

    expect(requests[0]).toMatchObject({
      values: { traysOnLine: 5, batchesReady: 1 },
      baseValues: { traysOnLine: 5, batchesReady: 0 },
    });
  });

  it("uses a newer supplied baseline after the prior section chain drains", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const requests: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, any>;
      requests.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          outcome: "accepted", canonicalRevision: 3, serverTime: Date.now(),
          data: { runValues: { "run-1": { skidsCompleted: 0, casesOnCurrentSkid: body.values.casesOnCurrentSkid } } },
        }),
      };
    }));
    await submitManualSection({
      runId: "run-1", section: "packaging",
      values: { skidsCompleted: 0, casesOnCurrentSkid: 29 },
      baseValues: { skidsCompleted: 0, casesOnCurrentSkid: 30 },
      observedGeneration: "run-1:1",
    });
    await submitManualSection({
      runId: "run-1", section: "packaging",
      values: { skidsCompleted: 0, casesOnCurrentSkid: 49 },
      baseValues: { skidsCompleted: 0, casesOnCurrentSkid: 50 },
      observedGeneration: "run-1:2",
    });
    expect(requests.map((request) => request.baseValues.casesOnCurrentSkid)).toEqual([30, 50]);
    expect(requests.map((request) => request.values.casesOnCurrentSkid)).toEqual([29, 49]);
  });
  it("adopts and caches canonical values when the selected run's section is complete", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const canonical = canonicalData({
      runValues: {
        "run-1": { skidsCompleted: 1, casesOnCurrentSkid: 24 },
      },
    });
    const requests: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, any>);
      return {
        ok: true,
        status: 200,
        json: async () => requests.length === 1
          ? confirmed("accepted", canonical)
          : confirmed("accepted", canonicalData({ runValues: { "run-1": requests.at(-1)?.values } })),
      };
    }));
    const adopt = vi.fn();
    setOperationalIntentCanonicalAdopter(adopt);

    const [first, second] = await Promise.all([
      submitManualSection({
        runId: "run-1", section: "packaging",
        values: { skidsCompleted: 0, casesOnCurrentSkid: 29 },
        baseValues: { skidsCompleted: 0, casesOnCurrentSkid: 30 },
        observedGeneration: "run-1:1",
      }),
      submitManualSection({
        runId: "run-1", section: "packaging",
        values: { skidsCompleted: 0, casesOnCurrentSkid: 28 },
        baseValues: { skidsCompleted: 0, casesOnCurrentSkid: 29 },
        observedGeneration: "run-1:1",
      }),
    ]);

    expect([first, second]).toEqual(["accepted", "accepted"]);
    expect(requests[1]).toMatchObject({
      baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 24 },
      values: { skidsCompleted: 1, casesOnCurrentSkid: 23 },
    });
    expect(adopt).toHaveBeenCalledTimes(2);
    expect(adopt).toHaveBeenCalledWith(
      canonical,
      expect.objectContaining({
        values: { skidsCompleted: 1, casesOnCurrentSkid: 24 },
      }),
      "accepted",
    );
  });
  it.each([
    ["missing selected run values", { runValues: {} }],
    ["malformed section field values", {
      runValues: { "run-1": { skidsCompleted: 0, casesOnCurrentSkid: "24" } },
    }],
  ])("does not adopt or cache canonical data with %s", async (_case, data) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const requests: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, any>);
      return {
        ok: true,
        status: 200,
        json: async () => requests.length === 1
          ? confirmed("accepted", data)
          : confirmed("accepted", canonicalData({ runValues: { "run-1": requests.at(-1)?.values } })),
      };
    }));
    const adopt = vi.fn();
    setOperationalIntentCanonicalAdopter(adopt);

    const [first, second] = await Promise.all([
      submitManualSection({
        runId: "run-1", section: "packaging",
        values: { skidsCompleted: 0, casesOnCurrentSkid: 29 },
        baseValues: { skidsCompleted: 0, casesOnCurrentSkid: 30 },
        observedGeneration: "run-1:1",
      }),
      submitManualSection({
        runId: "run-1", section: "packaging",
        values: { skidsCompleted: 0, casesOnCurrentSkid: 28 },
        baseValues: { skidsCompleted: 0, casesOnCurrentSkid: 29 },
        observedGeneration: "run-1:1",
      }),
    ]);

    expect([first, second]).toEqual(["offline", "accepted"]);
    expect(requests[1]).toMatchObject({
      baseValues: { skidsCompleted: 0, casesOnCurrentSkid: 29 },
      values: { skidsCompleted: 0, casesOnCurrentSkid: 28 },
    });
    expect(adopt).toHaveBeenCalledOnce();
    expect(adopt).toHaveBeenCalledWith(
      expect.objectContaining({ runValues: { "run-1": { skidsCompleted: 0, casesOnCurrentSkid: 28 } } }),
      expect.anything(), "accepted",
    );
  });
  it("retains an incomplete success receipt instead of claiming acceptance", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ outcome: "accepted" }),
    }));
    const intent = queueOperationalIntent({ runId: "run", action: "pause", observedGeneration: "run:1", effectiveAt: 1 });
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state: "pending", failure: "server" })]);
    expect(operationalIntentSummary().accepted).toBe(0);
  });
  it("does not adopt a late response after leaving and returning to the same account", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const adopt = vi.fn();
    setOperationalIntentCanonicalAdopter(adopt);
    let release!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { release = resolve; })));
    const intent = queueOperationalIntent({ runId: "run", action: "pause", observedGeneration: "run:1", effectiveAt: 1 });
    const pending = flushOperationalIntentOutbox();
    setOperationalIntentIdentity(null);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    release({ ok: true, status: 200, json: async () => confirmed() });
    await pending;
    expect(adopt).not.toHaveBeenCalled();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state: "sending" })]);
  });
  it("persists the exact correction and retains it for retry until canonical outcome", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => confirmed() });
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
      json: async () => confirmed(),
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
  it.each([
    [400, "permanently-rejected", "validation"],
    [403, "blocked", "permission"],
  ] as const)("does not retry or discard a %s validation/authorization failure", async (status, state, failure) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn().mockResolvedValue({
      ok: false, status, headers: { get: () => null },
      // A failed response must never be adopted as canonical data.
      json: async () => ({ outcome: "accepted", data: { runValues: { bad: { casesNeeded: 999 } } } }),
    });
    const adopt = vi.fn();
    vi.stubGlobal("fetch", fetch);
    setOperationalIntentCanonicalAdopter(adopt);
    const intent = queueOperationalIntent({ runId: "failure", observedGeneration: "failure:1", effectiveAt: 1, action: "pause" });

    await flushOperationalIntentOutbox();

    expect(fetch).toHaveBeenCalledOnce();
    expect(adopt).not.toHaveBeenCalled();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state, failure })]);
    expect(retryOperationalIntent(intent.id)).toBe(state !== "permanently-rejected");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([400, 422])("retains HTTP %s validation rejection through direct and bulk recovery", async (status) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn().mockResolvedValue({
      ok: false, status, headers: { get: () => null },
      json: async () => ({ error: "Invalid command" }),
    });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({
      runId: "invalid-run", observedGeneration: "invalid-run:1",
      effectiveAt: 1, action: "lifecycle", lifecycle: "start",
    });
    await flushOperationalIntentOutbox();
    const rejected = readOperationalIntentOutbox();
    expect(rejected).toEqual([expect.objectContaining({
      id: intent.id, state: "permanently-rejected", failure: "validation",
    })]);
    expect(retryOperationalIntent(intent.id)).toBe(false);
    await flushOperationalIntentOutbox();
    expect(fetch).toHaveBeenCalledOnce();
    expect(readOperationalIntentOutbox()).toEqual(rejected);
  });

  it("keeps transient 5xx responses queued for backoff", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503, headers: { get: () => null },
      json: async () => ({ outcome: "accepted", data: { invalid: true } }),
    });
    const adopt = vi.fn();
    vi.stubGlobal("fetch", fetch);
    setOperationalIntentCanonicalAdopter(adopt);
    const intent = queueOperationalIntent({ runId: "server", observedGeneration: "server:1", effectiveAt: 1, action: "pause" });

    await flushOperationalIntentOutbox();

    expect(adopt).not.toHaveBeenCalled();
    const [pending] = readOperationalIntentOutbox();
    expect([pending]).toEqual([expect.objectContaining({
      id: intent.id, state: "pending", failure: "server", attempts: 1,
    })]);
    expect(pending?.nextRetryAt).toBeGreaterThan(Date.now());
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("adopts canonical data only for the documented 409 conflict response", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const canonical = canonicalData({ runValues: { "run-1": { casesNeeded: 12 } } });
    const fetch = vi.fn().mockResolvedValue({
      ok: false, status: 409, headers: { get: () => null },
      json: async () => confirmed("conflicted", canonical),
    });
    const adopt = vi.fn();
    vi.stubGlobal("fetch", fetch);
    setOperationalIntentCanonicalAdopter(adopt);
    const intent = queueOperationalIntent({ runId: "run-1", observedGeneration: "run-1:1", effectiveAt: 1, action: "pause" });

    await flushOperationalIntentOutbox();

    expect(adopt).toHaveBeenCalledWith(canonical, expect.objectContaining({ id: intent.id, canonicalRevision: 3 }), "conflicted");
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({ id: intent.id, state: "conflicted" })]);
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
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed("review-required") });
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
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed() })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed("rebased") });
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
  it("keeps an authentication-blocked intent private until its owner explicitly retries it", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 401, headers: { get: () => null }, json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed(),
      });
    vi.stubGlobal("fetch", fetch);

    const intent = queueOperationalIntent({
      runId: "account-switch", observedGeneration: "account-switch:1", effectiveAt: 1, action: "pause",
    });
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({
      id: intent.id, owner: "live:operator-1", state: "blocked", failure: "authentication",
    })]);
    expect(fetch).toHaveBeenCalledTimes(1);

    setOperationalIntentIdentity({ scope: "live", userId: "operator-2" });
    expect(readOperationalIntentOutbox()).toEqual([]);
    expect(retryOperationalIntent(intent.id)).toBe(false);
    await flushOperationalIntentOutbox();
    expect(fetch).toHaveBeenCalledTimes(1);

    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({
      id: intent.id, owner: "live:operator-1", state: "blocked", failure: "authentication",
    })]);
    expect(retryOperationalIntent(intent.id)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({
      id: intent.id, owner: "live:operator-1", state: "accepted",
    })]);
    expect(fetch).toHaveBeenCalledTimes(2);
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
    release({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed() });
    await flushing;
    expect(readOperationalIntentOutbox()).toEqual([]);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    expect(readOperationalIntentOutbox()[0]).toMatchObject({ id: intent.id, state: "sending" });
  });
  it("retains a late 401 as blocked after sign-out and requires an explicit retry", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    let release!: (value: unknown) => void;
    const pendingResponse = new Promise((resolve) => { release = resolve; });
    const fetch = vi.fn()
      .mockReturnValueOnce(pendingResponse)
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: { get: () => null },
        json: async () => confirmed(),
      });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({
      runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 1, action: "pause",
    });
    const flushing = flushOperationalIntentOutbox();
    await vi.waitFor(() => expect(readOperationalIntentOutbox()[0]?.state).toBe("sending"));

    // Model /me rejecting the session before the operational-intent request
    // returns its own 401.
    setOperationalIntentIdentity(null);
    release({
      ok: false, status: 401, headers: { get: () => null }, json: async () => ({}),
    });
    await flushing;
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });

    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining({
      id: intent.id,
      state: "blocked",
      failure: "authentication",
      guidance: "Sign in again, then choose Retry.",
    })]);
    const terminalKey = `run-calculator:operational-intent-outbox:v1:terminal:${intent.id}`;
    expect(JSON.parse(localStorage.getItem(terminalKey) ?? "null")).toMatchObject({
      id: intent.id,
      state: "blocked",
      failure: "authentication",
    });
    setOperationalIntentIdentity(null);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    expect(JSON.parse(localStorage.getItem(terminalKey) ?? "null")).toMatchObject({
      id: intent.id,
      state: "blocked",
      failure: "authentication",
    });
    await flushOperationalIntentOutbox();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(retryOperationalIntent(intent.id)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().accepted).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps a 403 permission denial durable until the same intent is explicitly retried", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const requestIds: string[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { intent: { id: string } };
      requestIds.push(body.intent.id);
      if (requestIds.length === 1) {
        return {
          ok: false, status: 403, headers: { get: () => null }, json: async () => ({}),
        };
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => confirmed(),
      };
    });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({
      runId: "permission", observedGeneration: "permission:1", effectiveAt: 1, action: "pause",
    });

    await flushOperationalIntentOutbox();
    const blocked = {
      id: intent.id,
      state: "blocked",
      failure: "permission",
      guidance: "You do not have permission. Ask a manager, then Retry if access changes.",
    };
    expect(readOperationalIntentOutbox()).toEqual([expect.objectContaining(blocked)]);
    const terminalKey = `run-calculator:operational-intent-outbox:v1:terminal:${intent.id}`;
    expect(JSON.parse(localStorage.getItem(terminalKey) ?? "null")).toMatchObject(blocked);

    // Signing out and back into the same account does not send blocked work.
    setOperationalIntentIdentity(null);
    setOperationalIntentIdentity({ scope: "live", userId: "operator-1" });
    await flushOperationalIntentOutbox();
    expect(JSON.parse(localStorage.getItem(terminalKey) ?? "null")).toMatchObject(blocked);
    expect(fetch).toHaveBeenCalledOnce();
    expect(requestIds).toEqual([intent.id]);

    expect(retryOperationalIntent(intent.id)).toBe(true);
    await flushOperationalIntentOutbox();
    expect(operationalIntentSummary().accepted).toBe(1);
    expect(requestIds).toEqual([intent.id, intent.id]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps a pending action across an offline reload boundary and adopts canonical data only after retry", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const canonical = canonicalData({ runValues: { "run-1": { casesOnCurrentSkid: 12 } } });
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("browser went offline"))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed("accepted", canonical) });
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
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed() });
    vi.stubGlobal("fetch", fetch);
    const intent = queueOperationalIntent({ runId: "run-1", observedGeneration: "run-1:7", effectiveAt: 1, action: "pause" });
    const firstFlush = flushOperationalIntentOutbox();
    await vi.waitFor(() => expect(readOperationalIntentOutbox()[0]?.state).toBe("sending"));
    setOperationalIntentIdentity(null);
    release({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed() });
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
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed() });
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
      ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed(),
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
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, json: async () => confirmed() });
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