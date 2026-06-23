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
import type { Capability } from "../lib/roles";

// The complete capability set, mirrored locally so the test never statically
// imports lib/roles (which would bind @workspace/db's pool before beforeAll can
// repoint DATABASE_URL at the throwaway DB). seedRoles is loaded dynamically.
const ALL_CAPS: Capability[] = [
  "manage-staff",
  "manage-inventory",
  "edit-production-rules",
  "approve-password-resets",
  "review-incidents",
  "use-ai-tools",
];

// The capability set each seeded role grants (must match ROLE_SEEDS in
// lib/roles). The tests derive expected allow/deny purely from this map.
const ROLE_CAPS: Record<string, Capability[]> = {
  manager: [...ALL_CAPS],
  operator: [],
  supervisor: ["review-incidents", "edit-production-rules"],
  "qc-operator": ["use-ai-tools"],
  "qc-manager": ["use-ai-tools", "review-incidents"],
  warehouse: [],
  inventory: ["manage-inventory"],
};

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
let inventoryLocationsTable: DbModule["inventoryLocationsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryConsumedRunsTable: DbModule["inventoryConsumedRunsTable"];
let inventorySettingsTable: DbModule["inventorySettingsTable"];
let userRolesTable: DbModule["userRolesTable"];
let usersTable: DbModule["usersTable"];
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
const SUPERVISOR = "supervisor-1";
const QC_OPERATOR = "qc-operator-1";
const QC_MANAGER = "qc-manager-1";
const WAREHOUSE = "warehouse-1";
const INVENTORY = "inventory-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  // Create a uniquely named throwaway database on the same Postgres server.
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
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
  inventoryLocationsTable = dbMod.inventoryLocationsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryConsumedRunsTable = dbMod.inventoryConsumedRunsTable;
  inventorySettingsTable = dbMod.inventorySettingsTable;
  userRolesTable = dbMod.userRolesTable;
  usersTable = dbMod.usersTable;
  rolesTable = dbMod.rolesTable;
  const rolesMod = await import("../lib/roles");
  seedRoles = rolesMod.seedRoles;

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
}, 30_000);

