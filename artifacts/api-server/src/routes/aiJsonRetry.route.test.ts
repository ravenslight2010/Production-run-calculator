// Integration-style tests for the shared bounded-retry glue
// (lib/aiJsonRetry.ts) on the ai.ts routes where a malformed model reply used
// to silently become an empty result: /ai/fill-missing, /ai/match-import,
// /ai/match-premix and /ai/suggest-merges. The /ai/parse-spec-sheet route
// (which established the pattern) is pinned in aiParseSpecSheet.route.test.ts.
//
// For each route this file pins "first malformed, second good": a
// truncated/non-JSON first reply is retried ONCE and the good second reply
// produces a normal, non-empty result. Bounded give-up and the no-retry 502 on
// provider errors are pinned once (on /ai/suggest-merges) — every route runs
// through the same shared helper, so those semantics can't drift per-route.
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
// off `queue`; when the queue is empty (e.g. the advisory reviewer's extra
// call) it returns an empty JSON object, which the reviewer treats as "no
// verdicts". `mainCalls` counts only non-reviewer calls (the reviewer's system
// prompt is the generic "careful reviewer" preamble) so the reviewer call
// can't skew the retry-count assertions.
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
            const sys = String(args.messages?.[0]?.content ?? "");
            const isReviewer = sys.includes("careful reviewer");
            if (!isReviewer) mock.mainCalls += 1;
            if (isReviewer) return { choices: [{ message: { content: "{}" } }] };
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

// A response cut off mid-string, like the truncation seen from the real model.
const TRUNCATED_REPLY = '{"suggestions":[{"tar';

describe("bounded retry on malformed model output (first malformed, second good)", () => {
  it("/ai/fill-missing retries once and returns the good second suggestions", async () => {
    const good = JSON.stringify({
      suggestions: [{ key: "temp", value: "350", rationale: "Standard oven temp." }],
    });
    mock.queue = [TRUNCATED_REPLY, good];
    const res = await post("/ai/fill-missing", {
      brand: "Lowes",
      flavor: "Pepperoni",
      fields: [{ key: "temp", label: "Temperature", category: "line", kind: "number" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: Array<{ key: string; value: string }> };
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].key).toBe("temp");
    expect(mock.mainCalls).toBe(2);
  });

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

  it("/ai/suggest-merges retries once and returns the good second suggestions", async () => {
    const good = JSON.stringify({
      suggestions: [{ target: "Mozzarella", sources: ["Mozz"], reason: "Common abbreviation" }],
    });
    mock.queue = [TRUNCATED_REPLY, good];
    const res = await post("/ai/suggest-merges", { names: ["Mozzarella", "Mozz"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: Array<{ target: string }> };
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].target).toBe("Mozzarella");
    expect(mock.mainCalls).toBe(2);
  });
});

describe("shared retry semantics (pinned once — same helper on every route)", () => {
  it("gives up after 2 malformed attempts with the fail-safe empty result", async () => {
    mock.queue = [TRUNCATED_REPLY, TRUNCATED_REPLY, '{"suggestions":[]}'];
    const res = await post("/ai/suggest-merges", { names: ["Mozzarella", "Mozz"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: unknown[] };
    expect(body.suggestions).toHaveLength(0);
    // Bounded: exactly 2 paid attempts, never a third.
    expect(mock.mainCalls).toBe(2);
    expect(mock.queue).toHaveLength(1);
  });

  it("returns a clear no-AI state immediately on a provider error", async () => {
    mock.shouldThrow = true;
    const res = await post("/ai/suggest-merges", { names: ["Mozzarella", "Mozz"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: unknown[]; aiStatus: string };
    expect(body.suggestions).toHaveLength(0);
    expect(body.aiStatus).toBe("unavailable");
    expect(mock.mainCalls).toBe(1);
  });

  it("retries a 429 rate-limit rejection once, then returns a no-AI state", async () => {
    mock.shouldThrow429 = true;
    const res = await post("/ai/suggest-merges", { names: ["Mozzarella", "Mozz"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: unknown[]; aiStatus: string };
    expect(body.suggestions).toHaveLength(0);
    expect(body.aiStatus).toBe("unavailable");
    // A 429 rejection is free, so exactly one retry happens (2 attempts total).
    expect(mock.mainCalls).toBe(2);
  });

  it("does not retry a first-attempt success", async () => {
    mock.queue = ['{"suggestions":[]}'];
    const res = await post("/ai/suggest-merges", { names: ["Mozzarella", "Mozz"] });
    expect(res.status).toBe(200);
    expect(mock.mainCalls).toBe(1);
  });

  it("serves unchanged merge-suggestion input from cache without another provider call", async () => {
    const request = { names: ["Mozzarella", "Mozz"] };
    mock.queue = [JSON.stringify({
      suggestions: [{ target: "Mozzarella", sources: ["Mozz"], reason: "abbreviation" }],
    })];

    const first = await post("/ai/suggest-merges", request);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(mock.mainCalls).toBe(1);

    mock.queue = [JSON.stringify({
      suggestions: [{ target: "Mozzarella", sources: [], reason: "different answer" }],
    })];
    const second = await post("/ai/suggest-merges", request);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      ...firstBody,
      generatedAt: expect.any(Number),
    });
    expect(mock.mainCalls).toBe(1);
  });
});
