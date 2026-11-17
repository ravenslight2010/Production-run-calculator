import { describe, expect, it, vi } from "vitest";
import { createStationActivityCache } from "./stationActivityCache";

describe("station activity evidence cache", () => {
  it("isolates run/date/scope and expires at one second without refreshing on hits", async () => {
    let now = 0;
    const load = vi.fn(async () => []);
    const cache = createStationActivityCache(load, () => now);
    await cache.read("live", "2026-10-23", "one");
    now = 999;
    await cache.read("live", "2026-10-23", "one");
    expect(load).toHaveBeenCalledTimes(1);
    await cache.read("sandbox", "2026-10-23", "one");
    await cache.read("live", "2026-10-24", "one");
    await cache.read("live", "2026-10-23", "two");
    now = 1_000;
    await cache.read("live", "2026-10-23", "one");
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("evicts the oldest entry at capacity and invalidates only the selected scope/date", async () => {
    const load = vi.fn(async () => []);
    const cache = createStationActivityCache(load, () => 0);
    for (let i = 0; i < 257; i++) await cache.read("live", "2026-10-23", String(i));
    await cache.read("live", "2026-10-23", "1");
    expect(load).toHaveBeenCalledTimes(257);
    await cache.read("live", "2026-10-23", "0");
    expect(load).toHaveBeenCalledTimes(258);
    await cache.read("sandbox", "2026-10-23", "scope");
    await cache.read("live", "2026-10-24", "date");
    cache.invalidate("live", "2026-10-23");
    await cache.read("live", "2026-10-23", "0");
    await cache.read("sandbox", "2026-10-23", "scope");
    await cache.read("live", "2026-10-24", "date");
    expect(load).toHaveBeenCalledTimes(261);
    cache.clear();
    await cache.read("sandbox", "2026-10-23", "scope");
    expect(load).toHaveBeenCalledTimes(262);
  });

  it("rejects expired read failures, never serves stale evidence, and permits recovery", async () => {
    let now = 0;
    const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(["confirmed"])
      .mockRejectedValueOnce(new Error("fixture read unavailable")).mockResolvedValueOnce([]);
    const cache = createStationActivityCache(load, () => now);
    expect(await cache.read("live", "2026-10-23", "one")).toEqual(["confirmed"]);
    now = 1_000;
    await expect(cache.read("live", "2026-10-23", "one")).rejects.toThrow("fixture read unavailable");
    expect(await cache.read("live", "2026-10-23", "one")).toEqual([]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it.each(["invalidate", "clear"] as const)("does not repopulate stale evidence after an in-flight %s", async (operation) => {
    let finish!: (rows: string[]) => void;
    const load = vi.fn<() => Promise<string[]>>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(["new-confirmation"]);
    const cache = createStationActivityCache(load, () => 0);
    const pending = cache.read("live", "2026-10-23", "one");
    if (operation === "clear") cache.clear();
    else cache.invalidate("live", "2026-10-23");
    finish(["old-confirmation"]);
    await pending;
    expect(await cache.read("live", "2026-10-23", "one")).toEqual(["new-confirmation"]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
