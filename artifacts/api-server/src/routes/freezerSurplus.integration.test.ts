// Integration coverage for the dated finished-case freezer surplus ledger.
// This uses a disposable database so the tests exercise auth, scope isolation,
// the real transaction/row locks, and persistence rather than a mocked route.

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
let freezerSurplusLotsTable: DbModule["freezerSurplusLotsTable"];
let freezerSurplusAllocationsTable: DbModule["freezerSurplusAllocationsTable"];
let dailySyncTable: DbModule["dailySyncTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;
let clearSandboxCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const MANAGER = "surplus-manager";
const SANDBOX_MANAGER = "surplus-sandbox";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_surplus_int_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
    throw new Error(`drizzle push-force failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const rolesMod = await import("../lib/roles");
  const userValidityMod = await import("../lib/userValidity");
  const sandboxMod = await import("../lib/sandbox");

  db = dbMod.db;
  pool = dbMod.pool;
  freezerSurplusLotsTable = dbMod.freezerSurplusLotsTable;
  freezerSurplusAllocationsTable = dbMod.freezerSurplusAllocationsTable;
  dailySyncTable = dbMod.dailySyncTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = rolesMod.seedRoles;
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  clearSandboxCache = sandboxMod.clearSandboxCache;

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
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
}, 90_000);

beforeEach(async () => {
  clearUserValidityCache();
  clearSandboxCache();
  await db.execute(sql`
    TRUNCATE ${freezerSurplusAllocationsTable}, ${freezerSurplusLotsTable},
      ${dailySyncTable}, ${userRolesTable}, ${usersTable}, ${rolesTable}
      RESTART IDENTITY CASCADE
  `);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: MANAGER, passwordHash: "x" },
    { id: SANDBOX_MANAGER, username: SANDBOX_MANAGER, passwordHash: "x", sandbox: true },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: SANDBOX_MANAGER, role: "manager" },
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
  if (userId) headers.authorization = `Bearer ${signToken(userId)}`;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ledger(userId = MANAGER) {
  const response = await req(userId, "GET", "/api/freezer-surplus");
  expect(response.status).toBe(200);
  return (await response.json()) as {
    lots: Array<{ id: string; productionDate: string; remainingCases: number; totalCases: number }>;
    allocations: Array<{ lotId: string; runId: string; cases: number }>;
  };
}

async function confirm(userId: string, overrides: Record<string, unknown> = {}) {
  return req(userId, "POST", "/api/freezer-surplus", {
    brand: "Acme",
    flavor: "Pepperoni",
    productionDate: "2026-08-28",
    cases: 20,
    ...overrides,
  });
}

async function allocate(
  userId: string,
  runId: string,
  allocations: Array<{ lotId: string; cases: number }>,
  overrides: Record<string, unknown> = {},
) {
  return req(userId, "PUT", `/api/freezer-surplus/allocations/${encodeURIComponent(runId)}`, {
    runDate: "2026-08-29",
    brand: "Acme",
    flavor: "Pepperoni",
    allocations,
    ...overrides,
  });
}

async function seedRun(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(dailySyncTable).values({
    date: "2026-08-29",
    scope: "live",
    data: {
      dayState: {
        runs: [{ id, brand: "Acme", flavor: "Pepperoni", casesNeeded: 500, ...overrides }],
      },
    },
  });
}

describe("dated freezer surplus API", () => {
  it("requires authentication and preserves separate dated lots on reload", async () => {
    expect((await req(null, "GET", "/api/freezer-surplus")).status).toBe(401);

    expect((await confirm(MANAGER)).status).toBe(201);
    expect((await confirm(MANAGER, { productionDate: "2026-08-29", cases: 7 })).status).toBe(201);
    const loaded = await ledger();
    expect(loaded.lots).toHaveLength(2);
    expect(loaded.lots.map((lot) => lot.productionDate).sort()).toEqual(["2026-08-28", "2026-08-29"]);
    expect(loaded.lots.map((lot) => lot.remainingCases).sort((a, b) => a - b)).toEqual([7, 20]);
  });

  it("rejects malformed dates and keeps scopes isolated", async () => {
    expect((await confirm(MANAGER, { productionDate: "2026-02-30" })).status).toBe(400);
    expect((await confirm(MANAGER)).status).toBe(201);
    expect((await ledger(SANDBOX_MANAGER)).lots).toHaveLength(0);
    expect((await confirm(SANDBOX_MANAGER, { cases: 4 })).status).toBe(201);
    expect((await ledger(SANDBOX_MANAGER)).lots).toHaveLength(1);
    expect((await ledger(MANAGER)).lots).toHaveLength(1);
  });

  it("supports idempotent partial allocation, revision, release, and effective demand", async () => {
    const lotResponse = await confirm(MANAGER);
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    await seedRun("run-1");

    expect((await allocate(MANAGER, "run-1", [{ lotId, cases: 12 }])).status).toBe(200);
    let loaded = await ledger();
    expect(loaded.lots[0].remainingCases).toBe(8);
    expect(loaded.allocations).toEqual([
      expect.objectContaining({ lotId, runId: "run-1", cases: 12 }),
    ]);

    // Repeating the same PUT replaces the run selection instead of spending again.
    expect((await allocate(MANAGER, "run-1", [{ lotId, cases: 12 }])).status).toBe(200);
    expect((await ledger()).lots[0].remainingCases).toBe(8);

    expect((await allocate(MANAGER, "run-1", [{ lotId, cases: 5 }])).status).toBe(200);
    loaded = await ledger();
    expect(loaded.lots[0].remainingCases).toBe(15);
    expect(loaded.allocations[0].cases).toBe(5);

    expect((await allocate(MANAGER, "run-1", [])).status).toBe(200);
    expect((await ledger()).lots[0].remainingCases).toBe(20);
  });

  it("rejects mismatches and protects a lot from concurrent over-allocation", async () => {
    const lotResponse = await confirm(MANAGER);
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    await seedRun("run-1");

    expect(
      (await allocate(MANAGER, "run-1", [{ lotId, cases: 1 }], { flavor: "Cheese" })).status,
    ).toBe(400);
    expect(
      (await allocate(MANAGER, "run-1", [{ lotId, cases: 21 }])).status,
    ).toBe(400);

    const [first, second] = await Promise.all([
      allocate(MANAGER, "run-a", [{ lotId, cases: 15 }]),
      allocate(MANAGER, "run-b", [{ lotId, cases: 15 }]),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    expect((await ledger()).lots[0].remainingCases).toBe(5);
  });

  it("rejects a pull after a run has started", async () => {
    const lotResponse = await confirm(MANAGER);
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    await seedRun("started-run", { startedAt: "2026-08-29T10:00:00.000Z" });
    expect((await allocate(MANAGER, "started-run", [{ lotId, cases: 1 }])).status).toBe(409);
    expect((await ledger()).lots[0].remainingCases).toBe(20);
  });
});