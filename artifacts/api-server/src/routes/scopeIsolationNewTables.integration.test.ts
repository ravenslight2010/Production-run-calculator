// Integration tests proving scope isolation for the newly scoped tables:
// factory_kv, production_runs, quality_checks, and run_templates.
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
let runTemplatesTable: DbModule["runTemplatesTable"];

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
const LIVE_OPERATOR = "live-op-scope-test";
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
  runTemplatesTable = dbMod.runTemplatesTable;
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

  await db.insert(usersTable).values([
    { id: LIVE_MANAGER, username: "live-mgr-scope", passwordHash: "x" },
    { id: LIVE_OPERATOR, username: "live-op-scope", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: LIVE_MANAGER, role: "manager" },
    { userId: LIVE_OPERATOR, role: "operator" },
  ]);
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
  await db.execute(sql`DELETE FROM ${runTemplatesTable}`);
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

type RunTemplate = {
  id: string;
  name: string;
  values: Record<string, unknown>;
  revision?: number;
  deleted?: boolean;
};

async function saveTemplate(userId: string, template: RunTemplate): Promise<Response> {
  return fetch(`${baseUrl}/api/run-templates`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader(userId) },
    body: JSON.stringify({
      templates: [{
        ...template,
        revision: template.revision ?? 1,
        createdAt: "2026-09-06T00:00:00.000Z",
      }],
    }),
  });
}

async function listTemplates(userId: string): Promise<RunTemplate[]> {
  const res = await fetch(`${baseUrl}/api/run-templates`, { headers: authHeader(userId) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { templates: RunTemplate[] }).templates;
}

async function deleteTemplates(
  userId: string,
  items: Array<{ id: string; revision: number }>,
): Promise<Response> {
  return fetch(`${baseUrl}/api/run-templates`, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...authHeader(userId) },
    body: JSON.stringify({ items }),
  });
}

async function saveLegacyTemplate(userId: string, template: Omit<RunTemplate, "revision">): Promise<Response> {
  return fetch(`${baseUrl}/api/run-templates`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader(userId) },
    body: JSON.stringify({
      templates: [{ ...template, createdAt: "2026-09-06T00:00:00.000Z" }],
    }),
  });
}

async function deleteLegacyTemplates(userId: string, ids: string[]): Promise<Response> {
  return fetch(`${baseUrl}/api/run-templates`, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...authHeader(userId) },
    body: JSON.stringify({ ids }),
  });
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
  it("rejects anonymous reads and writes, and requires factory-settings capability for mutations", async () => {
    const anonymousGet = await fetch(`${baseUrl}/api/runs`);
    const anonymousPost = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const operatorGet = await fetch(`${baseUrl}/api/runs`, { headers: authHeader(LIVE_OPERATOR) });
    const operatorPost = await createRun(LIVE_OPERATOR, "operator-run");

    expect(anonymousGet.status).toBe(401);
    expect(anonymousPost.status).toBe(401);
    expect(operatorGet.status).toBe(200);
    expect(operatorPost.status).toBe(403);
  });

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

// ── run templates auth and scope isolation ───────────────────────────────────

