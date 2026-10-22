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
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { signLegacyTokenForTests, verifyPassword } from "../lib/auth";
import { facilityDate } from "../lib/facilityTime";
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
  "manage-factory-settings",
  "manage-profiles",
  "manage-allergens",
  "record-qc",
  "manage-qc",
];

// The capability set each seeded role grants (must match ROLE_SEEDS in
// lib/roles). The tests derive expected allow/deny purely from this map.
const ROLE_CAPS: Record<string, Capability[]> = {
  manager: [...ALL_CAPS],
  operator: [],
  supervisor: ["review-incidents", "edit-production-rules"],
  "qc-operator": ["use-ai-tools", "record-qc"],
  "qc-manager": ["use-ai-tools", "review-incidents", "manage-allergens", "record-qc", "manage-qc"],
  warehouse: [],
  inventory: ["manage-inventory"],
};

// Mock the OpenAI vision client so POST /inventory/identify-photo returns a
// valid (empty) result without making a paid call.
vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify({ items: [] }) } }],
          }),
        },
      },
    },
    // Routes resolve their model via pickModel(); the mock must export it too,
    // or the call throws "pickModel is not a function" and every route 502s.
    AI_MODELS,
    pickModel: (kind: keyof typeof AI_MODELS = "full") => AI_MODELS[kind],
  };
});

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventoryLocationsTable: DbModule["inventoryLocationsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryConsumedRunsTable: DbModule["inventoryConsumedRunsTable"];
let inventorySettingsTable: DbModule["inventorySettingsTable"];
let ingredientsTable: DbModule["ingredientsTable"];
let brandProfilesTable: DbModule["brandProfilesTable"];
let dailySyncTable: DbModule["dailySyncTable"];
let completedRunHistoryTable: DbModule["completedRunHistoryTable"];
let qcWorkflowEventsTable: DbModule["qcWorkflowEventsTable"];
let ingredientBatchWeightsTable: DbModule["ingredientBatchWeightsTable"];
let userRolesTable: DbModule["userRolesTable"];
let usersTable: DbModule["usersTable"];
let rolesTable: DbModule["rolesTable"];
let dataHealsTable: DbModule["dataHealsTable"];
let auditLogsTable: DbModule["auditLogsTable"];
let passwordResetRequestsTable: DbModule["passwordResetRequestsTable"];

let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;
let getRequiredCapabilities: (
  middleware: unknown,
) => readonly Capability[] | undefined;

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
const SANDBOX = "sandbox-1";

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
  const auditProtection = spawnSync(
    process.execPath,
    [path.resolve(repoRoot, "lib/db/migrations/apply-audit-log-protection.mjs")],
    { cwd: repoRoot, env: { ...process.env, DATABASE_URL: testUrlStr }, encoding: "utf8" },
  );
  if (auditProtection.status !== 0) {
    throw new Error(`audit protection migration failed:\n${auditProtection.stdout}\n${auditProtection.stderr}`);
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
  ingredientsTable = dbMod.ingredientsTable;
  brandProfilesTable = dbMod.brandProfilesTable;
  dailySyncTable = dbMod.dailySyncTable;
  completedRunHistoryTable = dbMod.completedRunHistoryTable;
  qcWorkflowEventsTable = dbMod.qcWorkflowEventsTable;
  ingredientBatchWeightsTable = dbMod.ingredientBatchWeightsTable;
  userRolesTable = dbMod.userRolesTable;
  usersTable = dbMod.usersTable;
  rolesTable = dbMod.rolesTable;
  dataHealsTable = dbMod.dataHealsTable;
  auditLogsTable = dbMod.auditLogsTable;
  passwordResetRequestsTable = dbMod.passwordResetRequestsTable;
  const rolesMod = await import("../lib/roles");
  seedRoles = rolesMod.seedRoles;
  const capabilityMod = await import("../middlewares/requireCapability");
  getRequiredCapabilities = capabilityMod.getRequiredCapabilities;

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
}, 120_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  // Close the app pool so the database has no open connections, then drop it.
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

async function resetRoleFixture(): Promise<void> {
  // The user-existence cache is module-level and outlives a single test; fixed
  // ids reused across tests would otherwise inherit a prior test's revocation.
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryLocationsTable}, ${inventoryConsumedRunsTable}, ${inventoryItemsTable}, ${inventorySettingsTable}, ${ingredientBatchWeightsTable}, ${qcWorkflowEventsTable}, ${completedRunHistoryTable}, ${dailySyncTable}, ${brandProfilesTable}, ${ingredientsTable}, ${passwordResetRequestsTable}, ${auditLogsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
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
    { id: SANDBOX, username: "sandbox", passwordHash: "x", sandbox: true },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
    { userId: SUPERVISOR, role: "supervisor" },
    { userId: QC_OPERATOR, role: "qc-operator" },
    { userId: QC_MANAGER, role: "qc-manager" },
    { userId: WAREHOUSE, role: "warehouse" },
    { userId: INVENTORY, role: "inventory" },
    { userId: SANDBOX, role: "operator" },
  ]);
}

