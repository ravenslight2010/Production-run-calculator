// Route-glue tests for POST /ai/recipe-assistant — SSE streaming path.
//
// Confirms that the route:
//   1. Streams SSE `delta` events carrying incremental answer text when the
//      client sends `Accept: text/event-stream`.
//   2. Emits a final `done` event whose JSON payload carries a non-empty
//      `answer` string and a numeric `generatedAt` — the same shape the
//      non-stream path returns.
//   3. Never stalls or leaves the connection open: `done` always arrives and
//      the response body closes cleanly.
//   4. Surfaces an `error` SSE event and closes the stream (instead of hanging)
//      when the AI provider throws.
//   5. Falls back to regular JSON (200 with answer + generatedAt) when the
//      request has no `Accept: text/event-stream` header.
//
// The AI client, requireCapability, facility-memory context, corrections, and
// the request scope are all mocked so the route runs without a DB or live
// credentials.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// ── Controllable AI mock ──────────────────────────────────────────────────────
// When `streamChunks` is populated the mock returns an async-iterable stream;
// when it is empty the mock returns the synchronous `syncContent` reply.
// `shouldThrow` makes the next create() call reject, exercising the error path.
const mock = vi.hoisted(() => ({
  streamChunks: [] as string[],
  syncContent: "",
  shouldThrow: false,
}));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gemini-2.5-flash", cheap: "gemini-2.5-flash" } as const;
  return {
    openai: {
      chat: {
        completions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: async (args: any) => {
            if (mock.shouldThrow) throw new Error("provider blew up");
            if (args.stream) {
              // Return an async iterable that yields each chunk in turn.
              const chunks = [...mock.streamChunks];
              return (async function* () {
                for (const piece of chunks) {
                  yield { choices: [{ delta: { content: piece } }] };
                }
              })();
            }
            return { choices: [{ message: { content: mock.syncContent } }] };
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
    req.userId = "test-staff";
    next();
  },
}));

vi.mock("./aiMemoryContext", () => ({
  loadFacilityKnowledge: async () => [],
  appendFacilityMemoryBlock: (prompt: string) => prompt,
  groundPromptWithMemory: async (_log: unknown, prompt: string) => prompt,
  recordFacilityKnowledge: async () => {},
  recordConversationTurns: async () => {},
}));

vi.mock("./aiCorrectionsContext", () => ({
  loadCorrections: async () => [],
  appendCorrectionsBlock: (prompt: string) => prompt,
}));

vi.mock("../lib/requestScope", () => ({
  currentScope: () => ({ scope: "test", scopeId: "test" }),
}));

// ── In-process test server ────────────────────────────────────────────────────
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
  mock.streamChunks = [];
  mock.syncContent = "";
  mock.shouldThrow = false;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal valid recipe-assistant body. */
function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    question: "Scale the dough recipe to 1.5x",
    recipes: [
      {
        id: "dough-recipe-1",
        kind: "dough",
        name: "House Dough",
        rows: [
          { ingredient: "Flour", lbs: 50 },
          { ingredient: "Water", lbs: 30 },
        ],
      },
    ],
    ingredientNames: ["Flour", "Water", "Salt"],
    ...overrides,
  };
}

