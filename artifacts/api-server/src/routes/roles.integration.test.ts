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
// Auth is the self-contained username + password system: each request carries a
// real HMAC-signed session token in the Authorization header, and the OpenAI
// vision client is mocked so the photo endpoint never makes a paid call.
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
import { signToken, verifyPassword } from "../lib/auth";

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
let usersTable: DbModule["usersTable"];

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
  const userValidityMod = await import("../lib/userValidity");
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  db = dbMod.db;
  pool = dbMod.pool;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryConsumedRunsTable = dbMod.inventoryConsumedRunsTable;
  inventorySettingsTable = dbMod.inventorySettingsTable;
  userRolesTable = dbMod.userRolesTable;
  usersTable = dbMod.usersTable;

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
  // The user-existence cache is module-level and outlives a single test; fixed
  // ids reused across tests would otherwise inherit a prior test's revocation.
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryConsumedRunsTable}, ${inventoryItemsTable}, ${inventorySettingsTable}, ${userRolesTable}, ${usersTable} RESTART IDENTITY CASCADE`,
  );
  // A manager and an operator we have already "seen". Seeding rows directly
  // bypasses the first-user bootstrap so each test starts from a known roster.
  await db.insert(usersTable).values([
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: OPERATOR, username: "operator", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
  ]);
});

// Issue a request as the given user (or signed out when userId is null). A real
// signed session token is attached as a bearer header for signed-in callers.
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
  {
    name: "PUT /users/:id/password",
    method: "PUT",
    path: () => `/api/users/${OPERATOR}/password`,
    body: { newPassword: "fresh-password" },
    okStatus: 204,
  },
  {
    name: "DELETE /users/:id",
    method: "DELETE",
    path: () => `/api/users/${OPERATOR}`,
    okStatus: 204,
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
      .where(sql`${userRolesTable.userId} = ${MANAGER}`);
    expect(row.role).toBe("manager");
  });

  it("allows demoting a manager when another manager remains (→ 200)", async () => {
    // Promote the operator so there are two managers, then demote one.
    await db.insert(usersTable).values({
      id: "manager-2",
      username: "manager-2",
      passwordHash: "x",
    });
    await db.insert(userRolesTable).values({
      userId: "manager-2",
      role: "manager",
    });
    const res = await req(MANAGER, "PUT", `/api/users/manager-2/role`, { role: "operator" });
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(userRolesTable)
      .where(sql`${userRolesTable.userId} = ${"manager-2"}`);
    expect(row.role).toBe("operator");
  });

  it("rejects removing the only manager (DELETE /users/:id → 400)", async () => {
    const res = await req(MANAGER, "DELETE", `/api/users/${MANAGER}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/last manager/i);

    // The manager still exists.
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${MANAGER}`);
    expect(row).toBeDefined();
  });

  it("allows removing a manager when another manager remains (→ 204)", async () => {
    await db.insert(usersTable).values({
      id: "manager-2",
      username: "manager-2",
      passwordHash: "x",
    });
    await db.insert(userRolesTable).values({ userId: "manager-2", role: "manager" });
    const res = await req(MANAGER, "DELETE", `/api/users/manager-2`);
    expect(res.status).toBe(204);
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${"manager-2"}`);
    expect(row).toBeUndefined();
  });
});