beforeEach(async () => {
  await resetRoleFixture();
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
  if (userId) headers["authorization"] = `Bearer ${signLegacyTokenForTests(userId)}`;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function auditLogs(): Promise<{
  logs: Array<{
    actor: string;
    action: string;
    resource: string | null;
    changes: Record<string, any>;
  }>;
  count: number;
}> {
  const res = await req(MANAGER, "GET", "/api/audit-logs");
  expect(res.status).toBe(200);
  return (await res.json()) as {
    logs: Array<{
      actor: string;
      action: string;
      resource: string | null;
      changes: Record<string, any>;
    }>;
    count: number;
  };
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
  {
    name: "GET /duplicate-reviews",
    capability: "manage-inventory",
    method: "GET",
    path: () => "/api/duplicate-reviews",
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
  // Shared learned/master records must be protected on the API, not merely
  // hidden in the importer/setup UI.
  {
    name: "POST /import-aliases",
    capability: "manage-profiles",
    method: "POST",
    path: () => "/api/import-aliases",
    body: { aliases: [] },
    okStatus: 200,
  },
  {
    name: "POST /fill-missing-values",
    capability: "manage-profiles",
    method: "POST",
    path: () => "/api/fill-missing-values",
    body: { values: [] },
    okStatus: 200,
  },
  {
    name: "POST /ingredient-batch-weights",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/ingredient-batch-weights",
    body: { weights: [] },
    okStatus: 200,
  },
  {
    name: "POST /photo-aliases",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/photo-aliases",
    body: { aliases: [] },
    okStatus: 200,
  },
  {
    name: "POST /spec-import-aliases",
    capability: "manage-profiles",
    method: "POST",
    path: () => "/api/spec-import-aliases",
    body: { aliases: [] },
    okStatus: 200,
  },
  {
    name: "POST /die-types",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/die-types",
    body: { names: [] },
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
  {
    name: "POST /mixes",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/mixes",
    body: { items: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /mixes",
    capability: "manage-inventory",
    method: "DELETE",
    path: () => "/api/mixes",
    body: { ids: [] },
    okStatus: 200,
  },
  {
    name: "POST /cycle-count-schedules",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/cycle-count-schedules",
    body: { schedules: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /cycle-count-schedules",
    capability: "manage-inventory",
    method: "DELETE",
    path: () => "/api/cycle-count-schedules",
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
    name: "GET /audit-logs",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/audit-logs",
    okStatus: 200,
  },
  {
    name: "GET /audit-logs/profile-name-link-cleanup",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/audit-logs/profile-name-link-cleanup",
    okStatus: 200,
  },
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
  // --- manage-profiles / imports / exports ---
  {
    name: "GET /import-history",
    capability: "manage-profiles",
    method: "GET",
    path: () => "/api/import-history",
    okStatus: 200,
  },
  {
    name: "POST /import-history",
    capability: "manage-profiles",
    method: "POST",
    path: () => "/api/import-history",
    body: { importType: "spec", sourceLabel: "coverage.xlsx", status: "complete", operationId: "import-history-profile-coverage-001" },
    okStatus: 201,
  },
  {
    name: "POST /import-history (inventory importer)",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/import-history",
    body: { importType: "premix", sourceLabel: "coverage.xlsx", status: "complete", operationId: "import-history-inventory-coverage-001" },
    okStatus: 201,
  },
  {
    name: "POST /brand-profiles",
    capability: "manage-profiles",
    method: "POST",
    path: () => "/api/brand-profiles",
    body: { items: [] },
    okStatus: 200,
  },
  {
    name: "PATCH /brand-profiles/:key/clear-slot",
    capability: "manage-profiles",
    method: "PATCH",
    path: () => "/api/brand-profiles/missing/clear-slot",
    body: { slot: "app3" },
    // A valid request reaches the handler; no seeded profile exists to clear.
    okStatus: 404,
  },
  {
    name: "DELETE /brand-profiles",
    capability: "manage-profiles",
    method: "DELETE",
    path: () => "/api/brand-profiles",
    body: { keys: [] },
    okStatus: 200,
  },
  // --- named recipes and inventory master data ---
  {
    name: "POST /dough-recipes",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/dough-recipes",
    body: { items: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /dough-recipes",
    capability: "manage-inventory",
    method: "DELETE",
    path: () => "/api/dough-recipes",
    body: { ids: [] },
    okStatus: 200,
  },
  {
    name: "POST /sauce-recipes",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/sauce-recipes",
    body: { items: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /sauce-recipes",
    capability: "manage-inventory",
    method: "DELETE",
    path: () => "/api/sauce-recipes",
    body: { ids: [] },
    okStatus: 200,
  },
  {
    name: "POST /cheese-recipes",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/cheese-recipes",
    body: { items: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /cheese-recipes",
    capability: "manage-inventory",
    method: "DELETE",
    path: () => "/api/cheese-recipes",
    body: { ids: [] },
    okStatus: 200,
  },
  {
    name: "POST /ingredients",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/ingredients",
    body: { items: [] },
    okStatus: 200,
  },
  {
    name: "PUT /ingredients/:id/allergen-mapping",
    capability: "manage-allergens",
    method: "PUT",
    path: () => "/api/ingredients/ingredient-not-present/allergen-mapping",
    body: { allergens: ["egg"], reviewed: true },
    // A caller with the capability reaches the scoped handler; the deliberate
    // missing id returns 404 without mutating the fixture.
    okStatus: 404,
  },
  {
    name: "DELETE /ingredients",
    capability: "manage-inventory",
    method: "DELETE",
    path: () => "/api/ingredients",
    body: { ids: [] },
    okStatus: 200,
  },
  {
    name: "POST /ingredients/merge",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/ingredients/merge",
    body: { targetId: "missing-target", sourceIds: ["missing-source"] },
    // The request reached the handler; the merge payload is rejected because
    // neither side exists in the intentionally empty fixture.
    okStatus: 400,
  },
  {
    name: "POST /die-line-defaults",
    capability: "manage-inventory",
    method: "POST",
    path: () => "/api/die-line-defaults",
    body: { entries: [] },
    okStatus: 200,
  },
  {
    name: "DELETE /die-line-defaults",
    capability: "manage-inventory",
    method: "DELETE",
    path: () => "/api/die-line-defaults",
    body: { names: [] },
    okStatus: 200,
  },
  // --- factory settings, diagnostics, sync reset, and action queue ---
  {
    name: "GET /factory-data",
    capability: "manage-factory-settings",
    method: "GET",
    path: () => "/api/factory-data",
    okStatus: 200,
  },
  {
    name: "PUT /factory-data",
    capability: "manage-factory-settings",
    method: "PUT",
    path: () => "/api/factory-data",
    body: { key: "capability-coverage", value: true },
    okStatus: 200,
  },
  {
    name: "GET /sync/conflict-stats",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/sync/conflict-stats",
    okStatus: 200,
  },
  {
    name: "POST /sync/reset",
    capability: "manage-staff",
    method: "POST",
    path: () => "/api/sync/reset",
    body: { confirm: true },
    okStatus: 200,
  },
  {
    name: "POST /sync/purge-all",
    capability: "manage-staff",
    method: "POST",
    path: () => "/api/sync/purge-all",
    body: { confirm: true },
    okStatus: 200,
  },
  {
    name: "DELETE /sync/:date",
    capability: "manage-factory-settings",
    method: "DELETE",
    path: () => "/api/sync/2099-01-01",
    okStatus: 200,
  },
  {
    name: "POST /runs",
    capability: "manage-factory-settings",
    method: "POST",
    path: () => "/api/runs",
    body: {
      label: "capability-run",
      casesNeeded: 100,
      casesLeft: 100,
      skidsCompleted: 0,
      pizzasPerMin: "5.00",
      totalTimeSec: 1200,
      batchesNeeded: "2.50",
      inputs: {},
    },
    okStatus: 201,
  },
  {
    name: "DELETE /runs/:id",
    capability: "manage-factory-settings",
    method: "DELETE",
    path: () => "/api/runs/2147483647",
    // A missing run proves the request reached the scope-filtered handler.
    okStatus: 404,
  },
  {
    name: "GET /manager-action-queue",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/manager-action-queue",
    okStatus: 200,
  },
  {
    name: "PATCH /manager-action-queue/:id",
    capability: "manage-staff",
    method: "PATCH",
    path: () => "/api/manager-action-queue/missing",
    body: { status: "resolved" },
    // The route validates an action id before looking it up.
    okStatus: 400,
  },
  {
    name: "GET /profile-data/health-check",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/profile-data/health-check",
    okStatus: 200,
  },
  {
    name: "GET /profile-data/health-workspace",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/profile-data/health-workspace",
    okStatus: 200,
  },
  {
    name: "POST /profile-data/ai-retention/apply",
    capability: "manage-staff",
    method: "POST",
    path: () => "/api/profile-data/ai-retention/apply",
    okStatus: 200,
  },
  {
    name: "POST /profile-data/health-check/apply",
    capability: "manage-staff",
    method: "POST",
    path: () => "/api/profile-data/health-check/apply",
    okStatus: 400,
  },
  {
    name: "POST /profile-data/source-library-reconciliation/capture",
    capability: "manage-staff",
    method: "POST",
    path: () => "/api/profile-data/source-library-reconciliation/capture",
    body: {},
    okStatus: 400,
  },
  {
    name: "POST /profile-data/health-check/batches/:batchId/undo",
    capability: "manage-staff",
    method: "POST",
    path: () => "/api/profile-data/health-check/batches/missing/undo",
    okStatus: 404,
  },
  {
    name: "GET /master-data/health",
    capability: "manage-profiles",
    method: "GET",
    path: () => "/api/master-data/health",
    okStatus: 200,
  },
  {
    name: "GET /master-data/health/history",
    capability: "manage-profiles",
    method: "GET",
    path: () => "/api/master-data/health/history",
    okStatus: 200,
  },
  {
    name: "GET /reports/handoff",
    capability: "review-incidents",
    method: "GET",
    path: () => "/api/reports/handoff?date=2026-09-06",
    okStatus: 200,
  },
  {
    name: "GET /reports/operational-view",
    capability: "review-incidents",
    method: "GET",
    path: () => "/api/reports/operational-view?date=2026-09-06&runId=missing",
    // The capability check must run before the handler's canonical-snapshot
    // lookup.  A 404 here proves the authorized request reached that lookup.
    okStatus: 404,
  },
  {
    name: "POST /master-data/health/scan",
    capability: "manage-profiles",
    method: "POST",
    path: () => "/api/master-data/health/scan",
    okStatus: 200,
  },
  {
    name: "POST /master-data/health/repair",
    capability: "manage-profiles",
    method: "POST",
    path: () => "/api/master-data/health/repair",
    body: {},
    okStatus: 200,
  },
  {
    name: "GET /ai-memory/health-check",
    capability: "manage-staff",
    method: "GET",
    path: () => "/api/ai-memory/health-check",
    okStatus: 200,
  },
];

type ExpressRouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};

function declaredAuthorizationRoutes(
  ownedRouters: readonly {
    name: string;
    router: { stack: Array<{ route?: unknown }> };
    authOnlyRoutes?: readonly string[];
  }[],
) {
  const capabilityRoutes: Array<{ name: string; capability: Capability }> = [];
  const authOnlyRoutes: string[] = [];

  for (const owned of ownedRouters) {
    const declaredAuthOnly = new Set(owned.authOnlyRoutes ?? []);
    for (const rawLayer of owned.router.stack) {
      const layer = rawLayer as ExpressRouteLayer;
      if (!layer.route) continue;
      const methods = Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => method.toUpperCase());
      for (const method of methods) {
        const name = `${method} ${layer.route.path}`;
        const required = layer.route.stack.flatMap(
          ({ handle }) => getRequiredCapabilities(handle) ?? [],
        );
        if (required.length > 0) {
          for (const capability of required) capabilityRoutes.push({ name, capability });
        } else if (declaredAuthOnly.has(name)) {
          authOnlyRoutes.push(name);
          declaredAuthOnly.delete(name);
        } else {
          throw new Error(
            `${owned.name} route ${name} has no direct authorization coverage classification`,
          );
        }
      }
    }
    if (declaredAuthOnly.size > 0) {
      throw new Error(
        `${owned.name} has stale auth-only classifications: ${[...declaredAuthOnly].join(", ")}`,
      );
    }
  }

  return { capabilityRoutes, authOnlyRoutes };
}

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
  it("keeps owned operations routes in the direct authorization inventory", async () => {
    const { directAuthorizationCoverageRouters } = await import("./index");
    const declared = declaredAuthorizationRoutes(directAuthorizationCoverageRouters);
    const covered = ROUTES.map(({ name, capability }) => ({ name, capability }));

    for (const route of declared.capabilityRoutes) {
      expect(covered, `${route.name} direct capability coverage`).toContainEqual(route);
    }
    expect(declared.authOnlyRoutes.sort()).toEqual([
      "DELETE /run-templates",
      "GET /run-templates",
      "GET /runs",
      "POST /run-templates",
    ]);
  });

  it("keeps every registered application write in the mutation authorization matrix", async () => {
    const {
      directAuthorizationCoverageRouters,
      mutationAuthorizationInventory,
      mutationAuthorizationRouters,
      validateMutationAuthorizationInventory,
    } = await import("./index");
    // This is intentionally route-stack based, not a list of test requests:
    // every mounted API router (including public auth endpoints) is checked, so
    // a new write fails unless it is classified and its gate precedes its handler.
    validateMutationAuthorizationInventory(mutationAuthorizationRouters);
    expect(
      directAuthorizationCoverageRouters.every(({ router }) =>
        mutationAuthorizationRouters.some((entry) => entry.router === router),
      ),
    ).toBe(true);
    expect(mutationAuthorizationInventory).toContainEqual({
      method: "POST",
      path: "/auth/change-password",
      ownership: "per-user",
      scope: "per-user",
      sandbox: "allowed",
    });
  });

  it("allows sandbox users to reach their own password-change validation", async () => {
    const res = await req(SANDBOX, "POST", "/api/auth/change-password", {});
    // Invalid input proves direct requireAuth and sandbox scope both passed; a
    // live-only regression would return the safe sandbox denial (403) instead.
    expect(res.status).toBe(400);
  });

  it("rejects source-library captures from the sandbox before request validation", async () => {
    const res = await req(
      SANDBOX,
      "POST",
      "/api/profile-data/source-library-reconciliation/capture",
      {},
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Not available in the sandbox account",
    });
  });

  it("marks source-library capture responses as non-cacheable", async () => {
    const res = await req(
      MANAGER,
      "POST",
      "/api/profile-data/source-library-reconciliation/capture",
      {},
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps public capture and diagnostics unauthenticated, production-only, and on one shared rate limit", async () => {
    const paths = [
      "/api/profile-data/source-library-reconciliation/capture",
      "/api/profile-data/source-library-reconciliation/diagnostics",
      "/api/profile-data/source-library-reconciliation/capture",
      "/api/profile-data/source-library-reconciliation/diagnostics",
      "/api/profile-data/source-library-reconciliation/capture",
    ];
    for (const path of paths) {
      const res = await req(
        null,
        "GET",
        path,
      );
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toContain("no-store");
      await expect(res.json()).resolves.toEqual({ error: "Not found" });
    }
    const limited = await req(
      null,
      "GET",
      "/api/profile-data/source-library-reconciliation/diagnostics",
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("rejects source-library capture bodies above the 8 KiB request cap", async () => {
    const res = await req(
      MANAGER,
      "POST",
      "/api/profile-data/source-library-reconciliation/capture",
      { padding: "x".repeat(9000) },
    );
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      error: "Request body too large",
    });
  });

  it("rejects every protected route with 401 when signed out", async () => {
    const itemId = await makeItem("ingredient:Target:lbs");
    for (const route of ROUTES) {
      const res = await req(null, route.method, route.path({ itemId }), route.body);
      expect(res.status, `${route.name} signed-out status`).toBe(401);
    }
  });

  it("limits operators to explicit current-day sync and rejects dated scheduling bypasses", async () => {
    const body = { senderId: "coverage", payload: {} };
    const anonymous = await req(null, "PUT", "/api/sync/2099-01-01?today=2025-01-01", body);
    expect(anonymous.status).toBe(401);

    const futureDenied = await req(OPERATOR, "PUT", "/api/sync/2099-01-01?today=2025-01-01", body);
    expect(futureDenied.status).toBe(403);

    const forgedTodayDenied = await req(OPERATOR, "PUT", "/api/sync/2099-01-01?today=2099-01-01", body);
    expect(forgedTodayDenied.status).toBe(403);

    const currentAllowed = await req(OPERATOR, "PUT", "/api/sync/today?today=2025-01-01", body);
    expect(currentAllowed.status).toBe(200);

    const scheduledAllowed = await req(MANAGER, "PUT", "/api/sync/2099-01-01?today=2025-01-01", body);
    expect(scheduledAllowed.status).toBe(200);
  });

  it("keeps scheduled-day read variants authenticated and scope-bound without weakening scheduled writes", async () => {
    const scheduledPayload = {
      dayState: {
        runs: [{ id: "scheduled-run", brand: "Acme", flavor: "Future" }],
        resetAt: 0,
      },
      runValues: {},
    };
    const scheduledWrite = await req(
      MANAGER,
      "PUT",
      "/api/sync/2099-01-02?today=2025-01-01",
      { senderId: "scheduled-read-coverage", payload: scheduledPayload },
    );
    expect(scheduledWrite.status).toBe(200);

    // The scheduled GETs are shared day-state reads, so an operator may read
    // them after authentication. The write variant above remains manager-only.
    const scheduledDay = await req(OPERATOR, "GET", "/api/sync/2099-01-02");
    expect(scheduledDay.status).toBe(200);
    const scheduledDayBody = await scheduledDay.json() as {
      dayState: { runs: Array<{ id: string }> };
    };
    expect(scheduledDayBody.dayState.runs[0].id).toBe("scheduled-run");

    const scheduledList = await req(OPERATOR, "GET", "/api/sync/scheduled?today=2025-01-01&include=runs");
    expect(scheduledList.status).toBe(200);
    const scheduledRows = await scheduledList.json() as Array<{ date: string }>;
    expect(scheduledRows.some((row) => row.date === "2099-01-02")).toBe(true);

    expect((await req(null, "GET", "/api/sync/2099-01-02")).status).toBe(401);
    expect((await req(null, "GET", "/api/sync/scheduled")).status).toBe(401);
  });

  it("resolves the expected capabilities for every seeded role", async () => {
    for (const [roleName, expectedCapabilities] of Object.entries(ROLE_CAPS)) {
      const res = await req(USER_BY_ROLE[roleName], "GET", "/api/me");
      expect(res.status, `${roleName} /me status`).toBe(200);
      const body = await res.json() as { capabilities: Capability[] };
      expect(
        [...body.capabilities].sort(),
        `${roleName} resolved capabilities`,
      ).toEqual([...expectedCapabilities].sort());
    }
  });

  // Route guards and role-to-capability resolution are orthogonal: every route
  // is exercised with one role that has its required capability and one that
  // does not, while the test above verifies the complete seeded role map.
  for (const route of ROUTES) {
    it(`enforces the capability required by ${route.name}`, async () => {
      const itemId = await makeItem("ingredient:Target:lbs");
      const roleHasRequiredCapability = ([, caps]: [string, Capability[]]) =>
        route.name === "GET /import-history"
          ? caps.includes("manage-profiles") || caps.includes("manage-inventory")
          : caps.includes(route.capability);
      const allowedRole =
        Object.entries(ROLE_CAPS).find(
          ([roleName, caps]) =>
            roleName !== "manager" &&
            roleHasRequiredCapability([roleName, caps]),
        )?.[0] ??
        Object.entries(ROLE_CAPS).find(roleHasRequiredCapability)?.[0];
      const deniedRole = Object.entries(ROLE_CAPS).find(([, caps]) =>
        route.name === "GET /import-history"
          ? !caps.includes("manage-profiles") && !caps.includes("manage-inventory")
          : !caps.includes(route.capability)
      )?.[0];
      if (!allowedRole || !deniedRole) {
        throw new Error(`Missing allow/deny role fixture for ${route.name}`);
      }

      const denied = await req(
        USER_BY_ROLE[deniedRole],
        route.method,
        route.path({ itemId }),
        route.body,
      );
      expect(denied.status, `${deniedRole} ${route.name} status`).toBe(403);

      const allowed = await req(
        USER_BY_ROLE[allowedRole],
        route.method,
        route.path({ itemId }),
        route.body,
      );
      expect(allowed.status, `${allowedRole} ${route.name} status`).toBe(
        route.okStatus,
      );
    });
  }
});

describe("manager action queue manual resolution", () => {
  it("keeps a resolved derived item out of the active queue after refresh", async () => {
    const incidentId = `coderabbit-resolution-${Date.now()}`;
    const dedupKey = `incident:${incidentId}`;
    await db.execute(sql`
      INSERT INTO incidents
        (id, source, screen, app_platform, context, status, priority, workflow_state)
      VALUES
        (${incidentId}, 'user_report', 'Run', 'web',
         '{"description":"Disposable action queue regression fixture"}'::jsonb,
         'new', 'high', 'new')
    `);

    try {
      const initialResponse = await req(
        MANAGER,
        "GET",
        "/api/manager-action-queue?category=incident&status=all",
      );
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json() as {
        items: Array<{ id: number; dedupKey: string; status: string; version: number }>;
      };
      const item = initial.items.find((candidate) => candidate.dedupKey === dedupKey);
      expect(item).toBeDefined();

      const resolvedResponse = await req(
        MANAGER,
        "PATCH",
        `/api/manager-action-queue/${item!.id}`,
        {
          status: "resolved",
          version: item!.version,
          resolutionNote: "Verified the incident is resolved.",
        },
      );
      expect(resolvedResponse.status).toBe(200);

      const refreshedResponse = await req(
        MANAGER,
        "GET",
        "/api/manager-action-queue?category=incident&status=all",
      );
      expect(refreshedResponse.status).toBe(200);
      const refreshed = await refreshedResponse.json() as {
        items: Array<{ id: number; dedupKey: string; status: string }>;
        counts: { resolved: number };
      };
      expect(
        refreshed.items.find((candidate) => candidate.id === item!.id)?.status,
      ).toBe("resolved");
      expect(refreshed.counts.resolved).toBeGreaterThanOrEqual(1);

      const audit = await db.execute<{ changes: Record<string, unknown> }>(sql`
        SELECT changes FROM audit_logs
        WHERE scope = 'live'
          AND resource = ${`action_item:${item!.id}`}
          AND action = 'manager_action_item_update'
        ORDER BY id DESC
        LIMIT 1
      `);
      expect(audit.rows[0]?.changes).toMatchObject({ status: "resolved" });
    } finally {
      await db.execute(sql`DELETE FROM action_items WHERE scope = 'live' AND dedup_key = ${dedupKey}`);
      await db.execute(sql`DELETE FROM incidents WHERE id = ${incidentId}`);
    }
  });
});

describe("import history idempotency", () => {
  it("rejects an audit write without an idempotency key", async () => {
    const response = await req(MANAGER, "POST", "/api/import-history", {
      importType: "spec", sourceLabel: "missing-key.xlsx", status: "complete", summary: {},
    });
    expect(response.status).toBe(400);
  });

  it("returns the original row when a manager retries the same audit operation", async () => {
    const body = {
      importType: "spec",
      sourceLabel: "timeout-retry.xlsx",
      status: "complete",
      summary: { counts: { parsed: 1 } },
      operationId: "import-history-timeout-retry-0001",
    };
    const first = await req(MANAGER, "POST", "/api/import-history", body);
    const second = await req(MANAGER, "POST", "/api/import-history", body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstPayload = await first.json() as { import: { id: number } };
    const secondPayload = await second.json() as { import: { id: number } };
    expect(firstPayload.import.id).toBe(secondPayload.import.id);
  });
});

describe("PUT /ingredients/:id/allergen-mapping endpoint behavior", () => {
  async function createIngredient(id: string, name: string): Promise<void> {
    const response = await req(MANAGER, "POST", "/api/ingredients", {
      items: [{ id, name, categories: ["dough"], enabled: true }],
    });
    expect(response.status).toBe(200);
  }

  it("keeps mappings readable to staff while restricting mapping writes to the approved capability", async () => {
    await createIngredient("allergen-flour", "Allergen Flour");

    const denied = await req(QC_OPERATOR, "PUT", "/api/ingredients/allergen-flour/allergen-mapping", {
      allergens: ["wheat"],
      reviewed: true,
    });
    expect(denied.status).toBe(403);
    const [unchanged] = await db
      .select()
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, "allergen-flour"));
    expect(unchanged).toMatchObject({ allergens: [], allergensReviewed: false });

    const accepted = await req(QC_MANAGER, "PUT", "/api/ingredients/allergen-flour/allergen-mapping", {
      allergens: ["wheat", "soy"],
      reviewed: true,
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      id: "allergen-flour",
      allergens: ["wheat", "soy"],
      allergensReviewed: true,
    });

    const visibleToOperator = await req(QC_OPERATOR, "GET", "/api/ingredients");
    expect(visibleToOperator.status).toBe(200);
    const { items } = await visibleToOperator.json() as {
      items: Array<{ id: string; allergens: string[]; allergensReviewed: boolean }>;
    };
    expect(items.find((item: { id: string }) => item.id === "allergen-flour")).toMatchObject({
      allergens: ["wheat", "soy"],
      allergensReviewed: true,
    });
  });

  it("preserves mappings during ordinary catalog saves and rejects invalid mappings without overwriting saved state", async () => {
    await createIngredient("allergen-oil", "Allergen Oil");
    const mappingUrl = "/api/ingredients/allergen-oil/allergen-mapping";
    const saved = await req(MANAGER, "PUT", mappingUrl, {
      allergens: ["soy"],
      reviewed: true,
    });
    expect(saved.status).toBe(200);

    const catalogSave = await req(MANAGER, "POST", "/api/ingredients", {
      items: [{ id: "allergen-oil", name: "Allergen Oil", categories: ["general"], enabled: true }],
    });
    expect(catalogSave.status).toBe(200);
    let [ingredient] = await db
      .select()
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, "allergen-oil"));
    expect(ingredient).toMatchObject({ allergens: ["soy"], allergensReviewed: true });

    const reviewedEmpty = await req(MANAGER, "PUT", mappingUrl, {
      allergens: [],
      reviewed: true,
    });
    expect(reviewedEmpty.status).toBe(200);

    const invalid = await req(MANAGER, "PUT", mappingUrl, {
      allergens: ["almond"],
      reviewed: true,
    });
    expect(invalid.status).toBe(400);
    [ingredient] = await db
      .select()
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, "allergen-oil"));
    expect(ingredient).toMatchObject({ allergens: [], allergensReviewed: true });
  });

  it("does not update an ingredient in another facility scope", async () => {
    await createIngredient("other-scope-ingredient", "Other Scope Ingredient");
    await db
      .update(ingredientsTable)
      .set({ scope: "other-facility" })
      .where(eq(ingredientsTable.id, "other-scope-ingredient"));

    const response = await req(MANAGER, "PUT", "/api/ingredients/other-scope-ingredient/allergen-mapping", {
      allergens: ["egg"],
      reviewed: true,
    });
    expect(response.status).toBe(404);
    const [ingredient] = await db
      .select()
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, "other-scope-ingredient"));
    expect(ingredient).toMatchObject({ allergens: [], allergensReviewed: false });
  });
});

describe("qc-manager allergen capability repair", () => {
  it("adds only the approved grant to existing roles and does not override later role edits", async () => {
    await db
      .update(rolesTable)
      .set({ capabilities: ["use-ai-tools", "review-incidents", "manage-inventory"] })
      .where(eq(rolesTable.name, "qc-manager"));
    await db
      .insert(dataHealsTable)
      .values({ id: "recipe-customer-metadata-cleanup-v1" })
      .onConflictDoNothing();

    const [{ qcManagerAllergenCapabilityRepair }, { runRegisteredRepair }] = await Promise.all([
      import("../lib/repairs/qcManagerAllergenCapabilityRepair"),
      import("../lib/repairRegistry"),
    ]);
    const applied = await runRegisteredRepair(qcManagerAllergenCapabilityRepair, db);
    expect(applied).toMatchObject({ id: "qc-manager-allergen-capability-v1", status: "applied" });
    let [role] = await db.select().from(rolesTable).where(eq(rolesTable.name, "qc-manager"));
    expect(role).toBeDefined();
    const addedCapabilities = role!.capabilities;
    expect(addedCapabilities).toEqual([
      "use-ai-tools",
      "review-incidents",
      "manage-inventory",
      "manage-allergens",
    ]);

    await db
      .update(rolesTable)
      .set({ capabilities: addedCapabilities.filter((capability) => capability !== "manage-allergens") })
      .where(eq(rolesTable.name, "qc-manager"));
    const repeated = await runRegisteredRepair(qcManagerAllergenCapabilityRepair, db);
    expect(repeated).toMatchObject({ id: "qc-manager-allergen-capability-v1", status: "skipped" });
    [role] = await db.select().from(rolesTable).where(eq(rolesTable.name, "qc-manager"));
    expect(role!.capabilities).toEqual(["use-ai-tools", "review-incidents", "manage-inventory"]);
  });
});

describe("QC first release capability repair", () => {
  it("adds only QC grants to existing built-in roles and leaves unrelated grants intact", async () => {
    await db.update(rolesTable).set({ capabilities: ["use-ai-tools", "review-incidents"] })
      .where(eq(rolesTable.name, "qc-operator"));
    await db.update(rolesTable).set({ capabilities: ["use-ai-tools", "manage-inventory"] })
      .where(eq(rolesTable.name, "qc-manager"));
    const [{ qcFirstReleaseCapabilitiesRepair }, { runRegisteredRepair }] = await Promise.all([
      import("../lib/repairs/qcFirstReleaseCapabilitiesRepair"),
      import("../lib/repairRegistry"),
    ]);
    const applied = await runRegisteredRepair(qcFirstReleaseCapabilitiesRepair, db);
    expect(applied).toMatchObject({ id: "qc-first-release-capabilities-v1", status: "applied" });
    const [operatorRole] = await db.select().from(rolesTable).where(eq(rolesTable.name, "qc-operator"));
    const [managerRole] = await db.select().from(rolesTable).where(eq(rolesTable.name, "qc-manager"));
    expect(operatorRole.capabilities).toEqual(["use-ai-tools", "review-incidents", "record-qc"]);
    expect(managerRole.capabilities).toEqual(["use-ai-tools", "manage-inventory", "record-qc", "manage-qc"]);
  });
});

