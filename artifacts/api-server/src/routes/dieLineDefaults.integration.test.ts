// Integration tests for the manager-editable per-die line-setting defaults
// pool (Manage Lists → Die Defaults), asserting the intended boundary:
//
//   1. Reading is open to any signed-in user (the run form needs the values
//      to pre-fill line settings), unauthenticated access is rejected.
//   2. Writes (save + delete) are manager-gated on "manage-inventory" — a
//      plain operator gets 403.
//   3. Upserts are idempotent across spellings (case-folded id), last write
//      wins, and malformed entries (negative / non-finite numbers, blank
//      names) are dropped.
//   4. Deleting by name (case-insensitive) removes the override so the die
//      falls back to the app's built-in defaults.
//
// Stands up the *real* router against a *disposable* Postgres database, same
// as brandProfiles.integration.test.ts. @workspace/db binds its pool to
// process.env.DATABASE_URL at import time, so the throwaway DB is created and
// DATABASE_URL repointed BEFORE importing anything that pulls in @workspace/db
// (see .agents/memory/integration-test-db-binding.md).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let dieLineDefaultsTable: DbModule["dieLineDefaultsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;

let clearUserValidityCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const MANAGER = "manager-1";
const OPERATOR = "operator-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_dielinedefaults_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const userValidityMod = await import("../lib/userValidity");
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  db = dbMod.db;
  pool = dbMod.pool;
  dieLineDefaultsTable = dbMod.dieLineDefaultsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;

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
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${dieLineDefaultsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: OPERATOR, username: "operator", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
  ]);
});

async function req(
  userId: string | null,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (userId) headers["authorization"] = `Bearer ${signToken(userId)}`;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

type ApiEntry = {
  name: string;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
  freezerTime: number;
  casesPerLayer: number;
  preTunnelMin?: number;
  postTunnelMin?: number;
};

function entry(overrides: Partial<ApiEntry> = {}): ApiEntry {
  return {
    name: '7" Dies',
    crustsPerCycle: 4,
    cycleSpeed: 9,
    speedAdjustment: 0.7,
    freezerTime: 30,
    casesPerLayer: 8,
    ...overrides,
  };
}

async function listAs(userId: string): Promise<ApiEntry[]> {
  const res = await req(userId, "GET", "/api/die-line-defaults");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { entries: ApiEntry[] };
  return body.entries;
}

describe("die-line-defaults auth boundary", () => {
  it("rejects unauthenticated access", async () => {
    const resGet = await req(null, "GET", "/api/die-line-defaults");
    expect(resGet.status).toBe(401);
    const resPost = await req(null, "POST", "/api/die-line-defaults", { entries: [entry()] });
    expect(resPost.status).toBe(401);
  });

  it("lets an operator read but not write", async () => {
    const save = await req(OPERATOR, "POST", "/api/die-line-defaults", { entries: [entry()] });
    expect(save.status).toBe(403);
    const del = await req(OPERATOR, "DELETE", "/api/die-line-defaults", { names: ['7" Dies'] });
    expect(del.status).toBe(403);
    expect(await listAs(OPERATOR)).toEqual([]);
  });

  it("lets a manager save and every signed-in user read", async () => {
    const save = await req(MANAGER, "POST", "/api/die-line-defaults", { entries: [entry()] });
    expect(save.status).toBe(200);
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject(entry());
  });
});

describe("die-line-defaults upsert semantics", () => {
  it("upserts idempotently across spellings (case-folded id), last write wins", async () => {
    await req(MANAGER, "POST", "/api/die-line-defaults", { entries: [entry()] });
    await req(MANAGER, "POST", "/api/die-line-defaults", {
      entries: [entry({ name: '7" DIES', freezerTime: 25 })],
    });
    const items = await listAs(MANAGER);
    expect(items).toHaveLength(1);
    expect(items[0].freezerTime).toBe(25);
    expect(items[0].name).toBe('7" DIES');
  });

  it("saves and returns explicit tunnel time overrides", async () => {
    const save = await req(MANAGER, "POST", "/api/die-line-defaults", {
      entries: [entry({ preTunnelMin: 2.5, postTunnelMin: 4 })],
    });
    expect(save.status).toBe(200);

    const items = await listAs(MANAGER);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: '7" Dies',
      preTunnelMin: 2.5,
      postTunnelMin: 4,
    });
  });

  it("omits tunnel time fields when they are not provided", async () => {
    const save = await req(MANAGER, "POST", "/api/die-line-defaults", {
      entries: [entry()],
    });
    expect(save.status).toBe(200);

    const items = await listAs(MANAGER);
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("preTunnelMin");
    expect(items[0]).not.toHaveProperty("postTunnelMin");
  });

  it("drops malformed entries (blank name, negative / non-finite numbers)", async () => {
    const res = await req(MANAGER, "POST", "/api/die-line-defaults", {
      entries: [
        entry({ name: "   " }),
        entry({ name: "Bad Negative", freezerTime: -1 }),
        entry({ name: "Good", cycleSpeed: 7 }),
      ],
    });
    expect(res.status).toBe(200);
    const items = await listAs(MANAGER);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Good");
  });

  it("rejects a body without entries", async () => {
    const res = await req(MANAGER, "POST", "/api/die-line-defaults", { nope: true });
    expect(res.status).toBe(400);
  });
});

describe("die-line-defaults delete", () => {
  it("deletes by name case-insensitively so the die falls back to built-ins", async () => {
    await req(MANAGER, "POST", "/api/die-line-defaults", {
      entries: [
        entry({ preTunnelMin: 2.5, postTunnelMin: 4 }),
        entry({ name: "Argus Dies" }),
      ],
    });
    const del = await req(MANAGER, "DELETE", "/api/die-line-defaults", { names: ['7" DIES'] });
    expect(del.status).toBe(200);
    const items = await listAs(MANAGER);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Argus Dies");
  });
});
