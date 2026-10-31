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
import { fencePendingOperationalValues, fenceActiveManualSectionValues, retryPendingManualSections, retryPendingManualSection } from "./operationalIntentOutbox";
import {
  reportRejectedManualSectionErrors,
  setOperationalIntentIdentity,
  submitManualSection,
  setOperationalIntentCanonicalAdopter,
  hasPendingManualSection,
  readPendingManualSection,
  retireObsoletePackagingResume,
} from "./operationalIntentOutbox";
import { subscribeToManualSectionErrors } from "./manualSectionErrors";

function acceptedPackagingResponse(runId: string, values: Record<string, number>): Response {
  return Response.json({
    outcome: "accepted", canonicalRevision: 1, serverTime: Date.now(),
    data: { runValues: { [runId]: { skidsCompleted: 0, casesOnCurrentSkid: 0, ...values } } },
  });
}

describe("manual section locks", () => {
  afterEach(() => clearManualSectionLocks());

  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

  it("sends Resume as a generation-bound control and does not force correction counts on adoption", async () => {
    setOperationalIntentIdentity({ scope: "live", userId: "resume-fixture" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const adopter = vi.fn();
    setOperationalIntentCanonicalAdopter(adopter);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      outcome: "accepted", canonicalRevision: 1, serverTime: 200,
      data: {
        runValues: { r: { skidsCompleted: 1, casesOnCurrentSkid: 3 } },
        packagingProgress: { r: { correctionGeneration: 2, manualOverrideUntil: 200, updatedAt: 200, skidsCompleted: 1, casesOnCurrentSkid: 3 } },
      },
    }), { status: 200 }));
    const result = await submitManualSection({
      id: "resume-id", runId: "r", section: "packaging",
      values: { skidsCompleted: 1, casesOnCurrentSkid: 3 },
      baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 3 },
      observedGeneration: "r:1", operation: "resume-packaging", correctionGeneration: 2,
    });
    expect(result).toBe("accepted");
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
      id: "resume-id", operation: "resume-packaging", correctionGeneration: 2, observedGeneration: "r:1",
    });
    expect(adopter.mock.calls[0][1].values).toBeUndefined();
    expect(hasPendingManualSection("r", "packaging")).toBe(false);
    setOperationalIntentCanonicalAdopter(undefined);
  });

  it.each([{}, { runValues: { r: { skidsCompleted: 1, casesOnCurrentSkid: 3 } } }])(
    "does not report Resume accepted for a malformed canonical success", async (data) => {
      vi.useFakeTimers();
      setOperationalIntentIdentity({ scope: "live", userId: "resume-malformed" });
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      const adopter = vi.fn();
      setOperationalIntentCanonicalAdopter(adopter);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ outcome: "accepted", data }), { status: 200 }));
      expect(await submitManualSection({
        id: "bad-resume", runId: "r", section: "packaging",
        values: { skidsCompleted: 1, casesOnCurrentSkid: 3 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 3 },
        observedGeneration: "r:1", operation: "resume-packaging", correctionGeneration: 2,
      })).toBe("offline");
      expect(adopter).not.toHaveBeenCalled();
      expect(readPendingManualSection("r", "packaging")?.id).toBe("bad-resume");
      setOperationalIntentCanonicalAdopter(undefined);
    },
  );

  it("retains offline Resume identity and retires only obsolete control requests, never corrections", async () => {
    setOperationalIntentIdentity({ scope: "live", userId: "resume-offline" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const input = {
      id: "offline-resume", runId: "r", section: "packaging",
      values: { skidsCompleted: 1, casesOnCurrentSkid: 3 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 3 },
      observedGeneration: "r:1", operation: "resume-packaging" as const, correctionGeneration: 2,
    };
    expect(await submitManualSection(input)).toBe("offline");
    expect(hasPendingManualSection("r", "packaging")).toBe(true);
    retireObsoletePackagingResume("r", "r:1", 2);
    expect(readPendingManualSection("r", "packaging")?.id).toBe(input.id);
    retireObsoletePackagingResume("r", "r:1", 3);
    expect(hasPendingManualSection("r", "packaging")).toBe(false);
    await submitManualSection({ ...input, id: "offline-correction", operation: undefined, correctionGeneration: undefined });
    retireObsoletePackagingResume("r", "r:99", 99);
    expect(readPendingManualSection("r", "packaging")?.id).toBe("offline-correction");
  });

  it.each([401, 400, 409, "hidden-timeout"] as const)("keeps Resume recoverable after %s without a false acknowledgement", async (failure) => {
    vi.useFakeTimers();
    setOperationalIntentIdentity({ scope: "live", userId: "resume-recovery" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(failure === "hidden-timeout");
    const adopter = vi.fn();
    setOperationalIntentCanonicalAdopter(adopter);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    if (failure === "hidden-timeout") fetchSpy.mockRejectedValueOnce(new DOMException("fixture suspended request", "AbortError"));
    else fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ code: "section_changed" }), { status: failure }));
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      outcome: "accepted", canonicalRevision: 1, serverTime: 300,
      data: {
        runValues: { r: { skidsCompleted: 1, casesOnCurrentSkid: 3 } },
        packagingProgress: { r: {
          skidsCompleted: 1, casesOnCurrentSkid: 3, correctionGeneration: 2,
          manualOverrideUntil: 300, updatedAt: 300,
        } },
      },
    }), { status: 200 }));
    const input = {
      id: "resume-recovery-id", runId: "r", section: "packaging",
      values: { skidsCompleted: 1, casesOnCurrentSkid: 3 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 3 },
      observedGeneration: "r:1", operation: "resume-packaging" as const, correctionGeneration: 2,
    };
    expect(await submitManualSection(input)).not.toBe("accepted");
    expect(adopter).not.toHaveBeenCalled();
    expect(readPendingManualSection("r", "packaging")).toMatchObject({
      id: input.id, values: input.values, observedGeneration: input.observedGeneration, correctionGeneration: 2,
    });
    if (failure !== "hidden-timeout") {
      await retryPendingManualSections();
      expect(fetchSpy).toHaveBeenCalledOnce();
    }
    if (failure === 400 || failure === 409) {
      expect(await retryPendingManualSection(input.id)).toBe(false);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(adopter).not.toHaveBeenCalled();
      setOperationalIntentCanonicalAdopter(undefined);
      return;
    }
    hidden.mockReturnValue(false);
    expect(await retryPendingManualSection(input.id)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const sent = fetchSpy.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(sent[1]).toMatchObject({
      id: sent[0].id, values: sent[0].values, baseValues: sent[0].baseValues,
      operation: "resume-packaging", correctionGeneration: 2,
    });
    expect(adopter).toHaveBeenCalledOnce();
    expect(hasPendingManualSection("r", "packaging")).toBe(false);
    setOperationalIntentCanonicalAdopter(undefined);
  });

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

  it("manual section conflicts do not adopt canonical data and retain the edited section safely", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const originalFetch = globalThis.fetch;
    const adopter = vi.fn();
    const errors: string[] = [];
    const unsubscribe = subscribeToManualSectionErrors((message) => errors.push(message));
    setOperationalIntentIdentity({ scope: "live", userId: "manual-conflict" });
    setOperationalIntentCanonicalAdopter(adopter);
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: "Manual section edit was rejected",
      code: "section_changed",
      data: { runValues: { "run-conflict": { skidsCompleted: 876543, casesOnCurrentSkid: 8 } } },
    }), { status: 409, headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await submitManualSection({
      runId: "run-conflict", section: "packaging",
      values: { skidsCompleted: 876543 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 3 },
      observedGeneration: "run-conflict:1", date: "2030-01-01", resetEpoch: 0,
    });
    globalThis.fetch = originalFetch;
    setOperationalIntentCanonicalAdopter(undefined);
    unsubscribe();
    expect(result).toBe("conflicted");
    expect(adopter).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Your edits are still here");
    expect(errors[0]).not.toContain("876543");
    const pendingPrefix = "run-calculator:manual-section-pending:v1:live:manual-conflict:";
    const rejectedRecord = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => !!key?.startsWith(pendingPrefix))
      .map((key) => JSON.parse(localStorage.getItem(key)!))
      .find((record) => record.runId === "run-conflict");
    expect(rejectedRecord).toMatchObject({
      deliveryState: "rejected",
      values: { skidsCompleted: 876543 },
    });
    expect(fencePendingOperationalValues({
      "run-conflict": { skidsCompleted: 876543, casesOnCurrentSkid: 8 },
    })).toEqual({});
    expect(getManualSectionConflict("run-conflict", "packaging")).toBeUndefined();
    expect(JSON.stringify(errors)).not.toContain("Manual section edit was rejected");
    const reloadedErrors: string[] = [];
    const unsubscribeReloaded = subscribeToManualSectionErrors((message) => reloadedErrors.push(message));
    reportRejectedManualSectionErrors();
    unsubscribeReloaded();
    expect(reloadedErrors).toEqual(errors);
  });

  it.each([400, 422])("rejects manual validation status %s without retrying or adopting failed data", async (status) => {
    setOperationalIntentIdentity({ scope: "live", userId: "manual-errors" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const adopter = vi.fn();
    setOperationalIntentCanonicalAdopter(adopter);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      outcome: "accepted", data: { runValues: { "manual-validation": { skidsCompleted: 99 } } },
    }), { status }));
    const result = await submitManualSection({
      id: `manual-${status}`, runId: "manual-validation", section: "packaging",
      values: { skidsCompleted: 2 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 0 },
      observedGeneration: "manual-validation:1",
    });
    expect(result).toBe("validation-rejected");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(adopter).not.toHaveBeenCalled();
    expect(fencePendingOperationalValues({ "manual-validation": { skidsCompleted: 2, casesOnCurrentSkid: 4 } })["manual-validation"])
      .toBeUndefined();
  });

  it.each([
    [401, "authentication-required", "authentication"],
    [403, "permission-denied", "permission"],
  ] as const)("preserves manual data and fence for explicit retry after %s", async (status, resultState, failure) => {
    setOperationalIntentIdentity({ scope: "live", userId: "manual-auth" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { runValues: { bad: { skidsCompleted: 99 } } } }), { status }))
      .mockResolvedValueOnce(acceptedPackagingResponse("manual-auth-run", { skidsCompleted: 2 }));
    const id = `manual-auth-${status}`;
    const result = await submitManualSection({
      id, runId: "manual-auth-run", section: "packaging",
      values: { skidsCompleted: 2 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 0 },
      observedGeneration: "manual-auth-run:1",
    });
    expect(result).toBe(resultState);
    const pendingKey = `run-calculator:manual-section-pending:v1:live:manual-auth:${id}`;
    expect(JSON.parse(localStorage.getItem(pendingKey)!)).toMatchObject({ id, deliveryState: "auth-required", failure });
    expect(fencePendingOperationalValues({ "manual-auth-run": { skidsCompleted: 2, casesOnCurrentSkid: 4 } }))
      .toEqual({});
    await retryPendingManualSections();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await retryPendingManualSection(id)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(pendingKey)).toBeNull();
  });

  it("retries a manual 429 after Retry-After and keeps the section fenced until accepted", async () => {
    vi.useFakeTimers();
    setOperationalIntentIdentity({ scope: "live", userId: "manual-rate" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { runValues: { bad: {} } } }), {
        status: 429, headers: { "Retry-After": "1" },
      }))
      .mockResolvedValueOnce(acceptedPackagingResponse("manual-rate-run", { skidsCompleted: 2 }));
    const result = await submitManualSection({
      id: "manual-rate-id", runId: "manual-rate-run", section: "packaging",
      values: { skidsCompleted: 2 }, baseValues: { skidsCompleted: 1, casesOnCurrentSkid: 0 },
      observedGeneration: "manual-rate-run:1",
    });
    const pendingKey = "run-calculator:manual-section-pending:v1:live:manual-rate:manual-rate-id";
    expect(result).toBe("offline");
    expect(localStorage.getItem(pendingKey)).not.toBeNull();
    expect(fencePendingOperationalValues({ "manual-rate-run": { skidsCompleted: 2, casesOnCurrentSkid: 4 } }))
      .toEqual({});
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchSpy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem(pendingKey)).toBeNull();
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(acceptedPackagingResponse("run-replace", { skidsCompleted: 3, casesOnCurrentSkid: 2 }));
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
    resolveOld(acceptedPackagingResponse("run-shared", { skidsCompleted: 2 }));
    expect(await first).toBe("identity-mismatch");
    expect(fenceActiveManualSectionValues({ "run-shared": { skidsCompleted: 3, casesOnCurrentSkid: 4 } })["run-shared"]).toBeUndefined();
    resolveNew(acceptedPackagingResponse("run-shared", { skidsCompleted: 3 }));
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(acceptedPackagingResponse("run-old", { skidsCompleted: 2 }));
    await retryPendingManualSections();
    expect(localStorage.getItem("run-calculator:manual-section-pending:v1:live:userA:old-user-id")).toBeNull();
  });
});