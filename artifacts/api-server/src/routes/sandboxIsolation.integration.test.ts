// Integration tests proving the live ↔ sandbox data-scope isolation is real,
// end to end through the actual router + middleware stack and a disposable
// Postgres database. Scope isolation is the whole point of the sandbox feature:
// a regression would silently leak sandbox edits into live (or vice-versa) —
// exactly the failure this feature exists to prevent. Typecheck + manual
// reasoning can't catch that; this file locks it in.
//
// What is asserted:
//  - A live session and the seeded `test` (sandbox) session each write day-state
//    (/sync/today), inventory (/inventory/items) and production rules
//    (/production-rules), and neither scope ever sees the other's rows.
//  - POST /sandbox/reset re-copies live → sandbox: the sandbox's divergent edits
//    are wiped and live's rows appear under the sandbox scope, while live is
//    left completely untouched.
//  - POST /sandbox/reset refuses a live session (403) and changes nothing.
//  - The daily-reset / auth boundary stays pinned to live: a reset boundary
//    written in the sandbox scope fences nobody, while a live-scope boundary
//    fences every session (including the sandbox one).
//
// Mirrors the other *.integration.test.ts harnesses: a throwaway DB is created
// from the dev DATABASE_URL's server, the schema is pushed via drizzle-kit, and
// it is dropped on teardown, so nothing here ever touches real data. Auth uses
// the self-contained username + password system: each user carries a real
// HMAC-signed session token in the Authorization header.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so we
// create the throwaway DB and repoint DATABASE_URL BEFORE importing anything
// that pulls in @workspace/db (see .agents/memory/integration-test-db-binding.md).
// Only the db-free helper (lib/auth's signToken) is a safe static import.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let dailySyncTable: DbModule["dailySyncTable"];
let productionRulesTable: DbModule["productionRulesTable"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryConsumedRunsTable: DbModule["inventoryConsumedRunsTable"];
let inventorySettingsTable: DbModule["inventorySettingsTable"];

let seedRoles: () => Promise<void>;
let seedSandboxUser: () => Promise<void>;
let SANDBOX_USERNAME: string;
let clearUserValidityCache: () => void;
let clearSessionBoundaryCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const LIVE_MANAGER = "live-manager-1";
let sandboxUserId: string;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_sandbox_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const rolesMod = await import("../lib/roles");
  const sandboxMod = await import("../lib/sandbox");
  const userValidityMod = await import("../lib/userValidity");
  const sessionBoundaryMod = await import("../lib/sessionBoundary");
  const usersMod = await import("../lib/users");

  db = dbMod.db;
  pool = dbMod.pool;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  dailySyncTable = dbMod.dailySyncTable;
  productionRulesTable = dbMod.productionRulesTable;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryConsumedRunsTable = dbMod.inventoryConsumedRunsTable;
  inventorySettingsTable = dbMod.inventorySettingsTable;
  seedRoles = rolesMod.seedRoles;
  seedSandboxUser = sandboxMod.seedSandboxUser;
  SANDBOX_USERNAME = sandboxMod.SANDBOX_USERNAME;
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  clearSessionBoundaryCache = sessionBoundaryMod.clearSessionBoundaryCache;

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

  // Seed the role catalog so requireCapability can resolve a manager's role to
  // its capability set, then the two actors:
  //  - the seeded sandbox account `test` (sandbox flag + manager role), whose
  //    sessions route to the "sandbox" scope.
  //  - a plain live manager, whose sessions stay on the "live" scope.
  // Both are managers so every manager-gated write (inventory items, production
  // rules) is reachable in either scope. Seeded ONCE so the per-request sandbox/
  // user-validity caches keyed by id stay valid across cases.
  await seedRoles();
  await seedSandboxUser();
  const sandboxUser = await usersMod.findUserByUsername(SANDBOX_USERNAME);
  if (!sandboxUser) throw new Error("sandbox user was not seeded");
  sandboxUserId = sandboxUser.id;

  await db.insert(usersTable).values({ id: LIVE_MANAGER, username: "live-manager", passwordHash: "x" });
  await db.insert(userRolesTable).values({ userId: LIVE_MANAGER, role: "manager" });
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
  clearSessionBoundaryCache();
  // Wipe only the scoped DATA tables; the users / roles / role-catalog rows are
  // seeded once in beforeAll and must survive so the identity caches stay valid.
  await db.execute(
    sql`TRUNCATE ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryConsumedRunsTable}, ${inventoryItemsTable}, ${inventorySettingsTable}, ${productionRulesTable}, ${dailySyncTable} RESTART IDENTITY CASCADE`,
  );
});

