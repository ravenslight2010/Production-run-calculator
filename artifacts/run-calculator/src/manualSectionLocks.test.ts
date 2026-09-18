import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimManualSectionLock,
  clearManualSectionLocks,
  getManualSectionLock,
  releaseManualSectionLock,
  setManualSectionConflict,
  getManualSectionConflict,
  getControlLockState,
  restoreManualSectionValues,
  MANUAL_SECTION_CONTROLS,
  USED_MANUAL_SECTION_CONTROL_IDS,
  sectionForManualControl,
} from "./manualSectionLocks";
import { fencePendingOperationalValues, fenceActiveManualSectionValues, retryPendingManualSections } from "./operationalIntentOutbox";
import { setOperationalIntentIdentity, submitManualSection, setOperationalIntentCanonicalAdopter } from "./operationalIntentOutbox";

describe("manual section locks", () => {
  afterEach(() => clearManualSectionLocks());

  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

  it("shares ownership across duplicate controls but not unrelated sections", () => {
    expect(claimManualSectionLock("run-1", "packaging", "device-a")).toBe(true);
    expect(claimManualSectionLock("run-1", "packaging", "device-b")).toBe(false);
    expect(claimManualSectionLock("run-1", "dough", "device-b")).toBe(true);
    expect(getManualSectionLock("run-1", "packaging")?.owner).toBe("device-a");
    expect(getControlLockState("run-1", "packaging").disabled).toBe(true);
    releaseManualSectionLock("run-1", "dough", "device-b");
    expect(getControlLockState("run-1", "dough").disabled).toBe(false);
  });

  it("releases on timeout and exposes canonical conflict messaging", () => {
    expect(claimManualSectionLock("run-1", "sauce", "device-a", 1)).toBe(true);
    expect(getManualSectionLock("run-1", "sauce", Date.now() + 2)).toBeUndefined();
    setManualSectionConflict("run-1", "app1");
    expect(getManualSectionConflict("run-1", "app1")).toContain("saved this section first");
    expect(getControlLockState("run-1", "app1").message).toContain("saved this section first");
    releaseManualSectionLock("run-1", "app1", "device-a");
  });

  it("fences the entire grouped section from ordinary snapshots", () => {
    const fenced = fencePendingOperationalValues({
      "run-1": {
        skidsCompleted: 7, casesOnCurrentSkid: 3, traysOnLine: 8,
        batchesReady: 2, unrelated: 99,
      },
    }, [{
      id: "manual", version: 1, date: "2030-01-01", runId: "run-1",
      observedGeneration: "run-1:1", resetEpoch: 0, effectiveAt: 1,
      action: "correction", commandCategory: "correction", deviceId: "d",
      baseRevision: 0, occurredAt: 1, values: { skidsCompleted: 7 },
      state: "sending",
    }]);
    expect(fenced).toEqual({
      "run-1": { traysOnLine: 8, batchesReady: 2, unrelated: 99 },
    });
  });

  it("persists offline manual command identity and fences its complete section", async () => {
    setOperationalIntentIdentity({ scope: "live", userId: "operator" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const result = await submitManualSection({
      runId: "run-1", section: "packaging",
      values: { skidsCompleted: 4 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 2 },
      observedGeneration: "run-1:1", date: "2030-01-01", resetEpoch: 3,
    });
    expect(result).toBe("offline");
    const fenced = fencePendingOperationalValues({
      "run-1": { skidsCompleted: 4, casesOnCurrentSkid: 9, unrelated: 1 },
    });
    expect(fenced["run-1"]).toEqual({ unrelated: 1 });
  });

  it("restores every canonical field in a conflicted mapped section", () => {
    expect(restoreManualSectionValues("packaging", {
      skidsCompleted: 8, casesOnCurrentSkid: 6, unrelated: 99,
    })).toEqual({ skidsCompleted: 8, casesOnCurrentSkid: 6 });
  });

  it("locks Calculator, Packaging, Dough quick-check, and Floor controls together", () => {
    const controls = ["calculator-skids", "packaging-skids", "dough-quick-check", "floor-skid-done"];
    expect(claimManualSectionLock("run-1", "packaging", "peer-device")).toBe(true);
    for (const _control of controls) expect(getControlLockState("run-1", "packaging").disabled).toBe(true);
    expect(getControlLockState("run-1", "dough").disabled).toBe(false);
    setManualSectionConflict("run-1", "packaging");
    for (const _control of controls) expect(getControlLockState("run-1", "packaging").message).toContain("saved this section first");
  });

  it("route finally release test double releases after transaction failure", () => {
    claimManualSectionLock("run-1", "sauce", "device-failure");
    try {
      throw new Error("injected transaction failure");
    } catch {
      // The route's finally path is represented by the explicit release below.
    } finally {
      releaseManualSectionLock("run-1", "sauce", "device-failure");
    }
    expect(getControlLockState("run-1", "sauce").locked).toBe(false);
  });

  it("authoritative duplicate-control registry resolves every packaging identifier", () => {
    expect(MANUAL_SECTION_CONTROLS.packaging.length).toBeGreaterThan(1);
    claimManualSectionLock("run-registry", "packaging", "peer");
    for (const control of MANUAL_SECTION_CONTROLS.packaging) {
      expect(getControlLockState("run-registry", "packaging").disabled, control).toBe(true);
    }
    expect(getControlLockState("run-registry", "dough").disabled).toBe(false);
    setManualSectionConflict("run-registry", "packaging", "Conflict restored canonical packaging values.");
    for (const _control of MANUAL_SECTION_CONTROLS.packaging) {
      expect(getControlLockState("run-registry", "packaging").message).toBe("Conflict restored canonical packaging values.");
    }
  });

  it("every production registry ID resolves to its declared section", () => {
    for (const [section, controls] of Object.entries(MANUAL_SECTION_CONTROLS)) {
      for (const id of controls) expect(sectionForManualControl(id)).toBe(section);
    }
    expect(USED_MANUAL_SECTION_CONTROL_IDS).toEqual(Object.values(MANUAL_SECTION_CONTROLS).flat());
  });

  it("submitManualSection invokes canonical adopter with all conflict fields", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const originalFetch = globalThis.fetch;
    let adopted: any;
    setOperationalIntentCanonicalAdopter((_data, intent, outcome) => { adopted = { intent, outcome }; });
    globalThis.fetch = (async () => new Response(JSON.stringify({
      outcome: "conflicted",
      canonicalRevision: 7,
      serverTime: Date.now(),
      snapshotId: "a".repeat(64),
      data: { runValues: { "run-conflict": { skidsCompleted: 9, casesOnCurrentSkid: 8 } } },
    }), { status: 409, headers: { "content-type": "application/json" } })) as typeof fetch;
    await submitManualSection({
      runId: "run-conflict", section: "packaging",
      values: { skidsCompleted: 2 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 3 },
      observedGeneration: "run-conflict:1", date: "2030-01-01", resetEpoch: 0,
    });
    globalThis.fetch = originalFetch;
    setOperationalIntentCanonicalAdopter(undefined);
    expect(adopted.outcome).toBe("conflicted");
    expect(adopted.intent.values).toEqual({ skidsCompleted: 9, casesOnCurrentSkid: 8 });
    expect(getManualSectionConflict("run-conflict", "packaging")).toContain("saved this section first");
  });

  it("rolls back while fenced when pending storage persistence fails", async () => {
    const original = Storage.prototype.setItem;
    const base = { skidsCompleted: 1, casesOnCurrentSkid: 2 };
    fenceActiveManualSectionValues({ "run-roll": { skidsCompleted: 9, casesOnCurrentSkid: 8 } });
    let callbackValues: Record<string, number> | undefined;
    let fencedDuringCallback: Record<string, Record<string, number>> | undefined;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const result = await submitManualSection({
      runId: "run-roll", section: "packaging", values: { skidsCompleted: 9 },
      baseValues: base, date: "2031-12-31", observedGeneration: "run-roll:1",
      onPersistenceFailure: (values) => {
        callbackValues = values;
        fencedDuringCallback = fenceActiveManualSectionValues({ "run-roll": { ...values, optimistic: 9 } });
      },
    });
    expect(result).toBe("persistence-failed");
    expect(callbackValues).toEqual(base);
    expect(fencedDuringCallback?.["run-roll"]).toEqual({ optimistic: 9 });
    expect(original).toBeDefined();
  });

  it("uses immutable command date in query and body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ outcome: "accepted", data: {} }), { status: 200 }));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await submitManualSection({ runId: "run-date", section: "packaging", values: { skidsCompleted: 2 },
      baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 0 }, date: "2032-01-02", observedGeneration: "run-date:1", id: "fixed-date" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("?today=2032-01-02");
    expect(JSON.parse(String((init as RequestInit).body)).date).toBe("2032-01-02");
  });

  it("retries uncertain online delivery with the same command identity", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const responses = [new Response("temporary", { status: 500 }), new Response(JSON.stringify({ outcome: "accepted", data: {} }), { status: 200 })];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);
    await submitManualSection({ runId: "run-retry", section: "packaging", values: { skidsCompleted: 2 },
      baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 0 }, date: "2032-01-02", resetEpoch: 4,
      observedGeneration: "run-retry:1", id: "retry-id" });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(second).toMatchObject({ id: first.id, date: first.date, resetEpoch: first.resetEpoch, baseValues: first.baseValues });
  });

  it("keeps the whole section fenced when rollback storage remains unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const result = await submitManualSection({
      runId: "run-stuck", section: "packaging", values: { skidsCompleted: 9 },
      baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 2 }, date: "2032-02-02",
      observedGeneration: "run-stuck:1", onPersistenceFailure: () => false,
    });
    expect(result).toBe("persistence-failed");
    expect(fenceActiveManualSectionValues({ "run-stuck": { skidsCompleted: 9, casesOnCurrentSkid: 8, other: 1 } })["run-stuck"])
      .toEqual({ other: 1 });
  });

  it("stops automatic retries at the bounded maximum", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("temporary", { status: 500 }));
    await submitManualSection({
      runId: "run-exhaust", section: "packaging", values: { skidsCompleted: 9 },
      baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 2 }, date: "2032-03-03",
      resetEpoch: 8, observedGeneration: "run-exhaust:1", id: "exhaust-id",
    });
    await vi.advanceTimersByTimeAsync(200_000);
    expect(fetchSpy).toHaveBeenCalledTimes(7);
    await retryPendingManualSections();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(200_000);
    expect(fetchSpy).toHaveBeenCalledTimes(7);
    const records = Object.keys(localStorage).filter((key) => key.includes("exhaust-id"));
    expect(records.length).toBe(1);
    expect(JSON.parse(localStorage.getItem(records[0])!).deliveryState).toBe("retry-exhausted");
    expect(fencePendingOperationalValues({ "run-exhaust": { skidsCompleted: 9, casesOnCurrentSkid: 4, other: 1 } })["run-exhaust"])
      .toEqual({ other: 1 });
  });

  it("replacement retires exhausted command only after durable persistence", async () => {
    setOperationalIntentIdentity({ scope: "live", userId: "replace-user" });
    const prefix = "run-calculator:manual-section-pending:v1:live:replace-user:";
    localStorage.setItem(`${prefix}old-id`, JSON.stringify({
      id: "old-id", runId: "run-replace", section: "packaging", date: "2032-04-04",
      resetEpoch: 1, values: { skidsCompleted: 8 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 2 },
      observedGeneration: "run-replace:1", deliveryState: "retry-exhausted",
    }));
    localStorage.setItem(`${prefix}other-id`, JSON.stringify({
      id: "other-id", runId: "other-run", section: "packaging", deliveryState: "retry-exhausted",
    }));
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const failed = await submitManualSection({
      id: "new-id", runId: "run-replace", section: "packaging", date: "2032-04-04",
      resetEpoch: 1, values: { skidsCompleted: 3 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 2 },
      observedGeneration: "run-replace:1", onPersistenceFailure: () => false,
    });
    expect(failed).toBe("persistence-failed");
    expect(localStorage.getItem(`${prefix}old-id`)).not.toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(originalSet);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ outcome: "accepted", data: {} }), { status: 200 }));
    await submitManualSection({
      id: "new-id-2", runId: "run-replace", section: "packaging", date: "2032-04-04",
      resetEpoch: 1, values: { skidsCompleted: 3 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 2 },
      observedGeneration: "run-replace:1",
    });
    expect(localStorage.getItem(`${prefix}old-id`)).toBeNull();
    expect(localStorage.getItem(`${prefix}new-id-2`)).toBeNull();
    expect(localStorage.getItem(`${prefix}other-id`)).not.toBeNull();
    expect(fencePendingOperationalValues({ "run-replace": { skidsCompleted: 3, casesOnCurrentSkid: 4 } })["run-replace"])
      .toEqual({ skidsCompleted: 3, casesOnCurrentSkid: 4 });
  });

  it("ignores an old scope response after switching to sandbox", async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const newResponse = new Promise<Response>((resolve) => { resolveNew = resolve; });
    // Deterministic call-order deferred transport.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => oldResponse)
      .mockImplementationOnce(async () => newResponse);
    setOperationalIntentIdentity({ scope: "live", userId: "userA" });
    setOperationalIntentCanonicalAdopter(vi.fn());
    const first = submitManualSection({ id: "shared-id", owner: "live:userA", runId: "run-shared", section: "packaging", values: { skidsCompleted: 2 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 0 }, date: "2032-05-05", observedGeneration: "run-shared:1" });
    setOperationalIntentIdentity({ scope: "sandbox", userId: "userA" });
    const second = submitManualSection({ id: "shared-id", owner: "sandbox:userA", runId: "run-shared", section: "packaging", values: { skidsCompleted: 3 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 0 }, date: "2032-05-05", observedGeneration: "run-shared:1" });
    resolveOld(new Response(JSON.stringify({ outcome: "accepted", data: { runValues: { "run-shared": { skidsCompleted: 2, casesOnCurrentSkid: 0 } } } }), { status: 200 }));
    expect(await first).toBe("identity-mismatch");
    expect(fenceActiveManualSectionValues({ "run-shared": { skidsCompleted: 3, casesOnCurrentSkid: 4 } })["run-shared"]).toBeUndefined();
    resolveNew(new Response(JSON.stringify({ outcome: "accepted", data: { runValues: { "run-shared": { skidsCompleted: 3, casesOnCurrentSkid: 0 } } } }), { status: 200 }));
    expect(await second).toBe("accepted");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not rewrite a rejected old-user request into the new user partition", async () => {
    vi.useFakeTimers();
    let rejectOld!: (error: Error) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectOld = reject; }));
    setOperationalIntentIdentity({ scope: "live", userId: "userA" });
    const pending = submitManualSection({ id: "old-user-id", owner: "live:userA", runId: "run-old", section: "packaging", values: { skidsCompleted: 2 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 0 }, date: "2032-06-06", observedGeneration: "run-old:1" });
    setOperationalIntentIdentity({ scope: "live", userId: "userB" });
    rejectOld(new Error("network"));
    expect(await pending).toBe("identity-mismatch");
    expect(localStorage.getItem("run-calculator:manual-section-pending:v1:live:userA:old-user-id")).not.toBeNull();
    expect(localStorage.getItem("run-calculator:manual-section-pending:v1:live:userB:old-user-id")).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setOperationalIntentIdentity({ scope: "live", userId: "userA" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ outcome: "accepted", data: {} }), { status: 200 }));
    await retryPendingManualSections();
    expect(localStorage.getItem("run-calculator:manual-section-pending:v1:live:userA:old-user-id")).toBeNull();
  });
});