// Integration coverage for the manager duplicate-review ledger.
//
// The route's capability middleware is stubbed here so these tests focus on
// persistence, scope isolation, and the stale-scan safety contract. The shared
// roles integration suite covers capability enforcement for manager routes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { sql } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { runWithScope } from "../lib/requestScope";

vi.mock("../middlewares/requireCapability", () => ({
  requireCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let duplicateReviewGroupsTable: DbModule["duplicateReviewGroupsTable"];

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
  testDbName = `helium_duplicate_review_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const routerMod = await import("./duplicateReviews");
  db = dbMod.db;
  pool = dbMod.pool;
  duplicateReviewGroupsTable = dbMod.duplicateReviewGroupsTable;

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    const scope = req.header("x-test-scope") === "sandbox" ? "sandbox" : "live";
    runWithScope(scope, next);
  });
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    };
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
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
  await db.execute(sql`TRUNCATE ${duplicateReviewGroupsTable} RESTART IDENTITY CASCADE`);
});

const group = {
  groupKey: "ingredient::mozz::mozzarella",
  category: "ingredient",
  target: "Mozz",
  sources: ["Mozzarella"],
  status: "pending",
};

async function list(scope = "live"): Promise<{ groups: unknown[]; count: number }> {
  const res = await fetch(`${baseUrl}/api/duplicate-reviews`, {
    headers: { "x-test-scope": scope },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { groups: unknown[]; count: number };
}

async function record(groups: unknown[], scope = "live"): Promise<Response> {
  return fetch(`${baseUrl}/api/duplicate-reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-scope": scope },
    body: JSON.stringify({ groups }),
  });
}

async function resolve(groupKey: string, outcome: "resolved" | "ignored", scope = "live"): Promise<Response> {
  return fetch(`${baseUrl}/api/duplicate-reviews/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-scope": scope },
    body: JSON.stringify({ groupKey, outcome }),
  });
}

describe("duplicate-review routes", () => {
  it("records pending work, resolves it explicitly, and does not reopen it from a stale scan", async () => {
    expect(await list()).toEqual({ groups: [], count: 0 });

    const created = await record([group]);
    expect(created.status).toBe(200);
    expect((await created.json() as { count: number }).count).toBe(1);

    const ignored = await resolve(group.groupKey, "ignored");
    expect(ignored.status).toBe(200);
    expect((await ignored.json() as { count: number }).count).toBe(0);

    const staleScan = await record([group]);
    expect(staleScan.status).toBe(200);
    expect((await staleScan.json() as { count: number }).count).toBe(0);
    expect(await list()).toEqual({ groups: [], count: 0 });
  });

  it("keeps pending reminders isolated by facility scope", async () => {
    await record([group], "live");
    await record([{ ...group, groupKey: "sandbox-group" }], "sandbox");

    expect((await list("live")).count).toBe(1);
    expect((await list("sandbox")).count).toBe(1);

    await resolve(group.groupKey, "resolved", "live");
    expect((await list("live")).count).toBe(0);
    expect((await list("sandbox")).count).toBe(1);
  });

  it("rejects malformed review input without changing pending work", async () => {
    const res = await record([{ ...group, sources: [] }]);
    expect(res.status).toBe(400);
    expect((await list()).count).toBe(0);
  });
});