// One authenticated request. A fresh HMAC token is minted per call (iat = now),
// mirroring the other harnesses.
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

// ── Per-scope write helpers (all go through the real auth-gated HTTP path) ────

async function putDayState(userId: string, payload: unknown): Promise<void> {
  const res = await req(userId, "PUT", "/api/sync/today", { senderId: "test", payload });
  expect(res.status).toBe(200);
}

async function getDayState(userId: string): Promise<unknown> {
  const res = await req(userId, "GET", "/api/sync/today");
  expect(res.status).toBe(200);
  return res.json();
}

async function createItem(userId: string, key: string): Promise<void> {
  const res = await req(userId, "POST", "/api/inventory/items", {
    key,
    category: "ingredient",
    name: key,
    unit: "lbs",
  });
  expect(res.status).toBe(201);
}

type InvItem = { key: string };
async function listItemKeys(userId: string): Promise<string[]> {
  const res = await req(userId, "GET", "/api/inventory");
  expect(res.status).toBe(200);
  const items = (await res.json()) as InvItem[];
  return items.map((i) => i.key).sort();
}

async function createRule(userId: string, id: string): Promise<void> {
  const res = await req(userId, "POST", "/api/production-rules", {
    rules: [
      { id, name: id, type: "required-field", enforcement: "flexible", enabled: true, field: "brand" },
    ],
  });
  expect(res.status).toBe(200);
}

type ApiRule = { id: string };
async function listRuleIds(userId: string): Promise<string[]> {
  const res = await req(userId, "GET", "/api/production-rules");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rules: ApiRule[] };
  return body.rules.map((r) => r.id).sort();
}

describe("live ↔ sandbox scope isolation", () => {
  it("day-state, inventory, and production rules never cross between scopes", async () => {
    // Live writes its rows.
    await putDayState(LIVE_MANAGER, { marker: "live-day" });
    await createItem(LIVE_MANAGER, "live-item");
    await createRule(LIVE_MANAGER, "live-rule");

    // Sandbox writes its own, distinct rows.
    await putDayState(sandboxUserId, { marker: "sandbox-day" });
    await createItem(sandboxUserId, "sandbox-item");
    await createRule(sandboxUserId, "sandbox-rule");

    // Each scope reads back ONLY its own day-state.
    expect(await getDayState(LIVE_MANAGER)).toEqual({ marker: "live-day" });
    expect(await getDayState(sandboxUserId)).toEqual({ marker: "sandbox-day" });

    // Inventory is isolated: neither scope sees the other's item.
    expect(await listItemKeys(LIVE_MANAGER)).toEqual(["live-item"]);
    expect(await listItemKeys(sandboxUserId)).toEqual(["sandbox-item"]);

    // Production rules are isolated.
    expect(await listRuleIds(LIVE_MANAGER)).toEqual(["live-rule"]);
    expect(await listRuleIds(sandboxUserId)).toEqual(["sandbox-rule"]);

    // And at the row level, each scope column carries exactly its own rows.
    const dailyRows = await db.select().from(dailySyncTable);
    expect(dailyRows.map((r) => r.scope).sort()).toEqual(["live", "sandbox"]);
    const itemRows = await db.select().from(inventoryItemsTable);
    expect(itemRows.map((r) => r.scope).sort()).toEqual(["live", "sandbox"]);
    const ruleRows = await db.select().from(productionRulesTable);
    expect(ruleRows.map((r) => r.scope).sort()).toEqual(["live", "sandbox"]);
  });
});

