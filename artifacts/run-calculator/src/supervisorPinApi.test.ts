import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSupervisorPin, updateSupervisorPin, verifySupervisorPin } from "./supervisorPinApi";
import { purgeLegacyPinCopies } from "./purgeLegacyPinCopies";
import { captureMasterDataSnapshot, restoreMasterDataSnapshot, loadList, saveList } from "./storage";
import { resetFactoryDataSyncForTests, setFactoryDataIdentity, hydrateFromServer } from "./factoryDataSync";
import { BRANDS_KEY } from "./types";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  localStorage.clear(); resetFactoryDataSyncForTests();
  setFactoryDataIdentity("live:fixture", true); hydrateFromServer({});
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("online PIN contract", () => {
  it("keeps only nonsecret status and rejects a legacy secret response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ configured: true })));
    expect(await fetchSupervisorPin()).toEqual({ configured: true });
    expect(await updateSupervisorPin("4826")).toEqual({ configured: true });
    expect(localStorage.getItem("run-calc-supervisor-pin")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => response({ pin: "4826" })));
    await expect(fetchSupervisorPin()).rejects.toThrow("Update");
  });
  it.each([[401, /expired/i], [403, /incorrect/i], [429, /wait/i], [503, /unavailable/i]])(
    "never unlocks on HTTP %i", async (status, message) => {
      vi.stubGlobal("fetch", vi.fn(async () => response({}, status as number)));
      await expect(verifySupervisorPin("4826")).rejects.toThrow(message as RegExp);
    },
  );
  it("never treats a malformed success as verification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({})));
    await expect(verifySupervisorPin("4826")).rejects.toThrow("failed");
  });
  it("distinguishes network failure from a wrong PIN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(verifySupervisorPin("4826")).rejects.toThrow(/online|connect/i);
  });
  it("times out without unlocking", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const check = expect(verifySupervisorPin("4826")).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(10_000); await check;
  });
});
describe("targeted PIN cleanup and historical undo", () => {
  it("removes nested PIN snapshots while retaining other history/recovery", () => {
    localStorage.setItem("run-calc-supervisor-pin", "4826");
    localStorage.setItem("run-calc-change-history", JSON.stringify([{ snapshot: {
      "run-calc-supervisor-pin": "4826", keep: "keep", nested: JSON.stringify({
        "run-calc-supervisor-pin": "4826", preserved: 7,
      }),
    } }]));
    localStorage.setItem("run-calc-day", "production");
    purgeLegacyPinCopies();
    expect(localStorage.getItem("run-calc-change-history")).not.toContain("4826");
    expect(localStorage.getItem("run-calc-change-history")).toContain("preserved");
    expect(localStorage.getItem("run-calc-day")).toBe("production");
  });
  it("routes undo through the directory without recreating a PIN or a live cache", () => {
    saveList(BRANDS_KEY, ["Original"]);
    const snapshot = captureMasterDataSnapshot();
    saveList(BRANDS_KEY, ["Changed"]);
    restoreMasterDataSnapshot({ ...snapshot, "run-calc-supervisor-pin": "4826" });
    expect(loadList(BRANDS_KEY, [])).toEqual(["Original"]);
    expect(localStorage.getItem(BRANDS_KEY)).toBeNull();
    expect(localStorage.getItem("run-calc-supervisor-pin")).toBeNull();
  });
});
