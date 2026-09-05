// Integration tests for PostgresRateLimitStore — the shared, cross-instance
// backing store for the AI cost cap.
//
// The default in-memory limiter counts per process, so a horizontally scaled API
// would let a user exceed the cap by spreading requests across instances. This
// store keeps the counters in Postgres so the cap holds regardless of how many
// instances are running. These tests prove that:
//   - the count is shared: two independent store instances (standing in for two
//     API processes) pointed at the same DB enforce ONE combined cap;
//   - the window is anchored to the application clock and resets after it
//     elapses, identical to the in-memory store;
//   - concurrent hits race-safely (the atomic upsert never loses an increment);
//   - distinct keys are independent.
//
// Like the other *.integration.test.ts files, this stands up a *disposable*
// Postgres database (created from the dev DATABASE_URL's server, schema pushed
// via drizzle-kit, dropped on teardown). @workspace/db binds its pool to
// process.env.DATABASE_URL at import time, so the throwaway DB must be created
// and DATABASE_URL repointed BEFORE importing anything that pulls in the db —
// hence the dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import express, { type Express } from "express";
import type { RateLimitStore } from "../middlewares/rateLimit";

// The integration route only reaches request validation in this suite. Keep the
// capability gate focused on routing and avoid seeding the role tables just to
// establish the test user identity.
vi.mock("../middlewares/requireCapability", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireCapability: () => (req: any, _res: unknown, next: () => void) => {
    const userId = req.headers?.["x-test-user"];
    if (typeof userId === "string") req.userId = userId;
    next();
  },
}));

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let rateLimitCountersTable: DbModule["rateLimitCountersTable"];

let PostgresRateLimitStore: typeof import("../middlewares/rateLimitStore").PostgresRateLimitStore;
let createAiCostLimit: typeof import("../middlewares/costLimitMiddleware").createAiCostLimit;
let createInventoryRouter: typeof import("./inventory").createInventoryRouter;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let inventoryServers: Server[] = [];

const WINDOW_MS = 60_000;
const MAX = 10;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_ratelimit_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();

  // Build the real schema in the throwaway DB via drizzle-kit (no hand-written
  // DDL to drift out of sync with lib/db/src/schema).
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  // Point the app's db at the throwaway DB, THEN load the modules so the
  // singleton pool binds to it.
  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const storeMod = await import("../middlewares/rateLimitStore");
  const costMod = await import("../middlewares/costLimitMiddleware");
  const inventoryMod = await import("./inventory");
  db = dbMod.db;
  pool = dbMod.pool;
  rateLimitCountersTable = dbMod.rateLimitCountersTable;
  PostgresRateLimitStore = storeMod.PostgresRateLimitStore;
  createAiCostLimit = costMod.createAiCostLimit;
  createInventoryRouter = inventoryMod.createInventoryRouter;

  // Swallow benign idle-client errors. During teardown the throwaway DB is
  // dropped WITH (FORCE), which can terminate a connection that is still closing
  // just after pool.end() resolved; pg surfaces that as an 'error' event on the
  // pool. Without a listener it becomes an unhandled error and fails the run.
  pool.on("error", () => {});

  // Mount two independently constructed routers, as two API instances would.
  // Their weighted AI limiters use separate Postgres store objects but the same
  // disposable database.
  const makeApp = (router: ReturnType<typeof createInventoryRouter>): Express => {
    const app: Express = express();
    app.use(express.json({ limit: "10mb" }));
    app.use((req, _res, next) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
      next();
    });
    app.use(router);
    return app;
  };
  const appA = makeApp(createInventoryRouter({
    countObservationCostLimit: createAiCostLimit({
      maxCost: 40,
      store: newInstance(),
    }),
  }));
  const appB = makeApp(createInventoryRouter({
    countObservationCostLimit: createAiCostLimit({
      maxCost: 40,
      store: newInstance(),
    }),
  }));
  for (const app of [appA, appB]) {
    const server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    inventoryServers.push(server);
  }
}, 60_000);

