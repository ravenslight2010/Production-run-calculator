// Route-glue tests for POST /ai/forecast-accuracy.
//
// The scoring/aggregation math is unit-tested in forecastAccuracy.test.ts. This
// file covers the GLUE in ai.ts: that the route reads recorded forecasts from
// facility memory, grades them against the posted actual history, and ALWAYS
// returns a `trend` rollup (with empty-default lists when there is nothing to
// score). requireRole and the facility-memory store are mocked so the route
// runs without a DB or real auth; role gating is covered by
// roles.integration.test.ts.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FacilityKnowledge } from "@workspace/ai-memory";

// Controllable facility-memory store: `knowledge` is what loadFacilityKnowledge
// returns; `recorded` captures what the route writes back so we can assert the
// best-effort accuracy note round-trips without a DB.
const mem = vi.hoisted(() => ({
  knowledge: [] as FacilityKnowledge[],
  recorded: [] as unknown[],
}));

vi.mock("./aiMemoryContext", () => ({
  loadFacilityKnowledge: async () => mem.knowledge,
  recordFacilityKnowledge: async (entries: unknown) => {
    mem.recorded.push(entries);
  },
  // Unused by this route but imported by ai.ts at module load.
  appendFacilityMemoryBlock: (p: string) => p,
  groundPromptWithMemory: async (p: string) => p,
  recordConversationTurns: async () => {},
}));

vi.mock("../middlewares/requireRole", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireRole: () => (_req: any, _res: unknown, next: () => void) => next(),
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
  mem.knowledge = [];
  mem.recorded = [];
});

function post(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/ai/forecast-accuracy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /ai/forecast-accuracy — trend glue", () => {
  it("always returns a trend with empty defaults when there is nothing to score", async () => {
    const res = await post({ nowMs: Date.now(), history: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toEqual([]);
    expect(body.trend).toEqual({
      daysScored: 0,
      averageCaseAccuracyPct: 0,
      chronicOver: [],
      chronicUnder: [],
    });
    expect(typeof body.note).toBe("string");
  });

  it("rolls recorded forecasts + posted actuals into reviews and a trend", async () => {
    mem.knowledge = [
      {
        domain: "forecast",
        key: "plan:2026-06-17",
        fact: "Forecast for 2026-06-17 [high confidence]: Tony's Pepperoni (~200cs).",
      },
      {
        domain: "forecast",
        key: "plan:2026-06-16",
        fact: "Forecast for 2026-06-16 [high confidence]: Tony's Pepperoni (~180cs).",
      },
    ];
    const res = await post({
      nowMs: Date.now(),
      history: [
        {
          date: "2026-06-17",
          runs: [{ brand: "Tony's", flavor: "Pepperoni", dieType: "", cases: 100, netRunMin: 60 }],
        },
        {
          date: "2026-06-16",
          runs: [{ brand: "Tony's", flavor: "Pepperoni", dieType: "", cases: 90, netRunMin: 60 }],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews.map((r: { date: string }) => r.date)).toEqual([
      "2026-06-17",
      "2026-06-16",
    ]);
    expect(body.trend.daysScored).toBe(2);
    expect(body.trend.chronicOver).toEqual([
      { label: "Tony's Pepperoni", daysOver: 2, daysUnder: 0, daysScored: 2 },
    ]);
    // Best-effort accuracy notes were written back to facility memory.
    expect(mem.recorded.length).toBe(1);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await post({ history: "nope" });
    expect(res.status).toBe(400);
  });
});
