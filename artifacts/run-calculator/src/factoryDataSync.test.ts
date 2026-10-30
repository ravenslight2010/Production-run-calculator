import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchFactoryData, flushFactoryQueue, getShiftStartTime, getProductionStartTime, getStopReasons, getPackagingSettings, hydrateFromServer,
  putFactoryKey, resetFactoryDataSyncForTests, setFactoryDataIdentity,
  runFactoryKvMigration, legacyDirectoryReviews, resolveLegacyDirectoryReview,
} from "./factoryDataSync";
import { BRANDS_KEY, DOUGH_RECIPE_NAMES_KEY, DOUGH_RECIPE_PRESETS_KEY, SHIFT_START_TIME_KEY,
  STOP_REASONS_KEY, CIRCLES_KEY, SHIPPER_KEY, SKID_STACKING_KEY, GRIP_SHEETS_KEY, PRODUCTION_START_TIME_KEY } from "./types";
import { directoryRaw, factoryDirectoryState, subscribeFactoryDirectory } from "./factoryDirectory";
import { browserStorage } from "./adapters/browserRecordStore";

const queueKey = (identity = "live:manager") => `run-calc-fkv-queue-v2:${encodeURIComponent(identity)}`;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
function ack(init?: RequestInit) {
  const op = JSON.parse(String(init?.body));
  return response({ value: op.value, updatedAt: new Date(op.updatedAt).toISOString() });
}
const pending = () => JSON.parse(localStorage.getItem(queueKey()) ?? "[]");
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => {
  localStorage.clear(); resetFactoryDataSyncForTests();
  setFactoryDataIdentity("live:manager", true); hydrateFromServer({});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("memory directory and scoped durable commands", () => {
  it("loads manager-configured operational settings for fresh staff and across scope changes, without defaults or caches", async () => {
    const values = (scope: string) => ({
      [STOP_REASONS_KEY]: [`${scope} custom stop`],
      [CIRCLES_KEY]: [`${scope} custom circle`], [SHIPPER_KEY]: [`${scope} custom shipper`],
      [SKID_STACKING_KEY]: [`${scope} custom stack`], [GRIP_SHEETS_KEY]: [`${scope} custom grip`],
      [SHIFT_START_TIME_KEY]: scope === "live" ? "04:25" : "06:35",
      [PRODUCTION_START_TIME_KEY]: scope === "live" ? "05:10" : "07:20",
    });
    const assertSettings = (expected: ReturnType<typeof values>) => {
      expect(getStopReasons()).toEqual(expected[STOP_REASONS_KEY]);
      expect(getPackagingSettings()).toEqual({
        circles: expected[CIRCLES_KEY], shipper: expected[SHIPPER_KEY],
        skidStacking: expected[SKID_STACKING_KEY], gripSheets: expected[GRIP_SHEETS_KEY],
      });
      expect(getShiftStartTime()).toBe(expected[SHIFT_START_TIME_KEY]);
      expect(getProductionStartTime()).toBe(expected[PRODUCTION_START_TIME_KEY]);
    };
    for (const scope of ["live", "sandbox", "live"]) {
      setFactoryDataIdentity(`${scope}:staff`, false);
      const expected = values(scope);
      const read = vi.fn(async (_url: RequestInfo | URL) => response({ data: Object.fromEntries(
        Object.entries(expected).map(([key, value]) => [key, { value, updatedAt: new Date().toISOString() }]),
      ) }));
      vi.stubGlobal("fetch", read);
      const data = await fetchFactoryData();
      hydrateFromServer(data!);
      expect(read.mock.calls[0][0]).toBe("/api/factory-data/operational");
      assertSettings(expected);
      for (const key of Object.keys(expected)) expect(localStorage.getItem(key)).toBeNull();
      putFactoryKey(STOP_REASONS_KEY, ["staff forbidden write"]);
      assertSettings(expected); expect(read).toHaveBeenCalledTimes(1);
    }
  });
  it("recovers raw legacy factory settings with absent server rows only after explicit acknowledged Apply", async () => {
    const legacy: Record<string, unknown> = {
      [STOP_REASONS_KEY]: ["Custom fixture stop"],
      [CIRCLES_KEY]: ["Custom fixture circle"],
      [SHIPPER_KEY]: ["Custom fixture shipper"],
      [SKID_STACKING_KEY]: ["Custom fixture stack"],
      [GRIP_SHEETS_KEY]: ["Custom fixture grip"],
      [SHIFT_START_TIME_KEY]: "04:25",
      [PRODUCTION_START_TIME_KEY]: "05:10",
    };
    const originalBytes = new Map(Object.entries(legacy).map(([key, value]) => [key, ` ${JSON.stringify(value)} `]));
    for (const [key, raw] of originalBytes) localStorage.setItem(key, raw);
    const offline = vi.fn(async () => response({}, 503)); vi.stubGlobal("fetch", offline);
    hydrateFromServer({});
    await runFactoryKvMigration({});
    expect(offline).not.toHaveBeenCalled();
    expect(legacyDirectoryReviews().map((item) => item.key).sort()).toEqual(Object.keys(legacy).sort());
    for (const [key, raw] of originalBytes) expect(localStorage.getItem(key)).toBe(raw);
    // Staff cannot turn these unowned settings into writes or claim ownership.
    setFactoryDataIdentity("live:staff", false); hydrateFromServer({});
    expect(legacyDirectoryReviews()).toEqual([]);
    await runFactoryKvMigration({}); expect(offline).not.toHaveBeenCalled();
    setFactoryDataIdentity("live:manager", true); hydrateFromServer({});
    const first = legacyDirectoryReviews().find((item) => item.key === STOP_REASONS_KEY)!;
    expect(await resolveLegacyDirectoryReview(first, true)).toBe(false);
    expect(localStorage.getItem(STOP_REASONS_KEY)).toBe(originalBytes.get(STOP_REASONS_KEY));
    expect(pending()).toHaveLength(1);
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => ack(init)));
    for (const review of legacyDirectoryReviews()) expect(await resolveLegacyDirectoryReview(review, true)).toBe(true);
    expect(legacyDirectoryReviews()).toEqual([]);
    expect(pending()).toEqual([]);
    for (const key of Object.keys(legacy)) expect(localStorage.getItem(key)).toBeNull();
    expect(getStopReasons()).toEqual(legacy[STOP_REASONS_KEY]);
    expect(getPackagingSettings()).toEqual({
      circles: legacy[CIRCLES_KEY], shipper: legacy[SHIPPER_KEY],
      skidStacking: legacy[SKID_STACKING_KEY], gripSheets: legacy[GRIP_SHEETS_KEY],
    });
    expect(getShiftStartTime()).toBe("04:25");
  });
  it("retains customized legacy setting bytes through a malformed acknowledgment and supports explicit Keep", async () => {
    const raw = '  ["Custom fixture shipper"]  ';
    localStorage.setItem(SHIPPER_KEY, raw);
    hydrateFromServer({});
    vi.stubGlobal("fetch", vi.fn(async () => response({ updatedAt: "not-a-date", value: [] })));
    const review = legacyDirectoryReviews().find((item) => item.key === SHIPPER_KEY)!;
    expect(await resolveLegacyDirectoryReview(review, true)).toBe(false);
    expect(localStorage.getItem(SHIPPER_KEY)).toBe(raw);
    expect(pending()).toHaveLength(1);
    expect(await resolveLegacyDirectoryReview(review, false)).toBe(false);
    expect(localStorage.getItem(SHIPPER_KEY)).toBe(raw);
    // Use a clean legacy source for the Keep decision, with no new authorized
    // pending command to confuse with an unowned source.
    localStorage.setItem(GRIP_SHEETS_KEY, raw);
    const keep = legacyDirectoryReviews().find((item) => item.key === GRIP_SHEETS_KEY)!;
    expect(await resolveLegacyDirectoryReview(keep, false)).toBe(true);
    expect(localStorage.getItem(GRIP_SHEETS_KEY)).toBeNull();
    expect(localStorage.getItem(SHIPPER_KEY)).toBe(raw);
    expect(pending()).toHaveLength(1);
  });
  it("does not hide legacy settings behind unreadable unowned queue evidence or omit legacy conflict records", async () => {
    const queueRaw = "unreadable fixture queue";
    const stopsRaw = '["Custom fixture stop"]';
    const conflictRaw = '{"brands":["Retired fixture brand"]}';
    localStorage.setItem("run-calc-fkv-queue-v1", queueRaw);
    localStorage.setItem(STOP_REASONS_KEY, stopsRaw);
    localStorage.setItem("run-calc-deleted-items", conflictRaw);
    hydrateFromServer({});
    expect(legacyDirectoryReviews().map((review) => review.key)).toEqual(expect.arrayContaining([
      STOP_REASONS_KEY, "run-calc-deleted-items",
    ]));
    expect(localStorage.getItem("run-calc-fkv-queue-v1")).toBe(queueRaw);
    expect(localStorage.getItem(STOP_REASONS_KEY)).toBe(stopsRaw);
    expect(localStorage.getItem("run-calc-deleted-items")).toBe(conflictRaw);
    const unreadable = legacyDirectoryReviews().find((review) => review.source === "run-calc-fkv-queue-v1")!;
    expect(unreadable).toMatchObject({ canRemove: false, problem: expect.any(String) });
    expect(await resolveLegacyDirectoryReview(unreadable, false)).toBe(false);
    expect(localStorage.getItem("run-calc-fkv-queue-v1")).toBe(queueRaw);
  });
  it("protects unowned pending entries from removal and applies only the selected duplicate", async () => {
    const raw = JSON.stringify([
      { key: BRANDS_KEY, value: ["Legacy"], updatedAt: 10, g: 1 },
      { key: BRANDS_KEY, value: ["Legacy"], updatedAt: 11, g: 2 },
    ]);
    localStorage.setItem("run-calc-fkv-queue-v1", raw);
    const reviews = legacyDirectoryReviews().filter((review) => review.source === "run-calc-fkv-queue-v1");
    expect(reviews).toHaveLength(2);
    expect(reviews[0].id).not.toBe(reviews[1].id);
    expect(reviews[0]).toMatchObject({ canApply: true, canRemove: false });
    expect(await resolveLegacyDirectoryReview(reviews[0], false)).toBe(false);
    expect(localStorage.getItem("run-calc-fkv-queue-v1")).toBe(raw);
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => ack(init)));
    expect(await resolveLegacyDirectoryReview(reviews[0], true)).toBe(true);
    expect(JSON.parse(localStorage.getItem("run-calc-fkv-queue-v1")!)).toEqual([JSON.parse(raw)[1]]);
    expect(await resolveLegacyDirectoryReview(reviews[1], false)).toBe(false);
  });
  it("does not remove a legacy edit if its saved bytes changed after review", async () => {
    const raw = '["Reviewed copy"]';
    localStorage.setItem(STOP_REASONS_KEY, raw);
    const review = legacyDirectoryReviews().find((item) => item.key === STOP_REASONS_KEY)!;
    localStorage.setItem(STOP_REASONS_KEY, '["Newer local copy"]');
    expect(await resolveLegacyDirectoryReview(review, false)).toBe(false);
    expect(localStorage.getItem(STOP_REASONS_KEY)).toBe('["Newer local copy"]');
  });
  it("rejects an old read receipt even if identity changes after fetch resolves", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: {} })));
    const data = await fetchFactoryData();
    setFactoryDataIdentity("sandbox:other", true);
    expect(() => hydrateFromServer(data)).toThrow("superseded");
    expect(factoryDirectoryState().status).toBe("loading");
  });
  it("does not let an older concurrent read erase a newer canonical directory", async () => {
    let release!: (res: Response) => void;
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(() => ++count === 1
      ? new Promise<Response>((resolve) => { release = resolve; })
      : Promise.resolve(response({ data: { [BRANDS_KEY]: { value: ["New"], updatedAt: new Date().toISOString() } } }))));
    const older = fetchFactoryData();
    hydrateFromServer(await fetchFactoryData());
    release(response({ data: {} }));
    const olderData = await older;
    expect(() => hydrateFromServer(olderData)).toThrow("superseded");
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual(["New"]);
  });
  it("preserves malformed pending records rather than silently replacing them", () => {
    const raw = '[{"key":"unknown-future-command","value":["Saved"]}]';
    localStorage.setItem(queueKey(), raw);
    expect(() => hydrateFromServer({})).toThrow("retained");
    expect(localStorage.getItem(queueKey())).toBe(raw);
    expect(factoryDirectoryState().status).toBe("unavailable");
  });
  it("stores loaded directories and acknowledged edits in memory only", async () => {
    hydrateFromServer({ [BRANDS_KEY]: { value: ["Server"], updatedAt: new Date(1).toISOString() } });
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual(["Server"]);
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => ack(init)));
    putFactoryKey(BRANDS_KEY, ["Edited"]);
    await flushFactoryQueue();
    expect(localStorage.getItem(BRANDS_KEY)).toBeNull();
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual(["Edited"]);
    expect(pending()).toEqual([]);
  });
  it("keeps an offline server-only setting and flushes it on recovery", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 503)));
    putFactoryKey(SHIFT_START_TIME_KEY, "08:15"); await flushFactoryQueue();
    expect(getShiftStartTime()).toBe("08:15");
    expect(pending()[0]).toMatchObject({ key: SHIFT_START_TIME_KEY, value: "08:15" });
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => ack(init)));
    await flushFactoryQueue();
    expect(pending()).toEqual([]);
  });
  it("retries a retained facility edit when browser connectivity returns", async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => response({}, 503))
      .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => ack(init));
    vi.stubGlobal("fetch", fetcher);
    putFactoryKey(BRANDS_KEY, ["Reconnect delivery"]);
    await flushFactoryQueue();
    expect(pending()).toHaveLength(1);

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(pending()).toEqual([]);
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual(["Reconnect delivery"]);
  });
  it("coalesces a newer edit without an earlier in-flight acknowledgment dropping it", async () => {
    let release!: () => void;
    let count = 0;
    const values: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      values.push(JSON.parse(String(init?.body)).value);
      if (++count === 1) await new Promise<void>((resolve) => { release = resolve; });
      return ack(init);
    }));
    putFactoryKey(BRANDS_KEY, ["First"]); await settle();
    putFactoryKey(BRANDS_KEY, ["Second"]); release(); await flushFactoryQueue();
    expect(values).toEqual([["First"], ["Second"]]);
    expect(pending()).toEqual([]);
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual(["Second"]);
  });
  it.each([{}, { value: ["Bad"] }, { updatedAt: "invalid", value: ["Bad"] }, { updatedAt: new Date().toISOString(), value: 4 }])(
    "retains an operation after a malformed acknowledgment %j", async (body) => {
      vi.stubGlobal("fetch", vi.fn(async () => response(body)));
      putFactoryKey(BRANDS_KEY, ["Pending"]); await flushFactoryQueue();
      expect(pending()).toHaveLength(1);
    },
  );
  it("adopts a canonical stale-write rejection only after valid acknowledgment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 503)));
    putFactoryKey(BRANDS_KEY, ["Old"]); await flushFactoryQueue();
    const newer = new Date(Date.now() + 60_000).toISOString();
    hydrateFromServer({ [BRANDS_KEY]: { value: ["New"], updatedAt: newer } });
    expect(pending()).toHaveLength(1);
    vi.stubGlobal("fetch", vi.fn(async () => response({ value: ["New"], updatedAt: newer })));
    await flushFactoryQueue();
    expect(pending()).toEqual([]);
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual(["New"]);
  });
  it("does not overwrite a newer local intent during hydration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 503)));
    putFactoryKey(BRANDS_KEY, ["Local"]); await flushFactoryQueue();
    hydrateFromServer({ [BRANDS_KEY]: { value: ["Remote"], updatedAt: new Date(1).toISOString() } });
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual(["Local"]);
  });
  it("partitions reload recovery and never delivers another principal's work", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 503)));
    putFactoryKey(BRANDS_KEY, ["A"]); await flushFactoryQueue();
    resetFactoryDataSyncForTests();
    setFactoryDataIdentity("live:other", true); hydrateFromServer({});
    const fetcher = vi.fn(async (_url, init) => ack(init)); vi.stubGlobal("fetch", fetcher);
    await flushFactoryQueue(); expect(fetcher).not.toHaveBeenCalled();
    setFactoryDataIdentity("live:manager", true); hydrateFromServer({});
    await flushFactoryQueue();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(pending()).toEqual([]);
  });
  it("fences late reads after account/scope switch", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const request = fetchFactoryData();
    setFactoryDataIdentity("sandbox:other", false);
    release(response({ data: { [BRANDS_KEY]: { value: ["Private"], updatedAt: new Date().toISOString() } } }));
    await expect(request).rejects.toThrow("superseded");
    expect(directoryRaw(BRANDS_KEY)).toBeNull();
  });
  it("fences a late write acknowledgment and keeps the originating queue", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    putFactoryKey(BRANDS_KEY, ["Private"]); const original = flushFactoryQueue();
    await settle();
    setFactoryDataIdentity("sandbox:other", true); hydrateFromServer({});
    release(response({ value: ["Private"], updatedAt: new Date().toISOString() }));
    await original;
    expect(pending()).toHaveLength(1);
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual([]);
  });
  it.each([null, {}, { data: [] }, { data: { [BRANDS_KEY]: { value: null, updatedAt: "bad" } } }])(
    "fails explicitly on malformed bootstrap %j", async (body) => {
      vi.stubGlobal("fetch", vi.fn(async () => response(body)));
      await expect(fetchFactoryData()).rejects.toThrow();
      expect(factoryDirectoryState().status).toBe("unavailable");
    },
  );
  it("rejects malformed nested directory/preset data before exposing it", async () => {
    for (const [key, value] of [
      ["run-calc-brand-flavors", { Fixture: 4 }],
      [DOUGH_RECIPE_PRESETS_KEY, { Fixture: { rows: "not-rows" } }],
      ["run-calc-frontline-recipe-presets", { Fixture: [{ ingredient: "X", lbs: "bad" }] }],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => response({ data: { [key]: { value, updatedAt: new Date().toISOString() } } })));
      await expect(fetchFactoryData()).rejects.toThrow();
    }
  });
  it("uses staff projection and blocks staff/unknown-state writes", async () => {
    setFactoryDataIdentity("live:staff", false);
    const fetcher = vi.fn(async () => response({ data: {} })); vi.stubGlobal("fetch", fetcher);
    await fetchFactoryData();
    expect(fetcher.mock.calls[0][0]).toBe("/api/factory-data/operational");
    putFactoryKey(BRANDS_KEY, ["Blocked"]); expect(localStorage.getItem(queueKey("live:staff"))).toBeNull();
    setFactoryDataIdentity("live:manager", true);
    putFactoryKey(BRANDS_KEY, ["Blocked"]); expect(pending()).toEqual([]);
  });
  it("cold offline reload cannot read legacy directories or presets", () => {
    localStorage.setItem(BRANDS_KEY, '["Legacy"]');
    localStorage.setItem(DOUGH_RECIPE_PRESETS_KEY, '{"Legacy":{"rows":[]}}');
    resetFactoryDataSyncForTests(); setFactoryDataIdentity("live:manager", true);
    expect(browserStorage.getItem(BRANDS_KEY)).toBeNull();
    expect(browserStorage.getItem(DOUGH_RECIPE_PRESETS_KEY)).toBeNull();
    expect(factoryDirectoryState().status).toBe("loading");
  });
  it("keeps divergent legacy names for explicit review rather than resurrecting them", async () => {
    localStorage.setItem(DOUGH_RECIPE_NAMES_KEY, '["Legacy"]');
    const canonical = { [DOUGH_RECIPE_NAMES_KEY]: { value: [], updatedAt: new Date().toISOString() } };
    hydrateFromServer(canonical); await runFactoryKvMigration(canonical);
    expect(JSON.parse(directoryRaw(DOUGH_RECIPE_NAMES_KEY)!)).toEqual([]);
    expect(localStorage.getItem(DOUGH_RECIPE_NAMES_KEY)).toBeNull();
    expect(legacyDirectoryReviews()[0].value).toEqual(["Legacy"]);
    expect(pending()).toEqual([]);
  });
  it("publishes the post-ack legacy-review source, not a stale pre-cleanup action", async () => {
    localStorage.setItem(BRANDS_KEY, '["Legacy"]');
    let observed = "";
    const unsubscribe = subscribeFactoryDirectory(() => { observed = JSON.stringify(legacyDirectoryReviews()); });
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => ack(init)));
    try {
      putFactoryKey(BRANDS_KEY, ["Canonical"]);
      await flushFactoryQueue();
      expect(legacyDirectoryReviews()).toHaveLength(1);
      expect(observed).toBe(JSON.stringify(legacyDirectoryReviews()));
      expect(legacyDirectoryReviews()[0].source).toContain("legacy-review:");
      expect(await resolveLegacyDirectoryReview(legacyDirectoryReviews()[0], false)).toBe(true);
      expect(legacyDirectoryReviews()).toHaveLength(0);
    } finally { unsubscribe(); }
  });
  it("does not strand unowned legacy evidence under a staff account that cannot review it", () => {
    localStorage.setItem(BRANDS_KEY, '["Legacy"]');
    const data = { [BRANDS_KEY]: { value: ["Canonical"], updatedAt: new Date().toISOString() } };
    setFactoryDataIdentity("live:staff", false); hydrateFromServer(data);
    expect(legacyDirectoryReviews()).toEqual([]);
    setFactoryDataIdentity("live:manager", true); hydrateFromServer(data);
    expect(legacyDirectoryReviews()).toHaveLength(1);
    expect(legacyDirectoryReviews()[0].value).toEqual(["Legacy"]);
    expect(legacyDirectoryReviews()[0].source).toContain(":unowned:");
  });
  it("does not assign an unowned legacy queue to the next account", async () => {
    const raw = JSON.stringify([{ key: BRANDS_KEY, value: ["Unowned"], updatedAt: 1, g: 1 }]);
    localStorage.setItem("run-calc-fkv-queue-v1", raw);
    const fetcher = vi.fn(async (_url, init) => ack(init)); vi.stubGlobal("fetch", fetcher);
    await runFactoryKvMigration({});
    expect(fetcher).not.toHaveBeenCalled();
    expect(localStorage.getItem("run-calc-fkv-queue-v1")).toBe(raw);
    await resolveLegacyDirectoryReview(legacyDirectoryReviews()[0], true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(directoryRaw(BRANDS_KEY)!)).toEqual(["Unowned"]);
    expect(localStorage.getItem("run-calc-fkv-queue-v1")).toBeNull();
  });
  it("never changes production recovery, device preferences or unrelated queues during migration", async () => {
    const excluded = ["run-calc-day", "run-calc-run-x", "run-calc-history", "run-calc-templates",
      "run-calc-profile-a__b", "run-calc-crust-profile-a__b", "run-calc-device-id",
      "run-calc-completed-history-outbox-v1:live", "run-calc-applicator-evidence-outbox-v1",
      "run-calculator:operational-intent-outbox:v1", "run-calc-sync-pending-intent-v1", "ui-theme"];
    for (const key of excluded) localStorage.setItem(key, `fixture:${key}`);
    localStorage.setItem(BRANDS_KEY, '["Old"]');
    const data = { [BRANDS_KEY]: { value: ["New"], updatedAt: new Date().toISOString() } };
    hydrateFromServer(data); await runFactoryKvMigration(data);
    for (const key of excluded) expect(localStorage.getItem(key)).toBe(`fixture:${key}`);
  });
});
