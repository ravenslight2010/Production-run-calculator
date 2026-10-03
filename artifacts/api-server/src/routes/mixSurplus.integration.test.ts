// Integration coverage for the mix surplus ledger (lots + allocations + void).
// Uses a disposable database (same harness as freezerSurplus.integration.test.ts)
// to exercise real auth, scope isolation, transaction/row locks, and persistence.
// Requires DATABASE_URL to be set (CI / Render deploy).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signLegacyTokenForTests } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let mixesTable: DbModule["mixesTable"];
let mixSurplusLotsTable: DbModule["mixSurplusLotsTable"];
let mixSurplusAllocationsTable: DbModule["mixSurplusAllocationsTable"];
let mixesToUpdateTable: DbModule["mixesTable"]; // same ref
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

const MANAGER = "mix-surplus-manager";
const SCOPE = "live";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set");
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_mix_surplus_int_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);
  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) throw new Error(`drizzle push-force failed:\n${push.stdout}\n${push.stderr}`);
  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const rolesMod = await import("../lib/roles");
  const userValidityMod = await import("../lib/userValidity");
  const sandboxMod = await import("../lib/sandbox");
  db = dbMod.db;
  pool = dbMod.pool;
  mixesTable = dbMod.mixesTable;
  mixSurplusLotsTable = dbMod.mixSurplusLotsTable;
  mixSurplusAllocationsTable = dbMod.mixSurplusAllocationsTable;
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
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 90_000);

afterAll(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  await pool?.end();
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 90_000);

const MIX_ID = "test-mix-1";

beforeEach(async () => {
  clearUserValidityCache();
  clearSandboxCache();
  await db.execute(sql`
    TRUNCATE ${mixSurplusAllocationsTable}, ${mixSurplusLotsTable}, ${mixesTable},
      ${userRolesTable}, ${usersTable}, ${rolesTable}
      RESTART IDENTITY CASCADE
  `);
  await seedRoles();
  await db.insert(usersTable).values([{ id: MANAGER, username: MANAGER, passwordHash: "x" }]);
  await db.insert(userRolesTable).values([{ userId: MANAGER, role: "manager" }]);
  await db.insert(mixesTable).values({
    id: MIX_ID, scope: SCOPE, name: "Bobo's Veggie Mix", brand: "Bobo's", flavor: "Veggie",
    batchSize: 40, daysEarly: 0, notes: "", amountAlreadyMade: 0, amountActualMade: 0,
    components: [{ ingredient: "Cheese", perPizza: 2 }], isPrep: false, enabled: true,
  });
});

async function req(method: string, pathname: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  headers.authorization = `Bearer ${signLegacyTokenForTests(MANAGER)}`;
  return fetch(`${baseUrl}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("mix surplus ledger integration", () => {
  it("records a manual lot and lists it in the ledger", async () => {
    const created = await req("POST", "/api/mix-surplus", { mixId: MIX_ID, productionDate: "2026-09-14", amountMade: 60 });
    expect(created.status).toBe(201);
    const { lots, balances } = (await created.json()) as { lots: Array<{ mixId: string; amountRemaining: number }>; balances: Array<{ mixId: string; lbs: number }> };
    expect(lots).toHaveLength(1);
    expect(lots[0]!.mixId).toBe(MIX_ID);
    expect(lots[0]!.amountRemaining).toBe(60);
    expect(balances).toEqual([{ mixId: MIX_ID, name: "Bobo's Veggie Mix", lbs: 60, productionDates: [expect.any(String)] }]);
  });

  it("extends an existing same-date lot instead of duplicating", async () => {
    await req("POST", "/api/mix-surplus", { mixId: MIX_ID, productionDate: "2026-09-14", amountMade: 40 });
    const second = await req("POST", "/api/mix-surplus", { mixId: MIX_ID, productionDate: "2026-09-14", amountMade: 20 });
    expect(second.status).toBe(201);
    const { lots } = (await second.json()) as { lots: Array<{ amountMade: number; amountRemaining: number }> };
    expect(lots).toHaveLength(1);
    expect(lots[0]!.amountMade).toBe(60);
    expect(lots[0]!.amountRemaining).toBe(60);
  });

  it("allocations decrement lot remaining and void decrements amountAlreadyMade", async () => {
    const created = await req("POST", "/api/mix-surplus", { mixId: MIX_ID, productionDate: "2026-09-14", amountMade: 40 });
    const { lots } = (await created.json()) as { lots: Array<{ id: string }> };
    const lotId = lots[0]!.id;
    // Set mix carry so void can decrement it.
    await db.update(mixesTable).set({ amountAlreadyMade: 20 }).where(sql`${mixesTable.id} = ${MIX_ID} AND ${mixesTable.scope} = ${SCOPE}`);

    const allocated = await req("PUT", "/api/mix-surplus/allocations/2026-09-15", {
      runDate: "2026-09-15",
      allocations: [{ lotId, amount: 15 }],
    });
    expect(allocated.status).toBe(200);
    const afterAlloc = (await allocated.json()) as { lots: Array<{ amountRemaining: number }>; allocations: Array<{ amount: number }> };
    expect(afterAlloc.lots[0]!.amountRemaining).toBe(25);
    expect(afterAlloc.allocations).toHaveLength(1);

    const voided = await req("DELETE", `/api/mix-surplus/lots/${lotId}`);
    expect(voided.status).toBe(200);
    const afterVoid = (await voided.json()) as { lots: Array<{ amountRemaining: number }>; allocations: unknown[] };
    expect(afterVoid.lots[0]!.amountRemaining).toBe(0);
    expect(afterVoid.allocations).toHaveLength(0);
    const mixRow = await db.select({ amountAlreadyMade: mixesTable.amountAlreadyMade }).from(mixesTable).where(sql`${mixesTable.id} = ${MIX_ID} AND ${mixesTable.scope} = ${SCOPE}`).limit(1);
    expect(Number(mixRow[0]!.amountAlreadyMade)).toBe(5); // 20 - 15
  });

  it("voiding an already voided lot returns a 404", async () => {
    const created = await req("POST", "/api/mix-surplus", { mixId: MIX_ID, productionDate: "2026-09-14", amountMade: 10 });
    const { lots } = (await created.json()) as { lots: Array<{ id: string }> };
    await req("DELETE", `/api/mix-surplus/lots/${lots[0]!.id}`);
    const second = await req("DELETE", `/api/mix-surplus/lots/${lots[0]!.id}`);
    expect(second.status).toBe(404);
  });
});
