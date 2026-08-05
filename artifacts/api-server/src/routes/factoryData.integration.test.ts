// Integration tests for GET /factory-data and PUT /factory-data.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so
// the throwaway DB is created and DATABASE_URL is repointed BEFORE the router is
// imported — hence dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

// The router imports AI routes at load time; mock the provider so no real
// requests are made and pickModel / AI_MODELS remain resolvable.
vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } },
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
let factoryKvTable: DbModule["factoryKvTable"];
let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;

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
  testDbName = `helium_factorykv_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  factoryKvTable = dbMod.factoryKvTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  pool.on("error", () => {});

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", routerMod.default);

  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
  }
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${factoryKvTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
});

let nextUser = 0;
async function freshUser(role: "manager" | "operator"): Promise<string> {
  const id = `${role}-${nextUser++}-${Math.floor(Math.random() * 1e6)}`;
  await db.insert(usersTable).values({ id, username: id, passwordHash: "x" });
  await db.insert(userRolesTable).values({ userId: id, role });
  clearUserValidityCache();
  return id;
}

async function getFactoryData(userId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/factory-data`, {
    headers: { authorization: `Bearer ${signToken(userId)}` },
  });
}

async function putFactoryData(userId: string, key: string, value: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/factory-data`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${signToken(userId)}`,
    },
    body: JSON.stringify({ key, value }),
  });
}

describe("GET /factory-data", () => {
  it("returns empty data object when no keys exist", async () => {
    const mgr = await freshUser("manager");
    const res = await getFactoryData(mgr);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toEqual({});
  });

  it("returns written keys after a PUT", async () => {
    const mgr = await freshUser("manager");
    const putRes = await putFactoryData(mgr, "myKey", { hello: "world" });
    expect(putRes.status).toBe(200);

    const getRes = await getFactoryData(mgr);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as { data: Record<string, { value: unknown; updatedAt: string }> };
    expect(body.data["myKey"]).toBeDefined();
    expect(body.data["myKey"].value).toEqual({ hello: "world" });
    expect(typeof body.data["myKey"].updatedAt).toBe("string");
  });

  it("is accessible to non-manager authenticated users", async () => {
    const op = await freshUser("operator");
    const res = await getFactoryData(op);
    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(`${baseUrl}/api/factory-data`);
    expect(res.status).toBe(401);
  });
});

describe("PUT /factory-data", () => {
  it("upserts a key and returns updatedAt", async () => {
    const mgr = await freshUser("manager");
    const res = await putFactoryData(mgr, "testKey", [1, 2, 3]);
    expect(res.status).toBe(200);
    const body = await res.json() as { updatedAt: string };
    expect(typeof body.updatedAt).toBe("string");
    expect(() => new Date(body.updatedAt)).not.toThrow();
  });

  it("overwrites the value on a second PUT to the same key", async () => {
    const mgr = await freshUser("manager");
    await putFactoryData(mgr, "overwriteKey", { v: 1 });
    await putFactoryData(mgr, "overwriteKey", { v: 2 });

    const res = await getFactoryData(mgr);
    const body = await res.json() as { data: Record<string, { value: unknown }> };
    expect(body.data["overwriteKey"].value).toEqual({ v: 2 });
  });

  it("rejects staff (operator) with 403", async () => {
    const op = await freshUser("operator");
    const res = await putFactoryData(op, "someKey", { x: 1 });
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing key", async () => {
    const mgr = await freshUser("manager");
    const res = await fetch(`${baseUrl}/api/factory-data`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signToken(mgr)}`,
      },
      body: JSON.stringify({ value: { x: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(`${baseUrl}/api/factory-data`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
