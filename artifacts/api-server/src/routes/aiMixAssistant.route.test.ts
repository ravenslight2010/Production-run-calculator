// Route-glue tests for POST /ai/mix-assistant — SSE streaming and JSON fallback.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

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

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    question: "How much mozzarella is in the cheese blend?",
    mixes: [
      {
        name: "Cheese blend",
        brand: "Tony's",
        flavor: "Pepperoni",
        components: [{ ingredient: "Mozzarella", perPizza: 0.5 }],
      },
    ],
    ...overrides,
  };
}

function post(body: unknown, stream = false): Promise<Response> {
  return fetch(`${baseUrl}/ai/mix-assistant`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(stream ? { accept: "text/event-stream" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function parseSseFrames(raw: string): Array<{ event: string; data: any }> {
  return raw
    .split(/\n\n/)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) return undefined;
      return { event, data: JSON.parse(data) };
    })
    .filter((frame): frame is { event: string; data: any } => !!frame);
}

describe("POST /ai/mix-assistant streaming", () => {
  it("emits non-empty deltas and a valid done payload", async () => {
    mock.streamChunks = ['{"answer":"Use 0.5 oz mozzarella', ' per pizza.","note":""}'];

    const res = await post(makeBody(), true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const frames = parseSseFrames(await res.text());
    const deltas = frames.filter((frame) => frame.event === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((frame) => typeof frame.data.text === "string" && frame.data.text.length > 0)).toBe(true);
    expect(deltas.map((frame) => frame.data.text).join("")).toContain("0.5 oz mozzarella");

    const done = frames.find((frame) => frame.event === "done")?.data;
    expect(done).toBeDefined();
    expect(done.answer).toContain("0.5 oz mozzarella");
    expect(typeof done.generatedAt).toBe("number");
  });

  it("emits an error event and closes when the provider throws", async () => {
    mock.shouldThrow = true;

    const res = await post(makeBody(), true);
    const frames = parseSseFrames(await res.text());
    expect(res.status).toBe(200);
    expect(frames.find((frame) => frame.event === "error")?.data.error).toBeTruthy();
    expect(frames.some((frame) => frame.event === "done")).toBe(false);
  });
});

describe("POST /ai/mix-assistant non-streaming", () => {
  it("returns 200 JSON with answer and generatedAt", async () => {
    mock.syncContent = JSON.stringify({ answer: "0.5 oz mozzarella per pizza.", note: "" });

    const res = await post(makeBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; generatedAt: number };
    expect(body.answer).toContain("0.5 oz mozzarella");
    expect(typeof body.generatedAt).toBe("number");
  });
});