describe("staff account administration", () => {
  it("removes a staff member and cascades their role row (DELETE → 204)", async () => {
    const res = await req(MANAGER, "DELETE", `/api/users/${OPERATOR}`);
    expect(res.status).toBe(204);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${OPERATOR}`);
    expect(user).toBeUndefined();
    const [role] = await db
      .select()
      .from(userRolesTable)
      .where(sql`${userRolesTable.userId} = ${OPERATOR}`);
    expect(role).toBeUndefined();
  });

  it("returns 404 when removing a non-existent user", async () => {
    const res = await req(MANAGER, "DELETE", `/api/users/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("resets a staff member's password so they can sign in with it (PUT → 204)", async () => {
    const res = await req(MANAGER, "PUT", `/api/users/${OPERATOR}/password`, {
      newPassword: "brand-new-secret",
    });
    expect(res.status).toBe(204);

    // The new password verifies against the stored hash.
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${OPERATOR}`);
    expect(verifyPassword("brand-new-secret", row.passwordHash)).toBe(true);
  });

  it("rejects a too-short reset password (PUT → 400)", async () => {
    const res = await req(MANAGER, "PUT", `/api/users/${OPERATOR}/password`, {
      newPassword: "x",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when resetting a non-existent user's password", async () => {
    const res = await req(MANAGER, "PUT", `/api/users/does-not-exist/password`, {
      newPassword: "brand-new-secret",
    });
    expect(res.status).toBe(404);
  });
});

describe("first-login onboarding overview", () => {
  // A freshly created account must start with onboardingSeen=false so the
  // "Get Started" overview auto-shows exactly once. POST /me/onboarding-seen
  // then flips it true permanently and idempotently, and the change is visible
  // in the /me payload both apps read on every load. This couldn't be exercised
  // live during the feature work because the isolated dev DB predated the
  // users-table migration — hence this coverage.
  it("a brand-new signed-up user starts with onboardingSeen=false", async () => {
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "newbie",
      password: "first-password",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      token: string;
      user: { userId: string; onboardingSeen: boolean };
    };
    expect(body.user.onboardingSeen).toBe(false);

    // The DB row backing it is false too — not just the response shape.
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${body.user.userId}`);
    expect(row.onboardingSeen).toBe(false);
  });

  it("the new user's /me payload reports onboardingSeen=false before dismissal", async () => {
    const signUp = await req(null, "POST", "/api/auth/sign-up", {
      username: "newbie2",
      password: "first-password",
    });
    const { user } = (await signUp.json()) as { user: { userId: string } };

    const me = await req(user.userId, "GET", "/api/me");
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { onboardingSeen: boolean };
    expect(meBody.onboardingSeen).toBe(false);
  });

  it("POST /me/onboarding-seen flips the flag and returns the updated StaffMember", async () => {
    const signUp = await req(null, "POST", "/api/auth/sign-up", {
      username: "newbie3",
      password: "first-password",
    });
    const { user } = (await signUp.json()) as { user: { userId: string } };

    const marked = await req(user.userId, "POST", "/api/me/onboarding-seen");
    expect(marked.status).toBe(200);
    const markedBody = (await marked.json()) as { onboardingSeen: boolean };
    expect(markedBody.onboardingSeen).toBe(true);

    // The /me payload now reflects it, so the overview never auto-opens again.
    const me = await req(user.userId, "GET", "/api/me");
    const meBody = (await me.json()) as { onboardingSeen: boolean };
    expect(meBody.onboardingSeen).toBe(true);

    // And the DB row is persisted true.
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${user.userId}`);
    expect(row.onboardingSeen).toBe(true);
  });

  it("POST /me/onboarding-seen is idempotent (stays true on repeat calls)", async () => {
    const signUp = await req(null, "POST", "/api/auth/sign-up", {
      username: "newbie4",
      password: "first-password",
    });
    const { user } = (await signUp.json()) as { user: { userId: string } };

    const first = await req(user.userId, "POST", "/api/me/onboarding-seen");
    expect(first.status).toBe(200);
    const second = await req(user.userId, "POST", "/api/me/onboarding-seen");
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { onboardingSeen: boolean };
    expect(secondBody.onboardingSeen).toBe(true);

    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${user.userId}`);
    expect(row.onboardingSeen).toBe(true);
  });
});

