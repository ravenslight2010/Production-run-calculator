// Integration tests for the denied (ignored) ingredient-merge endpoints.
//
// A "denied merge" is an unordered name pair the user told the app to never
// propose merging together. These tests guard the route contract against a real
// Postgres database:
//   - GET returns all denied pairs;
//   - POST normalizes (trim/lowercase/sort), dedupes, and is idempotent so the
//     same pair never produces a duplicate row regardless of order/case;
//   - DELETE un-denies a pair, matched case-insensitively in either order;
//   - blank / self-referential pairs are dropped; bad bodies 400.
//
// The denied-merges router has no auth of its own (auth is applied at the index
// mount), so we mount just the router with a stub req.log — auth gating is
// covered by roles.integration.test.ts.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so we
// must create the throwaway DB and point DATABASE_URL at it BEFORE importing the
// router — hence the dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let deniedMergesTable: DbModule["deniedMergesTable"];

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
  testDbName = `helium_denied_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const routerMod = await import("./deniedMerges");
  db = dbMod.db;
  pool = dbMod.pool;
  deniedMergesTable = dbMod.deniedMergesTable;

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
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${deniedMergesTable} RESTART IDENTITY CASCADE`);
});

type Pair = { nameA: string; nameB: string };

async function list(): Promise<Pair[]> {
  const res = await fetch(`${baseUrl}/api/denied-merges`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { denied: Pair[] }).denied;
}

async function add(pairs: Pair[]): Promise<Response> {
  return fetch(`${baseUrl}/api/denied-merges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairs }),
  });
}

async function remove(pairs: Pair[]): Promise<Response> {
  return fetch(`${baseUrl}/api/denied-merges`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairs }),
  });
}

describe("denied-merges routes", () => {
  it("starts empty", async () => {
    expect(await list()).toEqual([]);
  });

  it("POST normalizes a pair to trimmed/lowercase/sorted", async () => {
    const res = await add([{ nameA: "  Mozzarella ", nameB: "Mozz" }]);
    expect(res.status).toBe(200);
    const denied = ((await res.json()) as { denied: Pair[] }).denied;
    // sorted: "mozz" <= "mozzarella"
    expect(denied).toEqual([{ nameA: "mozz", nameB: "mozzarella" }]);
  });

  it("is idempotent regardless of order/case", async () => {
    await add([{ nameA: "Mozz", nameB: "Mozzarella" }]);
    await add([{ nameA: "MOZZARELLA", nameB: "mozz" }]); // same pair, reversed + cased
    expect(await list()).toHaveLength(1);
  });

  it("drops blank and self-referential pairs", async () => {
    await add([
      { nameA: "  ", nameB: "x" },
      { nameA: "Cheese", nameB: "cheese" },
      { nameA: "A", nameB: "B" },
    ]);
    expect(await list()).toEqual([{ nameA: "a", nameB: "b" }]);
  });

  it("DELETE un-denies a pair, order-independent and case-insensitive", async () => {
    await add([
      { nameA: "Mozz", nameB: "Mozzarella" },
      { nameA: "Pep", nameB: "Pepperoni" },
    ]);
    const res = await remove([{ nameA: "MOZZARELLA", nameB: "mozz" }]);
    expect(res.status).toBe(200);
    const denied = ((await res.json()) as { denied: Pair[] }).denied;
    expect(denied).toEqual([{ nameA: "pep", nameB: "pepperoni" }]);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/denied-merges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});
