// Integration-style tests for the POST /ai/optimize route handler.
//
// The individual pieces of this endpoint are unit-tested in aiOptimize.test.ts
// (request validation, response sanitization, prompt building). What this file
// covers is the GLUE in ai.ts that wires them together: validate body -> build
// prompt -> call the model -> parse + sanitize the reply -> cross-check action
// run ids against the real runs. A regression in that glue (e.g. forgetting to
// pass knownRunIds, or returning the raw model output) would let hallucinated or
// malformed recommendations reach the client even though every helper is fine.
//
// The model call is mocked so no paid request is made, and the response content
// is controllable per test. requireRole is mocked to a pass-through so the route
// needs no database or auth wiring — auth/role gating is already covered by
// roles.integration.test.ts. The mock also captures the messages handed to the
// model so we can assert the built prompt actually reaches it.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MAX_RUNS } from "./aiOptimize";

// A controllable mock of the OpenAI chat client. `nextContent` is whatever the
// model "returns" as message content; `lastMessages` captures the prompt the
// route built and passed in, so we can assert the glue wired build -> call.
const mock = vi.hoisted(() => ({
  nextContent: "" as string | null,
  shouldThrow: false as boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastMessages: undefined as any,
  // The optimize route makes two model calls per request: the recommendations
  // pass, then the advisory reviewer ("second set of eyes") pass. `lastMessages`
  // captures the most recent (reviewer) prompt; `firstMessages` pins the first
  // (recommendations) prompt so glue assertions can target it specifically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  firstMessages: undefined as any,
  calls: 0,
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
            mock.lastMessages = args.messages;
            if (mock.firstMessages === undefined) mock.firstMessages = args.messages;
            if (mock.shouldThrow) throw new Error("provider blew up");
            return { choices: [{ message: { content: mock.nextContent } }] };
          },
        },
      },
    },
    // The routes resolve their model via pickModel(); the mock must export it
    // too, or the call throws "pickModel is not a function" and every route 502s.
    AI_MODELS,
    pickModel: (kind: keyof typeof AI_MODELS = "full") => AI_MODELS[kind],
  };
});

// Pass-through role gate so the route runs without a DB or real auth. Role
// enforcement itself is exercised in roles.integration.test.ts.
//
// It also honors an optional `x-test-user` header by populating req.userId,
// which lets the rate-limit tests vary the limiter's bucket key per request.
// Without the header, userId stays undefined and the limiter falls back to
// req.ip (same for every request here), matching the route's keyGenerator.
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

beforeEach(() => {
  mock.nextContent = JSON.stringify({ recommendations: [] });
  mock.shouldThrow = false;
  mock.lastMessages = undefined;
  mock.firstMessages = undefined;
  mock.calls = 0;
});

function makeRun(id: string) {
  return {
    id,
    label: `Run ${id}`,
    brand: "Brand",
    flavor: "Cheese",
    dieType: "12in",
    status: "running" as const,
    casesNeeded: 100,
    casesMade: 10,
    casesLeft: 90,
    plannedPpm: 60,
    actualPpm: 55,
    minutesRemaining: 30,
    netElapsedSec: 600,
    downtimeSec: 0,
    stoppages: [],
  };
}

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-06-18",
    nowMs: 1_750_000_000_000,
    runs: [makeRun("run-1")],
    ...overrides,
  };
}

