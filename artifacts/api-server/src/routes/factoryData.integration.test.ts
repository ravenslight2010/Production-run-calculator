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
import { signLegacyTokenForTests } from "../lib/auth";

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
let supervisorPinSettingsTable: DbModule["supervisorPinSettingsTable"];
let rateLimitCountersTable: DbModule["rateLimitCountersTable"];
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
  supervisorPinSettingsTable = dbMod.supervisorPinSettingsTable;
  rateLimitCountersTable = dbMod.rateLimitCountersTable;
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
    sql`TRUNCATE ${factoryKvTable}, ${supervisorPinSettingsTable}, ${rateLimitCountersTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
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
    headers: { authorization: `Bearer ${signLegacyTokenForTests(userId)}` },
  });
}

async function putFactoryData(userId: string, key: string, value: unknown, updatedAt?: number): Promise<Response> {
  return fetch(`${baseUrl}/api/factory-data`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${signLegacyTokenForTests(userId)}`,
    },
    body: JSON.stringify({ key, value, ...(updatedAt === undefined ? {} : { updatedAt }) }),
  });
}

describe("GET /factory-data", () => {
  it("allows staff to read only the operational allowlist, never administrative settings", async () => {
    const mgr = await freshUser("manager");
    const op = await freshUser("operator");
    await putFactoryData(mgr, "run-calc-brands", ["Fixture brand"]);
    await putFactoryData(mgr, "run-calc-dough-recipe-presets", { Fixture: { rows: [] } });
    await putFactoryData(mgr, "run-calc-shift-start-time", "08:00");
    const operationalSettings = {
      "run-calc-stop-reasons": ["Fixture special stop"],
      "run-calc-circles": ["Fixture circle"], "run-calc-shippers": ["Fixture shipper"],
      "run-calc-skid-stacking": ["Fixture stack"], "run-calc-grip-sheets": ["Fixture grip"],
      "run-calc-production-start-time": "08:25",
    };
    for (const [key, value] of Object.entries(operationalSettings)) {
      expect((await putFactoryData(mgr, key, value)).status).toBe(200);
    }
    await putFactoryData(mgr, "private-admin-setting", { private: true });
    const res = await fetch(`${baseUrl}/api/factory-data/operational`, {
      headers: { authorization: `Bearer ${signLegacyTokenForTests(op)}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json() as { data: Record<string, { value: unknown }> };
    expect(Object.keys(body.data).sort()).toEqual([
      "run-calc-brands", "run-calc-dough-recipe-presets", "run-calc-shift-start-time",
      ...Object.keys(operationalSettings),
    ].sort());
    expect(body.data["run-calc-shift-start-time"].value).toBe("08:00");
    for (const [key, value] of Object.entries(operationalSettings)) {
      expect(body.data[key].value).toEqual(value);
      expect((await putFactoryData(op, key, [])).status).toBe(403);
    }
    expect((await getFactoryData(op)).status).toBe(403);
    expect((await putFactoryData(op, "run-calc-brands", [])).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/factory-data/operational`)).status).toBe(401);
  });
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

  it("rejects operators (missing manage-factory-settings capability) with 403", async () => {
    const op = await freshUser("operator");
    const res = await getFactoryData(op);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(`${baseUrl}/api/factory-data`);
    expect(res.status).toBe(401);
  });
});

