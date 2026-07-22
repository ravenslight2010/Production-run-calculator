// Integration tests for the durable merged-away tombstone endpoints.
//
// The merged-away list is the factory-wide tombstone of ingredient/die names
// the user merged away. These tests guard the route contract against a real
// Postgres database:
//   - GET returns all names;
//   - POST normalizes (trim/lowercase), dedupes, and is idempotent so the same
//     name never produces a duplicate row regardless of case/whitespace;
//   - DELETE un-tombstones a name (case-insensitively);
//   - blank names are dropped; bad bodies 400.
//
// The merged-away router has no auth of its own (auth is applied at the index
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
let mergedAwayTable: DbModule["mergedAwayTable"];

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
  testDbName = `helium_merged_away_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const routerMod = await import("./mergedAway");
  db = dbMod.db;
  pool = dbMod.pool;
  mergedAwayTable = dbMod.mergedAwayTable;

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
  await db.execute(sql`TRUNCATE ${mergedAwayTable} RESTART IDENTITY CASCADE`);
});

async function list(): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/merged-away`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { names: string[] }).names;
}

async function add(names: string[]): Promise<Response> {
  return fetch(`${baseUrl}/api/merged-away`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
}

async function remove(names: string[]): Promise<Response> {
  return fetch(`${baseUrl}/api/merged-away`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
}

describe("merged-away routes", () => {
  it("starts empty", async () => {
    expect(await list()).toEqual([]);
  });

  it("POST normalizes names to trimmed/lowercase", async () => {
    const res = await add(["  Mozz "]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { names: string[] }).names).toEqual(["mozz"]);
  });

  it("is idempotent regardless of case/whitespace", async () => {
    await add(["Mozz"]);
    await add([" MOZZ "]); // same name, cased + padded
    expect(await list()).toEqual(["mozz"]);
  });

  it("drops blank names", async () => {
    await add(["  ", "Pep", ""]);
    expect(await list()).toEqual(["pep"]);
  });

  it("DELETE un-tombstones a name, case-insensitively", async () => {
    await add(["Mozz", "Pep"]);
    const res = await remove(["MOZZ"]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { names: string[] }).names).toEqual(["pep"]);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/merged-away`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});