describe("guided tour completion", () => {
  // A freshly created account starts with tourCompleted=false (the opt-in tour
  // has never been finished). POST /me/tour-completed flips it true permanently
  // and idempotently once the user reaches the tour's final step, and the change
  // is visible in the /me payload both apps read on every load. Mirrors the
  // onboardingSeen plumbing.
  it("a brand-new signed-up user starts with tourCompleted=false", async () => {
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "tour-newbie",
      password: "first-password",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      token: string;
      user: { userId: string; tourCompleted: boolean };
    };
    expect(body.user.tourCompleted).toBe(false);

    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${body.user.userId}`);
    expect(row.tourCompleted).toBe(false);
  });

  it("POST /me/tour-completed flips the flag and returns the updated StaffMember", async () => {
    const signUp = await req(null, "POST", "/api/auth/sign-up", {
      username: "tour-newbie2",
      password: "first-password",
    });
    const { user } = (await signUp.json()) as { user: { userId: string } };

    const marked = await req(user.userId, "POST", "/api/me/tour-completed");
    expect(marked.status).toBe(200);
    const markedBody = (await marked.json()) as { tourCompleted: boolean };
    expect(markedBody.tourCompleted).toBe(true);

    // The /me payload now reflects it.
    const me = await req(user.userId, "GET", "/api/me");
    const meBody = (await me.json()) as { tourCompleted: boolean };
    expect(meBody.tourCompleted).toBe(true);

    // And the DB row is persisted true.
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${user.userId}`);
    expect(row.tourCompleted).toBe(true);
  });

  it("POST /me/tour-completed is idempotent (stays true on repeat calls)", async () => {
    const signUp = await req(null, "POST", "/api/auth/sign-up", {
      username: "tour-newbie3",
      password: "first-password",
    });
    const { user } = (await signUp.json()) as { user: { userId: string } };

    const first = await req(user.userId, "POST", "/api/me/tour-completed");
    expect(first.status).toBe(200);
    const second = await req(user.userId, "POST", "/api/me/tour-completed");
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { tourCompleted: boolean };
    expect(secondBody.tourCompleted).toBe(true);

    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${user.userId}`);
    expect(row.tourCompleted).toBe(true);
  });

  it("completing the tour does not flip onboardingSeen (independent flags)", async () => {
    const signUp = await req(null, "POST", "/api/auth/sign-up", {
      username: "tour-newbie4",
      password: "first-password",
    });
    const { user } = (await signUp.json()) as { user: { userId: string } };

    await req(user.userId, "POST", "/api/me/tour-completed");
    const me = await req(user.userId, "GET", "/api/me");
    const meBody = (await me.json()) as {
      onboardingSeen: boolean;
      tourCompleted: boolean;
    };
    expect(meBody.tourCompleted).toBe(true);
    expect(meBody.onboardingSeen).toBe(false);
  });
});

describe("removed staff lose access immediately", () => {
  // A removed user's stateless session token would otherwise keep working until
  // its natural expiry (up to 30 days). After deletion the very next request
  // must be rejected. We use a dedicated throwaway account (not the shared
  // MANAGER/OPERATOR fixtures) so caching its now-revoked state can't leak into
  // other tests. The same code path serves web (httpOnly cookie) and mobile
  // (bearer) sessions because requireAuth normalises both to one verified token.
  it("revokes an active session on the next request after deletion (→ 401)", async () => {
    const VICTIM = "victim-1";
    await db.insert(usersTable).values({ id: VICTIM, username: "victim", passwordHash: "x" });
    await db.insert(userRolesTable).values({ userId: VICTIM, role: "operator" });

    // The session works while the account exists (also warms the existence cache
    // to `true`, so the revocation below must actively evict it).
    const before = await req(VICTIM, "GET", "/api/me");
    expect(before.status).toBe(200);

    const removed = await req(MANAGER, "DELETE", `/api/users/${VICTIM}`);
    expect(removed.status).toBe(204);

    // Same still-valid token, but the account is gone → rejected immediately.
    const after = await req(VICTIM, "GET", "/api/me");
    expect(after.status).toBe(401);
  });

  it("does not affect other active users (→ 200)", async () => {
    const VICTIM = "victim-2";
    await db.insert(usersTable).values({ id: VICTIM, username: "victim2", passwordHash: "x" });
    await db.insert(userRolesTable).values({ userId: VICTIM, role: "operator" });

    await req(MANAGER, "DELETE", `/api/users/${VICTIM}`);

    // The surviving operator's session is untouched.
    const res = await req(OPERATOR, "GET", "/api/me");
    expect(res.status).toBe(200);
  });
});
