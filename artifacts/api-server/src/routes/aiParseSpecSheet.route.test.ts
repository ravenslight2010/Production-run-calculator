// Integration-style tests for the POST /ai/parse-spec-sheet retry glue in
// ai.ts. The prompt/sanitizer helpers are unit-tested in
// aiParseSpecSheet.test.ts; this file pins the route-level behavior around a
// transiently malformed model response:
//
//   - a truncated/non-JSON first reply is retried ONCE, and a good second
//     reply produces a normal parsed result (no empty-result "try again" note)
//   - retries are bounded: after 2 malformed replies the route falls back to
//     the existing fail-safe empty result + note (no third paid call)
//   - a provider error still 502s immediately (no retry on thrown calls)
//
// The model call is mocked with a per-test QUEUE of replies so the first and
// second attempts can differ. requireCapability is mocked to a pass-through;
// capability gating is covered elsewhere. loadCorrections/loadFacilityKnowledge
// are fail-safe against the missing DB (they log and return []), and the
// advisory reviewer pass is itself fail-safe against a junk mock reply.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Queue-based mock of the OpenAI chat client: each call shifts the next reply
// off `queue`; when the queue is empty (e.g. the advisory reviewer's extra
// call) it returns an empty JSON object, which the reviewer treats as "no
// verdicts". `parseCalls` counts only calls carrying the parse prompt so the
// reviewer call can't skew the retry-count assertions.
const mock = vi.hoisted(() => ({
  queue: [] as string[],
  shouldThrow: false as boolean,
  calls: 0,
  parseCalls: 0,
}));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: {
        completions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: async (args: any) => {
            mock.calls += 1;
            const sys = String(args.messages?.[0]?.content ?? "");
            // The parse prompt's system message talks about spec sheets; the
            // reviewer's system message is the generic reviewer preamble.
            if (sys.includes("spec sheet") || sys.includes("workbook")) mock.parseCalls += 1;
            if (mock.shouldThrow) throw new Error("provider blew up");
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
beforeEach(() => {
  mock.queue = [];
  mock.shouldThrow = false;
  mock.calls = 0;
  mock.parseCalls = 0;
  userCounter += 1;
});

const GOOD_REPLY = JSON.stringify({
  profiles: [
    {
      brand: "Lowes",
      flavor: "Pepperoni",
      applicators: [],
      pepperonis: [],
    },
  ],
  recipes: [],
});

// A response cut off mid-string, like the truncation seen from the real model.
const TRUNCATED_REPLY = '{"profiles":[{"brand":"Lo';

async function postParse(): Promise<Response> {
  return fetch(`${baseUrl}/ai/parse-spec-sheet`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Distinct user per test keeps each test in its own rate-limit bucket.
      "x-test-user": `parse-retry-user-${userCounter}`,
    },
    body: JSON.stringify({
      workbookText: "Brand\tFlavor\tSize\nLowes\tPepperoni\t7in\n",
    }),
  });
}

describe("POST /ai/parse-spec-sheet retry on malformed model output", () => {
  it("retries once after a truncated reply and returns the good second parse", async () => {
    mock.queue = [TRUNCATED_REPLY, GOOD_REPLY];
    const res = await postParse();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profiles: Array<{ brand: string; flavor: string }>;
      note?: string;
    };
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0].brand).toBe("Lowes");
    // The fail-safe "try again" note must NOT appear — the retry recovered.
    expect(body.note).toBeUndefined();
    expect(mock.parseCalls).toBe(2);
  });

  it("gives up after 2 malformed attempts with the fail-safe empty result", async () => {
    mock.queue = [TRUNCATED_REPLY, TRUNCATED_REPLY, GOOD_REPLY];
    const res = await postParse();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profiles: unknown[];
      recipes: unknown[];
      note?: string;
    };
    expect(body.profiles).toHaveLength(0);
    expect(body.recipes).toHaveLength(0);
    expect(body.note).toContain("cut off or malformed");
    // Bounded: exactly 2 paid parse attempts, never a third.
    expect(mock.parseCalls).toBe(2);
    // The would-be third (good) reply was never consumed.
    expect(mock.queue).toHaveLength(1);
  });

  it("does not retry a first-attempt success", async () => {
    mock.queue = [GOOD_REPLY];
    const res = await postParse();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: unknown[]; note?: string };
    expect(body.profiles).toHaveLength(1);
    expect(body.note).toBeUndefined();
    expect(mock.parseCalls).toBe(1);
  });

  it("still 502s immediately on a provider error (no retry of thrown calls)", async () => {
    mock.shouldThrow = true;
    const res = await postParse();
    expect(res.status).toBe(502);
    expect(mock.parseCalls).toBe(1);
  });
});
