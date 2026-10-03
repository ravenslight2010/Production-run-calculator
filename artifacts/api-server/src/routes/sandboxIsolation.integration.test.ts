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
// Only the db-free helper (lib/auth's signLegacyTokenForTests) is a safe static import.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signLegacyTokenForTests } from "../lib/auth";
import { facilityDate } from "../lib/facilityTime";

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
let brandProfilesTable: DbModule["brandProfilesTable"];
let mergedAwayTable: DbModule["mergedAwayTable"];
let cheeseRecipesTable: DbModule["cheeseRecipesTable"];
let doughRecipesTable: DbModule["doughRecipesTable"];
let sauceRecipesTable: DbModule["sauceRecipesTable"];
let importAliasesTable: DbModule["importAliasesTable"];
let specImportAliasesTable: DbModule["specImportAliasesTable"];
let facilityKnowledgeTable: DbModule["facilityKnowledgeTable"];
let savedSpecSheetsTable: DbModule["savedSpecSheetsTable"];

let seedRoles: () => Promise<void>;
let seedSandboxUser: () => Promise<void>;
let SANDBOX_USERNAME: string;
let clearUserValidityCache: () => void;
let clearSessionBoundaryCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let originalFacilityTimeZone: string | undefined;
let server: Server;
let baseUrl: string;

const LIVE_MANAGER = "sandbox-isolation-live-manager";
const LIVE_MANAGER_USERNAME = "sandbox-isolation-live-manager";
const LIVE_OPERATOR = "sandbox-isolation-live-operator";
let sandboxUserId: string;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalFacilityTimeZone = process.env.FACILITY_TIME_ZONE;
  // The sync route uses the client date while the session fence reads the
  // facility-local date. Pin both to the same calendar in this disposable
  // fixture so the boundary assertion cannot depend on the host timezone.
  process.env.FACILITY_TIME_ZONE = "UTC";
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
  brandProfilesTable = dbMod.brandProfilesTable;
  mergedAwayTable = dbMod.mergedAwayTable;
  cheeseRecipesTable = dbMod.cheeseRecipesTable;
  doughRecipesTable = dbMod.doughRecipesTable;
  sauceRecipesTable = dbMod.sauceRecipesTable;
  importAliasesTable = dbMod.importAliasesTable;
  specImportAliasesTable = dbMod.specImportAliasesTable;
  facilityKnowledgeTable = dbMod.facilityKnowledgeTable;
  savedSpecSheetsTable = dbMod.savedSpecSheetsTable;
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

  await db.insert(usersTable).values({
    id: LIVE_MANAGER,
    username: LIVE_MANAGER_USERNAME,
    passwordHash: "x",
  });
  await db.insert(usersTable).values({
    id: LIVE_OPERATOR,
    username: LIVE_OPERATOR,
    passwordHash: "x",
  });
  await db.insert(userRolesTable).values([
    { userId: LIVE_MANAGER, role: "manager" },
    { userId: LIVE_OPERATOR, role: "operator" },
  ]);
}, 60_000);

afterAll(async () => {
  clearSessionBoundaryCache?.();
  clearUserValidityCache?.();
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
  if (originalFacilityTimeZone === undefined) delete process.env.FACILITY_TIME_ZONE;
  else process.env.FACILITY_TIME_ZONE = originalFacilityTimeZone;
}, 60_000);

