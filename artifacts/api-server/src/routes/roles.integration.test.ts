// Integration tests for the role-based access control on the API.
//
// The new role system is enforced on the server: signed-out callers get 401,
// operators get 403 on the manager-only routes (inventory master-data CRUD,
// inventory settings, the paid AI photo endpoint, and the staff roster /
// role-change endpoints), and managers get through. There is also a
// last-manager guard so the team can never demote its only manager and lock
// itself out.
//
// These tests stand up the *real* router against a *disposable* Postgres
// database (created from the dev DATABASE_URL's server, schema pushed via
// drizzle-kit, dropped on teardown) so nothing here ever touches real data.
// Clerk is mocked so we can drive the signed-in identity per request, and the
// OpenAI vision client is mocked so the photo endpoint never makes a paid call.
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
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";

// Mutable identity the mocked Clerk getAuth reports. null means "signed out".
const authState = vi.hoisted(() => ({ userId: null as string | null }));

// Mock Clerk so requireAuth resolves whatever identity a test sets, and so the
// best-effort identity lookup in lib/roles never makes a network call.
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId }),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        primaryEmailAddress: { emailAddress: `${id}@example.com` },
        emailAddresses: [{ emailAddress: `${id}@example.com` }],
        firstName: "Test",
        lastName: id,
        username: id,
      }),
    },
  },
}));

// Mock the OpenAI vision client so POST /inventory/identify-photo returns a
// valid (empty) result without making a paid call.
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ items: [] }) } }],
        }),
      },
    },
  },
}));

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryConsumedRunsTable: DbModule["inventoryConsumedRunsTable"];
let inventorySettingsTable: DbModule["inventorySettingsTable"];
let userRolesTable: DbModule["userRolesTable"];

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

  // Create a uniquely named throwaway database on the same Postgres server.
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  testDbName = `helium_roles_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();

  // Build the real schema in the throwaway DB via drizzle-kit (no hand-written
  // DDL to drift out of sync with lib/db/src/schema).
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  // Point the app's db at the throwaway DB, THEN load the modules so the
  // singleton pool binds to it.
  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  db = dbMod.db;
  pool = dbMod.pool;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryConsumedRunsTable = dbMod.inventoryConsumedRunsTable;
  inventorySettingsTable = dbMod.inventorySettingsTable;
  userRolesTable = dbMod.userRolesTable;

  // Minimal app: the real router, behind a no-op req.log so handlers that log
  // don't crash without pino-http. Mounted at /api to match production paths.
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
  // Close the app pool so the database has no open connections, then drop it.
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
  authState.userId = null;
  await db.execute(
    sql`TRUNCATE ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryConsumedRunsTable}, ${inventoryItemsTable}, ${inventorySettingsTable}, ${userRolesTable} RESTART IDENTITY CASCADE`,
  );
  // A manager and an operator we have already "seen". Seeding rows directly
  // bypasses the first-user bootstrap so each test starts from a known roster.
  await db.insert(userRolesTable).values([
    { clerkUserId: MANAGER, role: "manager", email: `${MANAGER}@example.com`, name: "Manager" },
    { clerkUserId: OPERATOR, role: "operator", email: `${OPERATOR}@example.com`, name: "Operator" },
  ]);
});

// Issue a request as the given user (or signed out when userId is null).
async function req(
  userId: string | null,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  authState.userId = userId;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Insert a tracked item directly; returns its id. Used to give PATCH/DELETE a
// target without going through the (gated) create route.
async function makeItem(key: string): Promise<number> {
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({ key, category: "ingredient", name: key, unit: "lbs" })
    .returning();
  return item.id;
}

const validImage = "a".repeat(64);

// Each manager-only route, with a body that would succeed once past the guard.
// `setup` runs first (e.g. to create a target row) and returns path overrides.
type GatedRoute = {
  name: string;
  method: string;
  path: (ctx: { itemId: number }) => string;
  body?: unknown;
  okStatus: number;
};

const GATED_ROUTES: GatedRoute[] = [
  {
    name: "POST /inventory/items",
    method: "POST",
    path: () => "/api/inventory/items",
    body: { key: "ingredient:New:lbs", category: "ingredient", name: "New", unit: "lbs" },
    okStatus: 201,
  },
  {
    name: "PATCH /inventory/items/:id",
    method: "PATCH",
    path: ({ itemId }) => `/api/inventory/items/${itemId}`,
    body: { name: "Renamed" },
    okStatus: 200,
  },
  {
    name: "DELETE /inventory/items/:id",
    method: "DELETE",
    path: ({ itemId }) => `/api/inventory/items/${itemId}`,
    okStatus: 204,
  },
  {
    name: "PUT /inventory/settings",
    method: "PUT",
    path: () => "/api/inventory/settings",
    body: { expirySoonDays: 14 },
    okStatus: 200,
  },
  {
    name: "POST /inventory/identify-photo",
    method: "POST",
    path: () => "/api/inventory/identify-photo",
    body: { imageBase64: validImage },
    okStatus: 200,
  },
  {
    name: "GET /users",
    method: "GET",
    path: () => "/api/users",
    okStatus: 200,
  },
  {
    name: "PUT /users/:id/role",
    method: "PUT",
    path: () => `/api/users/${OPERATOR}/role`,
    body: { role: "manager" },
    okStatus: 200,
  },
];

describe("role-based access control", () => {
  describe("signed out → 401", () => {
    for (const route of GATED_ROUTES) {
      it(`rejects ${route.name} with 401`, async () => {
        const itemId = await makeItem("ingredient:Target:lbs");
        const res = await req(null, route.method, route.path({ itemId }), route.body);
        expect(res.status).toBe(401);
      });
    }
  });

  describe("operator → 403", () => {
    for (const route of GATED_ROUTES) {
      it(`forbids ${route.name} with 403`, async () => {
        const itemId = await makeItem("ingredient:Target:lbs");
        const res = await req(OPERATOR, route.method, route.path({ itemId }), route.body);
        expect(res.status).toBe(403);
      });
    }
  });

  describe("manager → allowed", () => {
    for (const route of GATED_ROUTES) {
      it(`allows ${route.name} (${route.okStatus})`, async () => {
        const itemId = await makeItem("ingredient:Target:lbs");
        const res = await req(MANAGER, route.method, route.path({ itemId }), route.body);
        expect(res.status).toBe(route.okStatus);
      });
    }
  });
});

describe("last-manager guard", () => {
  it("rejects demoting the only manager (PUT /users/:id/role → 400)", async () => {
    // The seeded roster has exactly one manager (MANAGER); OPERATOR doesn't count.
    const res = await req(MANAGER, "PUT", `/api/users/${MANAGER}/role`, { role: "operator" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/last manager/i);

    // The manager is unchanged — still a manager.
    const [row] = await db
      .select()
      .from(userRolesTable)
      .where(sql`${userRolesTable.clerkUserId} = ${MANAGER}`);
    expect(row.role).toBe("manager");
  });

  it("allows demoting a manager when another manager remains (→ 200)", async () => {
    // Promote the operator so there are two managers, then demote one.
    await db.insert(userRolesTable).values({
      clerkUserId: "manager-2",
      role: "manager",
      email: "manager-2@example.com",
      name: "Manager Two",
    });
    const res = await req(MANAGER, "PUT", `/api/users/manager-2/role`, { role: "operator" });
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(userRolesTable)
      .where(sql`${userRolesTable.clerkUserId} = ${"manager-2"}`);
    expect(row.role).toBe("operator");
  });
});
