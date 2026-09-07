import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_ENDPOINT_COSTS, costLimitMiddleware } from "./rateLimitCost";
import {
  MemoryRateLimitStore,
  type RateLimitResult,
  type RateLimitStore,
} from "../middlewares/rateLimit";

type CostLimitRun = {
  next: ReturnType<typeof vi.fn>;
  res: {
    setHeader: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  headers: Record<string, string>;
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
};

function runCostLimit(
  middleware: ReturnType<typeof costLimitMiddleware>,
  path = "/api/ai/fill-missing",
): Promise<CostLimitRun> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    let next!: CostLimitRun["next"];
    let res!: CostLimitRun["res"];
    const result = (): CostLimitRun => ({ next, res, headers, log });

    res = {
      setHeader: vi.fn((name: string, value: string) => {
        headers[name] = value;
      }),
      status: vi.fn(),
      json: vi.fn(() => resolve(result())),
    };
    next = vi.fn(() => resolve(result()));
    res.status.mockReturnValue(res);
    middleware(
      {
        ip: "203.0.113.5",
        path,
        log,
      } as never,
      res as never,
      next,
    );
  });
}

describe("costLimitMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("charges retained AI tools through the shared store contract", async () => {
    const windowMs = 60_000;
    const memoryStore = new MemoryRateLimitStore(windowMs);
    const hit = vi.fn(
      (
        key: string,
        window: number,
        now: number,
        cost = 1,
      ): Promise<RateLimitResult> => memoryStore.hit(key, window, now, cost),
    );
    const store: RateLimitStore = { hit };
    const middleware = costLimitMiddleware({
      windowMs,
      maxCost: 100,
      store,
      costFn: (req) => AI_ENDPOINT_COSTS[req.path] ?? 1,
    });

    const normal = await runCostLimit(middleware);
    const count = await runCostLimit(middleware, "/api/ai/fill-missing");
    const anotherNormal = await runCostLimit(middleware);

    expect(normal.next).toHaveBeenCalledOnce();
    expect(count.next).toHaveBeenCalledOnce();
    expect(anotherNormal.next).toHaveBeenCalledOnce();
    expect(count.headers).toMatchObject({
      "X-Cost-Used": "2",
      "X-Cost-Remaining": "98",
      "X-Cost-Requested": "1",
    });
    expect(anotherNormal.headers).toMatchObject({
      "X-Cost-Used": "3",
      "X-Cost-Remaining": "97",
      "X-Cost-Requested": "1",
    });
    expect(hit.mock.calls).toEqual([
      ["cost-limit:203.0.113.5", windowMs, 1_000, 1],
      ["cost-limit:203.0.113.5", windowMs, 1_000, 1],
      ["cost-limit:203.0.113.5", windowMs, 1_000, 1],
    ]);
  });

  it("reports quota and retry details, then starts a fresh cost window", async () => {
    const windowMs = 60_000;
    const middleware = costLimitMiddleware({
      windowMs,
      maxCost: 2,
      store: new MemoryRateLimitStore(windowMs),
      costFn: (req) => AI_ENDPOINT_COSTS[req.path] ?? 1,
    });

    const normal = await runCostLimit(middleware);
    const count = await runCostLimit(middleware, "/api/ai/fill-missing");
    const blocked = await runCostLimit(middleware, "/api/ai/match-import");

    expect(normal.headers).toMatchObject({
      "X-Cost-Limit": "2",
      "X-Cost-Used": "1",
      "X-Cost-Remaining": "1",
      "X-Cost-Requested": "1",
      "X-Cost-Reset": "60",
    });
    expect(normal.headers["Retry-After"]).toBeUndefined();
    expect(count.headers).toMatchObject({
      "X-Cost-Used": "2",
      "X-Cost-Remaining": "0",
      "X-Cost-Requested": "1",
    });

    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.headers).toMatchObject({
      "X-Cost-Limit": "2",
      "X-Cost-Used": "2",
      "X-Cost-Remaining": "0",
      "X-Cost-Requested": "1",
      "X-Cost-Reset": "60",
      "Retry-After": "60",
    });
    expect(blocked.res.json).toHaveBeenCalledWith({
      error:
        "Cost limit exceeded. Budget: 2, used: 2, requested: 1. Retry after 60s.",
    });

    vi.advanceTimersByTime(windowMs + 1);
    const afterReset = await runCostLimit(middleware);

    expect(afterReset.next).toHaveBeenCalledOnce();
    expect(afterReset.headers).toMatchObject({
      "X-Cost-Used": "1",
      "X-Cost-Remaining": "1",
      "X-Cost-Reset": "60",
    });
    expect(afterReset.headers["Retry-After"]).toBeUndefined();
  });

  it("signals retained inventory photo near-limit and rejection outcomes safely", async () => {
    const windowMs = 60_000;
    const telemetry = vi.fn();
    const middleware = costLimitMiddleware({
      windowMs,
      maxCost: 25,
      store: new MemoryRateLimitStore(windowMs),
      costFn: () => 20,
      telemetryScope: () => "inventory_photo_analysis",
      telemetry,
    });

    const nearLimit = await runCostLimit(middleware, "/api/inventory/count-observations");
    const rejected = await runCostLimit(middleware, "/api/inventory/count-observations");

    expect(nearLimit.next).toHaveBeenCalledOnce();
    expect(telemetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        scope: "inventory_photo_analysis",
        outcome: "near_limit",
        requestedCost: 20,
        usedCost: 20,
        limitCost: 25,
        remainingCost: 5,
        actorHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      }),
      nearLimit.log,
    );
    expect(rejected.next).not.toHaveBeenCalled();
    expect(telemetry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        scope: "inventory_photo_analysis",
        outcome: "rejected",
        requestedCost: 20,
        usedCost: 25,
        limitCost: 25,
        remainingCost: 0,
        actorHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      }),
      rejected.log,
    );
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("203.0.113.5");
    expect(JSON.stringify(telemetry.mock.calls)).not.toMatch(/image|prompt|payload/i);
  });
});
