import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: { chat: { completions: { create: provider.create } } },
    AI_MODELS,
    pickModel: (kind: keyof typeof AI_MODELS = "full") => AI_MODELS[kind],
  };
});

vi.mock("../middlewares/requireCapability", () => ({
  requireCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Use a deliberately small, isolated in-memory budget here. The application
// still constructs the production instance with Postgres; this proves that the
// router itself invokes the actual weighted limiter before the handler.
vi.mock("../middlewares/costLimitMiddleware", async () => {
  const [costMiddleware, rateLimit] = await Promise.all([
    vi.importActual<typeof import("../middlewares/costLimitMiddleware")>(
      "../middlewares/costLimitMiddleware",
    ),
    vi.importActual<typeof import("../middlewares/rateLimit")>(
      "../middlewares/rateLimit",
    ),
  ]);

  return {
    ...costMiddleware,
    aiCostLimit: costMiddleware.createAiCostLimit({
      maxCost: 11,
      store: new rateLimit.MemoryRateLimitStore(
        costMiddleware.AI_COST_LIMIT_WINDOW_MS,
      ),
    }),
  };
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const routerMod = await import("./ai");
  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  // Match the production mount point. This also exercises the mounted-path
  // normalization used to find /api/ai/optimize's configured cost.
  app.use("/api", routerMod.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/ai/optimize cost budget", () => {
  it("rejects an over-budget weighted AI request before the provider is called", async () => {
    const response = await fetch(`${baseUrl}/api/ai/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(429);
    expect(provider.create).not.toHaveBeenCalled();
    expect(response.headers.get("x-cost-limit")).toBe("11");
    expect(response.headers.get("x-cost-requested")).toBe("12");
    expect(response.headers.get("x-cost-used")).toBe("11");
    expect(await response.json()).toEqual({
      error: "Cost limit exceeded. Budget: 11, used: 11, requested: 12. Retry after 60s.",
    });
  });
});