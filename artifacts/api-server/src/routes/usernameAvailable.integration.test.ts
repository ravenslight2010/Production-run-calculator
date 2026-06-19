// Integration tests for the live sign-up username availability check.
//
// The sign-up form calls GET /auth/username-available?username=... as the user
// types so it can warn (red) on a taken name or reassure (green) on a free one
// before submit. These tests guard the endpoint's contract:
//   - public access: it must work signed-out (sign-up is itself public);
//   - it reports a free username as available;
//   - it reports an existing username as taken, case-insensitively (matching how
//     accounts are actually created);
//   - it rejects a missing/blank username with a 400.
//
// Like the other auth integration tests, it stands up the real router against a
// disposable Postgres database (created from the dev DATABASE_URL's server,
// schema pushed via drizzle-kit, dropped on teardown) so nothing here ever
// touches real data.
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
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];

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
  testDbName = `helium_uname_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  await db.execute(
    sql`TRUNCATE ${userRolesTable}, ${usersTable} RESTART IDENTITY CASCADE`,
  );
  await db.insert(usersTable).values([{ id: "taken-1", username: "taken", passwordHash: "x" }]);
});

async function check(username: string | null): Promise<Response> {
  const q = username === null ? "" : `?username=${encodeURIComponent(username)}`;
  return fetch(`${baseUrl}/api/auth/username-available${q}`);
}

describe("GET /auth/username-available", () => {
  it("is public — works signed out", async () => {
    const res = await check("freebird");
    expect(res.status).toBe(200);
  });

  it("reports a free username as available", async () => {
    const res = await check("freebird");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });

  it("reports an existing username as not available", async () => {
    const res = await check("taken");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });

  it("matches an existing username case-insensitively", async () => {
    const res = await check("TAKEN");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });

  it("treats surrounding whitespace the same as account creation", async () => {
    const res = await check("  taken  ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });

  it("rejects a missing username with 400", async () => {
    const res = await check(null);
    expect(res.status).toBe(400);
  });
});
