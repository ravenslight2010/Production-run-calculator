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
};

function runCostLimit(
  middleware: ReturnType<typeof costLimitMiddleware>,
  path = "/api/ai/ask",
): Promise<CostLimitRun> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    let next!: CostLimitRun["next"];
    let res!: CostLimitRun["res"];
    const result = (): CostLimitRun => ({ next, res, headers });

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
        log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

  it("charges regular and higher-cost AI tools through the shared store contract", async () => {
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
      costFn: (req) => {
        if (req.path === "/api/ai/forecast") {
          return AI_ENDPOINT_COSTS["/api/ai/forecast"]!;
        }
        if (req.path === "/api/ai/optimize") {
          return AI_ENDPOINT_COSTS["/api/ai/optimize"]!;
        }
        return 1;
      },
    });

    const normal = await runCostLimit(middleware);
    const forecast = await runCostLimit(middleware, "/api/ai/forecast");
    const optimize = await runCostLimit(middleware, "/api/ai/optimize");

    expect(normal.next).toHaveBeenCalledOnce();
    expect(forecast.next).toHaveBeenCalledOnce();
    expect(optimize.next).toHaveBeenCalledOnce();
    expect(forecast.headers).toMatchObject({
      "X-Cost-Used": "21",
      "X-Cost-Remaining": "79",
      "X-Cost-Requested": "20",
    });
    expect(optimize.headers).toMatchObject({
      "X-Cost-Used": "33",
      "X-Cost-Remaining": "67",
      "X-Cost-Requested": "12",
    });
    expect(hit.mock.calls).toEqual([
      ["cost-limit:203.0.113.5", windowMs, 1_000, 1],
      ["cost-limit:203.0.113.5", windowMs, 1_000, 20],
      ["cost-limit:203.0.113.5", windowMs, 1_000, 12],
    ]);
  });

  it("reports quota and retry details, then starts a fresh cost window", async () => {
    const windowMs = 60_000;
    const middleware = costLimitMiddleware({
      windowMs,
      maxCost: 25,
      store: new MemoryRateLimitStore(windowMs),
      costFn: (req) =>
        req.path === "/api/ai/forecast"
          ? AI_ENDPOINT_COSTS["/api/ai/forecast"]!
          : req.path === "/api/ai/optimize"
            ? AI_ENDPOINT_COSTS["/api/ai/optimize"]!
            : 1,
    });

    const normal = await runCostLimit(middleware);
    const forecast = await runCostLimit(middleware, "/api/ai/forecast");
    const blocked = await runCostLimit(middleware, "/api/ai/optimize");

    expect(normal.headers).toMatchObject({
      "X-Cost-Limit": "25",
      "X-Cost-Used": "1",
      "X-Cost-Remaining": "24",
      "X-Cost-Requested": "1",
      "X-Cost-Reset": "60",
    });
    expect(normal.headers["Retry-After"]).toBeUndefined();
    expect(forecast.headers).toMatchObject({
      "X-Cost-Used": "21",
      "X-Cost-Remaining": "4",
      "X-Cost-Requested": "20",
    });

    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.headers).toMatchObject({
      "X-Cost-Limit": "25",
      "X-Cost-Used": "33",
      "X-Cost-Remaining": "0",
      "X-Cost-Requested": "12",
      "X-Cost-Reset": "60",
      "Retry-After": "60",
    });
    expect(blocked.res.json).toHaveBeenCalledWith({
      error:
        "Cost limit exceeded. Budget: 25, used: 33, requested: 12. Retry after 60s.",
    });

    vi.advanceTimersByTime(windowMs + 1);
    const afterReset = await runCostLimit(middleware);

    expect(afterReset.next).toHaveBeenCalledOnce();
    expect(afterReset.headers).toMatchObject({
      "X-Cost-Used": "1",
      "X-Cost-Remaining": "24",
      "X-Cost-Reset": "60",
    });
    expect(afterReset.headers["Retry-After"]).toBeUndefined();
  });
});
