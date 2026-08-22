import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushFactoryQueue,
  getShiftStartTime,
  hydrateFromServer,
  putFactoryKey,
  resetFactoryDataSyncForTests,
} from "./factoryDataSync";
import { SHIFT_START_TIME_KEY } from "./types";
import { clearPerformanceDiagnostics, getPerformanceDiagnostics } from "./performanceDiagnostics";

const QUEUE_KEY = "run-calc-fkv-queue-v1";

function response(ok: boolean, updatedAt = "2026-08-20T12:00:00.000Z") {
  return { ok, status: ok ? 200 : 503, json: async () => ({ updatedAt }) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("factory data durable write queue", () => {
  beforeEach(() => {
    localStorage.clear();
    resetFactoryDataSyncForTests();
    clearPerformanceDiagnostics();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an offline server-only setting and flushes it on the next recovery", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return response(false);
    }));

    putFactoryKey(SHIFT_START_TIME_KEY, "08:15");
    await settle();

    expect(getShiftStartTime()).toBe("08:15");
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([
      expect.objectContaining({ key: SHIFT_START_TIME_KEY, value: "08:15" }),
    ]);

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return response(true);
    }));
    await flushFactoryQueue();

    expect(calls).toContainEqual(expect.objectContaining({
      key: SHIFT_START_TIME_KEY,
      value: "08:15",
    }));
    expect(localStorage.getItem(QUEUE_KEY)).toBe("[]");
    expect(getPerformanceDiagnostics().map((entry) => entry.name)).toEqual([
      "api:/api/factory-data:503",
      "api:/api/factory-data:200",
    ]);
  });

  it("records a sanitized failure when the factory-data read cannot reach the server", async () => {
    const failure = new TypeError("network failure");
    vi.stubGlobal("fetch", vi.fn(async () => { throw failure; }));

    const { fetchFactoryData } = await import("./factoryDataSync");
    await expect(fetchFactoryData()).rejects.toBe(failure);

    expect(getPerformanceDiagnostics().map((entry) => entry.name)).toEqual([
      "api-failure:/api/factory-data:network",
    ]);
  });

  it("coalesces a newer edit behind an in-flight request without dropping it", async () => {
    const bodies: Array<{ key: string; value: string }> = [];
    let releaseFirst: (() => void) | undefined;
    let request = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as { key: string; value: string });
      request += 1;
      if (request === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return response(true);
    }));

    putFactoryKey(SHIFT_START_TIME_KEY, "08:00");
    await settle();
    putFactoryKey(SHIFT_START_TIME_KEY, "08:30");
    releaseFirst?.();
    await flushFactoryQueue();

    expect(bodies.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: SHIFT_START_TIME_KEY, value: "08:00" },
      { key: SHIFT_START_TIME_KEY, value: "08:30" },
    ]);
    expect(localStorage.getItem(QUEUE_KEY)).toBe("[]");
    expect(getShiftStartTime()).toBe("08:30");
  });

  it("adopts a newer remote setting only when there is no pending local intent", () => {
    hydrateFromServer({
      [SHIFT_START_TIME_KEY]: {
        value: "05:45",
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
    });
    expect(getShiftStartTime()).toBe("05:45");

    vi.stubGlobal("fetch", vi.fn(async () => response(false)));
    putFactoryKey(SHIFT_START_TIME_KEY, "06:30");
    hydrateFromServer({
      [SHIFT_START_TIME_KEY]: {
        value: "05:00",
        updatedAt: "2026-08-20T13:00:00.000Z",
      },
    });
    expect(getShiftStartTime()).toBe("06:30");
  });

  it("drops an older queued write instead of overwriting a newer remote save", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(false)));
    putFactoryKey(SHIFT_START_TIME_KEY, "06:00");
    await settle();
    const newer = new Date(Date.now() + 60_000).toISOString();

    hydrateFromServer({
      [SHIFT_START_TIME_KEY]: { value: "07:15", updatedAt: newer },
    });

    expect(getShiftStartTime()).toBe("07:15");
    expect(localStorage.getItem(QUEUE_KEY)).toBe("[]");
  });
});