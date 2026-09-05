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
  path = "/api/ai/fill-missing",
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
});