afterAll(async () => {
  await Promise.all(
    inventoryServers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
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
  await db.execute(sql`TRUNCATE ${rateLimitCountersTable} RESTART IDENTITY CASCADE`);
});

// A fresh store for each "instance"; sweeping is disabled so the only writes are
// the hits the test makes (deterministic counts).
function newInstance(): RateLimitStore {
  return new PostgresRateLimitStore(WINDOW_MS, { enableSweep: false });
}

describe("PostgresRateLimitStore — shared cross-instance counting", () => {
  it("enforces one combined cap across two instances hitting the same key", async () => {
    const a = newInstance();
    const b = newInstance();
    const key = "user-shared";
    const now = 1_000_000;

    // Alternate the same key across two separate store instances (two processes
    // behind a load balancer). The counter is shared, so the count climbs 1..10
    // regardless of which instance handled the request.
    const counts: number[] = [];
    for (let i = 0; i < MAX; i += 1) {
      const store = i % 2 === 0 ? a : b;
      const { count } = await store.hit(key, WINDOW_MS, now);
      counts.push(count);
    }
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // The 11th hit (on either instance) pushes the shared count past the cap —
    // the limiter would 429 it. A per-process counter would still be at ~5 here.
    const over = await b.hit(key, WINDOW_MS, now);
    expect(over.count).toBe(MAX + 1);
    expect(over.count).toBeGreaterThan(MAX);
  });

  it("anchors the window to the supplied clock and resets after it elapses", async () => {
    const store = newInstance();
    const key = "user-window";
    const start = 5_000_000;

    const first = await store.hit(key, WINDOW_MS, start);
    expect(first.count).toBe(1);
    expect(first.resetAt).toBe(start + WINDOW_MS);

    // Still inside the window: the count keeps climbing and resetAt is unchanged.
    const second = await store.hit(key, WINDOW_MS, start + 1_000);
    expect(second.count).toBe(2);
    expect(second.resetAt).toBe(start + WINDOW_MS);

    // Past the window: a fresh bucket with a new anchor.
    const afterReset = await store.hit(key, WINDOW_MS, start + WINDOW_MS + 1);
    expect(afterReset.count).toBe(1);
    expect(afterReset.resetAt).toBe(start + WINDOW_MS + 1 + WINDOW_MS);
  });

  it("never loses an increment under concurrent hits across instances", async () => {
    const instances = Array.from({ length: 4 }, () => newInstance());
    const key = "user-concurrent";
    const now = 9_000_000;
    const total = 40;


    // Fire many hits in parallel, spread across instances. The atomic upsert
    // serializes on the row lock, so the final count equals the number of hits
    // with no lost updates.
    const results = await Promise.all(
      Array.from({ length: total }, (_, i) =>
        instances[i % instances.length]!.hit(key, WINDOW_MS, now),
      ),
    );

    const maxCount = Math.max(...results.map((r) => r.count));
    expect(maxCount).toBe(total);
    // Every count value 1..total appears exactly once (no duplicates/skips).
    const sorted = results.map((r) => r.count).sort((x, y) => x - y);
    expect(sorted).toEqual(Array.from({ length: total }, (_, i) => i + 1));
  }, 30_000);

  it("atomically accumulates weighted hits across instances", async () => {
    const a = newInstance();
    const b = newInstance();
    const key = "user-weighted";
    const now = 10_000_000;
    const costs = [5, 7, 11, 3];

    const results = await Promise.all(
      costs.map((cost, index) =>
        (index % 2 === 0 ? a : b).hit(key, WINDOW_MS, now, cost),
      ),
    );

    expect(Math.max(...results.map((result) => result.count))).toBe(
      costs.reduce((total, cost) => total + cost, 0),
    );
    const afterReset = await a.hit(key, WINDOW_MS, now + WINDOW_MS + 1, 9);
    expect(afterReset.count).toBe(9);
  }, 30_000);

  it("keeps distinct keys on independent counters", async () => {
    const store = newInstance();
    const now = 12_000_000;

    await store.hit("user-a", WINDOW_MS, now);
    await store.hit("user-a", WINDOW_MS, now);
    const a = await store.hit("user-a", WINDOW_MS, now);
    const b = await store.hit("user-b", WINDOW_MS, now);

    expect(a.count).toBe(3);
    expect(b.count).toBe(1);
  });

  it("keeps the retained photo budget shared across independently constructed inventory routers", async () => {
    const imagePayload = "retained-photo-payload-that-must-not-appear";
    const body = {
      // Invalid photos stop before the provider and DB insert, while still
      // charging the route's weighted cost limiter.
      photos: [],
      candidates: [],
      imageBase64: imagePayload,
    };
    const [serverA, serverB] = inventoryServers;
    const addressA = serverA?.address() as AddressInfo;
    const addressB = serverB?.address() as AddressInfo;
    const headers = {
      "content-type": "application/json",
      "x-test-user": "retained-photo-shared-user",
    };
    const post = (port: number) =>
      fetch(`http://127.0.0.1:${port}/inventory/count-observations`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

    const first = await post(addressA.port);
    const second = await post(addressB.port);
    const blocked = await post(addressA.port);

    expect(first.status).toBe(400);
    expect(first.headers.get("x-cost-used")).toBe("20");
    expect(second.status).toBe(400);
    expect(second.headers.get("x-cost-used")).toBe("40");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("x-cost-limit")).toBe("40");
    expect(blocked.headers.get("x-cost-requested")).toBe("20");
    expect(blocked.headers.get("x-cost-used")).toBe("40");
    const blockedBody = await blocked.text();
    expect(JSON.parse(blockedBody)).toEqual({
      error: expect.stringMatching(
        /^Cost limit exceeded\. Budget: 40, used: 40, requested: 20\. Retry after \d+s\.$/,
      ),
    });
    expect(blockedBody).not.toContain(imagePayload);
    expect(blockedBody).not.toContain("Extract one product/count observation");
  });
});