describe("POST /ingredients/merge endpoint behavior", () => {
  it("reuses an active identity on repeat import and adds categories", async () => {
    const first = await req(MANAGER, "POST", "/api/ingredients", {
      items: [{
        id: "ingredient-first",
        name: "  Mozzarella  ",
        categories: ["cheese"],
        enabled: true,
      }],
    });
    expect(first.status).toBe(200);

    const second = await req(MANAGER, "POST", "/api/ingredients", {
      items: [{
        id: "ingredient-from-repeat-import",
        name: "mozzarella",
        categories: ["mix"],
        enabled: true,
      }],
    });
    expect(second.status).toBe(200);

    const body = (await second.json()) as {
      items: Array<{ id: string; name: string; categories: string[]; enabled: boolean }>;
    };
    expect(body.items.filter((item) => item.enabled && item.name.toLowerCase() === "mozzarella")).toEqual([
      {
        id: "ingredient-first",
        name: "Mozzarella",
        categories: ["cheese", "mix"],
        mergedInto: null,
        enabled: true,
        allergens: [],
        allergensReviewed: false,
      },
    ]);
  });

  it("lets a manager merge ingredients while preserving both category sets", async () => {
    await db.insert(ingredientsTable).values([
      {
        id: "ingredient-target",
        scope: "live",
        name: "Established Flour",
        categories: ["dough", "general"],
        enabled: true,
      },
      {
        id: "ingredient-source",
        scope: "live",
        name: "Legacy Flour",
        categories: ["mix", "pep"],
        enabled: true,
      },
    ]);

    const res = await req(MANAGER, "POST", "/api/ingredients/merge", {
      targetId: "ingredient-target",
      sourceIds: ["ingredient-source"],
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      items: Array<{
        id: string;
        categories: string[];
        mergedInto: string | null;
        enabled: boolean;
      }>;
    };
    const target = body.items.find((item) => item.id === "ingredient-target");
    const source = body.items.find((item) => item.id === "ingredient-source");
    expect(target?.categories).toEqual(["dough", "general", "mix", "pep"]);
    expect(source).toMatchObject({
      mergedInto: "ingredient-target",
      enabled: false,
    });

    const [storedTarget] = await db
      .select()
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, "ingredient-target"));
    const [storedSource] = await db
      .select()
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, "ingredient-source"));
    expect(storedTarget.categories).toEqual(["dough", "general", "mix", "pep"]);
    expect(storedSource.mergedInto).toBe("ingredient-target");
    expect(storedSource.enabled).toBe(false);
  });

  it("moves a one-sided learned weight from a merged source to the target", async () => {
    await db.insert(ingredientsTable).values([
      {
        id: "ingredient-weight-target",
        scope: "live",
        name: "Canonical Flour",
        categories: ["dough"],
        enabled: true,
      },
      {
        id: "ingredient-weight-source",
        scope: "live",
        name: "Legacy Flour",
        categories: ["dough"],
        enabled: true,
      },
    ]);
    await db.insert(ingredientBatchWeightsTable).values({
      scope: "live",
      name: "legacy flour",
      lbs: 18,
    });

    const res = await req(MANAGER, "POST", "/api/ingredients/merge", {
      targetId: "ingredient-weight-target",
      sourceIds: ["ingredient-weight-source"],
    });
    expect(res.status).toBe(200);

    const weights = await db
      .select()
      .from(ingredientBatchWeightsTable);
    expect(weights.map(({ name, lbs }) => ({ name, lbs }))).toEqual([
      { name: "Canonical Flour", lbs: 18 },
    ]);
  });

  it("keeps the target weight when source and target weights conflict", async () => {
    await db.insert(ingredientsTable).values([
      {
        id: "ingredient-conflict-target",
        scope: "live",
        name: "Canonical Flour",
        categories: ["dough"],
        enabled: true,
      },
      {
        id: "ingredient-conflict-source",
        scope: "live",
        name: "Legacy Flour",
        categories: ["dough"],
        enabled: true,
      },
    ]);
    await db.insert(ingredientBatchWeightsTable).values([
      { scope: "live", name: "Canonical Flour", lbs: 22 },
      { scope: "live", name: "Legacy Flour", lbs: 18 },
    ]);

    const res = await req(MANAGER, "POST", "/api/ingredients/merge", {
      targetId: "ingredient-conflict-target",
      sourceIds: ["ingredient-conflict-source"],
    });
    expect(res.status).toBe(200);

    const weights = await db
      .select()
      .from(ingredientBatchWeightsTable);
    expect(weights.map(({ name, lbs }) => ({ name, lbs }))).toEqual([
      { name: "Canonical Flour", lbs: 22 },
    ]);
  });

  it("collapses case-variant learned rows and keeps the newest target row", async () => {
    await db.insert(ingredientsTable).values([
      {
        id: "ingredient-case-target",
        scope: "live",
        name: "Canonical Flour",
        categories: ["dough"],
        enabled: true,
      },
      {
        id: "ingredient-case-source",
        scope: "live",
        name: "Legacy Flour",
        categories: ["dough"],
        enabled: true,
      },
    ]);
    const [oldTarget] = await db
      .insert(ingredientBatchWeightsTable)
      .values({ scope: "live", name: "canonical flour", lbs: 14 })
      .returning();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [newTarget] = await db
      .insert(ingredientBatchWeightsTable)
      .values({ scope: "live", name: "CANONICAL FLOUR", lbs: 21 })
      .returning();
    await db.insert(ingredientBatchWeightsTable).values({
      scope: "live",
      name: "legacy flour",
      lbs: 19,
    });

    const res = await req(MANAGER, "POST", "/api/ingredients/merge", {
      targetId: "ingredient-case-target",
      sourceIds: ["ingredient-case-source"],
    });
    expect(res.status).toBe(200);

    const weights = await db
      .select()
      .from(ingredientBatchWeightsTable);
    expect(weights).toHaveLength(1);
    expect(weights[0]).toMatchObject({
      id: newTarget.id,
      name: "Canonical Flour",
      lbs: 21,
    });
    expect(oldTarget.id).not.toBe(weights[0].id);
  });

  it("repoints a learned weight when a catalog ingredient is renamed", async () => {
    await db.insert(ingredientsTable).values({
      id: "ingredient-rename",
      scope: "live",
      name: "Legacy Flour",
      categories: ["dough"],
      enabled: true,
    });
    await db.insert(ingredientBatchWeightsTable).values({
      scope: "live",
      name: "legacy flour",
      lbs: 18,
    });

    const res = await req(MANAGER, "POST", "/api/ingredients", {
      items: [{
        id: "ingredient-rename",
        name: "Canonical Flour",
        categories: ["dough"],
        enabled: true,
      }],
    });
    expect(res.status).toBe(200);

    const weights = await db
      .select()
      .from(ingredientBatchWeightsTable);
    expect(weights.map(({ name, lbs }) => ({ name, lbs }))).toEqual([
      { name: "Canonical Flour", lbs: 18 },
    ]);
  });

  it("flattens chained merges while retaining categories from every predecessor", async () => {
    await db.insert(ingredientsTable).values([
      {
        id: "ingredient-final-target",
        scope: "live",
        name: "Established Flour",
        categories: ["dough"],
        enabled: true,
      },
      {
        id: "ingredient-previous-target",
        scope: "live",
        name: "Previous Flour",
        categories: ["mix"],
        mergedInto: "ingredient-final-target",
        enabled: false,
      },
      {
        id: "ingredient-previous-source",
        scope: "live",
        name: "Legacy Flour",
        categories: ["pep"],
        mergedInto: "ingredient-previous-target",
        enabled: false,
      },
      {
        id: "ingredient-new-source",
        scope: "live",
        name: "New Legacy Flour",
        categories: ["cheese"],
        enabled: true,
      },
    ]);

    const res = await req(MANAGER, "POST", "/api/ingredients/merge", {
      targetId: "ingredient-previous-source",
      sourceIds: ["ingredient-new-source"],
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      items: Array<{
        id: string;
        categories: string[];
        mergedInto: string | null;
        enabled: boolean;
      }>;
    };
    const items = new Map(body.items.map((item) => [item.id, item]));
    expect(items.get("ingredient-final-target")?.categories).toEqual([
      "dough",
      "mix",
      "pep",
      "cheese",
    ]);
    expect(items.get("ingredient-previous-target")).toMatchObject({
      mergedInto: "ingredient-final-target",
      enabled: false,
    });
    expect(items.get("ingredient-previous-source")).toMatchObject({
      mergedInto: "ingredient-final-target",
      enabled: false,
    });
    expect(items.get("ingredient-new-source")).toMatchObject({
      mergedInto: "ingredient-final-target",
      enabled: false,
    });
  });

  it("rejects an ingredient merge from a user without manage-inventory", async () => {
    await db.insert(ingredientsTable).values([
      {
        id: "ingredient-target",
        scope: "live",
        name: "Established Flour",
        categories: ["dough"],
        enabled: true,
      },
      {
        id: "ingredient-source",
        scope: "live",
        name: "Legacy Flour",
        categories: ["mix"],
        enabled: true,
      },
    ]);

    const res = await req(OPERATOR, "POST", "/api/ingredients/merge", {
      targetId: "ingredient-target",
      sourceIds: ["ingredient-source"],
    });
    expect(res.status).toBe(403);

    const [source] = await db
      .select()
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, "ingredient-source"));
    expect(source.mergedInto).toBeNull();
    expect(source.enabled).toBe(true);
  });
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

// Mix config writes are manager-gated (covered in GATED_ROUTES), but the LIST is
// intentionally readable by any signed-in user so both apps can build the mix
// make-day plan for floor staff. These lock that read policy: no token → 401,
// but a capability-less operator → 200.
describe("GET /mixes read policy", () => {
  it("rejects an unauthenticated read with 401", async () => {
    const res = await req(null, "GET", "/api/mixes");
    expect(res.status).toBe(401);
  });

  it("allows a capability-less operator to read (→ 200)", async () => {
    const res = await req(OPERATOR, "GET", "/api/mixes");
    expect(res.status).toBe(200);
  });
});

// Cycle-count schedule config writes are manager-gated (covered in GATED_ROUTES),
// but the LIST is intentionally readable by any signed-in user so the warehouse
// "Time to Count" card renders for floor staff. These lock that read policy:
// no token → 401, but a capability-less operator → 200.
describe("GET /cycle-count-schedules read policy", () => {
  it("rejects an unauthenticated read with 401", async () => {
    const res = await req(null, "GET", "/api/cycle-count-schedules");
    expect(res.status).toBe(401);
  });

  it("allows a capability-less operator to read (→ 200)", async () => {
    const res = await req(OPERATOR, "GET", "/api/cycle-count-schedules");
    expect(res.status).toBe(200);
  });
});

