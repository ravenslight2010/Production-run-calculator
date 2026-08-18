// Route-glue tests for POST /ai/forecast.
//
// Confirms that the route:
//   1. Returns valid structured JSON with the expected `forecast` + `forecasts`
//      shape (not plain text or empty) when the model replies correctly.
//   2. Passes `max_completion_tokens` that is adequate to receive a full
//      forecast response: ≥ 4096 for a single-day request, ≥ 8192 for a
//      multi-day (horizonDays > 1) request — guarding against truncated JSON
//      under the new gemini-2.5-flash model.
//   3. Returns an honest empty result (with a note) rather than crashing when
//      the history is too thin to forecast from.
//
// The AI client, requireCapability, facility-memory context, corrections, and
// the server-side history-verification step are all mocked so the route runs
// without a DB or live credentials. Model-selection and max_completion_tokens
// are asserted via the captured call args — that is what drifts when a model
// bump changes token limits.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// ── Capture AI call args so tests can assert max_completion_tokens ────────────
type CapturedCall = { model: string; max_completion_tokens: number };
const captured = vi.hoisted(() => ({ calls: [] as CapturedCall[], reply: "" }));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gemini-2.5-flash", cheap: "gemini-2.5-flash" } as const;
  return {
    openai: {
      chat: {
        completions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: async (args: any) => {
            captured.calls.push({
              model: String(args.model ?? ""),
              max_completion_tokens: Number(args.max_completion_tokens ?? 0),
            });
            return { choices: [{ message: { content: captured.reply } }] };
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
    req.userId = "test-manager";
    next();
  },
}));

// Stub out facility memory (DB-dependent): return nothing, silently absorb writes.
vi.mock("./aiMemoryContext", () => ({
  loadFacilityKnowledge: async () => [],
  appendFacilityMemoryBlock: (prompt: string) => prompt,
  appendFacilityMemoryBlock_v2: (prompt: string) => prompt,
  groundPromptWithMemory: async (_log: unknown, prompt: string) => prompt,
  recordFacilityKnowledge: async () => {},
  recordConversationTurns: async () => {},
}));

// Stub out corrections (DB-dependent).
vi.mock("./aiCorrectionsContext", () => ({
  loadCorrections: async () => [],
  appendCorrectionsBlock: (prompt: string) => prompt,
}));

// Stub out server-side history verification (DB-dependent): always trust.
vi.mock("./aiForecastVerify", () => ({
  verifyForecastHistory: async () => true,
}));

// Stub out request scope (DB-dependent).
vi.mock("../lib/requestScope", () => ({
  currentScope: () => ({ scope: "test", scopeId: "test" }),
}));

// ── Test server ───────────────────────────────────────────────────────────────
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
  captured.calls = [];
  captured.reply = "";
});

// ── Shared helpers ────────────────────────────────────────────────────────────