describe("POST /sandbox/reset re-copies live → sandbox", () => {
  it("wipes the sandbox's divergent edits and mirrors live, leaving live untouched", async () => {
    // Live is the source of truth.
    await putDayState(LIVE_MANAGER, { marker: "live-day" });
    await createItem(LIVE_MANAGER, "live-item");
    await createRule(LIVE_MANAGER, "live-rule");

    // The sandbox diverges: a different day-state, a sandbox-only item, and a
    // sandbox-only rule.
    await putDayState(sandboxUserId, { marker: "sandbox-divergent" });
    await createItem(sandboxUserId, "sandbox-only-item");
    await createRule(sandboxUserId, "sandbox-only-rule");

    // Reset (only the sandbox session may trigger it).
    const resetRes = await req(sandboxUserId, "POST", "/api/sandbox/reset");
    expect(resetRes.status).toBe(200);

    // The sandbox now mirrors live: divergent edits gone, live's rows copied in.
    expect(await getDayState(sandboxUserId)).toEqual({ marker: "live-day" });
    expect(await listItemKeys(sandboxUserId)).toEqual(["live-item"]);
    expect(await listRuleIds(sandboxUserId)).toEqual(["live-rule"]);

    // Live is completely unaffected by the reset.
    expect(await getDayState(LIVE_MANAGER)).toEqual({ marker: "live-day" });
    expect(await listItemKeys(LIVE_MANAGER)).toEqual(["live-item"]);
    expect(await listRuleIds(LIVE_MANAGER)).toEqual(["live-rule"]);
  });

  it("refuses a live session (403) and changes nothing", async () => {
    await putDayState(LIVE_MANAGER, { marker: "live-day" });
    await createItem(LIVE_MANAGER, "live-item");

    const res = await req(LIVE_MANAGER, "POST", "/api/sandbox/reset");
    expect(res.status).toBe(403);

    // The live data the request could have clobbered is intact, and nothing was
    // copied into the sandbox.
    expect(await getDayState(LIVE_MANAGER)).toEqual({ marker: "live-day" });
    expect(await listItemKeys(LIVE_MANAGER)).toEqual(["live-item"]);
    expect(await listItemKeys(sandboxUserId)).toEqual([]);
  });
});

describe("daily-reset / auth boundary stays pinned to live", () => {
  it("a sandbox-scope reset boundary fences nobody", async () => {
    // The sandbox writes a far-future reset boundary onto ITS today row. Because
    // the boundary read is pinned to the live scope, this must fence no session.
    await putDayState(sandboxUserId, { dayState: { runs: [], resetAt: Date.now() + 1_000_000_000 } });
    clearSessionBoundaryCache();

    expect((await req(LIVE_MANAGER, "GET", "/api/me")).status).toBe(200);
    expect((await req(sandboxUserId, "GET", "/api/me")).status).toBe(200);

    // Sanity: the boundary really was written, just on the sandbox row.
    const [row] = await db
      .select()
      .from(dailySyncTable)
      .where(eq(dailySyncTable.scope, "sandbox"));
    expect((row.data as { dayState?: { resetAt?: number } })?.dayState?.resetAt).toBeGreaterThan(
      Date.now(),
    );
  });

  it("a live-scope reset boundary fences every session, including the sandbox one", async () => {
    // The live rollover writes a far-future boundary onto the live today row.
    // Every token minted before it is fenced — the live session AND the sandbox
    // session, proving the fence is one global boundary read from live.
    await putDayState(LIVE_MANAGER, { dayState: { runs: [], resetAt: Date.now() + 1_000_000_000 } });
    clearSessionBoundaryCache();

    expect((await req(LIVE_MANAGER, "GET", "/api/me")).status).toBe(401);
    expect((await req(sandboxUserId, "GET", "/api/me")).status).toBe(401);

    // The boundary lives on the live row.
    const liveRows = await db
      .select()
      .from(dailySyncTable)
      .where(and(eq(dailySyncTable.date, todayStr()), eq(dailySyncTable.scope, "live")));
    expect(liveRows.length).toBe(1);
  });
});