// Marking a section counted is intentionally NOT manager-gated — floor staff
// perform the counts — but it still requires a signed-in user. These lock that
// policy: no token → 401; a capability-less operator is allowed past the gate
// (an unknown id → 404, proving auth passed but no manager capability is
// required).
describe("POST /cycle-count-schedules/:id/mark-counted policy", () => {
  it("rejects an unauthenticated mark-counted with 401", async () => {
    const res = await req(
      null,
      "POST",
      "/api/cycle-count-schedules/nope/mark-counted",
    );
    expect(res.status).toBe(401);
  });

  it("allows a capability-less operator past the gate (unknown id → 404)", async () => {
    const res = await req(
      OPERATOR,
      "POST",
      "/api/cycle-count-schedules/nope/mark-counted",
    );
    expect(res.status).toBe(404);
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

describe("staff security actions are visible in the Audit Log", () => {
  it("records successful role grant/revoke and reset approval, but not rejected mutations", async () => {
    const grant = await req(MANAGER, "PUT", `/api/users/${OPERATOR}/role`, {
      role: "warehouse",
    });
    expect(grant.status).toBe(200);

    const revoke = await req(MANAGER, "PUT", `/api/users/${OPERATOR}/role`, {
      role: "operator",
    });
    expect(revoke.status).toBe(200);

    const resetRequestId = "audit-log-reset-request";
    await db.insert(passwordResetRequestsTable).values({
      id: resetRequestId,
      userId: OPERATOR,
      status: "pending",
    });
    const approval = await req(
      MANAGER,
      "POST",
      `/api/password-reset-requests/${resetRequestId}/approve`,
    );
    expect(approval.status).toBe(200);

    // An unauthorized role mutation must not produce an audit event.
    const rejected = await req(OPERATOR, "PUT", `/api/users/${WAREHOUSE}/role`, {
      role: "supervisor",
    });
    expect(rejected.status).toBe(403);

    // The routes intentionally use fire-and-forget audit writes. Poll the
    // manager-visible endpoint rather than relying on a timing-sensitive sleep.
    let result = await auditLogs();
    for (let attempt = 0; attempt < 20 && result.count < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      result = await auditLogs();
    }

    expect(result.count).toBe(3);
    expect(result.logs).toHaveLength(3);

    const grantLog = result.logs.find((log) => log.action === "role_granted");
    expect(grantLog).toMatchObject({
      actor: "manager-1",
      action: "role_granted",
      resource: "user:operator-1",
      changes: {
        outcome: "success",
        targetId: "operator-1",
      },
    });

    const revokeLog = result.logs.find((log) => log.action === "role_revoked");
    expect(revokeLog).toMatchObject({
      actor: "manager-1",
      action: "role_revoked",
      resource: "user:operator-1",
      changes: {
        outcome: "success",
        targetId: "operator-1",
      },
    });

    const approvalLog = result.logs.find(
      (log) => log.action === "password_reset_approved",
    );
    expect(approvalLog).toMatchObject({
      actor: "manager-1",
      action: "password_reset_approved",
      resource: `reset_request:${resetRequestId}`,
      changes: {
        requestId: resetRequestId,
      },
    });
  });
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

  it("forbids the junior-admin resetting a higher-privileged manager's password (403)", async () => {
    // manage-staff alone must not be a manager-takeover primitive: the
    // manager holds capabilities (e.g. approve-password-resets) the
    // junior-admin does not, so this reset must be rejected.
    const res = await req(OPERATOR, "PUT", `/api/users/${MANAGER}/password`, {
      newPassword: "attacker-chosen-secret",
    });
    expect(res.status).toBe(403);

    // The manager's password is unchanged.
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${MANAGER}`);
    expect(verifyPassword("attacker-chosen-secret", row.passwordHash)).toBe(false);
  });

  it("allows the junior-admin resetting a peer/lower-privileged account's password (204)", async () => {
    // manage-staff is the only capability the operator role carries, so a
    // junior-admin (also manage-staff-only) resetting a plain operator's
    // password should still work — the boundary is about privilege, not
    // about staff administration itself.
    const res = await req(OPERATOR, "PUT", `/api/users/${WAREHOUSE}/password`, {
      newPassword: "fresh-and-valid",
    });
    expect(res.status).toBe(204);
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

  it("serializes concurrent final-manager disable attempts", async () => {
    await db.insert(usersTable).values({
      id: "manager-race-2",
      username: "manager-race-2",
      passwordHash: "x",
    });
    await db.insert(userRolesTable).values({ userId: "manager-race-2", role: "manager" });

    // Equal-privilege targets remain protected, even when requests arrive at
    // the same time. The target must not be left disabled by either request.
    const responses = await Promise.all([
      req(MANAGER, "PATCH", `/api/users/manager-race-2/status`, { disabled: true }),
      req("manager-race-2", "PATCH", `/api/users/${MANAGER}/status`, { disabled: true }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([403, 403]);
    const rows = await db.select({ id: usersTable.id, disabled: usersTable.disabled })
      .from(usersTable);
    const relevant = rows.filter((row) => row.id === MANAGER || row.id === "manager-race-2");
    expect(relevant).toHaveLength(2);
    expect(relevant.every((row) => row.disabled === false)).toBe(true);
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
      accessCode: process.env.STAFF_SIGNUP_CODE,
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
      accessCode: process.env.STAFF_SIGNUP_CODE,
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
      accessCode: process.env.STAFF_SIGNUP_CODE,
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
      accessCode: process.env.STAFF_SIGNUP_CODE,
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
      accessCode: process.env.STAFF_SIGNUP_CODE,
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
      accessCode: process.env.STAFF_SIGNUP_CODE,
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
      accessCode: process.env.STAFF_SIGNUP_CODE,
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
      accessCode: process.env.STAFF_SIGNUP_CODE,
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

describe("per-user Floor Mode preference", () => {
  // Floor Mode's on/off setting is a per-user account preference (not
  // device-local) so it follows the user across devices. Unlike the one-way
  // onboarding/tour flags it is settable in both directions via
  // POST /me/floor-mode. Users are seeded directly (not via /auth/sign-up) so
  // these tests don't eat into the shared public-auth rate-limit budget the
  // sign-up gate tests below depend on.
  it("a freshly created user defaults to floorModeEnabled=false (DB default + /me shape)", async () => {
    // The seeded OPERATOR row never set the column, so it exercises the same
    // DB-level default a real sign-up insert gets.
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${OPERATOR}`);
    expect(row.floorModeEnabled).toBe(false);

    const me = await req(OPERATOR, "GET", "/api/me");
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { floorModeEnabled: boolean };
    expect(meBody.floorModeEnabled).toBe(false);
  });

  it("POST /me/floor-mode persists off AND back on (settable both directions)", async () => {
    const off = await req(OPERATOR, "POST", "/api/me/floor-mode", {
      enabled: false,
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { floorModeEnabled: boolean }).floorModeEnabled).toBe(false);

    // A fresh /me read (what another device would do) reflects the change.
    const meOff = await req(OPERATOR, "GET", "/api/me");
    expect(((await meOff.json()) as { floorModeEnabled: boolean }).floorModeEnabled).toBe(false);
    const [rowOff] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${OPERATOR}`);
    expect(rowOff.floorModeEnabled).toBe(false);

    const on = await req(OPERATOR, "POST", "/api/me/floor-mode", {
      enabled: true,
    });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { floorModeEnabled: boolean }).floorModeEnabled).toBe(true);
    const [rowOn] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${OPERATOR}`);
    expect(rowOn.floorModeEnabled).toBe(true);
  });

  it("rejects a malformed body with 400 and leaves the preference unchanged", async () => {
    const bad = await req(OPERATOR, "POST", "/api/me/floor-mode", {
      enabled: "nope",
    });
    expect(bad.status).toBe(400);
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${OPERATOR}`);
    expect(row.floorModeEnabled).toBe(false);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await req(null, "POST", "/api/me/floor-mode", { enabled: true });
    expect(res.status).toBe(401);
  });
});

describe("per-user notification preferences", () => {
  // Per-alert push toggles are stored on the account (users.notificationPrefs
  // jsonb) so they follow the user across devices, like Floor Mode. A MISSING
  // key means the alert is ON; POST /me/notification-prefs MERGES the supplied
  // partial map (never replaces) and silently drops unknown alert kinds.
  it("a freshly created user defaults to {} (all alerts on)", async () => {
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${OPERATOR}`);
    expect(row.notificationPrefs).toEqual({});

    const me = await req(OPERATOR, "GET", "/api/me");
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { notificationPrefs: Record<string, boolean> };
    expect(meBody.notificationPrefs).toEqual({});
  });

  it("merges partial updates (never replaces) and drops unknown keys", async () => {
    const first = await req(OPERATOR, "POST", "/api/me/notification-prefs", {
      prefs: { batchDue: false, evilKey: true },
    });
    expect(first.status).toBe(200);
    expect(
      ((await first.json()) as { notificationPrefs: Record<string, boolean> }).notificationPrefs,
    ).toEqual({ batchDue: false });

    // A later single-toggle update from another device must not clobber the
    // earlier choice — merge, not replace.
    const second = await req(OPERATOR, "POST", "/api/me/notification-prefs", {
      prefs: { fifteenMin: false },
    });
    expect(second.status).toBe(200);
    expect(
      ((await second.json()) as { notificationPrefs: Record<string, boolean> }).notificationPrefs,
    ).toEqual({ batchDue: false, fifteenMin: false });

    // Settable back on; the explicit true is stored (harmless — missing and
    // true both mean enabled) and the OTHER key still survives.
    const backOn = await req(OPERATOR, "POST", "/api/me/notification-prefs", {
      prefs: { batchDue: true },
    });
    expect(backOn.status).toBe(200);
    const [row] = await db
      .select()
      .from(usersTable)
      .where(sql`${usersTable.id} = ${OPERATOR}`);
    expect(row.notificationPrefs).toEqual({ batchDue: true, fifteenMin: false });
  });

  it("rejects a malformed body with 400 and unauthenticated with 401", async () => {
    const bad = await req(OPERATOR, "POST", "/api/me/notification-prefs", {
      prefs: { batchDue: "nope" },
    });
    expect(bad.status).toBe(400);
    const anon = await req(null, "POST", "/api/me/notification-prefs", {
      prefs: { batchDue: false },
    });
    expect(anon.status).toBe(401);
  });

  it("server allow-list stays in lockstep with the web client's alert kinds", async () => {
    // NOTIFICATION_PREF_KEYS (server) and NOTIFICATION_KINDS (web settings
    // panel) must agree or a toggle in the UI would be silently dropped by the
    // server. The web module is pure TS with no app deps, so import it
    // directly for a cross-layer parity guard.
    const { NOTIFICATION_PREF_KEYS } = await import("../lib/roles");
    // The specifier is computed at runtime ON PURPOSE: a literal path here
    // makes tsc pull the web file into the api-server program and fail the
    // typecheck with TS6059 (file not under rootDir). Vitest still transforms
    // and resolves the absolute-path dynamic import, so the parity guard
    // keeps working.
    const nodePath = await import("node:path");
    const webModPath: string = nodePath.resolve(
      __dirname,
      "../../../run-calculator/src/notificationPrefs.ts",
    );
    const webMod = await import(webModPath);
    const webKinds = webMod.NOTIFICATION_KINDS.map((k: { kind: string }) => k.kind);
    expect([...NOTIFICATION_PREF_KEYS].sort()).toEqual([...webKinds].sort());
  });
});

describe("bootstrap manager assignment (INITIAL_MANAGER_USERNAME)", () => {
  // STAFF_SIGNUP_CODE is a shared onboarding secret handed to every ordinary
  // new hire, so it must never be sufficient on its own to become the first
  // manager on a fresh deployment — anyone who has it (or leaks/reuses it)
  // could otherwise race to sign up first and seize full admin control.
  // INITIAL_MANAGER_USERNAME is the separate, narrower secret that actually
  // decides who becomes the bootstrap manager.
  const ORIGINAL_CODE = process.env.STAFF_SIGNUP_CODE;
  const ORIGINAL_INITIAL_MANAGER = process.env.INITIAL_MANAGER_USERNAME;
  const ORIGINAL_INITIAL_MANAGER_CODE = process.env.INITIAL_MANAGER_ACCESS_CODE;
  const BOOTSTRAP_CODE = "super-secret-bootstrap-code-not-the-staff-code";

  beforeEach(async () => {
    // Start from a truly empty roster (the outer beforeEach above already
    // seeded MANAGER/OPERATOR/etc.) so these tests exercise the real
    // "first user on a fresh database" bootstrap path.
    await db.execute(
      sql`TRUNCATE ${userRolesTable}, ${usersTable} RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(() => {
    process.env.STAFF_SIGNUP_CODE = ORIGINAL_CODE;
    process.env.INITIAL_MANAGER_USERNAME = ORIGINAL_INITIAL_MANAGER;
    process.env.INITIAL_MANAGER_ACCESS_CODE = ORIGINAL_INITIAL_MANAGER_CODE;
  });

  it("does NOT grant manager to the first sign-up when INITIAL_MANAGER_USERNAME/CODE are unset (fails closed)", async () => {
    delete process.env.INITIAL_MANAGER_USERNAME;
    delete process.env.INITIAL_MANAGER_ACCESS_CODE;
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "sneaky-first-user",
      password: "first-password",
      accessCode: ORIGINAL_CODE,
    });
    expect(res.status).toBe(201);
    const [row] = await db.select({ role: userRolesTable.role }).from(userRolesTable);
    expect(row?.role).toBe("operator");
  });

  it("does NOT grant manager to the first sign-up when the username doesn't match INITIAL_MANAGER_USERNAME (even with the right code)", async () => {
    process.env.INITIAL_MANAGER_USERNAME = "real-admin";
    process.env.INITIAL_MANAGER_ACCESS_CODE = BOOTSTRAP_CODE;
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "attacker",
      password: "first-password",
      accessCode: BOOTSTRAP_CODE,
    });
    expect(res.status).toBe(201);
    const [row] = await db.select({ role: userRolesTable.role }).from(userRolesTable);
    expect(row?.role).toBe("operator");
  });

  it("does NOT grant manager to the first sign-up when the username matches but only the shared staff code is supplied", async () => {
    // This is the exact escalation the reviewer flagged: knowing (or guessing)
    // the intended admin's username plus the ordinary, widely-shared staff
    // sign-up code must NOT be enough on its own.
    process.env.INITIAL_MANAGER_USERNAME = "real-admin";
    process.env.INITIAL_MANAGER_ACCESS_CODE = BOOTSTRAP_CODE;
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "real-admin",
      password: "first-password",
      accessCode: ORIGINAL_CODE,
    });
    expect(res.status).toBe(201);
    const [row] = await db.select({ role: userRolesTable.role }).from(userRolesTable);
    expect(row?.role).toBe("operator");
  });

  it("grants manager to the first sign-up when BOTH the username matches INITIAL_MANAGER_USERNAME (case-insensitive) and the access code matches INITIAL_MANAGER_ACCESS_CODE", async () => {
    process.env.INITIAL_MANAGER_USERNAME = "Real-Admin";
    process.env.INITIAL_MANAGER_ACCESS_CODE = BOOTSTRAP_CODE;
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "real-admin",
      password: "first-password",
      accessCode: BOOTSTRAP_CODE,
    });
    expect(res.status).toBe(201);
    const [row] = await db.select({ role: userRolesTable.role }).from(userRolesTable);
    expect(row?.role).toBe("manager");
  });

  it("does not grant manager to a SECOND sign-up even if it matches INITIAL_MANAGER_USERNAME/CODE (one bootstrap winner)", async () => {
    process.env.INITIAL_MANAGER_USERNAME = "real-admin";
    process.env.INITIAL_MANAGER_ACCESS_CODE = BOOTSTRAP_CODE;
    const first = await req(null, "POST", "/api/auth/sign-up", {
      username: "real-admin",
      password: "first-password",
      accessCode: BOOTSTRAP_CODE,
    });
    expect(first.status).toBe(201);

    const second = await req(null, "POST", "/api/auth/sign-up", {
      username: "real-admin-2",
      password: "first-password",
      accessCode: BOOTSTRAP_CODE,
    });
    expect(second.status).toBe(201);
    const rows = await db
      .select({ role: userRolesTable.role })
      .from(userRolesTable)
      .orderBy(userRolesTable.userId);
    const managerCount = rows.filter((r) => r.role === "manager").length;
    expect(managerCount).toBe(1);
  });
});

describe("sign-up access code gate", () => {
  // Public self-registration must require the shared facility access code
  // (STAFF_SIGNUP_CODE) or it exposes internal factory data to anyone who
  // finds the endpoint. These tests exercise the enforcement directly rather
  // than relying on the other describe blocks' happy-path usage of the code.
  const ORIGINAL_CODE = process.env.STAFF_SIGNUP_CODE;

  afterAll(() => {
    process.env.STAFF_SIGNUP_CODE = ORIGINAL_CODE;
  });

  it("rejects sign-up with a missing access code (→ 400, schema requires it)", async () => {
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "no-code-user",
      password: "first-password",
    });
    expect(res.status).toBe(400);
  });

  it("rejects sign-up with a wrong access code (→ 403)", async () => {
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "wrong-code-user",
      password: "first-password",
      accessCode: "definitely-not-the-code",
    });
    expect(res.status).toBe(403);
  });

  it("accepts sign-up with the correct access code (→ 201)", async () => {
    const res = await req(null, "POST", "/api/auth/sign-up", {
      username: "right-code-user",
      password: "first-password",
      accessCode: ORIGINAL_CODE,
    });
    expect(res.status).toBe(201);
  });

  it("fails closed (rejects every non-empty code) when STAFF_SIGNUP_CODE is unset", async () => {
    delete process.env.STAFF_SIGNUP_CODE;
    try {
      const withSomeCode = await req(null, "POST", "/api/auth/sign-up", {
        username: "unset-code-user",
        password: "first-password",
        accessCode: "anything",
      });
      expect(withSomeCode.status).toBe(403);

      // Even the *previously correct* code must not work once the operator
      // has unconfigured the secret.
      const withOldCode = await req(null, "POST", "/api/auth/sign-up", {
        username: "unset-code-user-2",
        password: "first-password",
        accessCode: ORIGINAL_CODE,
      });
      expect(withOldCode.status).toBe(403);
    } finally {
      process.env.STAFF_SIGNUP_CODE = ORIGINAL_CODE;
    }
  });
});

describe("public auth endpoints are rate-limited", () => {
  // Public, unauthenticated endpoints are the only foothold for brute force /
  // credential stuffing, so they carry a shared per-IP cap (see authRateLimit
  // in routes/auth.ts). This drives the cap past its limit on the cheapest
  // public route (a read-only availability check) and confirms it 429s.
  it("returns 429 once the per-IP auth rate limit is exceeded", async () => {
    let lastStatus = 0;
    // The cap is generous (20/60s) so real users retyping a password never
    // trip it; comfortably exceed it here to observe the 429.
    for (let i = 0; i < 60; i++) {
      const res = await req(
        null,
        "GET",
        `/api/auth/username-available?username=rate-limit-probe-${i}`,
      );
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
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

const QC_PROFILE_KEY = "qc-brand__qc-flavor";

async function seedQcWorkflowFixtures(): Promise<void> {
  await db.insert(ingredientsTable).values([
    { id: "qc-mozzarella", scope: "live", name: "Mozzarella", categories: ["cheese"] },
    { id: "qc-dough", scope: "live", name: "Dough", categories: ["dough"] },
    { id: "qc-sauce", scope: "live", name: "Sauce", categories: ["general"] },
    { id: "qc-crust", scope: "live", name: "Crust", categories: ["dough"] },
    { id: "qc-mozzarella", scope: "sandbox", name: "Mozzarella", categories: ["cheese"] },
  ]);
  await db.insert(brandProfilesTable).values([
    {
      key: QC_PROFILE_KEY, scope: "live", brand: "QC Brand", flavor: "QC Flavor",
      values: {
        app1Type: "cheese", app1CheeseRecipeName: "Mozzarella", app1OzPerPizza: 1.25,
        frontlineRecipeName: "Sauce", sauceOzPerPizza: 2.75,
        doughRecipeName: "Dough", targetDoughballWeight: 12, crustType: "Crust",
      },
      crustValues: { crustTargetWeight: 8 },
    },
    {
      key: QC_PROFILE_KEY, scope: "sandbox", brand: "QC Brand", flavor: "QC Flavor",
      values: { app1Type: "Mozzarella", app1OzPerPizza: 2.5 },
    },
  ]);
}

async function seedQcLabelRun(runIds: string | string[], missingIdentity: string[] = []): Promise<void> {
  const date = facilityDate();
  const ids = Array.isArray(runIds) ? runIds : [runIds];
  await db.insert(dailySyncTable).values({
    scope: "live",
    date,
    canonicalRevision: 1,
    data: {
      dayState: { date, runs: ids.map((id) => missingIdentity.includes(id) ? { id, flavor: id } : { id, brand: "Synthetic QC", flavor: id }) },
      runValues: Object.fromEntries(ids.map((id) => [id, {}])),
    },
  });
}

describe("QC workflows", () => {
  it("never evaluates an approved label reference for another product or an unknown canonical product", async () => {
    const matchingRun = "label-product-a";
    const otherRun = "label-product-b";
    const unknownRun = "label-product-unknown";
    await seedQcLabelRun([matchingRun, otherRun, unknownRun], [unknownRun]);
    const observed = { productName: "SYNTHETIC PRODUCT A", lotText: "LOT-A", dateText: "printed date" };
    const reference = await req(QC_MANAGER, "POST", "/api/qc/label-references", {
      operationId: randomUUID(), context: "shipper-case",
      productKey: `synthetic qc__${matchingRun}`,
      expected: observed, requiredFields: ["productName", "lotText", "dateText"],
      sourceIdentity: "SYNTHETIC-PRODUCT-BINDING", sourceDescription: "Fixture source for product A only.",
    });
    expect(reference.status).toBe(201);
    const referenceEvent = (await reference.json() as { event: { id: number; payload: { referenceId: string } } }).event;
    expect((await req(QC_MANAGER, "POST", `/api/qc/label-references/${referenceEvent.id}/review`, {
      operationId: randomUUID(), decision: "approved", reason: "Synthetic applicability fixture.",
    })).status).toBe(201);
    const unknownReference = await req(QC_MANAGER, "POST", "/api/qc/label-references", {
      operationId: randomUUID(), context: "shipper-case", productKey: `__${unknownRun}`,
      expected: observed, requiredFields: ["productName", "lotText", "dateText"],
      sourceIdentity: "SYNTHETIC-INCOMPLETE-IDENTITY", sourceDescription: "Even an exact partial-key match cannot establish applicability.",
    });
    expect(unknownReference.status).toBe(201);
    const unknownReferenceEvent = (await unknownReference.json() as { event: { id: number; payload: { referenceId: string } } }).event;
    expect((await req(QC_MANAGER, "POST", `/api/qc/label-references/${unknownReferenceEvent.id}/review`, {
      operationId: randomUUID(), decision: "approved", reason: "Synthetic incomplete identity fixture.",
    })).status).toBe(201);
    for (const runId of [matchingRun, otherRun, unknownRun]) {
      const response = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
        operationId: randomUUID(), runId, context: "shipper-case",
        referenceId: runId === unknownRun ? unknownReferenceEvent.payload.referenceId : referenceEvent.payload.referenceId, observed,
      });
      expect(response.status).toBe(201);
      const payload = (await response.json() as { event: { payload: Record<string, any> } }).event.payload;
      expect(payload.outcome).toBe(runId === matchingRun ? "pass" : "not-evaluated");
      expect(payload.runProductKey).toBe(runId === unknownRun ? null : `synthetic qc__${runId}`);
      if (runId !== matchingRun) {
        expect(payload.referenceSnapshot.state).toBe("inapplicable");
        expect(Object.values(payload.fieldResults).every((field: any) => field.state === "not-evaluated" && field.expected === null)).toBe(true);
        expect(payload.referenceUnavailableReason).toMatch(/different product|identity is incomplete/);
      }
    }
  });

  it("keeps label comparisons server-resolved, approved, versioned, and idempotent", async () => {
    const runId = "qc-label-authority-run";
    await seedQcLabelRun(runId);
    const draftInput = {
      operationId: randomUUID(),
      context: "shipper-case",
      productKey: `synthetic qc__${runId}`,
      expected: {
        productName: "Synthetic Cheese",
        lotText: "LOT-30",
        dateText: "BEST BY 12/30/30",
      },
      requiredFields: ["productName", "lotText", "dateText"],
      sourceIdentity: "SYNTHETIC-FIXTURE-REF-v1",
      sourceDescription: "Test-only reference; not an operational label master.",
    };
    expect((await req(QC_OPERATOR, "POST", "/api/qc/label-references", draftInput)).status).toBe(403);
    const draftResponse = await req(QC_MANAGER, "POST", "/api/qc/label-references", draftInput);
    expect(draftResponse.status).toBe(201);
    const draftEvent = (await draftResponse.json() as {
      event: { id: number; actorId: string; payload: Record<string, any> };
    }).event;
    const referenceId = draftEvent.payload.referenceId as string;
    expect(draftEvent.actorId).toBe(QC_MANAGER);
    expect(draftEvent.payload).toMatchObject({ referenceId, version: 1, sourceIdentity: "SYNTHETIC-FIXTURE-REF-v1" });
    const retryDraft = await req(QC_MANAGER, "POST", "/api/qc/label-references", draftInput);
    expect(retryDraft.status).toBe(200);
    expect((await retryDraft.json() as { duplicate: boolean }).duplicate).toBe(true);
    expect((await req(QC_OPERATOR, "GET", "/api/qc/label-references").then((response) => response.json()) as {
      items: unknown[];
    }).items).toEqual([]);

    const observationOnly = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
      operationId: randomUUID(),
      runId,
      context: "shipper-case",
      observed: { productName: "Observed only", lotText: "", dateText: "" },
    });
    expect(observationOnly.status).toBe(201);
    expect((await observationOnly.json() as { event: { payload: Record<string, any> } }).event.payload)
      .toMatchObject({ outcome: "not-evaluated", referenceSnapshot: null });

    const draftCheckInput = {
      operationId: randomUUID(),
      runId,
      context: "shipper-case",
      referenceId,
      observed: { productName: "Synthetic Cheese", lotText: "LOT-30", dateText: "BEST BY 12/30/30" },
    };
    const forged = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
      ...draftCheckInput,
      expected: { productName: "Synthetic Cheese" },
      outcome: "pass",
    });
    expect(forged.status).toBe(400);
    const noObservedText = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
      operationId: randomUUID(),
      runId,
      context: "shipper-case",
      observed: { productName: "", lotText: "", dateText: "" },
    });
    expect(noObservedText.status).toBe(400);

    const unapprovedCheck = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", draftCheckInput);
    expect(unapprovedCheck.status).toBe(201);
    const unapprovedEvent = (await unapprovedCheck.json() as {
      event: { id: number; payload: Record<string, any> };
    }).event;
    expect(unapprovedEvent.payload).toMatchObject({
      referenceId,
      referenceSnapshot: { version: 1, state: "draft" },
      outcome: "not-evaluated",
    });
    expect(unapprovedEvent.payload.referenceSnapshot.expected).toBeUndefined();
    expect(Object.values(unapprovedEvent.payload.fieldResults).map((field: any) => field.state))
      .toEqual(["not-evaluated", "not-evaluated", "not-evaluated"]);

    const approvalInput = {
      operationId: randomUUID(),
      decision: "approved",
      reason: "Synthetic fixture review for deterministic tests.",
    };
    const approval = await req(QC_MANAGER, "POST", `/api/qc/label-references/${draftEvent.id}/review`, approvalInput);
    expect(approval.status).toBe(201);
    const approvalEvent = (await approval.json() as {
      event: { id: number; actorId: string; payload: Record<string, unknown>; createdAt: string };
    }).event;
    expect(approvalEvent.actorId).toBe(QC_MANAGER);
    const approvedList = await req(QC_OPERATOR, "GET", "/api/qc/label-references");
    expect(approvedList.status).toBe(200);
    expect((await approvedList.json() as { items: Array<Record<string, unknown>> }).items)
      .toEqual([expect.objectContaining({
        referenceId,
        version: 1,
        state: "approved",
        sourceIdentity: "SYNTHETIC-FIXTURE-REF-v1",
        reviewedBy: QC_MANAGER,
      })]);

    const mixedInput = {
      operationId: randomUUID(),
      runId,
      context: "shipper-case",
      referenceId,
      observed: { productName: "Wrong Cheese", lotText: "LOT-30", dateText: "" },
      note: "Synthetic mixed-result check",
    };
    const mixedResponse = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", mixedInput);
    expect(mixedResponse.status).toBe(201);
    const mixedEvent = (await mixedResponse.json() as {
      event: { id: number; payload: Record<string, any> };
    }).event;
    expect(mixedEvent.payload).toMatchObject({
      outcome: "fail",
      referenceSnapshot: {
        version: 1,
        configurationEventId: draftEvent.id,
        approvalEventId: approvalEvent.id,
        sourceIdentity: "SYNTHETIC-FIXTURE-REF-v1",
        approvedBy: QC_MANAGER,
      },
      fieldResults: {
        productName: { state: "fail" },
        lotText: { state: "pass" },
        dateText: { state: "not-evaluated" },
      },
    });
    const retriedMixed = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", mixedInput);
    expect(retriedMixed.status).toBe(200);
    expect((await retriedMixed.json() as { event: { id: number; payload: Record<string, any> }; duplicate: boolean }))
      .toMatchObject({ duplicate: true, event: { id: mixedEvent.id, payload: { referenceSnapshot: { version: 1 } } } });
    expect((await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
      ...mixedInput,
      observed: { ...mixedInput.observed, productName: "Changed" },
    })).status).toBe(409);

    const nextVersionInput = {
      ...draftInput,
      operationId: randomUUID(),
      referenceId,
      expected: { ...draftInput.expected, dateText: "2031-01-01" },
      sourceIdentity: "SYNTHETIC-FIXTURE-REF-v2",
    };
    const nextVersionResponse = await req(QC_MANAGER, "POST", "/api/qc/label-references", nextVersionInput);
    expect(nextVersionResponse.status).toBe(201);
    const nextVersionEvent = (await nextVersionResponse.json() as {
      event: { id: number; payload: Record<string, unknown> };
    }).event;
    expect(nextVersionEvent.payload.version).toBe(2);
    expect((await req(QC_MANAGER, "POST", `/api/qc/label-references/${draftEvent.id}/review`, {
      operationId: randomUUID(),
      decision: "approved",
      reason: "Attempt to approve an older version.",
    })).status).toBe(409);
    const staleSelection = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
      ...draftCheckInput,
      operationId: randomUUID(),
    });
    expect(staleSelection.status).toBe(201);
    expect((await staleSelection.json() as { event: { payload: Record<string, any> } }).event.payload)
      .toMatchObject({
        outcome: "not-evaluated",
        referenceSnapshot: { version: 2, state: "draft" },
      });

    const versionTwoApproval = await req(QC_MANAGER, "POST", `/api/qc/label-references/${nextVersionEvent.id}/review`, {
      operationId: randomUUID(),
      decision: "approved",
      reason: "Approve synthetic fixture version two.",
    });
    expect(versionTwoApproval.status).toBe(201);
    const versionTwoCheck = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
      ...draftCheckInput,
      operationId: randomUUID(),
      observed: { productName: "Synthetic Cheese", lotText: "LOT-30", dateText: "2031-01-01" },
    });
    expect(versionTwoCheck.status).toBe(201);
    expect((await versionTwoCheck.json() as { event: { payload: Record<string, any> } }).event.payload)
      .toMatchObject({ outcome: "pass", referenceSnapshot: { version: 2, sourceIdentity: "SYNTHETIC-FIXTURE-REF-v2" } });
    const versionedRunHistory = await req(QC_OPERATOR, "GET", `/api/qc/runs/${runId}`);
    const historicalMixed = ((await versionedRunHistory.json()) as {
      items: Array<{ id: number; payload: Record<string, any> }>;
    }).items.find((item) => item.id === mixedEvent.id);
    expect(historicalMixed?.payload.referenceSnapshot).toMatchObject({
      version: 1,
      sourceIdentity: "SYNTHETIC-FIXTURE-REF-v1",
    });

    const incompleteDraft = await req(QC_MANAGER, "POST", "/api/qc/label-references", {
      operationId: randomUUID(),
      context: "shipper-case",
      productKey: "Incomplete Synthetic Reference",
      expected: { productName: "Synthetic Cheese" },
      requiredFields: ["productName", "dateText"],
      sourceIdentity: "SYNTHETIC-INCOMPLETE-REF",
      sourceDescription: "Synthetic incomplete test reference.",
    });
    expect(incompleteDraft.status).toBe(201);
    const incompleteId = (await incompleteDraft.json() as { event: { id: number } }).event.id;
    const incompleteApproval = await req(QC_MANAGER, "POST", `/api/qc/label-references/${incompleteId}/review`, {
      operationId: randomUUID(),
      decision: "approved",
      reason: "Incomplete references cannot be approved.",
    });
    expect(incompleteApproval.status).toBe(400);
  });

  it("keeps ambiguous or cross-scope references unevaluated and supports audited corrections, redactions, CSV, and sign-off reopening", async () => {
    const runId = "qc-label-ledger-run";
    const ledgerRunId = "qc-label-audit-run";
    await seedQcLabelRun([runId, ledgerRunId]);
    const referenceInput = {
      operationId: randomUUID(),
      context: "carton-label",
      productKey: `synthetic qc__${runId}`,
      expected: { productName: "Synthetic Cheese", lotText: "LOT-A", dateText: "2030-12-31" },
      requiredFields: ["productName", "lotText", "dateText"],
      sourceIdentity: "SYNTHETIC-LEDGER-REF-v1",
      sourceDescription: "Synthetic only; no shipping source or label master.",
    };
    const savedReference = await req(QC_MANAGER, "POST", "/api/qc/label-references", referenceInput);
    expect(savedReference.status).toBe(201);
    const referenceEvent = (await savedReference.json() as { event: { id: number; payload: Record<string, any> } }).event;
    const approved = await req(QC_MANAGER, "POST", `/api/qc/label-references/${referenceEvent.id}/review`, {
      operationId: randomUUID(),
      decision: "approved",
      reason: "Synthetic test approval.",
    });
    expect(approved.status).toBe(201);

    const [duplicateConfig] = await db.insert(qcWorkflowEventsTable).values({
      scope: "live",
      operationId: randomUUID(),
      recordId: randomUUID(),
      eventType: "label-reference",
      runId: null,
      actorId: QC_MANAGER,
      station: "packaging",
      payload: {
        referenceId: randomUUID(),
        version: 1,
        context: referenceInput.context,
        productKey: referenceInput.productKey,
        expected: referenceInput.expected,
        requiredFields: referenceInput.requiredFields,
        sourceIdentity: "SYNTHETIC-AMBIGUOUS-REF",
        sourceDescription: "Synthetic invalid duplicate for fail-closed ambiguity test.",
      },
    }).returning({ id: qcWorkflowEventsTable.id, recordId: qcWorkflowEventsTable.recordId, payload: qcWorkflowEventsTable.payload });
    const duplicatePayload = duplicateConfig!.payload as Record<string, any>;
    await db.insert(qcWorkflowEventsTable).values({
      scope: "live",
      operationId: randomUUID(),
      recordId: duplicateConfig!.recordId,
      eventType: "label-reference-review",
      runId: null,
      relatedEventId: String(duplicateConfig!.id),
      actorId: QC_MANAGER,
      station: "packaging",
      payload: {
        referenceId: duplicatePayload.referenceId,
        version: 1,
        configurationEventId: duplicateConfig!.id,
        decision: "approved",
        reason: "Synthetic invalid duplicate.",
      },
    });
    const ambiguous = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
      operationId: randomUUID(),
      runId,
      context: "carton-label",
      referenceId: referenceEvent.payload.referenceId,
      observed: { productName: "Synthetic Cheese", lotText: "LOT-A", dateText: "2030-12-31" },
    });
    expect(ambiguous.status).toBe(201);
    expect((await ambiguous.json() as { event: { payload: Record<string, any> } }).event.payload)
      .toMatchObject({
        outcome: "not-evaluated",
        referenceSnapshot: { state: "ambiguous" },
      });

    await db.update(userRolesTable).set({ role: "qc-manager" }).where(eq(userRolesTable.userId, SANDBOX));
    const sandboxReferences = await req(SANDBOX, "GET", "/api/qc/label-references");
    expect(sandboxReferences.status).toBe(200);
    expect((await sandboxReferences.json() as { items: unknown[] }).items).toEqual([]);
    expect((await req(SANDBOX, "POST", `/api/qc/label-references/${referenceEvent.id}/review`, {
      operationId: randomUUID(),
      decision: "withdrawn",
      reason: "Cross-scope operation must not see a live reference.",
    })).status).toBe(404);
    expect((await req(SANDBOX, "POST", "/api/qc/label-checks", {
      operationId: randomUUID(),
      runId,
      context: "carton-label",
      referenceId: referenceEvent.payload.referenceId,
      observed: { productName: "Synthetic Cheese", lotText: "LOT-A", dateText: "2030-12-31" },
    })).status).toBe(404);

    const auditReference = await req(QC_MANAGER, "POST", "/api/qc/label-references", {
      ...referenceInput,
      operationId: randomUUID(),
      productKey: `synthetic qc__${ledgerRunId}`,
      sourceIdentity: "SYNTHETIC-AUDIT-REF",
    });
    const auditReferenceEvent = (await auditReference.json() as { event: { id: number; payload: Record<string, unknown> } }).event;
    expect((await req(QC_MANAGER, "POST", `/api/qc/label-references/${auditReferenceEvent.id}/review`, {
      operationId: randomUUID(),
      decision: "approved",
      reason: "Synthetic audit approval.",
    })).status).toBe(201);
    const labelCheckResponse = await req(QC_OPERATOR, "POST", "/api/qc/label-checks", {
      operationId: randomUUID(),
      runId: ledgerRunId,
      context: "carton-label",
      referenceId: auditReferenceEvent.payload.referenceId,
      observed: { productName: "Synthetic Cheese", lotText: "LOT-A", dateText: "2030-12-31" },
    });
    expect(labelCheckResponse.status).toBe(201);
    const labelCheck = (await labelCheckResponse.json() as {
      event: { id: number; payload: Record<string, any> };
    }).event;
    expect(labelCheck.payload.outcome).toBe("pass");

    expect((await req(QC_MANAGER, "POST", "/api/qc/run-signoffs", {
      operationId: randomUUID(),
      runId: ledgerRunId,
    })).status).toBe(201);
    const correction = await req(QC_MANAGER, "POST", `/api/qc/events/${labelCheck.id}/corrections`, {
      operationId: randomUUID(),
      reason: "Correct a synthetic date transcription.",
      replacement: { observed: { dateText: "2030-12-30" } },
    });
    expect(correction.status).toBe(201);
    const reopened = await req(QC_OPERATOR, "GET", `/api/qc/runs/${ledgerRunId}`);
    expect((await reopened.json() as { signoff: { signedOff: boolean; reopened: boolean } }).signoff)
      .toMatchObject({ signedOff: false, reopened: true });
    const redaction = await req(QC_MANAGER, "POST", `/api/qc/events/${labelCheck.id}/redactions`, {
      operationId: randomUUID(),
      reason: "Synthetic privacy redaction.",
      fields: [
        "payload.observed.dateText",
        "payload.fieldResults.dateText.observed",
        "payload.fieldResults.dateText.expected",
        "payload.referenceSnapshot.expected.dateText",
      ],
    });
    expect(redaction.status).toBe(201);
    const history = await req(QC_OPERATOR, "GET", `/api/qc/runs/${ledgerRunId}`);
    const historyItems = (await history.json() as {
      items: Array<{ eventType: string; payload: Record<string, any>; redactedFields?: string[] }>;
    }).items;
    const projected = historyItems.find((event) => event.eventType === "label-check");
    expect(projected).toMatchObject({
      corrected: true,
      redactedFields: expect.arrayContaining([
        "payload.observed.dateText",
        "payload.referenceSnapshot.expected.dateText",
      ]),
      payload: {
        outcome: "fail",
        observed: { productName: "Synthetic Cheese", dateText: "[redacted]" },
        fieldResults: { dateText: { observed: "[redacted]", expected: "[redacted]", state: "fail" } },
        referenceSnapshot: { expected: { dateText: "[redacted]" } },
      },
    });
    const csv = await req(QC_MANAGER, "GET", "/api/qc/history.csv");
    const csvText = await csv.text();
    expect(csv.status).toBe(200);
    expect(csvText).toContain("label-reference");
    expect(csvText).toContain("label-reference-review");
    expect(csvText).toContain("label-check");
    expect(csvText).toContain("SYNTHETIC-AUDIT-REF");
    const runCsv = await req(QC_MANAGER, "GET", `/api/qc/history.csv?runId=${ledgerRunId}`);
    const runCsvText = await runCsv.text();
    expect(runCsvText).toContain("Synthetic privacy redaction.");
    expect(runCsvText).toContain("[redacted]");
    expect(runCsvText).not.toContain("2030-12-30");
  });

  it("serves one scoped production day from canonical snapshots and applies audited event overlays", async () => {
    const date = "2030-03-10";
    const runId = "qc-activity-ended-run";
    const completedSnapshot = (brand: string, allergen: string) => ({
      dayState: {
        date,
        runs: [{ id: runId, brand, flavor: "Cheese", finished: true }],
      },
      runValues: { [runId]: { allergen } },
    });
    await db.insert(completedRunHistoryTable).values([
      {
        id: "qc-activity-live-completed",
        scope: "live",
        operationId: randomUUID(),
        runId,
        date,
        completedAt: new Date(`${date}T18:00:00.000Z`),
        snapshot: completedSnapshot("Live Brand", "milk"),
        snapshotHash: "live-snapshot-hash",
        actorId: QC_OPERATOR,
      },
      {
        id: "qc-activity-sandbox-completed",
        scope: "sandbox",
        operationId: randomUUID(),
        runId,
        date,
        completedAt: new Date(`${date}T18:00:00.000Z`),
        snapshot: completedSnapshot("Sandbox Brand", "egg"),
        snapshotHash: "sandbox-snapshot-hash",
        actorId: SANDBOX,
      },
      {
        id: "qc-activity-adjacent-completed",
        scope: "live",
        operationId: randomUUID(),
        runId: "qc-activity-adjacent-run",
        date: "2030-03-11",
        completedAt: new Date("2030-03-11T18:00:00.000Z"),
        snapshot: {
          dayState: { date: "2030-03-11", runs: [{ id: "qc-activity-adjacent-run" }] },
          runValues: { "qc-activity-adjacent-run": { allergen: "soy" } },
        },
        snapshotHash: "adjacent-snapshot-hash",
        actorId: QC_OPERATOR,
      },
    ]);
    const [review] = await db.insert(qcWorkflowEventsTable).values({
      scope: "live",
      operationId: randomUUID(),
      recordId: randomUUID(),
      eventType: "allergen-review",
      runId,
      actorId: QC_OPERATOR,
      payload: {
        footprintReviewed: true,
        footprint: { status: "complete", allergens: [], unknownIngredients: [], missingComponents: [] },
        note: "Original note",
      },
    }).returning({ id: qcWorkflowEventsTable.id });
    await db.insert(qcWorkflowEventsTable).values([
      {
        scope: "live",
        operationId: randomUUID(),
        recordId: randomUUID(),
        eventType: "correction",
        runId,
        relatedEventId: String(review!.id),
        actorId: QC_MANAGER,
        payload: {
          reason: "Correct the recorded footprint",
          replacement: {
            footprint: { status: "complete", allergens: ["milk"], unknownIngredients: [], missingComponents: [] },
            note: "Corrected note",
          },
        },
      },
      {
        scope: "live",
        operationId: randomUUID(),
        recordId: randomUUID(),
        eventType: "redaction",
        runId,
        relatedEventId: String(review!.id),
        actorId: QC_MANAGER,
        payload: { reason: "Privacy request", fields: ["payload.note"] },
      },
      {
        scope: "sandbox",
        operationId: randomUUID(),
        recordId: randomUUID(),
        eventType: "redaction",
        runId,
        relatedEventId: String(review!.id),
        actorId: SANDBOX,
        payload: { reason: "Cross-facility audit secret", fields: ["payload.note"] },
      },
      {
        scope: "sandbox",
        operationId: randomUUID(),
        recordId: randomUUID(),
        eventType: "allergen-review",
        runId,
        actorId: SANDBOX,
        payload: {
          footprintReviewed: true,
          footprint: { status: "complete", allergens: ["egg"], unknownIngredients: [], missingComponents: [] },
          note: "Sandbox event",
        },
      },
    ]);
    const [cleaning] = await db.insert(qcWorkflowEventsTable).values({
      scope: "live",
      operationId: randomUUID(),
      recordId: randomUUID(),
      eventType: "cleaning",
      runId,
      actorId: QC_OPERATOR,
      payload: {
        method: "standard",
        startedAt: "2030-03-10T17:00:00.000Z",
        endedAt: "2030-03-10T17:30:00.000Z",
        note: "Original cleaning note",
      },
    }).returning({ id: qcWorkflowEventsTable.id });
    await db.insert(qcWorkflowEventsTable).values([
      {
        scope: "live",
        operationId: randomUUID(),
        recordId: randomUUID(),
        eventType: "correction",
        runId,
        relatedEventId: String(cleaning!.id),
        actorId: QC_MANAGER,
        payload: { reason: "Correct method", replacement: { method: "deep" } },
      },
      {
        scope: "live",
        operationId: randomUUID(),
        recordId: randomUUID(),
        eventType: "redaction",
        runId,
        relatedEventId: String(cleaning!.id),
        actorId: QC_MANAGER,
        payload: { reason: "Privacy request", fields: ["payload.note"] },
      },
      {
        scope: "live",
        operationId: randomUUID(),
        recordId: cleaning!.id.toString(),
        eventType: "cleaning-verification",
        runId,
        relatedEventId: String(cleaning!.id),
        actorId: QC_MANAGER,
        payload: { note: "Independently checked" },
      },
    ]);
    const eventCountBeforeReads = (await db.select({ id: qcWorkflowEventsTable.id }).from(qcWorkflowEventsTable)).length;

    expect((await req(null, "GET", `/api/qc/allergen-activity?date=${date}`)).status).toBe(401);
    expect((await req(OPERATOR, "GET", `/api/qc/allergen-activity?date=${date}`)).status).toBe(403);
    expect((await req(QC_OPERATOR, "GET", "/api/qc/allergen-activity?date=2030-02-30")).status).toBe(400);

    const liveResponse = await req(QC_OPERATOR, "GET", `/api/qc/allergen-activity?date=${date}`);
    expect(liveResponse.status).toBe(200);
    const liveReport = await liveResponse.json() as {
      sources: { endedRuns: { status: string }; activeRuns: { status: string }; qcEvents: { count: number } };
      runs: Array<{
        runId: string; label: string; source: string;
        manualAllergen: { status: string; value: string | null };
        derivedReviewState: string;
        allergenReviews: Array<{
          state: string; allergens: string[] | null; note: string | null; corrected: boolean;
          redactedFields: string[];
          auditDetails?: Array<{ action: string; actorId: string | null; reason: string | null; recordedAt: string }>;
        }>;
        cleaningEvents: Array<{
          method: string | null; note: string | null; verification: { status: string };
          auditDetails?: Array<{ action: string; actorId: string | null; reason: string | null; recordedAt: string }>;
        }>;
      }>;
    };
    expect(liveReport.sources).toMatchObject({
      endedRuns: { status: "available" },
      activeRuns: { status: "not-applicable" },
      qcEvents: { count: 3 },
    });
    expect(liveReport.runs).toHaveLength(1);
    expect(liveReport.runs[0]).toMatchObject({
      runId,
      label: "Live Brand Cheese",
      source: "completed-snapshot",
      manualAllergen: { status: "recorded", value: "milk" },
      derivedReviewState: "reviewed",
      allergenReviews: [{
        state: "reviewed",
        allergens: ["milk"],
        note: "[redacted]",
        corrected: true,
        redactedFields: ["payload.note"],
      }],
      cleaningEvents: [{
        method: "deep",
        note: "[redacted]",
        verification: { status: "recorded" },
      }],
    });
    expect(JSON.stringify(liveReport)).not.toContain("Sandbox event");
    expect(JSON.stringify(liveReport)).not.toContain(QC_OPERATOR);
    expect(JSON.stringify(liveReport)).not.toContain("Correct the recorded footprint");
    expect(JSON.stringify(liveReport)).not.toContain("Cross-facility audit secret");

    const managerResponse = await req(QC_MANAGER, "GET", `/api/qc/allergen-activity?date=${date}`);
    expect(managerResponse.status).toBe(200);
    const managerReport = await managerResponse.json() as typeof liveReport;
    const managerRun = managerReport.runs[0]!;
    expect(managerRun.allergenReviews[0]).toMatchObject({
      note: "[redacted]",
      auditDetails: expect.arrayContaining([
        {
          action: "correction",
          actorId: QC_MANAGER,
          reason: "Correct the recorded footprint",
          recordedAt: expect.any(String),
        },
        {
          action: "redaction",
          actorId: QC_MANAGER,
          reason: "Privacy request",
          recordedAt: expect.any(String),
        },
      ]),
    });
    expect(managerRun.cleaningEvents[0]).toMatchObject({
      note: "[redacted]",
      auditDetails: expect.arrayContaining([
        {
          action: "correction",
          actorId: QC_MANAGER,
          reason: "Correct method",
          recordedAt: expect.any(String),
        },
        {
          action: "redaction",
          actorId: QC_MANAGER,
          reason: "Privacy request",
          recordedAt: expect.any(String),
        },
      ]),
    });
    expect(JSON.stringify(managerReport)).not.toContain("Original note");
    expect(JSON.stringify(managerReport)).not.toContain("Corrected note");
    expect(JSON.stringify(managerReport)).not.toContain("Cross-facility audit secret");

    await db.update(userRolesTable).set({ role: "qc-operator" })
      .where(eq(userRolesTable.userId, SANDBOX));
    const sandboxResponse = await req(SANDBOX, "GET", `/api/qc/allergen-activity?date=${date}`);
    expect((await sandboxResponse.json() as { runs: Array<{ label: string; allergenReviews: Array<{ allergens: string[] }> }> }).runs)
      .toEqual([expect.objectContaining({
        label: "Sandbox Brand Cheese",
        allergenReviews: [expect.objectContaining({ allergens: ["egg"] })],
      })]);
    await db.update(userRolesTable).set({ role: "qc-manager" })
      .where(eq(userRolesTable.userId, SANDBOX));
    const sandboxManagerResponse = await req(SANDBOX, "GET", `/api/qc/allergen-activity?date=${date}`);
    const sandboxManagerReport = await sandboxManagerResponse.json() as typeof liveReport;
    expect(sandboxManagerResponse.status).toBe(200);
    expect(JSON.stringify(sandboxManagerReport)).not.toContain("Correct the recorded footprint");
    expect(JSON.stringify(sandboxManagerReport)).not.toContain("Cross-facility audit secret");
    expect(sandboxManagerReport.runs[0]?.allergenReviews[0]?.auditDetails).toBeUndefined();

    const today = facilityDate();
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: today,
      data: {
        dayState: { date: today, runs: [{ id: "qc-activity-active-run", brand: "Current", flavor: "Day" }] },
        runValues: { "qc-activity-active-run": { allergen: "none" } },
      },
    });
    const activeResponse = await req(QC_OPERATOR, "GET", `/api/qc/allergen-activity?date=${today}`);
    const activeReport = await activeResponse.json() as {
      sources: { activeRuns: { status: string }; endedRuns: { status: string } };
      runs: Array<{ runId: string; source: string; manualAllergen: { value: string | null } }>;
    };
    expect(activeReport.sources.activeRuns.status).toBe("available");
    expect(activeReport.runs).toContainEqual(expect.objectContaining({
      runId: "qc-activity-active-run",
      source: "active-day-state",
      manualAllergen: { status: "recorded", value: "none" },
    }));

    const missing = await req(QC_OPERATOR, "GET", "/api/qc/allergen-activity?date=2030-03-12");
    expect(await missing.json()).toMatchObject({
      sources: { endedRuns: { status: "unavailable" } },
      runs: [],
    });
    expect((await db.select({ id: qcWorkflowEventsTable.id }).from(qcWorkflowEventsTable)).length)
      .toBe(eventCountBeforeReads);
  });

  it("authorizes QC recording, appends multiple lots, and scopes reads and exports", async () => {
    await seedQcWorkflowFixtures();
    const lot = {
      operationId: randomUUID(), runId: "qc-scope-run", ingredientId: "qc-mozzarella",
      station: "frontline", lotNumber: "LIVE-LOT",
    };
    expect((await req(OPERATOR, "POST", "/api/qc/lots", lot)).status).toBe(403);
    expect((await req(null, "GET", "/api/qc/history")).status).toBe(401);
    expect((await req(OPERATOR, "GET", "/api/qc/history")).status).toBe(403);
    const first = await req(QC_OPERATOR, "POST", "/api/qc/lots", lot);
    expect(first.status).toBe(201);
    const firstEvent = (await first.json() as { event: {
      actorId: string; createdAt: string; ingredientId: string; payload: Record<string, unknown>;
    } }).event;
    expect(firstEvent.actorId).toBe(QC_OPERATOR);
    expect(firstEvent.ingredientId).toBe("qc-mozzarella");
    expect(Number.isFinite(Date.parse(firstEvent.createdAt))).toBe(true);
    expect(firstEvent.payload.lotNumber).toBe("LIVE-LOT");
    expect((await req(QC_OPERATOR, "POST", "/api/qc/lots", {
      ...lot, operationId: randomUUID(), lotNumber: "LIVE-LOT-2",
    })).status).toBe(201);

    await db.update(userRolesTable).set({ role: "qc-operator" })
      .where(eq(userRolesTable.userId, SANDBOX));
    const sandboxLot = await req(SANDBOX, "POST", "/api/qc/lots", {
      ...lot, operationId: randomUUID(), lotNumber: "SANDBOX-LOT",
    });
    expect(sandboxLot.status).toBe(201);
    const liveHistory = await req(QC_OPERATOR, "GET", "/api/qc/history?runId=qc-scope-run");
    const sandboxHistory = await req(SANDBOX, "GET", "/api/qc/history?runId=qc-scope-run");
    const liveItems = (await liveHistory.json() as { items: Array<{ payload: Record<string, unknown> }> }).items;
    const sandboxItems = (await sandboxHistory.json() as { items: Array<{ payload: Record<string, unknown> }> }).items;
    expect(liveItems.map((item) => item.payload.lotNumber).sort()).toEqual(["LIVE-LOT", "LIVE-LOT-2"]);
    expect(sandboxItems.map((item) => item.payload.lotNumber)).toEqual(["SANDBOX-LOT"]);
    expect((await req(QC_OPERATOR, "GET", "/api/qc/history.csv")).status).toBe(403);
    const csv = await req(QC_MANAGER, "GET", "/api/qc/history.csv?runId=qc-scope-run");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("LIVE-LOT");
  });

  it("resolves explicit imported targets, audits reviewed overrides, and never infers crust targets", async () => {
    await seedQcWorkflowFixtures();
    const url = `/api/qc/targets?profileKey=${encodeURIComponent(QC_PROFILE_KEY)}`;
    const initial = await req(QC_OPERATOR, "GET", url);
    expect(initial.status).toBe(200);
    const initialTargets = (await initial.json() as { targets: Array<Record<string, unknown>> }).targets;
    expect(initialTargets.find((target) => target.ingredientId === "qc-mozzarella"))
      .toMatchObject({ targetValue: 1.25, unit: "oz", toleranceValue: 0.1, source: "spec-import", state: "configured" });
    expect(initialTargets.find((target) => target.ingredientId === "qc-dough"))
      .toMatchObject({ targetValue: 12, unit: "oz", source: "spec-import", state: "configured" });
    expect(initialTargets.find((target) => target.ingredientId === "qc-sauce"))
      .toMatchObject({ targetValue: 2.75, unit: "oz", source: "spec-import", state: "configured" });
    expect(initialTargets.find((target) => target.ingredientId === "qc-crust"))
      .toMatchObject({ targetValue: null, state: "not-evaluated" });

    const override = {
      operationId: randomUUID(), profileKey: QC_PROFILE_KEY, ingredientId: "qc-mozzarella",
      targetValue: 1.5, unit: "g", toleranceValue: 0, reason: "Reviewed scale specification",
    };
    expect((await req(QC_OPERATOR, "POST", "/api/qc/targets", override)).status).toBe(403);
    expect((await req(QC_MANAGER, "POST", "/api/qc/targets", override)).status).toBe(201);
    const overridden = await req(QC_MANAGER, "GET", url);
    expect(((await overridden.json()) as { targets: Array<Record<string, unknown>> }).targets
      .find((target) => target.ingredientId === "qc-mozzarella"))
      .toMatchObject({ targetValue: 1.5, unit: "g", toleranceValue: 0, source: "qc-override", state: "configured" });
    const mismatchedUnits = await req(QC_OPERATOR, "POST", "/api/qc/weight-checks", {
      operationId: randomUUID(), runId: "qc-weight-run", profileKey: QC_PROFILE_KEY,
      ingredientId: "qc-mozzarella", checkType: "30-minute", actualValue: 1.5, actualUnit: "oz",
    });
    expect(mismatchedUnits.status).toBe(201);
    expect(((await mismatchedUnits.json()) as { event: { payload: Record<string, unknown> } }).event.payload)
      .toMatchObject({
        checkType: "30-minute", targetValue: 1.5, targetUnit: "g",
        actualValue: 1.5, actualUnit: "oz", outcome: "not-evaluated",
      });
    expect((await req(QC_MANAGER, "POST", "/api/qc/targets", {
      operationId: randomUUID(), profileKey: QC_PROFILE_KEY, ingredientId: "qc-mozzarella",
      targetValue: null, unit: null, toleranceValue: null, reason: "Restore imported target",
    })).status).toBe(201);
    const restored = await req(QC_MANAGER, "GET", url);
    expect(((await restored.json()) as { targets: Array<Record<string, unknown>> }).targets
      .find((target) => target.ingredientId === "qc-mozzarella"))
      .toMatchObject({ targetValue: 1.25, unit: "oz", toleranceValue: 0.1, source: "spec-import" });
    expect((await req(MANAGER, "POST", "/api/qc/targets", {
      operationId: randomUUID(), profileKey: QC_PROFILE_KEY, ingredientId: "qc-dough",
      targetValue: 13, unit: "oz", toleranceValue: 0.2, reason: "App manager reviewed target",
    })).status).toBe(201);
    const targetAudit = await req(QC_MANAGER, "GET", "/api/qc/history?limit=10");
    const targetEvents = (await targetAudit.json() as {
      items: Array<{ eventType: string; actorId: string }>;
    }).items.filter((event) => event.eventType === "target-setting");
    expect(targetEvents).toHaveLength(3);
    expect(targetEvents.map((event) => event.actorId).sort()).toEqual([MANAGER, QC_MANAGER, QC_MANAGER].sort());

    const outOfTolerance = {
      operationId: randomUUID(), runId: "qc-weight-run", profileKey: QC_PROFILE_KEY,
      ingredientId: "qc-mozzarella", checkType: "pre-run", actualValue: 1.5, actualUnit: "oz",
    };
    expect((await req(QC_OPERATOR, "POST", "/api/qc/weight-checks", outOfTolerance)).status).toBe(400);
    const withReason = await req(QC_OPERATOR, "POST", "/api/qc/weight-checks", {
      ...outOfTolerance, note: "Scale drift",
    });
    expect(withReason.status).toBe(201);
    expect(((await withReason.json()) as { event: { payload: Record<string, unknown> } }).event.payload)
      .toMatchObject({ targetValue: 1.25, targetUnit: "oz", toleranceValue: 0.1, outcome: "out-of-tolerance", note: "Scale drift" });
    const noTarget = await req(QC_OPERATOR, "POST", "/api/qc/weight-checks", {
      operationId: randomUUID(), runId: "qc-weight-run", profileKey: QC_PROFILE_KEY,
      ingredientId: "qc-crust", checkType: "pre-run", actualValue: 8, actualUnit: "oz",
    });
    expect(noTarget.status).toBe(201);
    expect(((await noTarget.json()) as { event: { payload: Record<string, unknown> } }).event.payload)
      .toMatchObject({ targetValue: null, outcome: "not-evaluated", targetSource: "not-configured" });

    const savedRun = await req(QC_OPERATOR, "GET", "/api/qc/runs/qc-weight-run");
    expect(savedRun.status).toBe(200);
    const savedRunData = await savedRun.json() as {
      runId: string;
      weightCheckEventsComplete: boolean;
      weightCheckEvents: Array<{ ingredientId: string; checkType: string; createdAt: string }>;
    };
    expect(savedRunData.runId).toBe("qc-weight-run");
    expect(savedRunData.weightCheckEventsComplete).toBe(true);
    expect(savedRunData.weightCheckEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ingredientId: "qc-mozzarella",
        checkType: "30-minute",
      }),
      expect.objectContaining({
        ingredientId: "qc-crust",
        checkType: "pre-run",
      }),
    ]));
  });

  it("records advisory Brix against the canonical run and immutable reviewed target snapshot", async () => {
    await seedQcWorkflowFixtures();
    const brixProfileKey = "qc brand__qc flavor";
    await db.insert(brandProfilesTable).values({
      key: brixProfileKey,
      scope: "live",
      brand: "QC Brand",
      flavor: "QC Flavor",
      values: {
        app1Type: "cheese",
        app1CheeseRecipeName: "Mozzarella",
        app1OzPerPizza: 1.25,
        frontlineRecipeName: "Sauce",
        sauceOzPerPizza: 2.75,
        doughRecipeName: "Dough",
        targetDoughballWeight: 12,
        crustType: "Crust",
      },
      crustValues: { crustTargetWeight: 8 },
    });
    const date = facilityDate();
    const runId = "qc-brix-run";
    await db.delete(dailySyncTable).where(and(
      eq(dailySyncTable.scope, "live"),
      eq(dailySyncTable.date, date),
    ));
    await db.insert(dailySyncTable).values({
      scope: "live",
      date,
      canonicalRevision: 3,
      data: {
        dayState: {
          date,
          runs: [{ id: runId, brand: "QC Brand", flavor: "QC Flavor" }],
        },
        runValues: { [runId]: {} },
      },
    });

    const targetsUrl = `/api/qc/targets?profileKey=${encodeURIComponent(brixProfileKey)}`;
    const initialTargets = await req(QC_OPERATOR, "GET", targetsUrl);
    expect(initialTargets.status).toBe(200);
    const initialTargetData = await initialTargets.json() as {
      targets: Array<Record<string, unknown>>;
      brixTargets: Array<Record<string, unknown>>;
    };
    expect(initialTargetData.targets.find((target) => target.ingredientId === "qc-mozzarella"))
      .toMatchObject({ targetValue: 1.25, unit: "oz", toleranceValue: 0.1 });
    expect(initialTargetData.brixTargets.find((target) => target.ingredientId === "qc-mozzarella"))
      .toMatchObject({
        targetBrix: null,
        toleranceBrix: null,
        state: "not-evaluated",
        source: "not-configured",
      });

    const config = {
      operationId: randomUUID(),
      profileKey: brixProfileKey,
      ingredientId: "qc-mozzarella",
      targetBrix: 12.5,
      toleranceBrix: 0.5,
      reason: "Approved synthetic Brix reference",
    };
    expect((await req(QC_OPERATOR, "POST", "/api/qc/brix-targets", config)).status).toBe(403);
    const savedTarget = await req(QC_MANAGER, "POST", "/api/qc/brix-targets", config);
    expect(savedTarget.status).toBe(201);
    const savedTargetEvent = (await savedTarget.json() as {
      event: { id: number; actorId: string; runId: string | null; payload: Record<string, unknown> };
    }).event;
    expect(savedTargetEvent).toMatchObject({
      actorId: QC_MANAGER,
      runId: null,
      payload: {
        measurementKind: "brix",
        targetBrix: 12.5,
        toleranceBrix: 0.5,
        unit: "brix",
        active: true,
      },
    });
    const replayedTarget = await req(QC_MANAGER, "POST", "/api/qc/brix-targets", config);
    expect(replayedTarget.status).toBe(200);
    expect((await replayedTarget.json() as { event: { id: number } }).event.id).toBe(savedTargetEvent.id);
    expect((await req(QC_MANAGER, "POST", "/api/qc/brix-targets", {
      ...config,
      toleranceBrix: 0.25,
    })).status).toBe(409);
    expect((await req(QC_MANAGER, "POST", "/api/qc/brix-targets", {
      ...config,
      operationId: randomUUID(),
      targetBrix: 12.5,
      toleranceBrix: null,
    })).status).toBe(400);
    expect((await req(QC_MANAGER, "POST", "/api/qc/brix-targets", {
      ...config,
      operationId: randomUUID(),
      targetBrix: -0.1,
    })).status).toBe(400);

    const baseCheck = {
      operationId: randomUUID(),
      runId,
      profileKey: brixProfileKey,
      ingredientId: "qc-mozzarella",
      station: "sauce",
      checkType: "pre-run",
      actualBrix: 13,
      instrument: "SYNTHETIC-REFRACTOMETER",
      note: "Inclusive upper boundary",
    };
    expect((await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      profileKey: "different__profile",
    })).status).toBe(409);
    expect((await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      actualBrix: -0.01,
    })).status).toBe(400);
    expect((await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      actualBrix: 100.01,
    })).status).toBe(400);
    expect((await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      actualBrix: 12.5,
      outcome: "pass",
    })).status).toBe(400);
    expect((await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      actualBrix: 12.5,
      targetBrix: 100,
      toleranceBrix: 100,
    })).status).toBe(400);
    expect((await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      actualBrix: 12.5,
      instrument: "I".repeat(121),
    })).status).toBe(400);

    const firstCheck = await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", baseCheck);
    expect(firstCheck.status).toBe(201);
    const firstEvent = (await firstCheck.json() as {
      event: { id: number; actorId: string; payload: Record<string, unknown> };
    }).event;
    expect(firstEvent).toMatchObject({
      actorId: QC_OPERATOR,
      payload: {
        actualBrix: 13,
        targetBrix: 12.5,
        toleranceBrix: 0.5,
        targetVersion: savedTargetEvent.id,
        targetSource: "qc-override",
        outcome: "pass",
        unit: "brix",
        checkType: "pre-run",
        instrument: "SYNTHETIC-REFRACTOMETER",
        note: "Inclusive upper boundary",
        runSourceKind: "current-day-canonical-settings",
        runSourceRevision: "3",
      },
    });
    const replayedCheck = await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", baseCheck);
    expect(replayedCheck.status).toBe(200);
    expect((await replayedCheck.json() as { event: { id: number } }).event.id).toBe(firstEvent.id);
    const duplicateCheckCount = await db.select().from(qcWorkflowEventsTable)
      .where(and(
        eq(qcWorkflowEventsTable.scope, "live"),
        eq(qcWorkflowEventsTable.operationId, baseCheck.operationId),
      ));
    expect(duplicateCheckCount).toHaveLength(1);

    const missingTargetCheck = await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      operationId: randomUUID(),
      ingredientId: "qc-sauce",
      checkType: "interval",
      actualBrix: 0,
    });
    expect(missingTargetCheck.status).toBe(201);
    expect(((await missingTargetCheck.json() as { event: { payload: Record<string, unknown> } }).event.payload))
      .toMatchObject({
        checkType: "interval",
        actualBrix: 0,
        targetBrix: null,
        toleranceBrix: null,
        targetVersion: null,
        outcome: "not-evaluated",
      });

    const zeroTarget = await req(QC_MANAGER, "POST", "/api/qc/brix-targets", {
      ...config,
      operationId: randomUUID(),
      ingredientId: "qc-sauce",
      targetBrix: 0,
      toleranceBrix: 0,
      reason: "Explicit zero reference for synthetic test",
    });
    expect(zeroTarget.status).toBe(201);
    const zeroReading = await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      operationId: randomUUID(),
      ingredientId: "qc-sauce",
      actualBrix: 0,
      checkType: "pre-run",
    });
    expect(zeroReading.status).toBe(201);
    expect(((await zeroReading.json() as {
      event: { payload: Record<string, unknown> };
    }).event.payload)).toMatchObject({
      actualBrix: 0,
      targetBrix: 0,
      toleranceBrix: 0,
      outcome: "pass",
      unit: "brix",
    });

    const signoff = await req(QC_MANAGER, "POST", "/api/qc/run-signoffs", {
      operationId: randomUUID(),
      runId,
    });
    expect(signoff.status).toBe(201);
    const targetAfterSignoff = await req(QC_MANAGER, "POST", "/api/qc/brix-targets", {
      ...config,
      operationId: randomUUID(),
      targetBrix: 13,
      toleranceBrix: 0.5,
      reason: "Post-sign-off target review metadata",
    });
    expect(targetAfterSignoff.status).toBe(201);
    const unchangedSignoff = await req(QC_OPERATOR, "GET", `/api/qc/runs/${runId}`);
    expect(((await unchangedSignoff.json() as { signoff: { signedOff: boolean; reopened: boolean } }).signoff))
      .toMatchObject({ signedOff: true, reopened: false });

    const changedTarget = await req(QC_MANAGER, "POST", "/api/qc/brix-targets", {
      ...config,
      operationId: randomUUID(),
      targetBrix: 12.5,
      toleranceBrix: 0,
      reason: "Newer reviewed zero-tolerance configuration",
    });
    expect(changedTarget.status).toBe(201);
    const changedTargetEventId = (await changedTarget.json() as { event: { id: number } }).event.id;
    const outsideZeroTolerance = await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      operationId: randomUUID(),
      checkType: "interval",
      actualBrix: 12.499,
    });
    expect(outsideZeroTolerance.status).toBe(201);
    const outsideEvent = (await outsideZeroTolerance.json() as {
      event: { id: number; payload: Record<string, unknown> };
    }).event;
    expect(outsideEvent.payload).toMatchObject({
      targetBrix: 12.5,
      toleranceBrix: 0,
      targetVersion: changedTargetEventId,
      outcome: "fail",
    });
    const reopened = await req(QC_OPERATOR, "GET", `/api/qc/runs/${runId}`);
    expect(((await reopened.json() as { signoff: { signedOff: boolean; reopened: boolean } }).signoff))
      .toMatchObject({ signedOff: false, reopened: true });

    const correction = await req(QC_MANAGER, "POST", `/api/qc/events/${outsideEvent.id}/corrections`, {
      operationId: randomUUID(),
      reason: "Correct the instrument reading",
      replacement: { actualBrix: 12.5 },
    });
    expect(correction.status).toBe(201);
    const redaction = await req(QC_MANAGER, "POST", `/api/qc/events/${outsideEvent.id}/redactions`, {
      operationId: randomUUID(),
      reason: "Remove the optional instrument label",
      fields: ["payload.instrument"],
    });
    expect(redaction.status).toBe(201);
    const history = await req(QC_MANAGER, "GET", `/api/qc/history?runId=${encodeURIComponent(runId)}`);
    expect(history.status).toBe(200);
    const historyItems = (await history.json() as {
      items: Array<{ id: number; eventType: string; payload: Record<string, unknown>; corrected?: boolean; redactedFields?: string[] }>;
    }).items;
    const correctedBrix = historyItems.find((event) => event.id === outsideEvent.id);
    expect(correctedBrix).toMatchObject({
      eventType: "brix-check",
      corrected: true,
      redactedFields: ["payload.instrument"],
      payload: {
        actualBrix: 12.5,
        targetBrix: 12.5,
        toleranceBrix: 0,
        targetVersion: changedTargetEventId,
        outcome: "pass",
        instrument: "[redacted]",
      },
    });
    const clearedTarget = await req(QC_MANAGER, "POST", "/api/qc/brix-targets", {
      ...config,
      operationId: randomUUID(),
      targetBrix: null,
      toleranceBrix: null,
      reason: "Clear the reviewed Brix configuration",
    });
    expect(clearedTarget.status).toBe(201);
    const afterClear = await req(QC_OPERATOR, "POST", "/api/qc/brix-checks", {
      ...baseCheck,
      operationId: randomUUID(),
      actualBrix: 12.5,
    });
    expect(afterClear.status).toBe(201);
    expect(((await afterClear.json() as {
      event: { payload: Record<string, unknown> };
    }).event.payload)).toMatchObject({
      targetBrix: null,
      toleranceBrix: null,
      targetVersion: null,
      outcome: "not-evaluated",
    });
    const csv = await req(QC_MANAGER, "GET", `/api/qc/history.csv?runId=${encodeURIComponent(runId)}`);
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("brix-check");
    const scopeRows = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, "live"),
      eq(qcWorkflowEventsTable.runId, runId),
    ));
    expect(scopeRows.filter((event) => event.eventType === "brix-check").length).toBeGreaterThanOrEqual(5);
    expect(scopeRows.some((event) => event.eventType === "correction" && event.relatedEventId === String(outsideEvent.id))).toBe(true);
    expect(scopeRows.some((event) => event.eventType === "redaction" && event.relatedEventId === String(outsideEvent.id))).toBe(true);
  });

  it("reopens run sign-off after new evidence and requires independent cleaning verification", async () => {
    await seedQcWorkflowFixtures();
    expect((await req(QC_OPERATOR, "POST", "/api/qc/lots", {
      operationId: randomUUID(), runId: "qc-signoff-run", ingredientId: "qc-mozzarella",
      station: "frontline", lotNumber: "LOT-BEFORE-SIGNOFF",
    })).status).toBe(201);
    const signoff = () => req(QC_MANAGER, "POST", "/api/qc/run-signoffs", {
      operationId: randomUUID(), runId: "qc-signoff-run",
    });
    expect((await req(QC_OPERATOR, "POST", "/api/qc/run-signoffs", {
      operationId: randomUUID(), runId: "qc-signoff-run",
    })).status).toBe(403);
    expect((await signoff()).status).toBe(201);
    expect((await signoff()).status).toBe(409);
    const cleaning = await req(QC_OPERATOR, "POST", "/api/qc/cleaning-records", {
      operationId: randomUUID(), runId: "qc-signoff-run", method: "deep",
      startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      endedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });
    expect(cleaning.status).toBe(201);
    const eventId = ((await cleaning.json()) as { event: { id: number } }).event.id;
    const verificationPath = `/api/qc/cleaning-records/${eventId}/verification`;
    expect((await req(QC_OPERATOR, "POST", verificationPath, { operationId: randomUUID() })).status).toBe(400);
    expect((await req(QC_MANAGER, "POST", verificationPath, { operationId: randomUUID() })).status).toBe(201);
    expect((await req(QC_MANAGER, "POST", verificationPath, { operationId: randomUUID() })).status).toBe(409);

    expect((await req(QC_OPERATOR, "POST", "/api/qc/lots", {
      operationId: randomUUID(), runId: "qc-signoff-run", ingredientId: "qc-mozzarella",
      station: "frontline", lotNumber: "LOT-AFTER-SIGNOFF",
    })).status).toBe(201);
    const reopened = await req(QC_OPERATOR, "GET", "/api/qc/runs/qc-signoff-run");
    expect(((await reopened.json()) as { signoff: { signedOff: boolean; reopened: boolean } }).signoff)
      .toMatchObject({ signedOff: false, reopened: true });
    expect((await signoff()).status).toBe(201);
  });

  it("resolves component checks from canonical settings, evaluates them server-side, and audits retry/correction/redaction", async () => {
    await seedQcWorkflowFixtures();
    const date = facilityDate();
    const runId = "qc-components-run";
    const incompleteRunId = "qc-components-incomplete";
    const ambiguousRunId = "qc-components-ambiguous";
    const settings = {
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", ingredientId: "qc-dough", lbs: 10 }],
      frontlineRecipeName: "Jarred Marinara",
      frontlineRecipe: [],
      app1Type: "cheese",
      app1CheeseRecipeName: "Mozzarella",
      app1CheeseRecipe: [{ ingredient: "Mozzarella", ingredientId: "qc-mozzarella", lbs: 2 }],
      app2Type: "",
      app2CheeseRecipeName: "",
      app2CheeseRecipe: [],
      app3Type: "",
      app3CheeseRecipeName: "",
      app3CheeseRecipe: [],
      app4Type: "",
      app4CheeseRecipeName: "",
      app4CheeseRecipe: [],
      pep1Type: "Pepperoni",
      pep1TypeB: "",
      pep2Type: "",
      pep2TypeB: "",
    };
    const substitutions = [{
      id: "qc-flour-sub",
      ingredient: "Flour",
      action: "swap",
      substitute: "Rice Flour",
    }];
    await db.delete(dailySyncTable).where(and(
      eq(dailySyncTable.date, date),
      eq(dailySyncTable.scope, "live"),
    ));
    await db.insert(dailySyncTable).values({
      date,
      scope: "live",
      canonicalRevision: 7,
      data: {
        dayState: {
          date,
          runs: [
            { id: runId, brand: "QC Brand", flavor: "QC Flavor", subTab: "dough" },
            { id: incompleteRunId, brand: "QC Brand", flavor: "Incomplete", subTab: "dough" },
            { id: ambiguousRunId, brand: "QC Brand", flavor: "Ambiguous", subTab: "dough" },
            { id: ambiguousRunId, brand: "QC Brand", flavor: "Ambiguous", subTab: "dough" },
          ],
          substitutions,
        },
        runValues: {
          [runId]: settings,
          [incompleteRunId]: { ...settings, doughRecipe: [] },
        },
      },
    });

    const signoff = await req(QC_MANAGER, "POST", "/api/qc/run-signoffs", {
      operationId: randomUUID(),
      runId,
    });
    expect(signoff.status).toBe(201);

    const checklistRes = await req(QC_OPERATOR, "GET", `/api/qc/runs/${runId}`);
    expect(checklistRes.status).toBe(200);
    const checklistData = await checklistRes.json() as {
      componentChecklist: {
        status: string;
        issues: Array<{ setting: string; message: string }>;
        source: { kind: string; date: string; revision: string } | null;
        expectedComponents: Array<{ componentId: string; name: string }>;
      };
    };
    expect(checklistData.componentChecklist).toMatchObject({
      status: "complete",
      source: { kind: "current-day-canonical-settings", date, revision: "7" },
    });
    expect(checklistData.componentChecklist.expectedComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentId: "dough:0", name: "Rice Flour" }),
      expect.objectContaining({ componentId: "sauce:product", name: "Jarred Marinara" }),
      expect.objectContaining({ componentId: "app1:0", name: "Mozzarella" }),
    ]));
    const observations = checklistData.componentChecklist.expectedComponents.map((component) => ({
      componentId: component.componentId,
      observation: "present-correct",
    }));
    const operationId = randomUUID();
    const componentBody = { operationId, runId, observations, note: "Checked against the run setup" };

    expect((await req(WAREHOUSE, "POST", "/api/qc/component-checks", componentBody)).status).toBe(403);
    expect((await req(QC_OPERATOR, "POST", "/api/qc/component-checks", {
      ...componentBody,
      expectedComponents: checklistData.componentChecklist.expectedComponents,
    })).status).toBe(400);

    const saved = await req(QC_OPERATOR, "POST", "/api/qc/component-checks", componentBody);
    expect(saved.status).toBe(201);
    const savedData = await saved.json() as {
      event: { id: number; actorId: string; createdAt: string; payload: Record<string, unknown> };
      duplicate: boolean;
    };
    expect(savedData.duplicate).toBe(false);
    expect(savedData.event).toMatchObject({
      actorId: QC_OPERATOR,
      payload: { expectedStatus: "complete", outcome: "pass", note: "Checked against the run setup" },
    });
    expect(Number.isNaN(Date.parse(savedData.event.createdAt))).toBe(false);

    const retry = await req(QC_OPERATOR, "POST", "/api/qc/component-checks", componentBody);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      duplicate: true,
      event: { id: savedData.event.id },
    });
    expect((await req(QC_OPERATOR, "POST", "/api/qc/component-checks", {
      ...componentBody,
      note: "Changed input with the old operation ID",
    })).status).toBe(409);

    const reopened = await req(QC_OPERATOR, "GET", `/api/qc/runs/${runId}`);
    expect(((await reopened.json()) as { signoff: { signedOff: boolean; reopened: boolean } }).signoff)
      .toMatchObject({ signedOff: false, reopened: true });

    expect((await req(QC_OPERATOR, "POST", `/api/qc/events/${savedData.event.id}/corrections`, {
      operationId: randomUUID(),
      reason: "Correct the observed presence",
      replacement: { observations: [{ componentId: "dough:0", observation: "missing" }] },
    })).status).toBe(403);
    expect((await req(QC_MANAGER, "POST", `/api/qc/events/${savedData.event.id}/corrections`, {
      operationId: randomUUID(),
      reason: "Correct the observed presence",
      replacement: { observations: [{ componentId: "dough:0", observation: "missing" }] },
    })).status).toBe(201);
    expect((await req(QC_MANAGER, "POST", `/api/qc/events/${savedData.event.id}/redactions`, {
      operationId: randomUUID(),
      reason: "Remove component identities from the history view",
      fields: ["payload.expectedComponents"],
    })).status).toBe(201);

    const componentEventsBeforeSignoff = await db.select({
      id: qcWorkflowEventsTable.id,
    }).from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, "live"),
      eq(qcWorkflowEventsTable.runId, runId),
      sql`${qcWorkflowEventsTable.eventType} <> 'run-signoff'`,
      sql`${qcWorkflowEventsTable.eventType} <> 'target-setting'`,
    ));
    const expectedReviewedThroughId = Math.max(
      ...componentEventsBeforeSignoff.map((event) => event.id),
    );
    const componentSignoffResponse = await req(QC_MANAGER, "POST", "/api/qc/run-signoffs", {
      operationId: randomUUID(),
      runId,
    });
    expect(componentSignoffResponse.status).toBe(201);
    const componentSignoff = await componentSignoffResponse.json() as {
      event: { actorId: string; payload: { reviewedThroughId: number } };
    };
    expect(componentSignoff.event).toMatchObject({
      actorId: QC_MANAGER,
      payload: { reviewedThroughId: expectedReviewedThroughId },
    });
    const signedComponentRun = await req(QC_OPERATOR, "GET", `/api/qc/runs/${runId}`);
    expect(((await signedComponentRun.json()) as {
      signoff: { signedOff: boolean; reopened: boolean };
    }).signoff).toMatchObject({ signedOff: true, reopened: false });

    expect((await req(QC_MANAGER, "POST", `/api/qc/events/${savedData.event.id}/corrections`, {
      operationId: randomUUID(),
      reason: "Correct the observation after sign-off",
      replacement: { observations: [{ componentId: "dough:0", observation: "present-mismatch" }] },
    })).status).toBe(201);
    const reopenedAfterCorrection = await req(QC_OPERATOR, "GET", `/api/qc/runs/${runId}`);
    expect(((await reopenedAfterCorrection.json()) as {
      signoff: { signedOff: boolean; reopened: boolean };
    }).signoff).toMatchObject({ signedOff: false, reopened: true });

    const history = await req(QC_OPERATOR, "GET", `/api/qc/runs/${runId}`);
    const historyItems = (await history.json() as {
      items: Array<{ eventType: string; corrected?: boolean; redactedFields?: string[]; payload: Record<string, unknown> }>;
    }).items;
    const checkedEvent = historyItems.find((event) => event.eventType === "component-check");
    expect(checkedEvent).toMatchObject({
      corrected: true,
      redactedFields: ["payload.expectedComponents"],
      payload: { outcome: "fail", expectedComponents: "[redacted]" },
    });

    const incompleteEvent = await req(QC_OPERATOR, "POST", "/api/qc/component-checks", {
      operationId: randomUUID(), runId: incompleteRunId, observations: [],
    });
    expect(incompleteEvent.status).toBe(201);
    expect(((await incompleteEvent.json()) as { event: { payload: Record<string, unknown> } }).event.payload)
      .toMatchObject({
        expectedStatus: "incomplete",
        outcome: "not-evaluated",
        expectedIssues: expect.arrayContaining([
          expect.objectContaining({ setting: "Dough recipe" }),
        ]),
      });
    const incompleteChecklist = await req(QC_OPERATOR, "GET", `/api/qc/runs/${incompleteRunId}`);
    expect(((await incompleteChecklist.json()) as {
      componentChecklist: { status: string; issues: Array<{ setting: string; message: string }> };
    }).componentChecklist).toMatchObject({
      status: "incomplete",
      issues: expect.arrayContaining([
        expect.objectContaining({ setting: "Dough recipe" }),
      ]),
    });
    const ambiguousEvent = await req(QC_OPERATOR, "POST", "/api/qc/component-checks", {
      operationId: randomUUID(), runId: ambiguousRunId, observations: [],
    });
    expect(ambiguousEvent.status).toBe(201);
    expect(((await ambiguousEvent.json()) as { event: { payload: Record<string, unknown> } }).event.payload)
      .toMatchObject({ expectedStatus: "incomplete", outcome: "not-evaluated" });
    const ambiguousChecklist = await req(QC_OPERATOR, "GET", `/api/qc/runs/${ambiguousRunId}`);
    const ambiguousChecklistPayload = ((await ambiguousChecklist.json()) as {
      componentChecklist: {
        status: string;
        reason: string;
        issues: Array<{ setting: string; message: string }>;
        expectedComponents: unknown[];
      };
    }).componentChecklist;
    expect(ambiguousChecklistPayload).toMatchObject({
      status: "incomplete",
      reason: "The current run snapshot is incomplete or ambiguous.",
      issues: [{
        setting: "Canonical run settings",
        message: "The current run snapshot is incomplete or ambiguous.",
      }],
      expectedComponents: [],
    });

    const completedRunId = "qc-components-completed";
    const startedAt = Date.now() - 60_000;
    const endedAt = Date.now() - 1_000;
    const completedSnapshot = {
      dayState: {
        date,
        runs: [{
          id: completedRunId,
          brand: "QC Brand",
          flavor: "QC Flavor",
          subTab: "dough",
          startedAt,
          endedAt,
        }],
        substitutions,
      },
      runValues: { [completedRunId]: settings },
    };
    expect((await req(QC_OPERATOR, "POST", "/api/completed-history", {
      operationId: randomUUID(),
      runId: completedRunId,
      date,
      completedAt: new Date(endedAt).toISOString(),
      snapshot: completedSnapshot,
    })).status).toBe(201);
    const completedChecklist = await req(QC_OPERATOR, "GET", `/api/qc/runs/${completedRunId}`);
    expect(((await completedChecklist.json()) as {
      componentChecklist: { status: string; source: { kind: string } | null; expectedComponents: Array<{ name: string }> };
    }).componentChecklist).toMatchObject({
      status: "complete",
      source: { kind: "completed-run-snapshot" },
      expectedComponents: expect.arrayContaining([expect.objectContaining({ name: "Rice Flour" })]),
    });
  });

  it("keeps incomplete allergen states visible and appends audited corrections and redactions", async () => {
    await seedQcWorkflowFixtures();
    const review = await req(QC_OPERATOR, "POST", "/api/qc/allergen-reviews", {
      operationId: randomUUID(),
      runId: "qc-allergen-run",
      footprintReviewed: true,
      footprint: {
        status: "incomplete",
        allergens: ["milk"],
        unknownIngredients: ["Unreviewed seasoning"],
        missingComponents: ["sauce"],
      },
      stagedIngredients: [
        { area: "Frontline", name: "Mozzarella", quantity: "24", unit: "lbs", staged: true },
        { area: "Dough", name: "Flour", quantity: "18", unit: "lbs", staged: false },
      ],
      stagedIngredientsStatus: "unknown",
      cleaningStatus: "unknown",
      note: "Catalog review remains incomplete",
    });
    expect(review.status).toBe(201);
    expect(((await review.json()) as { event: { payload: Record<string, unknown> } }).event.payload)
      .toMatchObject({
        footprint: {
          status: "incomplete",
          allergens: ["milk"],
          unknownIngredients: ["Unreviewed seasoning"],
          missingComponents: ["sauce"],
        },
        stagedIngredients: [
          { area: "Frontline", name: "Mozzarella", quantity: "24", unit: "lbs", staged: true },
          { area: "Dough", name: "Flour", quantity: "18", unit: "lbs", staged: false },
        ],
        stagedIngredientsStatus: "unknown",
        cleaningStatus: "unknown",
      });

    const lot = await req(QC_OPERATOR, "POST", "/api/qc/lots", {
      operationId: randomUUID(), runId: "qc-audit-run", ingredientId: "qc-mozzarella",
      station: "frontline", lotNumber: "LOT-ORIGINAL", note: "Free-text note",
    });
    const originalId = ((await lot.json()) as { event: { id: number } }).event.id;
    expect((await req(QC_OPERATOR, "POST", `/api/qc/events/${originalId}/corrections`, {
      operationId: randomUUID(), reason: "Correct transcribed lot number",
      replacement: { lotNumber: "LOT-CORRECTED" },
    })).status).toBe(403);
    expect((await req(QC_MANAGER, "POST", `/api/qc/events/${originalId}/corrections`, {
      operationId: randomUUID(), reason: "Correct transcribed lot number",
      replacement: { lotNumber: "LOT-CORRECTED", note: "Corrected private note" },
    })).status).toBe(201);
    expect((await req(QC_MANAGER, "POST", `/api/qc/events/${originalId}/redactions`, {
      operationId: randomUUID(), reason: "Privacy request for free-text note",
      fields: ["payload.note"],
    })).status).toBe(201);
    const history = await req(QC_OPERATOR, "GET", "/api/qc/history?runId=qc-audit-run");
    const events = (await history.json() as {
      items: Array<{
        eventType: string; actorId: string | null; corrected?: boolean;
        redactedFields?: string[]; payload: Record<string, unknown>;
      }>;
    }).items;
    const displayedLot = events.find((event) => event.eventType === "lot");
    expect(displayedLot).toMatchObject({
      actorId: QC_OPERATOR,
      corrected: true,
      redactedFields: ["payload.note"],
      payload: { lotNumber: "LOT-CORRECTED", note: "[redacted]" },
    });
    const operatorAuditRows = events.filter((event) =>
      event.eventType === "correction" || event.eventType === "redaction",
    );
    expect(operatorAuditRows).toHaveLength(2);
    expect(operatorAuditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "correction", actorId: null, payload: {} }),
      expect.objectContaining({ eventType: "redaction", actorId: null, payload: {} }),
    ]));
    expect(JSON.stringify(operatorAuditRows)).not.toContain("Correct transcribed lot number");
    expect(JSON.stringify(operatorAuditRows)).not.toContain("Privacy request for free-text note");
    expect(JSON.stringify(operatorAuditRows)).not.toContain("LOT-CORRECTED");
    const managerHistory = await req(QC_MANAGER, "GET", "/api/qc/history?runId=qc-audit-run");
    const managerAuditRows = ((await managerHistory.json()) as {
      items: Array<{ eventType: string; actorId: string | null; payload: Record<string, unknown> }>;
    }).items.filter((event) =>
      event.eventType === "correction" || event.eventType === "redaction",
    );
    expect(managerAuditRows).toHaveLength(2);
    expect(managerAuditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "correction",
        actorId: QC_MANAGER,
        payload: { reason: "Correct transcribed lot number" },
      }),
      expect.objectContaining({
        eventType: "redaction",
        actorId: QC_MANAGER,
        payload: { reason: "Privacy request for free-text note" },
      }),
    ]));
    expect(JSON.stringify(managerAuditRows)).not.toContain("Corrected private note");
    const operatorRun = await req(QC_OPERATOR, "GET", "/api/qc/runs/qc-audit-run");
    const operatorRunAuditRows = ((await operatorRun.json()) as {
      items: Array<{ eventType: string; actorId: string | null; payload: Record<string, unknown> }>;
    }).items.filter((event) => event.eventType === "correction" || event.eventType === "redaction");
    expect(operatorRunAuditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "correction", actorId: null, payload: {} }),
      expect.objectContaining({ eventType: "redaction", actorId: null, payload: {} }),
    ]));
    const managerRun = await req(QC_MANAGER, "GET", "/api/qc/runs/qc-audit-run");
    const managerRunAuditRows = ((await managerRun.json()) as {
      items: Array<{ eventType: string; actorId: string | null; payload: Record<string, unknown> }>;
    }).items.filter((event) => event.eventType === "correction" || event.eventType === "redaction");
    expect(managerRunAuditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "correction",
        actorId: QC_MANAGER,
        payload: { reason: "Correct transcribed lot number" },
      }),
      expect.objectContaining({
        eventType: "redaction",
        actorId: QC_MANAGER,
        payload: { reason: "Privacy request for free-text note" },
      }),
    ]));
    expect(JSON.stringify(managerRunAuditRows)).not.toContain("Corrected private note");
    const managerCsv = await req(QC_MANAGER, "GET", "/api/qc/history.csv?runId=qc-audit-run");
    const managerCsvText = await managerCsv.text();
    expect(managerCsv.status).toBe(200);
    expect(managerCsvText).toContain("Correct transcribed lot number");
    expect(managerCsvText).toContain("Privacy request for free-text note");
    expect(managerCsvText).toContain("[redacted]");
    expect(managerCsvText).not.toContain("Free-text note");
    expect(managerCsvText).not.toContain("Corrected private note");
    const [sandboxTarget] = await db.insert(qcWorkflowEventsTable).values({
      scope: "sandbox",
      operationId: randomUUID(),
      recordId: randomUUID(),
      eventType: "lot",
      runId: "qc-audit-run",
      actorId: QC_OPERATOR,
      payload: { lotNumber: "SANDBOX-LOT" },
    }).returning({ id: qcWorkflowEventsTable.id });
    await db.insert(qcWorkflowEventsTable).values({
      scope: "sandbox",
      operationId: randomUUID(),
      recordId: randomUUID(),
      eventType: "correction",
      runId: "qc-audit-run",
      relatedEventId: String(sandboxTarget!.id),
      actorId: QC_MANAGER,
      payload: { reason: "Sandbox-only correction reason", replacement: { lotNumber: "SANDBOX-CORRECTED" } },
    });
    await db.update(userRolesTable).set({ role: "qc-manager" })
      .where(eq(userRolesTable.userId, SANDBOX));
    const sandboxManagerHistory = await req(SANDBOX, "GET", "/api/qc/history?runId=qc-audit-run");
    const sandboxAuditRows = ((await sandboxManagerHistory.json()) as {
      items: Array<{ eventType: string; actorId: string | null; payload: Record<string, unknown> }>;
    }).items.filter((event) => event.eventType === "correction" || event.eventType === "redaction");
    expect(sandboxAuditRows).toEqual([
      expect.objectContaining({ eventType: "correction", actorId: null, payload: {} }),
    ]);
    expect(JSON.stringify(sandboxAuditRows)).not.toContain("Sandbox-only correction reason");
    const updateError = await db.update(qcWorkflowEventsTable).set({ actorId: MANAGER })
      .where(eq(qcWorkflowEventsTable.id, originalId))
      .then(() => null, (error: unknown) => error);
    expect((updateError as { cause?: { message?: string } } | null)?.cause?.message)
      .toContain("qc_workflow_events is append-only");
    const deleteError = await db.delete(qcWorkflowEventsTable).where(eq(qcWorkflowEventsTable.id, originalId))
      .then(() => null, (error: unknown) => error);
    expect((deleteError as { cause?: { message?: string } } | null)?.cause?.message)
      .toContain("qc_workflow_events is append-only");
  });
});
