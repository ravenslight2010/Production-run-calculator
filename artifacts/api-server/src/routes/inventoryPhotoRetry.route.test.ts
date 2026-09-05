// Integration-style tests for the shared bounded-retry glue
// (lib/aiJsonRetry.ts) on the inventory.ts vision routes where a malformed
// model reply used to silently read as "the AI saw nothing":
// /inventory/identify-photo and /inventory/production-sheet-photo. These
// handlers never touch the DB, so the router can be mounted with only the
// model client and capability middleware mocked (same pattern as
// aiParseSpecSheet.route.test.ts). Full retry semantics (bounded give-up, 502
// on provider error) are pinned in aiJsonRetry.route.test.ts against the same
// shared helper; here each route pins "first malformed, second good".
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const mock = vi.hoisted(() => ({
  queue: [] as string[],
  calls: 0,
}));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: {
        completions: {
          create: async () => {
            mock.calls += 1;
            const content = mock.queue.length > 0 ? mock.queue.shift() : "{}";
            return { choices: [{ message: { content } }] };
          },
        },
      },
    },
    AI_MODELS,
    pickModel: (kind: keyof typeof AI_MODELS = "full") => AI_MODELS[kind],
  };
});

vi.mock("../middlewares/requireCapability", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireCapability: () => (req: any, _res: unknown, next: () => void) => {
    const u = req.headers?.["x-test-user"];
    if (typeof u === "string") req.userId = u;
    next();
  },
}));

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
      maxCost: 40,
      store: new rateLimit.MemoryRateLimitStore(
        costMiddleware.AI_COST_LIMIT_WINDOW_MS,
      ),
    }),
  };
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const routerMod = await import("./inventory");
  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use(routerMod.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

let userCounter = 0;
beforeEach(() => {
  mock.queue = [];
  mock.calls = 0;
  userCounter += 1;
});

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Distinct user per test keeps each test in its own rate-limit bucket.
      "x-test-user": `photo-retry-user-${userCounter}`,
    },
    body: JSON.stringify(body),
  });
}

const IMAGE_BODY = { imageBase64: "SGVsbG8gd29ybGQhISEhIQ==" };

// A response cut off mid-string, like the truncation seen from the real model.
const TRUNCATED_REPLY = '{"items":[{"na';

describe("POST /inventory/identify-photo retry on malformed model output", () => {
  it("retries once after a truncated reply and returns the good second parse", async () => {
    const good = JSON.stringify({
      items: [
        { name: "Tomato Sauce", qty: 5, unit: "drums", category: "ingredient", matchedKey: null, confidence: 0.9 },
      ],
    });
    mock.queue = [TRUNCATED_REPLY, good];
    const res = await post("/inventory/identify-photo", IMAGE_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Tomato Sauce");
    expect(mock.calls).toBe(2);
  });

  it("gives up after 2 malformed attempts with the fail-safe empty result", async () => {
    mock.queue = [TRUNCATED_REPLY, TRUNCATED_REPLY, '{"items":[]}'];
    const res = await post("/inventory/identify-photo", IMAGE_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
    // Bounded: exactly 2 paid attempts, never a third.
    expect(mock.calls).toBe(2);
    expect(mock.queue).toHaveLength(1);
  });
});

describe("POST /inventory/production-sheet-photo retry on malformed model output", () => {
  it("retries once after a truncated reply and returns the good second parse", async () => {
    const good = JSON.stringify({
      rows: [
        { brand: "Lowes", flavor: "Pepperoni", dieType: "7in", casesNeeded: 100, date: "2099-01-02", confidence: 0.8 },
      ],
    });
    mock.queue = [TRUNCATED_REPLY, good];
    const res = await post("/inventory/production-sheet-photo", IMAGE_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ brand: string }>; note?: string };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].brand).toBe("Lowes");
    // The fail-safe "could not be read" note must NOT appear — the retry recovered.
    expect(body.note ?? "").not.toContain("could not be read");
    expect(mock.calls).toBe(2);
  });

  it("gives up after 2 malformed attempts with the fail-safe empty result + note", async () => {
    mock.queue = [TRUNCATED_REPLY, TRUNCATED_REPLY];
    const res = await post("/inventory/production-sheet-photo", IMAGE_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; note?: string };
    expect(body.rows).toHaveLength(0);
    expect(body.note).toContain("could not be read");
    expect(mock.calls).toBe(2);
  });
});

describe("POST /inventory/count-observations cost budget", () => {
  it("charges retained vision analysis and returns a payload-safe 429 before the provider", async () => {
    const imagePayload = "retained-photo-payload-that-must-not-appear";
    const body = {
      // Keep the request invalid so the first two charged requests stop before
      // the DB insert; the third must be rejected by the cost limiter first.
      photos: [],
      candidates: [],
      imageBase64: imagePayload,
    };

    const first = await post("/inventory/count-observations", body);
    const second = await post("/inventory/count-observations", body);
    const blocked = await post("/inventory/count-observations", body);

    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(blocked.status).toBe(429);
    expect(mock.calls).toBe(0);
    expect(blocked.headers.get("x-cost-limit")).toBe("40");
    expect(blocked.headers.get("x-cost-requested")).toBe("20");
    expect(blocked.headers.get("x-cost-used")).toBe("40");
    const blockedBody = await blocked.text();
    expect(JSON.parse(blockedBody)).toEqual({
      error: "Cost limit exceeded. Budget: 40, used: 40, requested: 20. Retry after 60s.",
    });
    expect(blockedBody).not.toContain(imagePayload);
    expect(blockedBody).not.toContain("Identify the distinct");
  });
});
