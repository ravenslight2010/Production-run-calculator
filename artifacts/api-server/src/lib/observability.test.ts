import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_MAINTENANCE_FAILURE_THRESHOLD,
  CACHE_MAINTENANCE_FAILURE_MAX_EVENTS,
  CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
  clearCacheMaintenanceDiagnosticsForTests,
  getCacheMaintenanceDiagnostics,
  isHealthProbePath,
  operationType,
  recordCacheMaintenance,
  recordStartupSlowWarning,
  safeErrorCode,
  safeQueueAgeMs,
} from "./observability";

afterEach(async () => {
  await clearCacheMaintenanceDiagnosticsForTests();
  vi.useRealTimers();
});

describe("observability", () => {
  it("classifies operational routes without including identifiers", () => {
    expect(operationType("/api/sync/2026-08-22")).toBe("sync");
    expect(operationType("/api/inventory/items/123")).toBe("inventory");
    expect(operationType("/api/ai/fill-missing")).toBe("ai");
    expect(operationType("/api/unknown")).toBe("request");
  });

  it("classifies platform probes separately from application operations", () => {
    expect(operationType("/api/readyz")).toBe("health");
    expect(operationType("/api/healthz")).toBe("health");
    expect(operationType("/api")).toBe("health");
    expect(isHealthProbePath("/api/livez")).toBe(true);
    expect(isHealthProbePath("/api/sync/today")).toBe(false);
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

  it("records only bounded, scope-aware cache maintenance fields", async () => {
    const info = vi.fn();
    await recordCacheMaintenance(
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

  it("does not let cache maintenance logging failures escape", async () => {
    await expect(
      recordCacheMaintenance(
        { scope: "live", operation: "prune", waitDurationMs: 12.4, outcome: "success" },
        { info: () => { throw new Error("logger unavailable"); } },
      ),
    ).resolves.toBeUndefined();
  });

  it("emits one safe startup warning payload with the current stage", () => {
    const warn = vi.fn();

    recordStartupSlowWarning(
      {
        phase: "starting",
        stage: "data_heals",
        durationMs: 30_001.7,
      },
      { warn },
    );

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      {
        event: "startup_slow",
        stage: "data_heals",
        durationMs: 30_002,
        outcome: "degraded",
        errorCode: "initialization_in_progress",
      },
      "Startup initialization is taking longer than expected",
    );
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/password|secret|message|stack/i);
  });

  it("uses the existing safe startup failure category when available", () => {
    const warn = vi.fn();

    recordStartupSlowWarning(
      {
        phase: "starting",
        stage: "seed_roles",
        durationMs: 45_000,
        failure: { stage: "seed_roles", errorCode: "seed_roles_failed" },
      },
      { warn },
    );

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "seed_roles", errorCode: "seed_roles_failed" }),
      "Startup initialization is taking longer than expected",
    );
  });

  it("surfaces recurring cache maintenance failures once per rolling-window episode", async () => {
    const now = new Date("2026-09-02T12:00:00.000Z");
    vi.useFakeTimers({ now });
    const info = vi.fn();
    const warn = vi.fn();
    const log = { info, warn };
    const fields = { scope: "live" as const, operation: "prune" as const, waitDurationMs: 12, outcome: "error" as const };

    for (let i = 0; i < CACHE_MAINTENANCE_FAILURE_THRESHOLD; i += 1) {
      await recordCacheMaintenance(fields, log);
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
    await expect(getCacheMaintenanceDiagnostics()).resolves.toMatchObject({
      live: {
        status: "warning",
        recentErrorCount: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
      },
      sandbox: { status: "ok", recentErrorCount: 0 },
    });

    await recordCacheMaintenance(fields, log);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/prompt|result|cache.?key/i);

    for (let i = 0; i < CACHE_MAINTENANCE_FAILURE_MAX_EVENTS * 2; i += 1) {
      await recordCacheMaintenance(fields, log);
    }
    expect((await getCacheMaintenanceDiagnostics()).live.recentErrorCount).toBe(
      CACHE_MAINTENANCE_FAILURE_MAX_EVENTS,
    );

    vi.advanceTimersByTime(CACHE_MAINTENANCE_FAILURE_WINDOW_MS + 1);
    expect((await getCacheMaintenanceDiagnostics()).live).toMatchObject({ status: "ok", recentErrorCount: 0 });

    await recordCacheMaintenance(fields, log);
    await recordCacheMaintenance(fields, log);
    await recordCacheMaintenance(fields, log);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
