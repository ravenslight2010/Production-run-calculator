import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_MAINTENANCE_FAILURE_THRESHOLD,
  CACHE_MAINTENANCE_FAILURE_MAX_EVENTS,
  CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
  clearCacheMaintenanceDiagnosticsForTests,
  getCacheMaintenanceDiagnostics,
  operationType,
  recordCacheMaintenance,
  safeErrorCode,
  safeQueueAgeMs,
} from "./observability";

afterEach(() => {
  clearCacheMaintenanceDiagnosticsForTests();
  vi.useRealTimers();
});

describe("observability", () => {
  it("classifies operational routes without including identifiers", () => {
    expect(operationType("/api/sync/2026-08-22")).toBe("sync");
    expect(operationType("/api/inventory/items/123")).toBe("inventory");
    expect(operationType("/api/ai/ask")).toBe("ai");
    expect(operationType("/api/unknown")).toBe("request");
  });

  it("only emits bounded machine-readable error codes", () => {
    expect(safeErrorCode({ code: "ETIMEDOUT" })).toBe("ETIMEDOUT");
    expect(safeErrorCode({ message: "password=secret" })).toBe("internal_error");
    expect(safeErrorCode("raw user data")).toBe("unknown");
  });

  it("accepts only recent non-negative queue ages", () => {
    expect(safeQueueAgeMs(9_500, 10_000)).toBe(500);
    expect(safeQueueAgeMs(10_001, 10_000)).toBeUndefined();
    expect(safeQueueAgeMs(0, 8 * 24 * 60 * 60 * 1000)).toBeUndefined();
  });

  it("records only bounded, scope-aware cache maintenance fields", () => {
    const info = vi.fn();
    recordCacheMaintenance(
      {
        scope: "sandbox",
        operation: "prune",
        waitDurationMs: Number.POSITIVE_INFINITY,
        outcome: "error",
      },
      { info },
    );

    expect(info).toHaveBeenCalledWith(
      {
        event: "cache_maintenance",
        scope: "sandbox",
        operation: "prune",
        waitDurationMs: 0,
        outcome: "error",
      },
      "cache maintenance completed",
    );
  });

  it("does not let cache maintenance logging failures escape", () => {
    expect(() =>
      recordCacheMaintenance(
        { scope: "live", operation: "prune", waitDurationMs: 12.4, outcome: "success" },
        { info: () => { throw new Error("logger unavailable"); } },
      ),
    ).not.toThrow();
  });

  it("surfaces recurring cache maintenance failures once per rolling-window episode", () => {
    const now = new Date("2026-09-02T12:00:00.000Z");
    vi.useFakeTimers({ now });
    const info = vi.fn();
    const warn = vi.fn();
    const log = { info, warn };
    const fields = { scope: "live" as const, operation: "prune" as const, waitDurationMs: 12, outcome: "error" as const };

    for (let i = 0; i < CACHE_MAINTENANCE_FAILURE_THRESHOLD; i += 1) {
      recordCacheMaintenance(fields, log);
    }

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      {
        event: "cache_maintenance_recurrence",
        scope: "live",
        operation: "prune",
        recentErrorCount: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
        threshold: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
        windowMs: CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
      },
      "cache maintenance failures recurring",
    );
    expect(getCacheMaintenanceDiagnostics()).toMatchObject({
      live: {
        status: "warning",
        recentErrorCount: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
      },
      sandbox: { status: "ok", recentErrorCount: 0 },
    });

    recordCacheMaintenance(fields, log);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/prompt|result|cache.?key/i);

    for (let i = 0; i < CACHE_MAINTENANCE_FAILURE_MAX_EVENTS * 2; i += 1) {
      recordCacheMaintenance(fields, log);
    }
    expect(getCacheMaintenanceDiagnostics().live.recentErrorCount).toBe(
      CACHE_MAINTENANCE_FAILURE_MAX_EVENTS,
    );

    vi.advanceTimersByTime(CACHE_MAINTENANCE_FAILURE_WINDOW_MS + 1);
    expect(getCacheMaintenanceDiagnostics().live).toMatchObject({ status: "ok", recentErrorCount: 0 });

    recordCacheMaintenance(fields, log);
    recordCacheMaintenance(fields, log);
    recordCacheMaintenance(fields, log);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
