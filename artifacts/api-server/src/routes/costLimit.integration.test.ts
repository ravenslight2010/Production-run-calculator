// Integration test: the AI cost-limit guard is actually wired onto /api/ai.
//
// aiCostLimit (lib/rateLimitCost.ts) aggregates per-user AI spend across every
// /api/ai/* endpoint so a single actor can't burn API credentials by spreading
// requests across many AI endpoints even when each stays under its own
// per-endpoint request cap. It is mounted in routes/index.ts as
// router.use("/ai", aiCostLimit), AFTER requireAuth so req.userId is set and
// BEFORE the individual route handlers (and their requireCapability checks).
//
// The unit tests prove the middleware and its costFn work in isolation; THIS
// test proves the middleware is actually mounted on the real assembled router,
// scoped to /ai (it must NOT block non-AI traffic), and budgeted by accumulated
// *cost* rather than bare request count — a regression in any of those would
// pass the unit suite but silently open or wrongly close the guard.
//
// Strategy: stand up the real router against a disposable Postgres DB and sign
// a fresh operator user (no use-ai-tools capability). The cost limiter counts
// every retained match-import request, but the route then 403s on the missing
// capability, so budget is consumed without calling the provider. Three hundred
// base-cost requests fill the budget and request 301 receives 429.
//
// Each test signs a NEW user so the in-memory cost bucket (a module singleton
// in the test NODE_ENV) is fresh for every budget-exhaustion scenario.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { signToken } from "../lib/auth";

const provider = vi.hoisted(() => ({
  calls: 0,
  wait: false,
  started: undefined as (() => void) | undefined,
  release: undefined as (() => void) | undefined,
  gate: undefined as Promise<void> | undefined,
}));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: {
        completions: {
          create: async (args: { messages?: Array<{ content?: unknown }> }) => {
            void args;
            provider.calls += 1;
            provider.started?.();
            if (provider.wait) {
              provider.gate ??= new Promise<void>((resolve) => {
                provider.release = resolve;
              });
              await provider.gate;
            }
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    brandMatches: [],
                    flavorMatches: [],
                    ingredientMatches: [],
                    appTypeMatches: [],
                    pepTypeMatches: [],
                  }),
                },
              }],
            };
          },
        },
      },
    },
    AI_MODELS,
    pickModel: (kind: keyof typeof AI_MODELS = "full") => AI_MODELS[kind],
  };
});

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let aiResultCacheTable: DbModule["aiResultCacheTable"];
let seedRoles: () => Promise<void>;
let newUserId: () => string;

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
  testDbName = `helium_costlimit_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const routerMod = await import("./index");
  db = dbMod.db;
  pool = dbMod.pool;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  aiResultCacheTable = dbMod.aiResultCacheTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  newUserId = (await import("../lib/auth")).newUserId;
  pool.on("error", () => {});

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", routerMod.default);

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
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  // Isolate from DB rows. The cost/rate limits run on in-memory stores (test
  // NODE_ENV), keyed by userId, so each test's freshly-minted users start with
  // a clean budget — no cross-test leakage.
  await db.execute(
    sql`TRUNCATE ${aiResultCacheTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  provider.calls = 0;
  provider.wait = false;
  provider.started = undefined;
  provider.release = undefined;
  provider.gate = undefined;
});

// A distinct user per call site, so two callers in one test never share a
// budget bucket.
let userSeq = 0;
function freshUser(): string {
  return `cost-user-${++userSeq}-${Date.now()}`;
}
async function insertUser(userId: string): Promise<void> {
  await db.insert(usersTable).values({
    id: userId,
    username: `costuser${userSeq}`,
    passwordHash: "x",
  });
}

async function insertManager(userId: string): Promise<void> {
  await insertUser(userId);
  await db.insert(userRolesTable).values({ userId, role: "manager" });
}

function auth(userId: string): Record<string, string> {
  return { authorization: `Bearer ${signToken(userId)}` };
}

