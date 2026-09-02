import { describe, expect, it, vi } from "vitest";
import {
  operationType,
  recordCacheMaintenance,
  safeErrorCode,
  safeQueueAgeMs,
} from "./observability";

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
});