function post(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/ai/forecast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Minimal 2-day history that clears the FORECAST_MIN_RUNS floor. */
function historyWithRuns(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-06-${String(16 - i).padStart(2, "0")}`,
    runs: [
      { brand: "Tony's", flavor: "Pepperoni", dieType: "12in", cases: 300 - i * 10, netRunMin: 120 },
    ],
  }));
}

/** A valid single-day forecast JSON reply (as the model would return). */
function goodSingleDayReply(targetDate: string): string {
  return JSON.stringify({
    forecasts: [
      {
        targetDate,
        confidence: "high",
        summary: "Typical Tuesday based on history.",
        runs: [
          {
            brand: "Tony's",
            flavor: "Pepperoni",
            dieType: "12in",
            casesNeeded: 300,
            rationale: "Runs most Tuesdays, ~300 cases.",
          },
          {
            brand: "Tony's",
            flavor: "Cheese",
            dieType: "12in",
            casesNeeded: 150,
            rationale: "Secondary run on Tuesdays, ~150 cases.",
          },
        ],
      },
    ],
  });
}

/** A valid multi-day forecast JSON reply covering `dates`. */
function goodMultiDayReply(dates: string[]): string {
  return JSON.stringify({
    forecasts: dates.map((targetDate, i) => ({
      targetDate,
      confidence: i === 0 ? "high" : "medium",
      summary: `Plan for ${targetDate}.`,
      runs: [
        {
          brand: "Tony's",
          flavor: "Pepperoni",
          dieType: "12in",
          casesNeeded: 300,
          rationale: "Matches history.",
        },
      ],
    })),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /ai/forecast — response shape", () => {
  it("returns valid structured JSON with forecast + forecasts when the model replies correctly", async () => {
    const targetDate = "2026-06-23";
    captured.reply = goodSingleDayReply(targetDate);

    const res = await post({
      nowMs: Date.now(),
      targetDate,
      history: historyWithRuns(2),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      forecast: { targetDate: string; confidence: string; summary: string; runs: unknown[] } | null;
      forecasts: unknown[];
      generatedAt: number;
    };

    // Top-level shape
    expect(body).toHaveProperty("forecast");
    expect(body).toHaveProperty("forecasts");
    expect(typeof body.generatedAt).toBe("number");

    // forecast (singular) is the back-compat first-day plan
    expect(body.forecast).not.toBeNull();
    expect(body.forecast?.targetDate).toBe(targetDate);
    expect(body.forecast?.confidence).toBe("high");
    expect(typeof body.forecast?.summary).toBe("string");
    expect(body.forecast!.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(body.forecast?.runs)).toBe(true);
    expect((body.forecast?.runs ?? []).length).toBeGreaterThan(0);

    // forecasts array mirrors it
    expect(Array.isArray(body.forecasts)).toBe(true);
    expect(body.forecasts).toHaveLength(1);
  });

  it("populates the runs with brand, flavor, dieType, casesNeeded, rationale", async () => {
    const targetDate = "2026-06-23";
    captured.reply = goodSingleDayReply(targetDate);

    const res = await post({
      nowMs: Date.now(),
      targetDate,
      history: historyWithRuns(2),
    });

    const body = (await res.json()) as {
      forecast: { runs: Array<{ brand: string; flavor: string; dieType: string; casesNeeded: number; rationale: string }> } | null;
    };

    const run = body.forecast!.runs[0];
    expect(typeof run.brand).toBe("string");
    expect(run.brand.length).toBeGreaterThan(0);
    expect(typeof run.flavor).toBe("string");
    expect(typeof run.dieType).toBe("string");
    expect(typeof run.casesNeeded).toBe("number");
    expect(run.casesNeeded).toBeGreaterThan(0);
    expect(typeof run.rationale).toBe("string");
  });

  it("returns forecast:null with a note when history is too thin (< FORECAST_MIN_RUNS)", async () => {
    // Zero or one run → below FORECAST_MIN_RUNS (2); route short-circuits before
    // calling the AI, so no captured call and the note is the server's own text.
    const res = await post({
      nowMs: Date.now(),
      targetDate: "2026-06-23",
      history: historyWithRuns(1), // only 1 run total
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { forecast: unknown; note: string };
    expect(body.forecast).toBeNull();
    expect(typeof body.note).toBe("string");
    expect(body.note.length).toBeGreaterThan(0);
    // No AI call should have been made.
    expect(captured.calls).toHaveLength(0);
  });

  it("returns 400 for a malformed request body", async () => {
    const res = await post({ history: "not-an-array" });
    expect(res.status).toBe(400);
  });
});

describe("POST /ai/forecast — max_completion_tokens adequacy", () => {
  it("passes max_completion_tokens ≥ 4096 for a single-day request", async () => {
    const targetDate = "2026-06-23";
    captured.reply = goodSingleDayReply(targetDate);

    await post({
      nowMs: Date.now(),
      targetDate,
      horizonDays: 1,
      history: historyWithRuns(2),
    });

    // At least one main AI call must have been made.
    const mainCall = captured.calls[0];
    expect(mainCall).toBeDefined();
    expect(mainCall.max_completion_tokens).toBeGreaterThanOrEqual(4096);
    expect(mainCall.model).toBe("gemini-2.5-flash");
  });

  it("passes max_completion_tokens ≥ 8192 for a multi-day (horizonDays > 1) request", async () => {
    const targetDate = "2026-06-23";
    captured.reply = goodMultiDayReply(["2026-06-23", "2026-06-24", "2026-06-25"]);

    await post({
      nowMs: Date.now(),
      targetDate,
      horizonDays: 3,
      history: historyWithRuns(2),
    });

    const mainCall = captured.calls[0];
    expect(mainCall).toBeDefined();
    // Multi-day produces proportionally more output — must give the model room.
    expect(mainCall.max_completion_tokens).toBeGreaterThanOrEqual(8192);
    expect(mainCall.model).toBe("gemini-2.5-flash");
  });

  it("single-day token budget is strictly less than the multi-day budget", async () => {
    // Confirm the route intentionally scales the budget: a single-day horizon
    // has a lower ceiling than a multi-day one (no silent regression where both
    // get the same, potentially too-small, value).
    captured.reply = goodSingleDayReply("2026-06-23");
    await post({ nowMs: Date.now(), targetDate: "2026-06-23", horizonDays: 1, history: historyWithRuns(2) });
    const singleTokens = captured.calls[0]?.max_completion_tokens ?? 0;

    captured.calls = [];
    captured.reply = goodMultiDayReply(["2026-06-23", "2026-06-24"]);
    await post({ nowMs: Date.now(), targetDate: "2026-06-23", horizonDays: 2, history: historyWithRuns(2) });
    const multiTokens = captured.calls[0]?.max_completion_tokens ?? 0;

    expect(multiTokens).toBeGreaterThan(singleTokens);
  });
});

describe("POST /ai/forecast — multi-day response shape", () => {
  it("returns one forecast plan per requested day in date order", async () => {
    const dates = ["2026-06-23", "2026-06-24", "2026-06-25"];
    captured.reply = goodMultiDayReply(dates);

    const res = await post({
      nowMs: Date.now(),
      targetDate: "2026-06-23",
      horizonDays: 3,
      history: historyWithRuns(2),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      forecast: { targetDate: string } | null;
      forecasts: Array<{ targetDate: string; runs: unknown[] }>;
      generatedAt: number;
    };

    expect(body.forecasts).toHaveLength(3);
    expect(body.forecasts.map((f) => f.targetDate)).toEqual(dates);
    // Back-compat: forecast (singular) is the first day.
    expect(body.forecast?.targetDate).toBe(dates[0]);
    // Every day's plan has at least one run.
    for (const plan of body.forecasts) {
      expect(Array.isArray(plan.runs)).toBe(true);
      expect(plan.runs.length).toBeGreaterThan(0);
    }
  });
});
