import { describe, expect, it, vi } from "vitest";

import { costLimitMiddleware } from "./rateLimitCost";
import { MemoryRateLimitStore } from "../middlewares/rateLimit";

function runCostLimit(
  middleware: ReturnType<typeof costLimitMiddleware>,
): Promise<{
  next: ReturnType<typeof vi.fn>;
  res: { setHeader: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}> {
  return new Promise((resolve) => {
    const next = vi.fn(() => resolve({ next, res }));
    const res = {
      setHeader: vi.fn(),
      status: vi.fn(),
      json: vi.fn(() => resolve({ next, res })),
    };
    res.status.mockReturnValue(res);
    middleware(
      { ip: "203.0.113.5", log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } } as never,
      res as never,
      next,
    );
  });
}

describe("costLimitMiddleware", () => {
  it("atomically charges the configured weighted cost instead of request count", async () => {
    const middleware = costLimitMiddleware({
      windowMs: 60_000,
      maxCost: 20,
      store: new MemoryRateLimitStore(60_000),
      costFn: () => 20,
    });

    const first = await runCostLimit(middleware);
    const second = await runCostLimit(middleware);

    expect(first.next).toHaveBeenCalledOnce();
    expect(second.next).not.toHaveBeenCalled();
    expect(second.res.status).toHaveBeenCalledWith(429);
    expect(second.res.setHeader).toHaveBeenCalledWith("X-Cost-Used", "40");
  });
});