beforeEach(async () => {
  // The user-existence cache is module-level and outlives a single test; fixed
  // ids reused across tests would otherwise inherit a prior test's revocation.
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryLocationsTable}, ${inventoryConsumedRunsTable}, ${inventoryItemsTable}, ${inventorySettingsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  // Seed the role catalog (manager/operator builtins + editable starters) so the
  // capability middleware can resolve each user's role to a capability set. Plus
  // a disposable, unassigned, non-builtin role for the delete-role happy path.
  await seedRoles();
  await db
    .insert(rolesTable)
    .values({ name: "disposable-role", capabilities: [], builtin: false });
  // A manager and an operator we have already "seen". Seeding rows directly
  // bypasses the first-user bootstrap so each test starts from a known roster.
  await db.insert(usersTable).values([
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: OPERATOR, username: "operator", passwordHash: "x" },
    { id: SUPERVISOR, username: "supervisor", passwordHash: "x" },
    { id: QC_OPERATOR, username: "qc-operator", passwordHash: "x" },
    { id: QC_MANAGER, username: "qc-manager", passwordHash: "x" },
    { id: WAREHOUSE, username: "warehouse", passwordHash: "x" },
    { id: INVENTORY, username: "inventory", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
    { userId: SUPERVISOR, role: "supervisor" },
    { userId: QC_OPERATOR, role: "qc-operator" },
    { userId: QC_MANAGER, role: "qc-manager" },
    { userId: WAREHOUSE, role: "warehouse" },
    { userId: INVENTORY, role: "inventory" },
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

// Each gated route, tagged with the single capability it requires plus a body
// and okStatus that would succeed once past the guard. The test derives expected
// allow/deny for every role purely from whether the role holds `capability`.
type GatedRoute = {
  name: string;
  capability: Capability;
  method: string;
  path: (ctx: { itemId: number }) => string;
  body?: unknown;
  okStatus: number;
};

const ROUTES: GatedRoute[] = [
  // --- manage-inventory ---
  {
    name: "POST /inventory/items",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/inventory/items",
    body: { key: "ingredient:New:lbs", category: "ingredient", name: "New", unit: "lbs" },
    okStatus: 201,
  },
  {
    name: "PATCH /inventory/items/:id",
    capability: "manage-inventory",
    method: "PATCH",
    path: ({ itemId }) => `/api/inventory/items/${itemId}`,
    body: { name: "Renamed" },
    okStatus: 200,
  },
  {
    name: "DELETE /inventory/items/:id",
    capability: "manage-inventory",
    method: "DELETE",
    path: ({ itemId }) => `/api/inventory/items/${itemId}`,
    okStatus: 204,
  },
  {
    // A self-merge (fromKey === toKey) is a safe no-op that returns 200 once
    // past the guard, so it exercises authz without mutating real stock.
    name: "POST /inventory/merge",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/inventory/merge",
    body: {
      merges: [
        {
          fromKey: "ingredient:Target:lbs",
          toKey: "ingredient:Target:lbs",
          toName: "Target",
          category: "ingredient",
          unit: "lbs",
        },
      ],
    },
    okStatus: 200,
  },
  {
    name: "PUT /inventory/settings",
    capability: "manage-inventory",
    method: "PUT",
    path: () => "/api/inventory/settings",
    body: { expirySoonDays: 14 },
    okStatus: 200,
  },
  // --- use-ai-tools ---
  {
    name: "POST /inventory/identify-photo",
    capability: "use-ai-tools",
    method: "POST",
    path: () => "/api/inventory/identify-photo",
    body: { imageBase64: validImage },
    okStatus: 200,
  },
  // --- review-incidents ---
  {
    name: "GET /incidents",
    capability: "review-incidents",
    method: "GET",
    path: () => "/api/incidents",
    okStatus: 200,
  },
  // --- edit-production-rules ---
  {
    name: "POST /production-rules",
    capability: "edit-production-rules",
    method: "POST",
    path: () => "/api/production-rules",
    body: { rules: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /production-rules",
    capability: "edit-production-rules",
    method: "DELETE",
    path: () => "/api/production-rules",
    body: { ids: [] },
    okStatus: 200,
  },
  {
    name: "POST /freezer-pull-items",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/freezer-pull-items",
    body: { items: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /freezer-pull-items",
    capability: "manage-inventory",
    method: "DELETE",
    path: () => "/api/freezer-pull-items",
    body: { ids: [] },
    okStatus: 200,
  },
  // --- approve-password-resets ---
  {
    name: "GET /password-reset-requests",
    capability: "approve-password-resets",
    method: "GET",
    path: () => "/api/password-reset-requests",
    okStatus: 200,
  },
  // --- manage-staff ---
  {
    name: "GET /roles",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/roles",
    okStatus: 200,
  },
  {
    name: "POST /roles",
    capability: "manage-staff",
    method: "POST",
    path: () => "/api/roles",
    body: { name: "brand-new-role", capabilities: [] },
    okStatus: 201,
  },
  {
    name: "PUT /roles/:name",
    capability: "manage-staff",
    method: "PUT",
    path: () => "/api/roles/warehouse",
    body: { capabilities: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /roles/:name",
    capability: "manage-staff",
    method: "DELETE",
    path: () => "/api/roles/disposable-role",
    okStatus: 204,
  },
  {
    name: "GET /users",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/users",
    okStatus: 200,
  },
  {
    name: "PUT /users/:id/role",
    capability: "manage-staff",
    method: "PUT",
    path: () => `/api/users/${OPERATOR}/role`,
    body: { role: "operator" },
    okStatus: 200,
  },
  {
    name: "PUT /users/:id/password",
    capability: "manage-staff",
    method: "PUT",
    path: () => `/api/users/${OPERATOR}/password`,
    body: { newPassword: "fresh-password" },
    okStatus: 204,
  },
  {
    name: "DELETE /users/:id",
    capability: "manage-staff",
    method: "DELETE",
    path: () => `/api/users/${OPERATOR}`,
    okStatus: 204,
  },
];

const USER_BY_ROLE: Record<string, string> = {
  manager: MANAGER,
  operator: OPERATOR,
  supervisor: SUPERVISOR,
  "qc-operator": QC_OPERATOR,
  "qc-manager": QC_MANAGER,
  warehouse: WAREHOUSE,
  inventory: INVENTORY,
};

describe("capability-based access control", () => {
  describe("signed out → 401", () => {
    for (const route of ROUTES) {
      it(`rejects ${route.name} with 401`, async () => {
        const itemId = await makeItem("ingredient:Target:lbs");
        const res = await req(null, route.method, route.path({ itemId }), route.body);
        expect(res.status).toBe(401);
      });
    }
  });

  // For every seeded role, each gated route is allowed iff the role holds the
  // route's capability — otherwise it must 403. This exhaustively verifies the
  // capability map drives access (e.g. inventory CRUD works for the inventory
  // role, AI tools for the QC roles, production rules for supervisors).
  for (const [roleName, caps] of Object.entries(ROLE_CAPS)) {
    const user = USER_BY_ROLE[roleName];
    describe(`${roleName}`, () => {
      for (const route of ROUTES) {
        const allowed = caps.includes(route.capability);
        if (allowed) {
          it(`allows ${route.name} (${route.okStatus})`, async () => {
            const itemId = await makeItem("ingredient:Target:lbs");
            const res = await req(user, route.method, route.path({ itemId }), route.body);
            expect(res.status).toBe(route.okStatus);
          });
        } else {
          it(`forbids ${route.name} with 403`, async () => {
            const itemId = await makeItem("ingredient:Target:lbs");
            const res = await req(user, route.method, route.path({ itemId }), route.body);
            expect(res.status).toBe(403);
          });
        }
      }
    });
  }
});

// Freezer-pull config writes are manager-gated (covered in GATED_ROUTES), but the
// LIST is intentionally readable by any signed-in user so the warehouse tab can
// render "Pull Out Freezer" cards for floor staff. These lock that read policy:
// no token → 401, but a capability-less operator → 200.
describe("GET /freezer-pull-items read policy", () => {
  it("rejects an unauthenticated read with 401", async () => {
    const res = await req(null, "GET", "/api/freezer-pull-items");
    expect(res.status).toBe(401);
  });

  it("allows a capability-less operator to read (→ 200)", async () => {
    const res = await req(OPERATOR, "GET", "/api/freezer-pull-items");
    expect(res.status).toBe(200);
  });
});

describe("identity and role assignment", () => {
  // GET /me is ungated; it returns the caller's role and resolved capability set
  // so the clients can show/hide controls. Every role must read back correctly.
  for (const roleName of Object.keys(ROLE_CAPS)) {
    it(`GET /me reports ${roleName}'s role and capabilities`, async () => {
      const user = USER_BY_ROLE[roleName];
      const res = await req(user, "GET", "/api/me");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        userId: string;
        role: string;
        capabilities: string[];
      };
      expect(body.userId).toBe(user);
      expect(body.role).toBe(roleName);
      expect([...body.capabilities].sort()).toEqual([...ROLE_CAPS[roleName]].sort());
    });
  }

  // A manager (who holds every capability) can assign any seeded role, and it
  // persists.
  for (const role of ["warehouse", "inventory", "supervisor", "qc-manager"] as const) {
    it(`lets a manager assign ${role} via PUT /users/:id/role (→ 200)`, async () => {
      const res = await req(MANAGER, "PUT", `/api/users/${OPERATOR}/role`, { role });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { role: string };
      expect(body.role).toBe(role);
      const [row] = await db
        .select()
        .from(userRolesTable)
        .where(sql`${userRolesTable.userId} = ${OPERATOR}`);
      expect(row.role).toBe(role);
    });
  }
});

describe("role administration", () => {
  it("creates a role and a manager can then assign it (end-to-end)", async () => {
    const create = await req(MANAGER, "POST", "/api/roles", {
      name: "line-lead",
      capabilities: ["manage-inventory"],
    });
    expect(create.status).toBe(201);

    const assign = await req(MANAGER, "PUT", `/api/users/${OPERATOR}/role`, {
      role: "line-lead",
    });
    expect(assign.status).toBe(200);

    const me = await req(OPERATOR, "GET", "/api/me");
    const body = (await me.json()) as { role: string; capabilities: string[] };
    expect(body.role).toBe("line-lead");
    expect(body.capabilities).toContain("manage-inventory");
  });

  it("refuses to create a role that already exists (409)", async () => {
    const res = await req(MANAGER, "POST", "/api/roles", {
      name: "supervisor",
      capabilities: [],
    });
    expect(res.status).toBe(409);
  });

  it("refuses to strip manage-staff from the built-in manager role (400)", async () => {
    const res = await req(MANAGER, "PUT", "/api/roles/manager", {
      capabilities: ["use-ai-tools"],
    });
    expect(res.status).toBe(400);
  });

  it("refuses to delete a built-in role (400)", async () => {
    const res = await req(MANAGER, "DELETE", "/api/roles/operator");
    expect(res.status).toBe(400);
  });

  it("refuses to delete a role that is still assigned to staff (400)", async () => {
    // The 'inventory' role is held by the INVENTORY user in the seed roster.
    const res = await req(MANAGER, "DELETE", "/api/roles/inventory");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/assigned/i);
  });

  it("renames a custom role and reassigns its holders (end-to-end)", async () => {
    // Create a custom role and put the operator on it.
    const create = await req(MANAGER, "POST", "/api/roles", {
      name: "line-lead",
      capabilities: ["manage-inventory"],
    });
    expect(create.status).toBe(201);
    const assign = await req(MANAGER, "PUT", `/api/users/${OPERATOR}/role`, {
      role: "line-lead",
    });
    expect(assign.status).toBe(200);

    // Rename it via PUT /roles/:name with a new `name` in the body.
    const rename = await req(MANAGER, "PUT", "/api/roles/line-lead", {
      name: "shift-lead",
      capabilities: ["manage-inventory"],
    });
    expect(rename.status).toBe(200);

    // The role catalog reflects the new name (old name gone).
    const list = await req(MANAGER, "GET", "/api/roles");
    const roles = (await list.json()) as { name: string }[];
    const names = roles.map((r) => r.name);
    expect(names).toContain("shift-lead");
    expect(names).not.toContain("line-lead");

    // The holder was carried over to the renamed role.
    const me = await req(OPERATOR, "GET", "/api/me");
    const body = (await me.json()) as { role: string; capabilities: string[] };
    expect(body.role).toBe("shift-lead");
    expect(body.capabilities).toContain("manage-inventory");
  });

  it("refuses to rename a built-in role (400)", async () => {
    const res = await req(MANAGER, "PUT", "/api/roles/operator", {
      name: "associate",
      capabilities: [],
    });
    expect(res.status).toBe(400);
  });

  it("refuses to rename to a blank name (400)", async () => {
    const create = await req(MANAGER, "POST", "/api/roles", {
      name: "temp-role",
      capabilities: [],
    });
    expect(create.status).toBe(201);
    const res = await req(MANAGER, "PUT", "/api/roles/temp-role", {
      name: "   ",
      capabilities: [],
    });
    expect(res.status).toBe(400);
  });

  it("refuses to rename onto an existing role name (409)", async () => {
    const create = await req(MANAGER, "POST", "/api/roles", {
      name: "renamable-role",
      capabilities: [],
    });
    expect(create.status).toBe(201);
    // 'supervisor' is a built-in role that already exists.
    const res = await req(MANAGER, "PUT", "/api/roles/renamable-role", {
      name: "supervisor",
      capabilities: [],
    });
    expect(res.status).toBe(409);
  });
});

// The privilege-escalation guard is enforced not just on role create/edit but
// on role ASSIGNMENT too. To exercise it over HTTP we need an actor who holds
// manage-staff (so they pass the route gate) but lacks other capabilities —
// a custom "junior-admin" role. They then can't grant capabilities they lack.
describe("privilege-escalation guard", () => {
  beforeEach(async () => {
    // Create a manage-staff-only role and put the operator on it.
    await db.insert(rolesTable).values({
      name: "junior-admin",
      capabilities: ["manage-staff"],
      builtin: false,
    });
    await db
      .insert(userRolesTable)
      .values({ userId: OPERATOR, role: "junior-admin" })
      .onConflictDoUpdate({
        target: userRolesTable.userId,
        set: { role: "junior-admin" },
      });
    clearUserValidityCache();
  });

  it("lets the junior-admin create a role with no capabilities (201)", async () => {
    const res = await req(OPERATOR, "POST", "/api/roles", {
      name: "plain-role",
      capabilities: [],
    });
    expect(res.status).toBe(201);
  });

  it("forbids the junior-admin granting a capability they lack on create (403)", async () => {
    const res = await req(OPERATOR, "POST", "/api/roles", {
      name: "sneaky-role",
      capabilities: ["use-ai-tools"],
    });
    expect(res.status).toBe(403);
  });

  it("forbids the junior-admin assigning a role with capabilities they lack (403)", async () => {
    // qc-operator carries use-ai-tools, which junior-admin does not hold.
    const res = await req(OPERATOR, "PUT", `/api/users/${WAREHOUSE}/role`, {
      role: "qc-operator",
    });
    expect(res.status).toBe(403);
  });
});

describe("last-manager guard", () => {
  // The guard blocks demoting the only manager to ANY non-manager role, not just
  // operator — so each of the six other roles must be rejected identically.
  for (const role of [
    "operator",
    "supervisor",
    "qc-operator",
    "qc-manager",
    "warehouse",
    "inventory",
  ]) {
    it(`rejects demoting the only manager to ${role} (PUT /users/:id/role → 400)`, async () => {
      // The seeded roster has exactly one manager (MANAGER); the rest don't count.
      const res = await req(MANAGER, "PUT", `/api/users/${MANAGER}/role`, { role });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/last staff manager/i);

      // The manager is unchanged — still a manager.
      const [row] = await db
        .select()
        .from(userRolesTable)
        .where(sql`${userRolesTable.userId} = ${MANAGER}`);
      expect(row.role).toBe("manager");
    });
  }

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
    expect(body.error).toMatch(/last staff manager/i);

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

// Restock is the commit path shared by manual restock AND AI photo intake: both
// post to /inventory/restock, optionally carrying a chosen destination
// locationId. These guard the contract photo-intake relies on — explicit
// offsite selection lands stock at that location, and an omitted location falls
// back to the onsite/line location (created on demand).
describe("restock honors the chosen destination location", () => {
  async function lotLocationsFor(itemId: number): Promise<(number | null)[]> {
    const rows = await db.execute<{ location_id: number | null }>(
      sql`SELECT location_id FROM inventory_lots WHERE item_id = ${itemId} ORDER BY id`,
    );
    return rows.rows.map((r) => r.location_id);
  }

  it("lands stock at an explicitly chosen offsite location", async () => {
    const [item] = await db
      .insert(inventoryItemsTable)
      .values({ key: "ingredient:Mozzarella:lbs", category: "ingredient", name: "Mozzarella", unit: "lbs" })
      .returning();
    const [onsite] = await db
      .insert(inventoryLocationsTable)
      .values({ name: "Onsite (Line)", isOnsite: true })
      .returning();
    const [cold] = await db
      .insert(inventoryLocationsTable)
      .values({ name: "Cold Storage", isOnsite: false })
      .returning();

    const res = await req(MANAGER, "POST", "/api/inventory/restock", {
      itemKey: "ingredient:Mozzarella:lbs",
      category: "ingredient",
      name: "Mozzarella",
      unit: "lbs",
      qty: 12,
      locationId: cold.id,
    });
    expect(res.status).toBe(200);

    const locs = await lotLocationsFor(item.id);
    expect(locs).toEqual([cold.id]);
    expect(locs).not.toContain(onsite.id);
  });

  it("defaults to the onsite location when none is specified", async () => {
    const [item] = await db
      .insert(inventoryItemsTable)
      .values({ key: "ingredient:Sauce:lbs", category: "ingredient", name: "Sauce", unit: "lbs" })
      .returning();
    const [onsite] = await db
      .insert(inventoryLocationsTable)
      .values({ name: "Onsite (Line)", isOnsite: true })
      .returning();
    await db.insert(inventoryLocationsTable).values({ name: "Cold Storage", isOnsite: false });

    const res = await req(MANAGER, "POST", "/api/inventory/restock", {
      itemKey: "ingredient:Sauce:lbs",
      category: "ingredient",
      name: "Sauce",
      unit: "lbs",
      qty: 8,
    });
    expect(res.status).toBe(200);

    const locs = await lotLocationsFor(item.id);
    expect(locs).toEqual([onsite.id]);
  });

  it("rejects an unknown destination location (→ 400)", async () => {
    await db
      .insert(inventoryItemsTable)
      .values({ key: "ingredient:Flour:lbs", category: "ingredient", name: "Flour", unit: "lbs" });
    await db.insert(inventoryLocationsTable).values({ name: "Onsite (Line)", isOnsite: true });

    const res = await req(MANAGER, "POST", "/api/inventory/restock", {
      itemKey: "ingredient:Flour:lbs",
      category: "ingredient",
      name: "Flour",
      unit: "lbs",
      qty: 5,
      locationId: 999999,
    });
    expect(res.status).toBe(400);
  });
});
