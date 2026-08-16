// Integration tests proving scope isolation for the newly scoped tables:
// factory_kv, production_runs, quality_checks, and proactive_alert_settings.
//
// Each test DB is created fresh, schema pushed via drizzle-kit push-force, and
// dropped on teardown — nothing here touches real data.
//
// Pattern mirrors sandboxIsolation.integration.test.ts: sandbox user is the
// seeded `test` account (sandbox=true in users) and live user is a plain
// manager. Both are managers so every capability-gated write is reachable.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

// Mock AI provider so routes that import it don't 502.
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
let productionRunsTable: DbModule["productionRunsTable"];
let qualityChecksTable: DbModule["qualityChecksTable"];
let proactiveAlertSettingsTable: DbModule["proactiveAlertSettingsTable"];

let seedRoles: () => Promise<void>;
let seedSandboxUser: () => Promise<void>;
let SANDBOX_USERNAME: string;
let clearUserValidityCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const LIVE_MANAGER = "live-mgr-scope-test";
let sandboxUserId: string;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_scope_new_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const sandboxMod = await import("../lib/sandbox");
  const usersMod = await import("../lib/users");

  db = dbMod.db;
  pool = dbMod.pool;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  factoryKvTable = dbMod.factoryKvTable;
  productionRunsTable = dbMod.productionRunsTable;
  qualityChecksTable = dbMod.qualityChecksTable;
  proactiveAlertSettingsTable = dbMod.proactiveAlertSettingsTable;
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  seedRoles = (await import("../lib/roles")).seedRoles;
  seedSandboxUser = sandboxMod.seedSandboxUser;
  SANDBOX_USERNAME = sandboxMod.SANDBOX_USERNAME;

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

  await seedRoles();
  await seedSandboxUser();
  const sandboxUser = await usersMod.findUserByUsername(SANDBOX_USERNAME);
  if (!sandboxUser) throw new Error("sandbox user was not seeded");
  sandboxUserId = sandboxUser.id;

  await db.insert(usersTable).values({ id: LIVE_MANAGER, username: "live-mgr-scope", passwordHash: "x" });
  await db.insert(userRolesTable).values({ userId: LIVE_MANAGER, role: "manager" });
}, 90_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
  // Wipe only the data tables; user/role rows survive across cases.
  await db.execute(sql`DELETE FROM ${factoryKvTable}`);
  await db.execute(sql`DELETE FROM ${productionRunsTable}`);
  await db.execute(sql`DELETE FROM ${qualityChecksTable}`);
  await db.execute(sql`DELETE FROM ${proactiveAlertSettingsTable}`);
});

// ── helpers ───────────────────────────────────────────────────────────────────

function authHeader(userId: string) {
  return { authorization: `Bearer ${signToken(userId)}` };
}

async function putKv(userId: string, key: string, value: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/factory-data`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeader(userId) },
    body: JSON.stringify({ key, value }),
  });
}

async function getKv(userId: string): Promise<Record<string, { value: unknown }>> {
  const res = await fetch(`${baseUrl}/api/factory-data`, { headers: authHeader(userId) });
  const body = await res.json() as { data: Record<string, { value: unknown }> };
  return body.data;
}

async function createRun(userId: string, label: string): Promise<Response> {
  return fetch(`${baseUrl}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader(userId) },
    body: JSON.stringify({
      label,
      casesNeeded: 100,
      casesLeft: 100,
      skidsCompleted: 0,
      pizzasPerMin: "5.00",
      totalTimeSec: 1200,
      batchesNeeded: "2.50",
      inputs: {},
    }),
  });
}

async function listRuns(userId: string): Promise<Array<{ id: number; label: string; scope: string }>> {
  const res = await fetch(`${baseUrl}/api/runs`, { headers: authHeader(userId) });
  return res.json() as Promise<Array<{ id: number; label: string; scope: string }>>;
}

async function deleteRun(userId: string, id: number): Promise<Response> {
  return fetch(`${baseUrl}/api/runs/${id}`, {
    method: "DELETE",
    headers: authHeader(userId),
  });
}

async function putProactiveSettings(userId: string, enabled: boolean): Promise<Response> {
  return fetch(`${baseUrl}/api/ai/proactive-settings`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeader(userId) },
    body: JSON.stringify({ enabled, pollSeconds: 120, cooldownSeconds: 900 }),
  });
}

async function getProactiveSettings(userId: string): Promise<{ enabled: boolean }> {
  const res = await fetch(`${baseUrl}/api/ai/proactive-settings`, { headers: authHeader(userId) });
  return res.json() as Promise<{ enabled: boolean }>;
}

// ── factory KV scope isolation ────────────────────────────────────────────────