beforeEach(async () => {
  // Wipe only the scoped DATA tables; the users / roles / role-catalog rows are
  // seeded once in beforeAll and must survive so the identity caches stay valid.
  await db.execute(
    sql`TRUNCATE ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryConsumedRunsTable}, ${inventoryItemsTable}, ${inventorySettingsTable}, ${productionRulesTable}, ${brandProfilesTable}, ${mergedAwayTable}, ${dailySyncTable}, ${cheeseRecipesTable}, ${doughRecipesTable}, ${sauceRecipesTable}, ${importAliasesTable}, ${specImportAliasesTable}, ${facilityKnowledgeTable}, ${savedSpecSheetsTable} RESTART IDENTITY CASCADE`,
  );
  // Clear after the disposable fixture is reset. This makes the first request
  // of every case read the boundary for the freshly truncated database rather
  // than a value cached by the preceding case.
  clearUserValidityCache();
  clearSessionBoundaryCache();
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
  if (userId) headers["authorization"] = `Bearer ${signLegacyTokenForTests(userId)}`;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ── Per-scope write helpers (all go through the real auth-gated HTTP path) ────

async function putDayState(userId: string, payload: unknown): Promise<void> {
  const res = await req(
    userId,
    "PUT",
    `/api/sync/today?today=${facilityDate()}`,
    { senderId: "test", payload },
  );
  expect(res.status).toBe(200);
}

async function getDayState(userId: string): Promise<unknown> {
  const res = await req(userId, "GET", "/api/sync/today");
  expect(res.status).toBe(200);
  return res.json();
}

async function createItem(userId: string, key: string, name = key): Promise<void> {
  const res = await req(userId, "POST", "/api/inventory/items", {
    key,
    category: "ingredient",
    name,
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

async function createRule(userId: string, id: string, name = id): Promise<void> {
  const res = await req(userId, "POST", "/api/production-rules", {
    rules: [
      { id, name, type: "required-field", enforcement: "flexible", enabled: true, field: "brand" },
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

async function listInventoryBody(userId: string): Promise<unknown[]> {
  const res = await req(userId, "GET", "/api/inventory");
  expect(res.status, "inventory read boundary").toBe(200);
  return (await res.json()) as unknown[];
}

async function listRuleBody(userId: string): Promise<unknown> {
  const res = await req(userId, "GET", "/api/production-rules");
  expect(res.status, "production rules read boundary").toBe(200);
  return res.json();
}

async function saveProfile(userId: string, flavor: string, dieType: string): Promise<void> {
  const res = await req(userId, "POST", "/api/brand-profiles", {
    items: [{
      key: `acme__${flavor}`,
      brand: "acme",
      flavor,
      values: { dieType },
      crustValues: {},
      updatedAt: 1_000,
    }],
  });
  expect(res.status).toBe(200);
}

async function listProfileKeys(userId: string): Promise<string[]> {
  const res = await req(userId, "GET", "/api/brand-profiles");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Array<{ key: string }> };
  return body.items.map((item) => item.key).sort();
}

async function addMergedAway(userId: string, name: string): Promise<void> {
  const res = await req(userId, "POST", "/api/merged-away", { names: [name] });
  expect(res.status).toBe(200);
}

async function listMergedAway(userId: string): Promise<string[]> {
  const res = await req(userId, "GET", "/api/merged-away");
  expect(res.status).toBe(200);
  return ((await res.json()) as { names: string[] }).names;
}

type NamedRecipeInput = {
  id: string;
  name: string;
  brand?: string;
  flavors?: string[];
  doughballWeightOz?: number;
  doughballsPerTray?: number;
};

function namedRecipe(input: NamedRecipeInput) {
  return {
    id: input.id,
    name: input.name,
    notes: "",
    components: [],
    enabled: true,
    brand: input.brand ?? "",
    flavors: input.flavors ?? [],
    ...(input.doughballWeightOz === undefined ? {} : { doughballWeightOz: input.doughballWeightOz }),
    ...(input.doughballsPerTray === undefined ? {} : { doughballsPerTray: input.doughballsPerTray }),
  };
}

function cheeseRecipe(id: string, name: string) {
  return {
    id,
    name,
    brand: "matrix-brand",
    flavors: ["matrix-flavor"],
    shredderSetting: "fine",
    cellulose: "",
    notes: "",
    components: [],
    enabled: true,
  };
}

async function saveRecipePool(
  userId: string,
  pathName: "/api/dough-recipes" | "/api/sauce-recipes" | "/api/cheese-recipes",
  item: unknown,
): Promise<void> {
  const res = await req(userId, "POST", pathName, { items: [item] });
  expect(res.status, `recipe pool ${pathName} manager write`).toBe(200);
}

async function listRecipePool(userId: string, pathName: string): Promise<unknown[]> {
  const res = await req(userId, "GET", pathName);
  expect(res.status, `recipe pool ${pathName} read boundary`).toBe(200);
  return ((await res.json()) as { items: unknown[] }).items;
}

async function listAliases(userId: string, pathName: "/api/import-aliases" | "/api/spec-import-aliases") {
  const res = await req(userId, "GET", pathName);
  expect(res.status, `aliases ${pathName} read boundary`).toBe(200);
  return ((await res.json()) as { aliases: unknown[] }).aliases;
}

async function saveAliases(
  userId: string,
  pathName: "/api/import-aliases" | "/api/spec-import-aliases",
  aliases: unknown[],
): Promise<void> {
  const res = await req(userId, "POST", pathName, { aliases });
  expect(res.status, `aliases ${pathName} manager write`).toBe(200);
}

async function listSpecSheets(userId: string): Promise<Array<{ id: number; label: string; data: unknown }>> {
  const res = await req(userId, "GET", "/api/spec-sheets");
  expect(res.status, "saved spec imports read boundary").toBe(200);
  return (await res.json() as { specSheets: Array<{ id: number; label: string; data: unknown }> }).specSheets;
}

async function saveSpecSheet(userId: string, label: string, marker: string): Promise<void> {
  const res = await req(userId, "POST", "/api/spec-sheets", {
    label,
    sourceKey: `${marker}.xlsx`,
    data: { recipes: [{ kind: "dough", name: marker, rows: [] }] },
  });
  expect(res.status, "saved spec imports manager write").toBe(200);
}

async function listFacilityMemory(userId: string): Promise<unknown[]> {
  const res = await req(userId, "GET", "/api/ai-memory/facility");
  expect(res.status, "AI facility memory read boundary").toBe(200);
  return ((await res.json()) as { knowledge: unknown[] }).knowledge;
}

// ┌──────────────────────── ISOLATION MATRIX ──────────────────────────────┐
// │ Family                 │ representative HTTP read │ manager-only write │
// │ setup profiles         │ GET /brand-profiles       │ POST /brand-profiles│
// │ inventory              │ GET /inventory             │ POST /inventory/items│
// │ sync day state         │ GET /sync/today            │ PUT /sync/today     │
// │ recipe pools (3)       │ GET /{dough,sauce,cheese}-recipes              │
// │ import aliases         │ GET/POST /import-aliases                        │
// │ spec aliases           │ GET/POST /spec-import-aliases                   │
// │ AI facility memory     │ GET /ai-memory/facility                         │
// │ saved spec imports     │ GET/POST /spec-sheets                           │
// └─────────────────────────────────────────────────────────────────────────┘
// Every row below is exercised through the actual /api router.  Rows are
// deliberately given the same identity in both scopes where the endpoint
// supports upsert, making an accidental unscoped overwrite observable.
describe("ISOLATION MATRIX — live ↔ sandbox data families", () => {
  it("keeps every required family read/write isolated and names each boundary", async () => {
    // The same IDs/keys are intentional: a scope-blind upsert would overwrite
    // the other actor's marker rather than merely creating a second row.
    await saveProfile(LIVE_MANAGER, "matrix", "live-profile");
    await saveProfile(sandboxUserId, "matrix", "sandbox-profile");
    await createItem(LIVE_MANAGER, "matrix-item", "live-inventory-only");
    await createItem(sandboxUserId, "matrix-item", "sandbox-inventory-only");
    await putDayState(LIVE_MANAGER, { dayState: { runs: [], resetAt: 0, shiftNotes: "live-day-matrix" } });
    await putDayState(sandboxUserId, { dayState: { runs: [], resetAt: 0, shiftNotes: "sandbox-day-matrix" } });
    await createRule(LIVE_MANAGER, "matrix-rule", "live-rule-only");
    await createRule(sandboxUserId, "matrix-rule", "sandbox-rule-only");

    for (const [pathName, liveName, sandboxName] of [
      ["/api/dough-recipes", "live-dough", "sandbox-dough"],
      ["/api/sauce-recipes", "live-sauce", "sandbox-sauce"],
    ] as const) {
      await saveRecipePool(LIVE_MANAGER, pathName, namedRecipe({ id: "matrix-recipe", name: liveName }));
      await saveRecipePool(sandboxUserId, pathName, namedRecipe({ id: "matrix-recipe", name: sandboxName }));
    }
    await saveRecipePool(LIVE_MANAGER, "/api/cheese-recipes", cheeseRecipe("matrix-cheese", "live-cheese"));
    await saveRecipePool(sandboxUserId, "/api/cheese-recipes", cheeseRecipe("matrix-cheese", "sandbox-cheese"));

    await saveAliases(LIVE_MANAGER, "/api/import-aliases", [{
      type: "brand", externalName: "Matrix Imported Brand", canonicalName: "Live Brand",
    }]);
    await saveAliases(sandboxUserId, "/api/import-aliases", [{
      type: "brand", externalName: "Matrix Imported Brand", canonicalName: "Sandbox Brand",
    }]);
    await saveAliases(LIVE_MANAGER, "/api/spec-import-aliases", [{
      kind: "brand", externalName: "Matrix Sheet Brand", canonicalName: "Live Sheet Brand",
    }]);
    await saveAliases(sandboxUserId, "/api/spec-import-aliases", [{
      kind: "brand", externalName: "Matrix Sheet Brand", canonicalName: "Sandbox Sheet Brand",
    }]);

    await saveSpecSheet(LIVE_MANAGER, "live-spec-import", "live-spec-import");
    await saveSpecSheet(sandboxUserId, "sandbox-spec-import", "sandbox-spec-import");

    // Facility memory is intentionally seeded at the DB seam because the
    // production HTTP write surface rejects arbitrary client-authored facts.
    // The real HTTP GET still proves that prompt-grounding memory is scoped.
    await db.insert(facilityKnowledgeTable).values([
      {
        scope: "live",
        domain: "matrix",
        key: "shared-key",
        fact: "live-facility-memory-only",
        source: "isolation-test",
      },
      {
        scope: "sandbox",
        domain: "matrix",
        key: "shared-key",
        fact: "sandbox-facility-memory-only",
        source: "isolation-test",
      },
    ]);

    const liveDay = await getDayState(LIVE_MANAGER) as Record<string, unknown>;
    const sandboxDay = await getDayState(sandboxUserId) as Record<string, unknown>;
    expect((liveDay.dayState as Record<string, unknown>)?.shiftNotes, "sync day state live→live").toBe("live-day-matrix");
    expect((sandboxDay.dayState as Record<string, unknown>)?.shiftNotes, "sync day state sandbox→sandbox").toBe("sandbox-day-matrix");
    expect(JSON.stringify(liveDay), "sync day state live cannot infer sandbox").not.toContain("sandbox-day-matrix");
    expect(JSON.stringify(sandboxDay), "sync day state sandbox cannot infer live").not.toContain("live-day-matrix");
    expect(await listItemKeys(LIVE_MANAGER), "inventory live→live").toEqual(["matrix-item"]);
    expect(await listItemKeys(sandboxUserId), "inventory sandbox→sandbox").toEqual(["matrix-item"]);
    expect(JSON.stringify(await listInventoryBody(LIVE_MANAGER)), "inventory live cannot infer sandbox").toContain("live-inventory-only");
    expect(JSON.stringify(await listInventoryBody(LIVE_MANAGER)), "inventory live cannot infer sandbox").not.toContain("sandbox-inventory-only");
    expect(JSON.stringify(await listInventoryBody(sandboxUserId)), "inventory sandbox cannot infer live").toContain("sandbox-inventory-only");
    expect(JSON.stringify(await listInventoryBody(sandboxUserId)), "inventory sandbox cannot infer live").not.toContain("live-inventory-only");
    expect(await listRuleIds(LIVE_MANAGER), "production rules live→live").toEqual(["matrix-rule"]);
    expect(await listRuleIds(sandboxUserId), "production rules sandbox→sandbox").toEqual(["matrix-rule"]);
    expect(JSON.stringify(await listRuleBody(LIVE_MANAGER)), "production rules live cannot infer sandbox").toContain("live-rule-only");
    expect(JSON.stringify(await listRuleBody(LIVE_MANAGER)), "production rules live cannot infer sandbox").not.toContain("sandbox-rule-only");
    expect(JSON.stringify(await listRuleBody(sandboxUserId)), "production rules sandbox cannot infer live").toContain("sandbox-rule-only");
    expect(JSON.stringify(await listRuleBody(sandboxUserId)), "production rules sandbox cannot infer live").not.toContain("live-rule-only");
    expect((await listProfileKeys(LIVE_MANAGER)), "setup profiles live→live").toEqual(["acme__matrix"]);
    expect((await listProfileKeys(sandboxUserId)), "setup profiles sandbox→sandbox").toEqual(["acme__matrix"]);
    const liveProfileBody = JSON.stringify(await req(LIVE_MANAGER, "GET", "/api/brand-profiles").then((r) => r.json()));
    const sandboxProfileBody = JSON.stringify(await req(sandboxUserId, "GET", "/api/brand-profiles").then((r) => r.json()));
    expect(liveProfileBody, "setup profiles live cannot infer sandbox").not.toContain("sandbox-profile");
    expect(sandboxProfileBody, "setup profiles sandbox cannot infer live").not.toContain("live-profile");

    for (const [pathName, liveName, sandboxName] of [
      ["/api/dough-recipes", "live-dough", "sandbox-dough"],
      ["/api/sauce-recipes", "live-sauce", "sandbox-sauce"],
    ] as const) {
      const live = JSON.stringify(await listRecipePool(LIVE_MANAGER, pathName));
      const sandbox = JSON.stringify(await listRecipePool(sandboxUserId, pathName));
      expect(live, `recipe pool ${pathName} live cannot infer sandbox`).toContain(liveName);
      expect(live, `recipe pool ${pathName} live cannot infer sandbox`).not.toContain(sandboxName);
      expect(sandbox, `recipe pool ${pathName} sandbox cannot infer live`).toContain(sandboxName);
      expect(sandbox, `recipe pool ${pathName} sandbox cannot infer live`).not.toContain(liveName);
    }
    const liveCheese = JSON.stringify(await listRecipePool(LIVE_MANAGER, "/api/cheese-recipes"));
    const sandboxCheese = JSON.stringify(await listRecipePool(sandboxUserId, "/api/cheese-recipes"));
    expect(liveCheese, "recipe pool cheese live cannot infer sandbox").toContain("live-cheese");
    expect(liveCheese, "recipe pool cheese live cannot infer sandbox").not.toContain("sandbox-cheese");
    expect(sandboxCheese, "recipe pool cheese sandbox cannot infer live").toContain("sandbox-cheese");
    expect(sandboxCheese, "recipe pool cheese sandbox cannot infer live").not.toContain("live-cheese");

    const liveImportAliases = JSON.stringify(await listAliases(LIVE_MANAGER, "/api/import-aliases"));
    const sandboxImportAliases = JSON.stringify(await listAliases(sandboxUserId, "/api/import-aliases"));
    expect(liveImportAliases, "import aliases live cannot infer sandbox").toContain("Live Brand");
    expect(liveImportAliases, "import aliases live cannot infer sandbox").not.toContain("Sandbox Brand");
    expect(sandboxImportAliases, "import aliases sandbox cannot infer live").toContain("Sandbox Brand");
    expect(sandboxImportAliases, "import aliases sandbox cannot infer live").not.toContain("Live Brand");
    const liveSpecAliases = JSON.stringify(await listAliases(LIVE_MANAGER, "/api/spec-import-aliases"));
    const sandboxSpecAliases = JSON.stringify(await listAliases(sandboxUserId, "/api/spec-import-aliases"));
    expect(liveSpecAliases, "spec aliases live cannot infer sandbox").toContain("Live Sheet Brand");
    expect(liveSpecAliases, "spec aliases live cannot infer sandbox").not.toContain("Sandbox Sheet Brand");
    expect(sandboxSpecAliases, "spec aliases sandbox cannot infer live").toContain("Sandbox Sheet Brand");
    expect(sandboxSpecAliases, "spec aliases sandbox cannot infer live").not.toContain("Live Sheet Brand");

    const liveSpecs = JSON.stringify(await listSpecSheets(LIVE_MANAGER));
    const sandboxSpecs = await listSpecSheets(sandboxUserId);
    expect(liveSpecs, "saved spec imports live cannot infer sandbox").toContain("live-spec-import");
    expect(liveSpecs, "saved spec imports live cannot infer sandbox").not.toContain("sandbox-spec-import");
    expect(JSON.stringify(sandboxSpecs), "saved spec imports sandbox cannot infer live").toContain("sandbox-spec-import");
    expect(JSON.stringify(sandboxSpecs), "saved spec imports sandbox cannot infer live").not.toContain("live-spec-import");
    const sandboxSpecId = sandboxSpecs[0]?.id;
    expect(sandboxSpecId, "saved spec imports sandbox row exists before cross-scope delete").toEqual(expect.any(Number));
    const crossScopeDelete = await req(LIVE_MANAGER, "DELETE", `/api/spec-sheets/${sandboxSpecId}`);
    expect(crossScopeDelete.status, "saved spec imports live cannot overwrite sandbox via delete").toBe(200);
    expect(JSON.stringify(await listSpecSheets(sandboxUserId)), "saved spec imports sandbox survives live delete").toContain("sandbox-spec-import");

    const liveMemory = JSON.stringify(await listFacilityMemory(LIVE_MANAGER));
    const sandboxMemory = JSON.stringify(await listFacilityMemory(sandboxUserId));
    expect(liveMemory, "AI facility memory live cannot infer sandbox").toContain("live-facility-memory-only");
    expect(liveMemory, "AI facility memory live cannot infer sandbox").not.toContain("sandbox-facility-memory-only");
    expect(sandboxMemory, "AI facility memory sandbox cannot infer live").toContain("sandbox-facility-memory-only");
    expect(sandboxMemory, "AI facility memory sandbox cannot infer live").not.toContain("live-facility-memory-only");

    // Operator reads use the caller's live scope, but representative
    // manager-only writes are rejected before they can overwrite live data.
    const operatorReads = [
      ["/api/brand-profiles", "GET"],
      ["/api/inventory", "GET"],
      ["/api/production-rules", "GET"],
      ["/api/dough-recipes", "GET"],
      ["/api/sauce-recipes", "GET"],
      ["/api/cheese-recipes", "GET"],
      ["/api/import-aliases", "GET"],
      ["/api/spec-import-aliases", "GET"],
      ["/api/spec-sheets", "GET"],
    ] as const;
    for (const [pathName, method] of operatorReads) {
      const response = await req(LIVE_OPERATOR, method, pathName);
      expect(response.status, `operator read ${pathName} stays in live boundary`).toBe(200);
      const body = await response.text();
      expect(body, `operator read ${pathName} cannot infer sandbox`).not.toContain("sandbox-");
    }
    const operatorWrites: Array<[string, unknown]> = [
      ["/api/brand-profiles", { items: [{ key: "acme__matrix", brand: "acme", flavor: "matrix", values: { dieType: "operator-overwrite" }, crustValues: {}, updatedAt: 999_999, force: true }] }],
      ["/api/inventory/items", { key: "operator-item", category: "ingredient", name: "operator-item", unit: "lbs" }],
      ["/api/production-rules", { rules: [{ id: "operator-rule", name: "operator-rule", type: "required-field", enforcement: "flexible", enabled: true, field: "brand" }] }],
      ["/api/dough-recipes", { items: [namedRecipe({ id: "matrix-recipe", name: "operator-dough" })] }],
      ["/api/sauce-recipes", { items: [namedRecipe({ id: "matrix-recipe", name: "operator-sauce" })] }],
      ["/api/cheese-recipes", { items: [cheeseRecipe("matrix-cheese", "operator-cheese")] }],
      ["/api/import-aliases", { aliases: [{ type: "brand", externalName: "Matrix Imported Brand", canonicalName: "Operator Brand" }] }],
      ["/api/spec-import-aliases", { aliases: [{ kind: "brand", externalName: "Matrix Sheet Brand", canonicalName: "Operator Sheet Brand" }] }],
      ["/api/spec-sheets", { label: "operator-spec-import", data: { recipes: [] } }],
    ];
    for (const [pathName, body] of operatorWrites) {
      const response = await req(LIVE_OPERATOR, "POST", pathName, body);
      expect(response.status, `operator manager-only write ${pathName} rejected in live boundary`).toBe(403);
    }
    const liveProfilesAfterOperator = JSON.stringify(await req(LIVE_MANAGER, "GET", "/api/brand-profiles").then((r) => r.json()));
    expect(liveProfilesAfterOperator, "operator cannot overwrite setup profiles live").toContain("live-profile");
    expect(liveProfilesAfterOperator, "operator cannot overwrite setup profiles live").not.toContain("operator-overwrite");
    expect(JSON.stringify(await listRecipePool(LIVE_MANAGER, "/api/dough-recipes")), "operator cannot overwrite dough live").toContain("live-dough");
    expect(JSON.stringify(await listAliases(LIVE_MANAGER, "/api/import-aliases")), "operator cannot overwrite import aliases live").not.toContain("Operator Brand");
    expect(JSON.stringify(await listSpecSheets(LIVE_MANAGER)), "operator cannot overwrite saved specs live").not.toContain("operator-spec-import");
  }, 30_000);
});

describe("live ↔ sandbox scope isolation", () => {
  it("day-state, inventory, and production rules never cross between scopes", async () => {
    // Live writes its rows.
    await putDayState(LIVE_MANAGER, { dayState: { runs: [], resetAt: 0, shiftNotes: "live-day" } });
    await createItem(LIVE_MANAGER, "live-item");
    await createRule(LIVE_MANAGER, "live-rule");

    // Sandbox writes its own, distinct rows.
    await putDayState(sandboxUserId, { dayState: { runs: [], resetAt: 0, shiftNotes: "sandbox-day" } });
    await createItem(sandboxUserId, "sandbox-item");
    await createRule(sandboxUserId, "sandbox-rule");

    // Each scope reads back ONLY its own day-state.
    const liveDs = await getDayState(LIVE_MANAGER) as Record<string, unknown>;
    const sandboxDs = await getDayState(sandboxUserId) as Record<string, unknown>;
    expect((liveDs?.dayState as Record<string, unknown>)?.shiftNotes).toBe("live-day");
    expect((sandboxDs?.dayState as Record<string, unknown>)?.shiftNotes).toBe("sandbox-day");

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
  }, 20_000);

  it("setup profiles and durable merge tombstones never cross between scopes", async () => {
    await saveProfile(LIVE_MANAGER, "live-profile", "live-die");
    await saveProfile(sandboxUserId, "sandbox-profile", "sandbox-die");
    await addMergedAway(LIVE_MANAGER, "Live Ingredient");
    await addMergedAway(sandboxUserId, "Sandbox Ingredient");

    expect(await listProfileKeys(LIVE_MANAGER)).toEqual(["acme__live-profile"]);
    expect(await listProfileKeys(sandboxUserId)).toEqual(["acme__sandbox-profile"]);
    expect(await listMergedAway(LIVE_MANAGER)).toEqual(["live ingredient"]);
    expect(await listMergedAway(sandboxUserId)).toEqual(["sandbox ingredient"]);

    const profileScopes = (await db.select().from(brandProfilesTable)).map((row) => row.scope).sort();
    const tombstoneScopes = (await db.select().from(mergedAwayTable)).map((row) => row.scope).sort();
    expect(profileScopes).toEqual(["live", "sandbox"]);
    expect(tombstoneScopes).toEqual(["live", "sandbox"]);
  });
});

describe("POST /sandbox/reset re-copies live → sandbox", () => {
  it("wipes the sandbox's divergent edits and mirrors live, leaving live untouched", async () => {
    // Live is the source of truth.
    await putDayState(LIVE_MANAGER, { dayState: { runs: [], resetAt: 0, shiftNotes: "live-day" } });
    await createItem(LIVE_MANAGER, "live-item");
    await createRule(LIVE_MANAGER, "live-rule");

    // The sandbox diverges: a different day-state, a sandbox-only item, and a
    // sandbox-only rule.
    await putDayState(sandboxUserId, { dayState: { runs: [], resetAt: 0, shiftNotes: "sandbox-divergent" } });
    await createItem(sandboxUserId, "sandbox-only-item");
    await createRule(sandboxUserId, "sandbox-only-rule");

    // Reset (only the sandbox session may trigger it).
    const resetRes = await req(sandboxUserId, "POST", "/api/sandbox/reset");
    expect(resetRes.status).toBe(200);

    // The sandbox now mirrors live: divergent edits gone, live's rows copied in.
    const sandboxAfter = await getDayState(sandboxUserId) as Record<string, unknown>;
    expect((sandboxAfter?.dayState as Record<string, unknown>)?.shiftNotes).toBe("live-day");
    expect(await listItemKeys(sandboxUserId)).toEqual(["live-item"]);
    expect(await listRuleIds(sandboxUserId)).toEqual(["live-rule"]);

    // Live is completely unaffected by the reset.
    const liveAfter = await getDayState(LIVE_MANAGER) as Record<string, unknown>;
    expect((liveAfter?.dayState as Record<string, unknown>)?.shiftNotes).toBe("live-day");
    expect(await listItemKeys(LIVE_MANAGER)).toEqual(["live-item"]);
    expect(await listRuleIds(LIVE_MANAGER)).toEqual(["live-rule"]);
  });

  it("refuses a live session (403) and changes nothing", async () => {
    await putDayState(LIVE_MANAGER, { dayState: { runs: [], resetAt: 0, shiftNotes: "live-day" } });
    await createItem(LIVE_MANAGER, "live-item");

    const res = await req(LIVE_MANAGER, "POST", "/api/sandbox/reset");
    expect(res.status).toBe(403);

    // The live data the request could have clobbered is intact, and nothing was
    // copied into the sandbox.
    const liveDs = await getDayState(LIVE_MANAGER) as Record<string, unknown>;
    expect((liveDs?.dayState as Record<string, unknown>)?.shiftNotes).toBe("live-day");
    expect(await listItemKeys(LIVE_MANAGER)).toEqual(["live-item"]);
    expect(await listItemKeys(sandboxUserId)).toEqual([]);
  });
});

describe("sandbox sessions cannot cross the live-only staff boundary", () => {
  it("rejects protected staff reads and writes even for a sandbox manager", async () => {
    // seedSandboxUser assigns the manager role so these requests prove the
    // live-scope fence, rather than merely proving a missing capability.
    const protectedReads = [
      ["GET", "/api/roles"],
      ["GET", "/api/users"],
      ["GET", "/api/audit-logs"],
      ["GET", "/api/password-reset-requests"],
    ] as const;
    for (const [method, pathname] of protectedReads) {
      expect((await req(sandboxUserId, method, pathname)).status, `${method} ${pathname}`).toBe(403);
    }

    expect((await req(sandboxUserId, "POST", "/api/roles", {
      name: "sandbox-must-not-create",
      capabilities: [],
    })).status).toBe(403);
    expect((await req(sandboxUserId, "PUT", `/api/users/${LIVE_MANAGER}/role`, {
      role: "operator",
    })).status).toBe(403);

    // A live manager still has the expected access, proving the boundary did
    // not accidentally turn the global staff surface off for every session.
    expect((await req(LIVE_MANAGER, "GET", "/api/roles")).status).toBe(200);
    expect((await req(LIVE_MANAGER, "GET", "/api/users")).status).toBe(200);
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
      .where(and(eq(dailySyncTable.date, facilityDate()), eq(dailySyncTable.scope, "live")));
    expect(liveRows.length).toBe(1);
  });
});
