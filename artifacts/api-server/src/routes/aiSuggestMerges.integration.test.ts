// DB-backed route coverage for the deterministic known-merge post-filter.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so
// the disposable database is created and DATABASE_URL is repointed before the
// router and DB modules are dynamically imported.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";

const mock = vi.hoisted(() => ({
  response: "",
}));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: {
        completions: {
          create: async (args: { messages?: Array<{ content?: unknown }> }) => {
            const system = String(args.messages?.[0]?.content ?? "");
            // The advisory reviewer is intentionally fail-safe and should not
            // alter the route result in this test.
            if (system.includes("careful reviewer")) {
              return { choices: [{ message: { content: "{}" } }] };
            }
            return { choices: [{ message: { content: mock.response } }] };
          },
        },
      },
    },
    AI_MODELS,
    pickModel: (kind: keyof typeof AI_MODELS = "full") => AI_MODELS[kind],
  };
});

vi.mock("../middlewares/requireCapability", () => ({
  requireCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let aiCorrectionsTable: DbModule["aiCorrectionsTable"];
let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_aisuggestmerges_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./ai");
  db = dbMod.db;
  pool = dbMod.pool;
  aiCorrectionsTable = dbMod.aiCorrectionsTable;
  pool.on("error", () => {});

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use(routerMod.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  mock.response = JSON.stringify({
    suggestions: [
      { target: "Mozzarella", sources: ["Mozz"], reason: "known abbreviation" },
      { target: "Pepperoni", sources: ["Peperoni"], reason: "spelling correction" },
    ],
  });
  await db.delete(aiCorrectionsTable);
});

describe("POST /ai/suggest-merges known correction filtering", () => {
  it("removes a DB-known pair while keeping a new pair", async () => {
    await db.insert(aiCorrectionsTable).values({
      scope: "live",
      domain: "ingredient",
      fromText: "Mozz",
      toText: "Mozzarella",
    });

    const res = await fetch(`${baseUrl}/ai/suggest-merges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        names: ["Mozzarella", "Mozz", "Pepperoni", "Peperoni"],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      suggestions: Array<{ target: string; sources: string[] }>;
    };
    expect(body.suggestions).toEqual([
      { target: "Pepperoni", sources: ["Peperoni"], reason: "spelling correction" },
    ]);
  });
});