// Integration-style tests for the shared bounded-retry glue
// (lib/aiJsonRetry.ts) on the ai.ts routes where a malformed model reply used
// to silently become an empty result: /ai/match-import and /ai/match-premix.
// The /ai/parse-spec-sheet route
// (which established the pattern) is pinned in aiParseSpecSheet.route.test.ts.
//
// For each route this file pins "first malformed, second good": a
// truncated/non-JSON first reply is retried ONCE and the good second reply
// produces a normal, non-empty result.
//
// The model call is mocked with a per-test QUEUE of replies so the first and
// second attempts can differ. requireCapability is mocked to a pass-through;
// capability gating is covered elsewhere. loadCorrections/loadFacilityKnowledge
// are fail-safe against the missing DB (they log and return []), and the
// advisory reviewer pass is itself fail-safe against a junk "{}" mock reply.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { setAiRateLimitBackoffMsForTests, AI_RATE_LIMITED_MESSAGE } from "../lib/aiJsonRetry";
import { clearAiResultCacheForTests } from "../lib/aiResultCache";

// Queue-based mock of the OpenAI chat client: each call shifts the next reply
// off `queue`; when the queue is empty it returns an empty JSON object.
const mock = vi.hoisted(() => ({
  queue: [] as string[],
  shouldThrow: false as boolean,
  shouldThrow429: false as boolean,
  mainCalls: 0,
}));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: {
        completions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: async (args: any) => {
            mock.mainCalls += 1;
            if (mock.shouldThrow) throw new Error("provider blew up");
            if (mock.shouldThrow429) {
              const err = new Error(
                '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}',
              ) as Error & { status: number };
              err.status = 429;
              throw err;
            }
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
let prevBackoff: number;
beforeEach(async () => {
  await clearAiResultCacheForTests();
  mock.queue = [];
  mock.shouldThrow = false;
  mock.shouldThrow429 = false;
  mock.mainCalls = 0;
  userCounter += 1;
  // Exercise the 429 retry path without a real 20-second backoff sleep.
  prevBackoff = setAiRateLimitBackoffMsForTests(0);
});
afterEach(() => {
  setAiRateLimitBackoffMsForTests(prevBackoff);
});

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Distinct user per test keeps each test in its own rate-limit bucket.
      "x-test-user": `retry-user-${userCounter}`,
    },
    body: JSON.stringify(body),
  });
}

describe("Operations Insights compatibility aliases", () => {
  const recapInput = {
    scope: "day",
    date: "2026-09-06",
    nowMs: Date.UTC(2026, 8, 6, 12),
    runs: [],
  };

  it("keeps AI metadata only on the legacy recap alias", async () => {
    const stable = await post("/operations-insights/recap", recapInput);
    expect(stable.status).toBe(200);
    const stableBody = (await stable.json()) as Record<string, unknown>;
    expect(stableBody).not.toHaveProperty("aiGenerated");
    expect(stableBody).not.toHaveProperty("aiStatus");

    const legacy = await post("/ai/summary", recapInput);
    expect(legacy.status).toBe(200);
    const legacyBody = (await legacy.json()) as Record<string, unknown>;
    expect(legacyBody.aiGenerated).toBe(false);
    expect(legacyBody.aiStatus).toBe("deterministic");
  });

  it("keeps deterministic schedule ordering available without a model call", async () => {
    const stable = await post("/operations-insights/schedule-order", { runs: [], rules: [] });
    expect(stable.status).toBe(200);
    expect(mock.mainCalls).toBe(0);
    await expect(stable.json()).resolves.toMatchObject({
      order: [],
      improved: false,
    });

    const legacy = await post("/ai/schedule-optimize", { runs: [], rules: [] });
    expect(legacy.status).toBe(200);
    expect(mock.mainCalls).toBe(0);
    await expect(legacy.json()).resolves.toMatchObject({
      order: [],
      aiGenerated: false,
      aiStatus: "deterministic",
    });
  });
});

// A response cut off mid-string, like the truncation seen from the real model.
const TRUNCATED_REPLY = '{"suggestions":[{"tar';

describe("bounded retry on malformed model output (first malformed, second good)", () => {
  it("/ai/match-import retries once and returns the good second matches", async () => {
    const good = JSON.stringify({
      brandMatches: [{ candidate: "Unknown Brand", match: "Lowes" }],
      flavorMatches: [],
    });
    mock.queue = [TRUNCATED_REPLY, good];
    const res = await post("/ai/match-import", {
      brands: ["Lowes"],
      brandFlavors: { Lowes: ["Pepperoni"] },
      unmatchedBrands: ["Unknown Brand"],
      unmatchedFlavors: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brandMatches: Array<{ candidate: string; match: string }> };
    expect(body.brandMatches).toHaveLength(1);
    expect(body.brandMatches[0].match).toBe("Lowes");
    expect(mock.mainCalls).toBe(2);
  });

  it("/ai/match-premix retries once and returns the good second matches", async () => {
    const good = JSON.stringify({
      matches: [{ name: "Lowes Mystery Mix", brand: "Lowes", flavor: "Pepperoni" }],
    });
    mock.queue = [TRUNCATED_REPLY, good];
    const res = await post("/ai/match-premix", {
      brands: ["Lowes"],
      brandFlavors: { Lowes: ["Pepperoni"] },
      unmatchedNames: ["Lowes Mystery Mix"],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: Array<{ brand: string }> };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].brand).toBe("Lowes");
    expect(mock.mainCalls).toBe(2);
  });
});
export {};