async function postOptimize(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/ai/optimize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Posts as a specific user so the limiter buckets requests under that key
// (the route's keyGenerator uses req.userId first). Distinct users get
// independent buckets.
async function postOptimizeAsUser(user: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/ai/optimize`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": user },
    body: JSON.stringify(body),
  });
}

describe("POST /ai/optimize — request validation glue", () => {
  it("returns 400 for an invalid body and never calls the model", async () => {
    const res = await postOptimize({ date: "2026-06-18" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBeTruthy();
    expect(mock.calls).toBe(0);
  });

  it("enforces the run cap with 400 before calling the model", async () => {
    const runs = Array.from({ length: MAX_RUNS + 1 }, (_, i) => makeRun(`run-${i}`));
    const res = await postOptimize(makeBody({ runs }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain(String(MAX_RUNS));
    expect(mock.calls).toBe(0);
  });
});

describe("POST /ai/optimize — happy path glue (build -> call -> sanitize)", () => {
  it("builds a prompt, calls the model, and returns sanitized recommendations", async () => {
    mock.nextContent = JSON.stringify({
      recommendations: [
        {
          category: "run",
          title: "  Catch up to plan  ",
          detail: "  You are behind; raise the line speed.  ",
          impact: "HIGH",
          appliesTo: "Run run-1",
        },
      ],
      note: "Looks good overall.",
    });

    const res = await postOptimize(makeBody());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      recommendations: Array<{
        category: string;
        title: string;
        detail: string;
        impact: string;
        appliesTo: string | null;
      }>;
      note?: string;
      generatedAt: number;
    };

    // Two model calls: the recommendations pass, then the advisory reviewer
    // ("second set of eyes") pass over the sanitized recommendations.
    expect(mock.calls).toBe(2);
    // The first (recommendations) call got the built prompt (system + user that
    // includes the run id), proving build -> call wiring.
    expect(mock.firstMessages?.[0]?.role).toBe("system");
    expect(mock.firstMessages?.[1]?.content).toContain("id=run-1");

    // Output is the SANITIZED shape (trimmed, impact mapped), not raw model JSON.
    expect(json.recommendations).toHaveLength(1);
    expect(json.recommendations[0]?.title).toBe("Catch up to plan");
    expect(json.recommendations[0]?.detail).toBe("You are behind; raise the line speed.");
    expect(json.recommendations[0]?.impact).toBe("high");
    expect(json.note).toBe("Looks good overall.");
    expect(typeof json.generatedAt).toBe("number");
  });
});

describe("POST /ai/optimize — run-id cross-check glue (knownRunIds passed)", () => {
  it("drops actions referencing unknown run ids while keeping the card, and passes valid ones", async () => {
    mock.nextContent = JSON.stringify({
      recommendations: [
        {
          category: "run",
          title: "Hallucinated run action",
          detail: "Targets a run that does not exist in this request.",
          impact: "high",
          action: { kind: "set_run_target", runId: "ghost", casesNeeded: 500 },
        },
        {
          category: "run",
          title: "Valid run action",
          detail: "Targets a real run.",
          impact: "high",
          action: { kind: "set_run_target", runId: "run-1", casesNeeded: 250 },
        },
      ],
    });

    // Two real runs so run-1 is "known" but "ghost" is not.
    const res = await postOptimize(makeBody({ runs: [makeRun("run-1"), makeRun("run-2")] }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      recommendations: Array<{
        title: string;
        action: { kind: string; runId?: string; casesNeeded?: number } | null;
      }>;
    };

    expect(json.recommendations).toHaveLength(2);
    // Hallucinated-run card is kept, but its action is dropped to null.
    expect(json.recommendations[0]?.title).toBe("Hallucinated run action");
    expect(json.recommendations[0]?.action).toBeNull();
    // Real-run card keeps its sanitized action.
    expect(json.recommendations[1]?.action).toEqual({
      kind: "set_run_target",
      label: "Set target to 250 cases",
      runId: "run-1",
      casesNeeded: 250,
    });
  });
});

describe("POST /ai/optimize — model failure glue", () => {
  it("returns 502 when the model call throws", async () => {
    mock.shouldThrow = true;
    const res = await postOptimize(makeBody());
    expect(res.status).toBe(502);
  });

  it("returns an empty recommendation set when the model emits non-JSON", async () => {
    mock.nextContent = "not json at all";
    const res = await postOptimize(makeBody());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      recommendations: unknown[];
      generatedAt: number;
    };
    expect(json.recommendations).toEqual([]);
    expect(typeof json.generatedAt).toBe("number");
  });
});

describe("POST /ai/optimize — rate-limit guard (cost/abuse protection)", () => {
  // The limiter allows 10 requests/minute per user. These tests use distinct
  // per-test user keys (via x-test-user) so they never collide with each other
  // or with the IP-keyed requests issued by the other describe blocks in this
  // file — the limiter's bucket map is shared across the whole file because the
  // router module is imported once in beforeAll.
  const RATE_MAX = 10;

  it("lets the surplus requests through with 429 + rate-limit headers once the window cap is exceeded", async () => {
    const user = "rate-user-exceed";

    // The first RATE_MAX requests within the window are allowed.
    for (let i = 0; i < RATE_MAX; i += 1) {
      const ok = await postOptimizeAsUser(user, makeBody());
      expect(ok.status).toBe(200);
    }

    // The very next request (the surplus) is rejected with 429.
    const blocked = await postOptimizeAsUser(user, makeBody());
    expect(blocked.status).toBe(429);
    const json = (await blocked.json()) as { error: string };
    expect(json.error).toBeTruthy();

    // Rate-limit headers are set so clients can back off correctly.
    expect(blocked.headers.get("ratelimit-limit")).toBe(String(RATE_MAX));
    expect(blocked.headers.get("ratelimit-remaining")).toBe("0");
    expect(blocked.headers.get("ratelimit-reset")).toBeTruthy();
    expect(blocked.headers.get("retry-after")).toBeTruthy();

    // A rejected request never reaches the (paid) model.
    expect(mock.calls).toBe(RATE_MAX);
  });

  it("allows the same user again once the window elapses (counter resets)", async () => {
    const user = "rate-user-recovers";

    // Only fake the clock the limiter reads (Date.now); leave real timers so the
    // HTTP server and fetch keep working. We control the window via setSystemTime.
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    try {
      // Exhaust the allowance within the window.
      for (let i = 0; i < RATE_MAX; i += 1) {
        const ok = await postOptimizeAsUser(user, makeBody());
        expect(ok.status).toBe(200);
      }

      // The surplus request is blocked while still inside the window.
      const blocked = await postOptimizeAsUser(user, makeBody());
      expect(blocked.status).toBe(429);

      // Advance past the one-minute fixed window so the bucket should reset.
      vi.setSystemTime(start + 60_000 + 1);

      // The same user is allowed again on a fresh bucket, with refreshed
      // rate-limit headers reflecting the reset counter.
      const recovered = await postOptimizeAsUser(user, makeBody());
      expect(recovered.status).toBe(200);
      expect(recovered.headers.get("ratelimit-limit")).toBe(String(RATE_MAX));
      expect(recovered.headers.get("ratelimit-remaining")).toBe(String(RATE_MAX - 1));
      expect(recovered.headers.get("ratelimit-reset")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not penalize a different user (separate bucket per key)", async () => {
    const heavyUser = "rate-user-heavy";
    const otherUser = "rate-user-other";

    // Exhaust the heavy user's allowance and then one more to trip the limit.
    for (let i = 0; i < RATE_MAX + 1; i += 1) {
      await postOptimizeAsUser(heavyUser, makeBody());
    }
    const heavyBlocked = await postOptimizeAsUser(heavyUser, makeBody());
    expect(heavyBlocked.status).toBe(429);

    // A different user is on a fresh bucket and is unaffected.
    const otherOk = await postOptimizeAsUser(otherUser, makeBody());
    expect(otherOk.status).toBe(200);
    expect(otherOk.headers.get("ratelimit-remaining")).toBe(String(RATE_MAX - 1));
  });
});