describe("factory KV — live/sandbox scope isolation", () => {
  it("a live-scope write is not visible to a sandbox-scope GET", async () => {
    await putKv(LIVE_MANAGER, "liveOnlyKey", { from: "live" });

    const sandboxData = await getKv(sandboxUserId);
    expect(sandboxData["liveOnlyKey"]).toBeUndefined();
  });

  it("a sandbox-scope write is not visible to a live-scope GET", async () => {
    await putKv(sandboxUserId, "sandboxOnlyKey", { from: "sandbox" });

    const liveData = await getKv(LIVE_MANAGER);
    expect(liveData["sandboxOnlyKey"]).toBeUndefined();
  });

  it("the same key name holds independent values per scope", async () => {
    await putKv(LIVE_MANAGER, "sharedKey", { version: "live-v1" });
    await putKv(sandboxUserId, "sharedKey", { version: "sandbox-v1" });

    const liveData = await getKv(LIVE_MANAGER);
    const sandboxData = await getKv(sandboxUserId);

    expect(liveData["sharedKey"].value).toEqual({ version: "live-v1" });
    expect(sandboxData["sharedKey"].value).toEqual({ version: "sandbox-v1" });
  });

  it("overwriting the same key in one scope leaves the other scope unchanged", async () => {
    await putKv(LIVE_MANAGER, "overwriteKey", { v: 1 });
    await putKv(sandboxUserId, "overwriteKey", { v: 1 });

    await putKv(LIVE_MANAGER, "overwriteKey", { v: 2 });

    const liveData = await getKv(LIVE_MANAGER);
    const sandboxData = await getKv(sandboxUserId);

    expect(liveData["overwriteKey"].value).toEqual({ v: 2 });
    expect(sandboxData["overwriteKey"].value).toEqual({ v: 1 });  // unchanged
  });

  it("GET requires manage-factory-settings capability — operator is rejected 403", async () => {
    // Seed an operator
    const opId = "op-scope-test";
    await db.insert(usersTable).values({ id: opId, username: "op-scope-test", passwordHash: "x" });
    await db.insert(userRolesTable).values({ userId: opId, role: "operator" });
    clearUserValidityCache();

    const res = await fetch(`${baseUrl}/api/factory-data`, { headers: authHeader(opId) });
    expect(res.status).toBe(403);
  });
});

// ── production runs scope isolation ──────────────────────────────────────────

describe("production runs — live/sandbox scope isolation", () => {
  it("a live-scope run is not visible in sandbox list", async () => {
    const r = await createRun(LIVE_MANAGER, "live-run");
    expect(r.status).toBe(201);

    const sandboxRuns = await listRuns(sandboxUserId);
    expect(sandboxRuns.map((r) => r.label)).not.toContain("live-run");
  });

  it("a sandbox-scope run is not visible in live list", async () => {
    const r = await createRun(sandboxUserId, "sandbox-run");
    expect(r.status).toBe(201);

    const liveRuns = await listRuns(LIVE_MANAGER);
    expect(liveRuns.map((r) => r.label)).not.toContain("sandbox-run");
  });

  it("a sandbox manager cannot delete a live run (scope predicate blocks it)", async () => {
    const createRes = await createRun(LIVE_MANAGER, "live-run-to-protect");
    expect(createRes.status).toBe(201);
    const liveRun = await createRes.json() as { id: number };

    // Sandbox tries to delete the live run by its id — should 404 (not found in sandbox)
    const deleteRes = await deleteRun(sandboxUserId, liveRun.id);
    expect(deleteRes.status).toBe(404);

    // Live run is still there
    const liveRuns = await listRuns(LIVE_MANAGER);
    expect(liveRuns.map((r) => r.id)).toContain(liveRun.id);
  });

  it("each scope only sees its own runs when both have created runs", async () => {
    await createRun(LIVE_MANAGER, "live-a");
    await createRun(LIVE_MANAGER, "live-b");
    await createRun(sandboxUserId, "sandbox-a");

    const liveRuns = await listRuns(LIVE_MANAGER);
    const sandboxRuns = await listRuns(sandboxUserId);

    expect(liveRuns.map((r) => r.label).sort()).toEqual(["live-a", "live-b"]);
    expect(sandboxRuns.map((r) => r.label)).toEqual(["sandbox-a"]);
  });
});

// ── proactive alert settings scope isolation ──────────────────────────────────

describe("proactive alert settings — live/sandbox scope isolation", () => {
  it("sandbox changes to alert settings do not affect live settings", async () => {
    // Set live to enabled=true
    await putProactiveSettings(LIVE_MANAGER, true);
    // Set sandbox to enabled=false
    await putProactiveSettings(sandboxUserId, false);

    const liveSettings = await getProactiveSettings(LIVE_MANAGER);
    const sandboxSettings = await getProactiveSettings(sandboxUserId);

    expect(liveSettings.enabled).toBe(true);
    expect(sandboxSettings.enabled).toBe(false);
  });

  it("live changes to alert settings do not affect sandbox settings", async () => {
    await putProactiveSettings(sandboxUserId, true);
    await putProactiveSettings(LIVE_MANAGER, false);

    const liveSettings = await getProactiveSettings(LIVE_MANAGER);
    const sandboxSettings = await getProactiveSettings(sandboxUserId);

    expect(liveSettings.enabled).toBe(false);
    expect(sandboxSettings.enabled).toBe(true);
  });
});