describe("run templates — authenticated shared convenience with scope isolation", () => {
  it("rejects anonymous access to every operation", async () => {
    const [getRes, postRes, deleteRes] = await Promise.all([
      fetch(`${baseUrl}/api/run-templates`),
      fetch(`${baseUrl}/api/run-templates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templates: [] }),
      }),
      fetch(`${baseUrl}/api/run-templates`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [] }),
      }),
    ]);

    expect(getRes.status).toBe(401);
    expect(postRes.status).toBe(401);
    expect(deleteRes.status).toBe(401);
  });

  it("allows an authenticated operator to read, save, and tombstone templates", async () => {
    const saved = await saveTemplate(LIVE_OPERATOR, {
      id: "operator-template",
      name: "Operator Template",
      values: { casesNeeded: 10 },
    });
    expect(saved.status).toBe(200);
    expect((await listTemplates(LIVE_OPERATOR)).map((template) => template.id))
      .toContain("operator-template");

    const deleted = await deleteTemplates(LIVE_OPERATOR, [{ id: "operator-template", revision: 2 }]);
    expect(deleted.status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "operator-template", revision: 2, deleted: true }),
    ]));
  });

  it("keeps same-id templates independent across live and sandbox scopes", async () => {
    const id = "shared-template-id";
    expect((await saveTemplate(LIVE_MANAGER, {
      id,
      name: "Live Template",
      values: { source: "live" },
    })).status).toBe(200);
    expect((await saveTemplate(sandboxUserId, {
      id,
      name: "Sandbox Template",
      values: { source: "sandbox" },
    })).status).toBe(200);

    expect((await listTemplates(LIVE_MANAGER)).map((template) => template.name))
      .toEqual(["Live Template"]);
    expect((await listTemplates(sandboxUserId)).map((template) => template.name))
      .toEqual(["Sandbox Template"]);

    expect((await deleteTemplates(sandboxUserId, [{ id, revision: 2 }])).status).toBe(200);
    expect(await listTemplates(sandboxUserId)).toEqual([
      expect.objectContaining({ id, name: "Sandbox Template", revision: 2, deleted: true }),
    ]);
    expect((await listTemplates(LIVE_MANAGER)).map((template) => template.name))
      .toEqual(["Live Template"]);
  });

  it("keeps the highest revision through stale saves, retries, tombstones, and stale resurrection", async () => {
    const id = "revisioned-template";
    expect((await saveTemplate(LIVE_OPERATOR, {
      id,
      name: "Version one",
      values: { version: 1 },
      revision: 1,
    })).status).toBe(200);

    expect((await saveTemplate(LIVE_OPERATOR, {
      id,
      name: "Version three",
      values: { version: 3 },
      revision: 3,
    })).status).toBe(200);

    // A delayed revision must not overwrite the newer authoritative record.
    expect((await saveTemplate(LIVE_OPERATOR, {
      id,
      name: "Stale version",
      values: { version: 2 },
      revision: 2,
    })).status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({ id, name: "Version three", values: { version: 3 }, revision: 3, deleted: false }),
    ]);

    // Retrying the same mutation is an idempotent no-op.
    expect((await saveTemplate(LIVE_OPERATOR, {
      id,
      name: "Conflicting duplicate",
      values: { version: "wrong" },
      revision: 3,
    })).status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({ id, name: "Version three", values: { version: 3 }, revision: 3, deleted: false }),
    ]);

    expect((await deleteTemplates(LIVE_OPERATOR, [{ id, revision: 4 }])).status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({ id, name: "Version three", values: { version: 3 }, revision: 4, deleted: true }),
    ]);

    // A pre-delete save cannot resurrect a newer deletion tombstone.
    expect((await saveTemplate(LIVE_OPERATOR, {
      id,
      name: "Stale resurrection",
      values: { version: 3 },
      revision: 3,
    })).status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({ id, name: "Version three", values: { version: 3 }, revision: 4, deleted: true }),
    ]);
  });

  it("atomically upgrades legacy saves while revisioned duplicates remain idempotent", async () => {
    const id = "legacy-save-template";
    expect((await saveLegacyTemplate(LIVE_OPERATOR, {
      id, name: "Legacy version one", values: { version: 1 },
    })).status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({ id, name: "Legacy version one", revision: 1, deleted: false }),
    ]);

    // A cached legacy retry/update has no client revision, so the server assigns
    // the next revision inside its conflict statement rather than dropping it.
    expect((await saveLegacyTemplate(LIVE_OPERATOR, {
      id, name: "Legacy version two", values: { version: 2 },
    })).status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({ id, name: "Legacy version two", values: { version: 2 }, revision: 2 }),
    ]);

    // Revision-aware equal-revision retries keep their strict idempotent behavior.
    expect((await saveTemplate(LIVE_OPERATOR, {
      id, name: "Conflicting duplicate", values: { version: "wrong" }, revision: 2,
    })).status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({ id, name: "Legacy version two", values: { version: 2 }, revision: 2 }),
    ]);
  });

  it("turns legacy DELETE ids into retained tombstones", async () => {
    const id = "legacy-delete-template";
    expect((await saveTemplate(LIVE_OPERATOR, {
      id, name: "To tombstone", values: { keep: "envelope" }, revision: 4,
    })).status).toBe(200);

    expect((await deleteLegacyTemplates(LIVE_OPERATOR, [id])).status).toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({
        id, name: "To tombstone", values: { keep: "envelope" }, revision: 5, deleted: true,
      }),
    ]);
  });

  it("rejects legacy mutations when the revision is already at the JS-safe limit", async () => {
    const id = "saturated-legacy-template";
    await db.insert(runTemplatesTable).values({
      id,
      scope: "live",
      name: "Saturated",
      values: {},
      createdAt: "2026-09-06T00:00:00.000Z",
      revision: Number.MAX_SAFE_INTEGER,
      deleted: false,
    });

    expect((await saveLegacyTemplate(LIVE_OPERATOR, {
      id, name: "Unsafe increment", values: { unsafe: true },
    })).status).toBe(409);
    expect((await deleteLegacyTemplates(LIVE_OPERATOR, [id])).status).toBe(409);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({
        id,
        name: "Saturated",
        revision: Number.MAX_SAFE_INTEGER,
        deleted: false,
      }),
    ]);
  });

  it("creates a complete tombstone envelope for a never-seen deletion", async () => {
    expect((await deleteTemplates(LIVE_OPERATOR, [{ id: "never-seen-template", revision: 7 }])).status)
      .toBe(200);
    expect(await listTemplates(LIVE_OPERATOR)).toEqual([
      expect.objectContaining({
        id: "never-seen-template",
        name: "Deleted template",
        values: {},
        revision: 7,
        deleted: true,
      }),
    ]);
  });
});