// Fire an AI request whose route 403s on the missing capability AFTER the cost
// limiter (mounted before the route) has already counted the request's cost.
function aiCall(userId: string, pathName: string): Promise<Response> {
  return fetch(`${baseUrl}/api${pathName}`, {
    method: "POST",
    headers: { ...auth(userId), "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

// Drive one user's aggregate AI budget to exhaustion with a retained,
// capability-gated route. Capability 403s never reach the endpoint limiter, so
// the 429 can only come from the shared cost limiter.
async function exhaustBudget(): Promise<{ blocked: Response; userId: string }> {
  const userId = freshUser();
  await insertUser(userId);
  for (let i = 0; i < 300; i++) {
    const res = await aiCall(userId, "/ai/match-import");
    expect(res.status, `match-import #${i + 1} should pass cost limit and 403`).toBe(403);
  }
  return { blocked: await aiCall(userId, "/ai/match-import"), userId };
}

describe("POST /api/ai/* — aiCostLimit is wired onto the /ai router", () => {
  it("requires authentication and capability before retained provider routes run", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/ai/parse-spec-sheet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workbookText: "Brand\tFlavor\nAcme\tCheese" }),
    });
    expect(unauthenticated.status).toBe(401);

    const operator = freshUser();
    await insertUser(operator);
    const denied = await fetch(`${baseUrl}/api/ai/match-import`, {
      method: "POST",
      headers: { ...auth(operator), "content-type": "application/json" },
      body: JSON.stringify({
        brands: ["Acme"],
        brandFlavors: { Acme: [] },
        unmatchedBrands: ["Unknown"],
        unmatchedFlavors: [],
      }),
    });
    expect(denied.status).toBe(403);
    expect(provider.calls).toBe(0);
  });

  it(
    "429s on the request that pushes aggregate AI spend past budget (cost, not request count)",
    async () => {
      const { blocked } = await exhaustBudget();
      expect(blocked.status).toBe(429);

      const headers = blocked.headers;
      expect(headers.get("X-Cost-Limit")).toBe("300");
      expect(headers.get("X-Cost-Used")).toBe("300");
      expect(headers.get("X-Cost-Requested")).toBe("1");
      expect(Number(headers.get("Retry-After"))).toBeGreaterThan(0);

      const body = (await blocked.json()) as { error: string };
      expect(body.error).toContain("Cost limit exceeded. Budget: 300, used: 300, requested: 1");
    },
    30_000,
  );

  it("does not cost-limit non-AI routes", async () => {
    const { blocked, userId } = await exhaustBudget();
    expect(blocked.status).toBe(429);

    // A non-AI authenticated route (/api/cheese-recipes, mounted separately) is
    // NOT under the /ai cost limiter and must still work even after exhaustion.
    const cheese = await fetch(`${baseUrl}/api/cheese-recipes`, { headers: auth(userId) });
    expect(cheese.status).toBe(200);
  });

  it("keeps a per-user budget (a second user is not blocked by the first)", async () => {
    const { blocked, userId } = await exhaustBudget();
    expect(blocked.status).toBe(429);

    // A different, fresh user starts a clean budget and is allowed immediately
    // (403 = passed the cost limiter, refused only by their missing capability).
    const other = freshUser();
    await insertUser(other);
    const res = await aiCall(other, "/ai/match-import");
    expect(res.status).toBe(403);
  });

  it("does not charge deterministic mix reconciliation or recap aliases", async () => {
    const { blocked, userId } = await exhaustBudget();
    expect(blocked.status).toBe(429);

    const mix = await fetch(`${baseUrl}/api/ai/mix-reconcile`, {
      method: "POST",
      headers: { ...auth(userId), "content-type": "application/json" },
      body: JSON.stringify({ discrepancies: [] }),
    });
    expect(mix.status).toBe(200);
    expect(mix.headers.get("X-Cost-Limit")).toBeNull();
    await expect(mix.json()).resolves.toMatchObject({
      discrepancies: [],
      aiGenerated: false,
      aiStatus: "deterministic",
    });

    const recap = await fetch(`${baseUrl}/api/ai/summary`, {
      method: "POST",
      headers: { ...auth(userId), "content-type": "application/json" },
      body: JSON.stringify({
        scope: "day",
        date: "2026-09-08",
        nowMs: Date.UTC(2026, 8, 8, 12),
        runs: [],
      }),
    });
    expect(recap.status).toBe(200);
    expect(recap.headers.get("X-Cost-Limit")).toBeNull();
    await expect(recap.json()).resolves.toMatchObject({
      aiGenerated: false,
      aiStatus: "deterministic",
    });
    expect(provider.calls).toBe(0);
  }, 30_000);

  it("charges one cache-miss owner, not its concurrent waiter or later cache hit", async () => {
    const manager = freshUser();
    await insertUser(manager);

    // Leave exactly one unit of provider budget. Invalid non-cacheable requests
    // are still charged before capability gating. Grant manager capability only
    // after priming so these requests do not consume the route's fixed window.
    for (let i = 0; i < 299; i += 1) {
      await aiCall(manager, "/ai/match-import");
    }
    await db
      .update(userRolesTable)
      .set({ role: "manager" })
      .where(eq(userRolesTable.userId, manager));

    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    provider.wait = true;
    provider.started = signalStarted;
    const requestBody = {
      brands: ["Acme"],
      brandFlavors: { Acme: [] },
      unmatchedBrands: ["Unknown"],
      unmatchedFlavors: [],
    };
    const callMatch = () => fetch(`${baseUrl}/api/ai/match-import`, {
      method: "POST",
      headers: { ...auth(manager), "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const owner = callMatch();
    await started;
    const waiter = callMatch();
    provider.release?.();
    const [ownerResponse, waiterResponse] = await Promise.all([owner, waiter]);
    expect(ownerResponse.status).toBe(200);
    expect(waiterResponse.status).toBe(200);
    expect(provider.calls).toBe(1);

    provider.wait = false;
    const hit = await callMatch();
    expect(hit.status).toBe(200);
    expect(provider.calls).toBe(1);

    const distinctMiss = await fetch(`${baseUrl}/api/ai/match-import`, {
      method: "POST",
      headers: { ...auth(manager), "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, unmatchedBrands: ["Another Unknown"] }),
    });
    expect(distinctMiss.status).toBe(429);
    expect(provider.calls).toBe(1);
  }, 30_000);
});