/** POST to the recipe-assistant endpoint (non-streaming). */
function post(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/ai/recipe-assistant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** POST to the recipe-assistant endpoint requesting an SSE stream. */
function postStream(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/ai/recipe-assistant`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

/** Parse a raw SSE body string into an array of { event, data } objects. */
function parseSseFrames(raw: string): Array<{ event: string; data: unknown }> {
  const frames: Array<{ event: string; data: unknown }> = [];
  // Each frame is separated by a blank line; fields are "event: …\ndata: …".
  for (const block of raw.split(/\n\n/)) {
    const lines = block.split("\n").filter(Boolean);
    if (!lines.length) continue;
    const eventLine = lines.find((l) => l.startsWith("event: "));
    const dataLine = lines.find((l) => l.startsWith("data: "));
    if (!eventLine || !dataLine) continue;
    const event = eventLine.slice("event: ".length).trim();
    let data: unknown;
    try {
      data = JSON.parse(dataLine.slice("data: ".length));
    } catch {
      data = dataLine.slice("data: ".length);
    }
    frames.push({ event, data });
  }
  return frames;
}

// ── Tests — streaming path ────────────────────────────────────────────────────

describe("POST /ai/recipe-assistant streaming (Accept: text/event-stream)", () => {
  it("returns Content-Type: text/event-stream and status 200", async () => {
    // The model streams back a complete JSON answer in two chunks.
    mock.streamChunks = ['{"answer":"Scale', ': Flour 75 lbs, Water 45 lbs.","note":""}'];

    const res = await postStream(makeBody());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  });

  it("emits at least one delta event with non-empty text as the stream arrives", async () => {
    mock.streamChunks = ['{"answer":"Flour', " 75, Water 45 lbs.", '","note":""}'];

    const res = await postStream(makeBody());
    const raw = await res.text();
    const frames = parseSseFrames(raw);

    const deltas = frames.filter((f) => f.event === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    // Each delta carries a `text` property.
    for (const d of deltas) {
      expect(d.data).toHaveProperty("text");
      expect(typeof (d.data as { text: unknown }).text).toBe("string");
    }
    // The concatenated delta text reconstructs the full answer.
    const accumulated = deltas
      .map((d) => (d.data as { text: string }).text)
      .join("");
    expect(accumulated.length).toBeGreaterThan(0);
    expect(accumulated).toContain("Flour");
  });

  it("emits a final `done` event with a non-empty answer string and generatedAt", async () => {
    mock.streamChunks = ['{"answer":"Scale to 1.5x: Flour 75 lbs, Water 45 lbs.","note":""}'];

    const res = await postStream(makeBody());
    const raw = await res.text();
    const frames = parseSseFrames(raw);

    const doneFrames = frames.filter((f) => f.event === "done");
    expect(doneFrames).toHaveLength(1);

    const done = doneFrames[0]!.data as {
      answer: string;
      generatedAt: number;
      note?: string;
      suggestion?: unknown;
    };
    expect(typeof done.answer).toBe("string");
    expect(done.answer.length).toBeGreaterThan(0);
    expect(typeof done.generatedAt).toBe("number");
    expect(done.generatedAt).toBeGreaterThan(0);
  });

  it("done payload answer accumulates ALL delta text (no truncation)", async () => {
    const fullAnswer = "Scale to 1.5x: Flour 75 lbs, Water 45 lbs, total 120 lbs.";
    // Split the JSON payload across many small chunks, as a real stream would.
    const fullJson = JSON.stringify({ answer: fullAnswer, note: "" });
    const chunks = fullJson.match(/.{1,8}/g) ?? [fullJson];
    mock.streamChunks = chunks;

    const res = await postStream(makeBody());
    const raw = await res.text();
    const frames = parseSseFrames(raw);

    const done = frames.find((f) => f.event === "done");
    expect(done).toBeDefined();
    const payload = done!.data as { answer: string };
    expect(payload.answer).toBe(fullAnswer);
  });

  it("no error event and connection closes cleanly (no stall)", async () => {
    mock.streamChunks = ['{"answer":"Straightforward scale.","note":""}'];

    const res = await postStream(makeBody());
    // If the connection stalled, res.text() would hang. The test runner's
    // default timeout will catch it; here we just assert the stream ends.
    const raw = await res.text();
    const frames = parseSseFrames(raw);

    expect(frames.some((f) => f.event === "error")).toBe(false);
    expect(frames.some((f) => f.event === "done")).toBe(true);
  });

  it("emits an error event and closes when the AI provider throws", async () => {
    mock.shouldThrow = true;

    const res = await postStream(makeBody());
    expect(res.status).toBe(200); // headers already committed to SSE
    const raw = await res.text();
    const frames = parseSseFrames(raw);

    const errorFrames = frames.filter((f) => f.event === "error");
    expect(errorFrames.length).toBeGreaterThan(0);
    const errPayload = errorFrames[0]!.data as { error: string };
    expect(typeof errPayload.error).toBe("string");
    expect(errPayload.error.length).toBeGreaterThan(0);
    // Connection must have closed: no `done` event after a provider failure.
    expect(frames.some((f) => f.event === "done")).toBe(false);
  });

  it("done event carries a valid suggestion when the model includes one", async () => {
    const payload = JSON.stringify({
      answer: "Scaled to 1.5x.",
      note: "",
      suggestion: {
        kind: "scale",
        recipeId: "dough-recipe-1",
        recipeName: "House Dough",
        summary: "Apply scaled dough 1.5x",
        rows: [
          { ingredient: "Flour", lbs: 75 },
          { ingredient: "Water", lbs: 45 },
        ],
      },
    });
    mock.streamChunks = [payload];

    const res = await postStream(makeBody());
    const raw = await res.text();
    const frames = parseSseFrames(raw);

    const done = frames.find((f) => f.event === "done");
    expect(done).toBeDefined();
    const data = done!.data as {
      answer: string;
      suggestion?: {
        kind: string;
        recipeId: string;
        rows: Array<{ ingredient: string; lbs: number }>;
      };
    };
    expect(data.suggestion).toBeDefined();
    expect(data.suggestion?.kind).toBe("scale");
    expect(data.suggestion?.recipeId).toBe("dough-recipe-1");
    expect(Array.isArray(data.suggestion?.rows)).toBe(true);
    expect((data.suggestion?.rows ?? []).length).toBeGreaterThan(0);
  });

  it("drops a suggestion whose recipeId was not in the request (hallucination guard)", async () => {
    const payload = JSON.stringify({
      answer: "Scaled to 1.5x.",
      note: "",
      suggestion: {
        kind: "scale",
        recipeId: "ghost-recipe-99",  // not in the request body
        recipeName: "Ghost",
        summary: "Apply scaled",
        rows: [{ ingredient: "Flour", lbs: 75 }],
      },
    });
    mock.streamChunks = [payload];

    const res = await postStream(makeBody());
    const raw = await res.text();
    const frames = parseSseFrames(raw);

    const done = frames.find((f) => f.event === "done");
    expect(done).toBeDefined();
    const data = done!.data as { suggestion?: unknown };
    // The off-target suggestion must be silently dropped.
    expect(data.suggestion).toBeUndefined();
  });
});

// ── Tests — non-streaming fallback path ───────────────────────────────────────

describe("POST /ai/recipe-assistant non-streaming (default)", () => {
  it("returns 200 JSON with answer + generatedAt when the model replies correctly", async () => {
    mock.syncContent = JSON.stringify({
      answer: "Flour 75 lbs, Water 45 lbs — total 120 lbs.",
      note: "",
    });

    const res = await post(makeBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; generatedAt: number };
    expect(typeof body.answer).toBe("string");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(typeof body.generatedAt).toBe("number");
  });

  it("returns 400 for an invalid request body", async () => {
    const res = await post({ question: "" }); // blank question + missing recipes
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