describe("server-only PIN verification", () => {
  async function pinRequest(userId: string | null, method: string, pin?: string) {
    return fetch(`${baseUrl}/api/supervisor-pin${method === "POST" ? "/verify" : ""}`, {
      method,
      headers: { "content-type": "application/json",
        ...(userId ? { authorization: `Bearer ${signLegacyTokenForTests(userId)}` } : {}) },
      ...(pin === undefined ? {} : { body: JSON.stringify({ pin }) }),
    });
  }
  it("never returns the configured PIN on reads or manager updates", async () => {
    const manager = await freshUser("manager");
    const staff = await freshUser("operator");
    const update = await pinRequest(manager, "PUT", "6372");
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ configured: true });
    const read = await pinRequest(staff, "GET");
    expect(await read.json()).toEqual({ configured: true });
    expect(read.headers.get("cache-control")).toContain("no-store");
    expect((await pinRequest(staff, "PUT", "8888")).status).toBe(403);
    expect((await pinRequest(null, "GET")).status).toBe(401);
    expect((await pinRequest(null, "POST", "6372")).status).toBe(401);
  });
  it("distinguishes incorrect, invalid, correct and explicitly empty PIN policies", async () => {
    const manager = await freshUser("manager"); const staff = await freshUser("operator");
    await pinRequest(manager, "PUT", "6372");
    expect((await pinRequest(staff, "POST", "abcd")).status).toBe(400);
    expect((await pinRequest(staff, "POST", "1")).status).toBe(400);
    expect((await pinRequest(staff, "POST", "1111")).status).toBe(403);
    const correct = await pinRequest(staff, "POST", "6372");
    expect(correct.status).toBe(200); expect(await correct.json()).toEqual({ verified: true });
    expect(await (await pinRequest(manager, "PUT", "")).json()).toEqual({ configured: false });
    expect(await (await pinRequest(staff, "GET")).json()).toEqual({ configured: false });
    expect((await pinRequest(staff, "POST", "1111")).status).toBe(200);
    expect((await pinRequest(manager, "PUT", "not-a-pin")).status).toBe(400);
  });
  it("limits low-entropy attempts using shared storage by principal", async () => {
    const manager = await freshUser("manager"); const staff = await freshUser("operator");
    await pinRequest(manager, "PUT", "6372");
    for (let i = 0; i < 10; i++) expect((await pinRequest(staff, "POST", "1111")).status).toBe(403);
    const blocked = await pinRequest(staff, "POST", "6372");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different authenticated principal retains its own bound, subject to the source cap.
    expect((await pinRequest(manager, "POST", "6372")).status).toBe(200);
  });
  it("isolates status and verification between live and sandbox", async () => {
    const live = await freshUser("manager");
    const sandbox = await freshUser("manager");
    await db.execute(sql`UPDATE ${usersTable} SET sandbox = true WHERE id = ${sandbox}`);
    clearUserValidityCache();
    await pinRequest(live, "PUT", "6372");
    await pinRequest(sandbox, "PUT", "");
    expect(await (await pinRequest(live, "GET")).json()).toEqual({ configured: true });
    expect(await (await pinRequest(sandbox, "GET")).json()).toEqual({ configured: false });
    expect((await pinRequest(live, "POST", "1111")).status).toBe(403);
    expect((await pinRequest(sandbox, "POST", "1111")).status).toBe(200);
  });
  it("fails closed when the shared verification limiter is unavailable", async () => {
    const { PostgresRateLimitStore } = await import("../middlewares/rateLimitStore");
    const manager = await freshUser("manager");
    const unavailable = vi.spyOn(PostgresRateLimitStore.prototype, "hit").mockRejectedValueOnce(new Error("fixture unavailable"));
    try { expect((await pinRequest(manager, "POST", "6372")).status).toBe(503); }
    finally { unavailable.mockRestore(); }
  });
  it("bounds attempts from one source across multiple authenticated principals", async () => {
    const manager = await freshUser("manager");
    await pinRequest(manager, "PUT", "6372");
    for (let n = 0; n < 4; n++) {
      const staff = await freshUser("operator");
      for (let i = 0; i < 10; i++) expect((await pinRequest(staff, "POST", "1111")).status).toBe(403);
    }
    expect((await pinRequest(manager, "POST", "6372")).status).toBe(429);
  });
});

describe("PUT /factory-data", () => {
  it("keeps stale retries canonical and independent keys idempotent within their scope", async () => {
    const manager = await freshUser("manager");
    const sandbox = await freshUser("manager");
    await db.execute(sql`UPDATE ${usersTable} SET sandbox = true WHERE id = ${sandbox}`);
    clearUserValidityCache();
    const now = Date.now();
    const firstKey = "run-calc-shift-start-time";
    const secondKey = "run-calc-production-start-time";
    const canonical = await (await putFactoryData(manager, firstKey, "09:00", now)).json();
    const stale = await putFactoryData(manager, firstKey, "07:00", now - 1_000);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual(canonical);
    const independent = await putFactoryData(manager, secondKey, "09:15", now);
    expect(independent.status).toBe(200);
    const accepted = await independent.json();
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await (await putFactoryData(manager, firstKey, "07:00", now - 1_000)).json()).toEqual(canonical);
      expect(await (await putFactoryData(manager, secondKey, "09:15", now)).json()).toEqual(accepted);
    }
    expect(await (await getFactoryData(sandbox)).json()).toEqual({ data: {} });
    const live = await (await getFactoryData(manager)).json() as { data: Record<string, { value: unknown }> };
    expect(live.data[firstKey].value).toBe("09:00");
    expect(live.data[secondKey].value).toBe("09:15");
  });
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
        authorization: `Bearer ${signLegacyTokenForTests(mgr)}`,
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
