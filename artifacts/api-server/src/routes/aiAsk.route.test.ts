// Route-glue tests for POST /ai/ask. The prompt builder and sanitizer have
// focused unit tests; this suite exercises the HTTP streaming and fallback
// contracts without a database or live AI credentials.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  recordConversationTurns: async (_userId: string, turns: unknown) => turns,
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
    // /ai/ask is available to any authenticated staff member. Inject the
    // identity that auth middleware would provide in the full application.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).userId = "test-staff";
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

function makeRun(id = "run-1") {
  return {
    id,
    label: "House Cheese",
    brand: "House",
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
    question: "Can we finish by 2pm?",
    dayState: {
      date: "2026-06-18",
      nowMs: 1_750_000_000_000,
      runs: [makeRun()],
    },
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/ai/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function parseSseFrames(raw: string): Array<{ event: string; data: unknown }> {
  return raw
    .split(/\n\n/)
    .map((block) => {
      const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (!eventLine || !dataLine) return undefined;
      let data: unknown;
      try {
        data = JSON.parse(dataLine.slice("data: ".length));
      } catch {
        data = dataLine.slice("data: ".length);
      }
      return { event: eventLine.slice("event: ".length), data };
    })
    .filter((frame): frame is { event: string; data: unknown } => frame !== undefined);
}

describe("POST /ai/ask streaming", () => {
  it("emits non-empty delta events and a final done payload with turns and generatedAt", async () => {
    const fullJson = JSON.stringify({
      answer: "Yes. The line has 90 cases left.",
      note: "",
    });
    mock.streamChunks = fullJson.match(/.{1,7}/g) ?? [fullJson];

    const res = await post(makeBody(), { accept: "text/event-stream" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const frames = parseSseFrames(await res.text());
    const deltas = frames.filter((frame) => frame.event === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(
      deltas.map((frame) => (frame.data as { text: string }).text).join(""),
    ).toBe("Yes. The line has 90 cases left.");

    const done = frames.find((frame) => frame.event === "done");
    expect(done).toBeDefined();
    expect(done!.data).toMatchObject({
      answer: "Yes. The line has 90 cases left.",
      turns: [
        { role: "user", text: "Can we finish by 2pm?" },
        { role: "assistant", text: "Yes. The line has 90 cases left." },
      ],
    });
    expect(typeof (done!.data as { generatedAt: unknown }).generatedAt).toBe("number");
  });

  it("emits an error event and closes when the provider fails", async () => {
    mock.shouldThrow = true;

    const res = await post(makeBody(), { accept: "text/event-stream" });
    expect(res.status).toBe(200);
    const frames = parseSseFrames(await res.text());

    expect(frames).toContainEqual({
      event: "error",
      data: { error: "AI provider error" },
    });
    expect(frames.some((frame) => frame.event === "done")).toBe(false);
  });
});

describe("POST /ai/ask non-streaming fallback", () => {
  it("returns the same answer contract as JSON without an SSE Accept header", async () => {
    mock.syncContent = JSON.stringify({
      answer: "No. There are 90 cases left.",
      note: "",
    });

    const res = await post(makeBody());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as {
      answer: string;
      turns: Array<{ role: string; text: string }>;
      generatedAt: number;
    };
    expect(body.answer).toBe("No. There are 90 cases left.");
    expect(body.turns).toEqual([
      { role: "user", text: "Can we finish by 2pm?" },
      { role: "assistant", text: "No. There are 90 cases left." },
    ]);
    expect(typeof body.generatedAt).toBe("number");
  });
});