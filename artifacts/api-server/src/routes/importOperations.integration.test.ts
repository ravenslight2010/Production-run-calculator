import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SPEC_IMPORT_PARSE_VERSION } from "@workspace/spec-import";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
let db: typeof import("@workspace/db").db;
let pool: typeof import("@workspace/db").pool;
let adminPool: pg.Pool;
let dbName: string;
let originalUrl: string | undefined;
let server: Server;
let baseUrl: string;
let tables: typeof import("@workspace/db");
let route: typeof import("./importOperations");
let seedRoles: () => Promise<void>;
let recordSession: typeof import("../lib/authSessions")["recordSession"];
let signLegacyTokenForTests: typeof import("../lib/auth")["signLegacyTokenForTests"];
let observabilityMiddleware: typeof import("../lib/observability")["observabilityMiddleware"];
const sessionTokens = new Map<string, string>();

beforeAll(async () => {
  originalUrl = process.env.DATABASE_URL;
  if (!originalUrl) throw new Error("DATABASE_URL must be set to run integration tests");
  adminPool = new pg.Pool({ connectionString: originalUrl });
  dbName = `helium_import_operations_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(originalUrl); url.pathname = `/${dbName}`;
  const pushed = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8",
  });
  if (pushed.status !== 0) throw new Error(`${pushed.stdout}\n${pushed.stderr}`);
  process.env.DATABASE_URL = url.toString();
  ({ signLegacyTokenForTests } = await import("../lib/auth"));
  ({ recordSession } = await import("../lib/authSessions"));
  ({ observabilityMiddleware } = await import("../lib/observability"));
  tables = await import("@workspace/db");
  db = tables.db; pool = tables.pool;
  route = await import("./importOperations");
  seedRoles = (await import("../lib/roles")).seedRoles;
  const { requireAuth } = await import("../middlewares/requireAuth");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => { (req as any).log = { info() {}, warn() {}, error() {}, debug() {} }; next(); });
  app.use(observabilityMiddleware);
  app.use("/api", requireAuth, route.default);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  route?.setImportOperationFailureHookForTest();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool?.end();
  if (adminPool) await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await adminPool?.end();
  process.env.DATABASE_URL = originalUrl;
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${tables.importOperationsTable}, ${tables.importHistoryTable}, ${tables.auditLogsTable}, ${tables.brandProfilesTable}, ${tables.mixesTable}, ${tables.doughRecipesTable}, ${tables.sauceRecipesTable}, ${tables.specImportAliasesTable}, ${tables.authSessionsTable}, ${tables.userRolesTable}, ${tables.usersTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.insert(tables.usersTable).values([
    { id: "inventory", username: "inventory", passwordHash: "x" },
    { id: "profiles", username: "profiles", passwordHash: "x" },
    { id: "sandbox", username: "sandbox", passwordHash: "x", sandbox: true },
  ]);
  await db.insert(tables.userRolesTable).values([
    { userId: "inventory", role: "manager" },
    { userId: "profiles", role: "operator" },
    { userId: "sandbox", role: "manager" },
  ]);
  sessionTokens.clear();
  for (const user of ["inventory", "profiles", "sandbox"]) {
    const token = signLegacyTokenForTests(user);
    sessionTokens.set(user, token);
    await recordSession(user, token);
  }
});

function headers(user = "inventory") {
  const token = sessionTokens.get(user);
  if (!token) throw new Error(`No test session established for ${user}`);
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}
function change(id = "mix-atomic") {
  return {
    importType: "premix", sourceLabel: "reviewed.xlsx",
    changes: { mixes: { upsert: [{ id, name: "Atomic Mix", brand: "", flavor: "", batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0, components: [], isPrep: false, enabled: true }] } },
  };
}
async function apply(
  operationId: string,
  body: Record<string, unknown>,
  user = "inventory",
  extraHeaders: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/import-operations/${operationId}/apply`, {
    method: "POST", headers: { ...headers(user), ...extraHeaders }, body: JSON.stringify(body),
  });
}

describe("atomic import operations", () => {
  it("records value-free imported create, update, and delete events for cheese, dough, sauce, and mix recipes", async () => {
    const dough = {
      id: "import-audit-dough",
      name: "PRIVATE_DOUGH_NAME",
      brand: "PRIVATE_DOUGH_BRAND",
      flavors: ["PRIVATE_DOUGH_FLAVOR"],
      notes: "PRIVATE_DOUGH_NOTES",
      components: [{ ingredient: "PRIVATE_DOUGH_INGREDIENT", lbs: 10 }],
      doughballWeightOz: 8,
      doughballsPerTray: 30,
      doughballVariants: [{ label: "PRIVATE_DOUGH_VARIANT", weightOz: 8, perTray: 30 }],
    };
    const sauce = {
      id: "import-audit-sauce",
      name: "PRIVATE_SAUCE_NAME",
      brand: "PRIVATE_SAUCE_BRAND",
      flavors: ["PRIVATE_SAUCE_FLAVOR"],
      notes: "PRIVATE_SAUCE_NOTES",
      components: [{ ingredient: "PRIVATE_SAUCE_INGREDIENT", lbs: 10 }],
    };
    const mix = {
      id: "import-audit-mix",
      name: "PRIVATE_MIX_NAME",
      brand: "PRIVATE_MIX_BRAND",
      flavor: "PRIVATE_MIX_FLAVOR",
      batchSize: 3,
      daysEarly: 2,
      notes: "PRIVATE_MIX_NOTES",
      amountAlreadyMade: 1,
      components: [{ ingredient: "PRIVATE_MIX_INGREDIENT", perPizza: 2 }],
      isPrep: true,
      enabled: true,
    };
    const cheese = {
      id: "import-audit-cheese",
      name: "PRIVATE_CHEESE_NAME",
      brand: "PRIVATE_CHEESE_BRAND",
      flavors: ["PRIVATE_CHEESE_FLAVOR"],
      shredderSetting: "PRIVATE_CHEESE_SHREDDER_SETTING",
      cellulose: "PRIVATE_CHEESE_CELLULOSE",
      notes: "PRIVATE_CHEESE_NOTES",
      components: [{ ingredient: "PRIVATE_CHEESE_INGREDIENT", lbs: 10 }],
      enabled: true,
    };
    const changesFor = (recipes: {
      cheese: typeof cheese;
      dough: typeof dough;
      sauce: typeof sauce;
      mix: typeof mix;
    }) => ({
      importType: "spec",
      sourceLabel: "private-recipe-source.xlsx",
      changes: {
        cheeseRecipes: { upsert: [recipes.cheese] },
        doughRecipes: { upsert: [recipes.dough] },
        sauceRecipes: { upsert: [recipes.sauce] },
        mixes: { upsert: [recipes.mix] },
      },
    });
    const createdResponse = await apply(
      "import-audit-create-0001",
      changesFor({ cheese, dough, sauce, mix }),
      "inventory",
      { "x-correlation-id": "client-supplied-correlation" },
    );
    expect(createdResponse.status).toBe(200);
    const createdCorrelationId = createdResponse.headers.get("x-correlation-id");
    expect(createdCorrelationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(createdCorrelationId).not.toBe("client-supplied-correlation");

    const updatedCheese = { ...cheese, shredderSetting: "UPDATED_CHEESE_SHREDDER_SETTING" };
    const updatedDough = { ...dough, notes: "UPDATED_DOUGH_NOTES" };
    const updatedSauce = { ...sauce, brand: "UPDATED_SAUCE_BRAND" };
    const updatedMix = { ...mix, batchSize: 4 };
    const updatedResponse = await apply("import-audit-update-0001", changesFor({
      cheese: updatedCheese,
      dough: updatedDough,
      sauce: updatedSauce,
      mix: updatedMix,
    }));
    expect(updatedResponse.status).toBe(200);
    const updatedCorrelationId = updatedResponse.headers.get("x-correlation-id");
    expect(updatedCorrelationId).toMatch(/^[0-9a-f-]{36}$/u);

    const noOpChanges = changesFor({
      cheese: updatedCheese,
      dough: updatedDough,
      sauce: updatedSauce,
      mix: updatedMix,
    });
    const noOpResponse = await apply("import-audit-noop-0001", {
      ...noOpChanges,
      changes: {
        ...noOpChanges.changes,
        cheeseRecipes: {
          ...noOpChanges.changes.cheeseRecipes,
          delete: ["missing-import-audit-recipe"],
        },
        doughRecipes: {
          ...noOpChanges.changes.doughRecipes,
          delete: ["missing-import-audit-recipe"],
        },
      },
    });
    expect(noOpResponse.status).toBe(200);

    const deleteResponse = await apply("import-audit-delete-0001", {
      importType: "spec",
      sourceLabel: "private-recipe-source.xlsx",
      changes: {
        cheeseRecipes: { delete: [cheese.id] },
        doughRecipes: { delete: [dough.id] },
        sauceRecipes: { delete: [sauce.id] },
        mixes: { delete: [mix.id] },
      },
    });
    expect(deleteResponse.status).toBe(200);
    const deleteCorrelationId = deleteResponse.headers.get("x-correlation-id");
    expect(deleteCorrelationId).toMatch(/^[0-9a-f-]{36}$/u);

    const auditRows = (await db.select().from(tables.auditLogsTable))
      .sort((left, right) => left.id - right.id);
    const families = [
      {
        family: "cheese_recipe",
        id: cheese.id,
        fields: [
          "name", "brand", "flavors", "shredderSetting", "cellulose",
          "notes", "components", "enabled",
        ],
        updatedFields: ["shredderSetting"],
      },
      {
        family: "dough_recipe",
        id: dough.id,
        fields: [
          "name", "notes", "components", "enabled", "brand", "flavors",
          "doughballWeightOz", "doughballsPerTray", "doughballVariants",
        ],
        updatedFields: ["notes"],
      },
      {
        family: "sauce_recipe",
        id: sauce.id,
        fields: ["name", "notes", "components", "enabled", "brand", "flavors"],
        updatedFields: ["brand"],
      },
      {
        family: "mix_recipe",
        id: mix.id,
        fields: [
          "name", "brand", "flavor", "batchSize", "daysEarly", "notes",
          "amountAlreadyMade", "components", "isPrep", "enabled",
        ],
        updatedFields: ["batchSize"],
      },
    ];
    expect(auditRows).toHaveLength(12);
    for (const recipe of families) {
      const events = auditRows.filter((row) => row.resource === `${recipe.family}:${recipe.id}`);
      expect(events.map((row) => row.action)).toEqual([
        `${recipe.family}_created`,
        `${recipe.family}_updated`,
        `${recipe.family}_deleted`,
      ]);
      expect(events.map((row) => row.actor)).toEqual(["inventory", "inventory", "inventory"]);
      expect(events.map((row) => row.changes)).toEqual([
        { fieldNames: recipe.fields, correlationId: createdCorrelationId },
        { fieldNames: recipe.updatedFields, correlationId: updatedCorrelationId },
        { fieldNames: recipe.fields, correlationId: deleteCorrelationId },
      ]);
    }
    expect(auditRows.some((row) =>
      (row.changes as Record<string, unknown>).correlationId === noOpResponse.headers.get("x-correlation-id"),
    )).toBe(false);

    const auditPayload = JSON.stringify(auditRows);
    for (const privateValue of [
      "PRIVATE_CHEESE_NAME", "PRIVATE_CHEESE_BRAND", "PRIVATE_CHEESE_FLAVOR",
      "PRIVATE_CHEESE_SHREDDER_SETTING", "PRIVATE_CHEESE_CELLULOSE",
      "PRIVATE_CHEESE_NOTES", "PRIVATE_CHEESE_INGREDIENT",
      "UPDATED_CHEESE_SHREDDER_SETTING",
      "PRIVATE_DOUGH_NAME", "PRIVATE_DOUGH_BRAND", "PRIVATE_DOUGH_FLAVOR",
      "PRIVATE_DOUGH_NOTES", "PRIVATE_DOUGH_INGREDIENT", "PRIVATE_DOUGH_VARIANT",
      "UPDATED_DOUGH_NOTES", "PRIVATE_SAUCE_NAME", "PRIVATE_SAUCE_BRAND",
      "PRIVATE_SAUCE_FLAVOR", "PRIVATE_SAUCE_NOTES", "PRIVATE_SAUCE_INGREDIENT",
      "UPDATED_SAUCE_BRAND", "PRIVATE_MIX_NAME", "PRIVATE_MIX_BRAND",
      "PRIVATE_MIX_FLAVOR", "PRIVATE_MIX_NOTES", "PRIVATE_MIX_INGREDIENT",
    ]) {
      expect(auditPayload).not.toContain(privateValue);
    }
  });

  it("rejects source evidence from a retired parser without persisting an operation", async () => {
    const response = await apply("distill-retired-parser-0001", {
      ...change("retired-parser"),
      importType: "spec",
      sourceEvidence: {
        sourceText: "Retired parser fixture",
        parseVersion: String(Number(SPEC_IMPORT_PARSE_VERSION) - 1),
      },
    });
    expect(response.status).toBe(400);
    expect(await db.select().from(tables.importOperationsTable)
      .where(eq(tables.importOperationsTable.id, "distill-retired-parser-0001"))).toHaveLength(0);
  });

  it("exports only completed, live, source-backed spec Applies to a manager", async () => {
    const sourceEvidence = {
      sourceText: "=== SHEET: Spec ===\nBrand\tAlpine Foods\nFlavor\tFour Cheese",
      parseVersion: SPEC_IMPORT_PARSE_VERSION,
    };
    const applied = await apply("distill-authorized-0001", {
      importType: "spec",
      sourceLabel: "private-source.xlsx",
      sourceEvidence,
      changes: {
        brandProfiles: {
          upsert: [{
            key: "alpine foods__four cheese",
            brand: "Alpine Foods",
            flavor: "Four Cheese",
            values: { pizzasPerCase: 12 },
            crustValues: {},
            updatedAtMs: 1,
          }],
        },
      },
    });
    expect(applied.status).toBe(200);
    const before = (await db.select().from(tables.importOperationsTable))
      .find((row) => row.id === "distill-authorized-0001");
    expect(before?.status).toBe("applied");

    const response = await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    const page = await response.json() as {
      records: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({
      operationId: "distill-authorized-0001",
      scope: "live",
      status: "applied",
      actorCapability: "manage-profiles",
      sourceText: sourceEvidence.sourceText,
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      parseVersion: SPEC_IMPORT_PARSE_VERSION,
    });
    expect(page.records[0]).not.toHaveProperty("actorId");
    expect(page.records[0]).not.toHaveProperty("sourceLabel");
    const after = (await db.select().from(tables.importOperationsTable))
      .find((row) => row.id === "distill-authorized-0001");
    expect(after).toEqual(before);
  });

  it("paginates source-backed evidence without repeating or skipping records", async () => {
    for (const suffix of ["0001", "0002"]) {
      await apply(`distill-page-${suffix}`, {
        importType: "spec",
        sourceLabel: `page-${suffix}.xlsx`,
        sourceEvidence: { sourceText: `Source ${suffix}`, parseVersion: SPEC_IMPORT_PARSE_VERSION },
        changes: {
          brandProfiles: {
            upsert: [{
              key: `brand ${suffix}__flavor`,
              brand: `Brand ${suffix}`,
              flavor: "Flavor",
              values: {},
              crustValues: {},
              updatedAtMs: Number(suffix),
            }],
          },
        },
      });
    }

    const firstResponse = await fetch(
      `${baseUrl}/api/import-operations/distillation-evidence?limit=1`,
      { headers: headers() },
    );
    const first = await firstResponse.json() as {
      records: Array<{ operationId: string }>;
      nextCursor: string | null;
    };
    expect(first.records).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const secondResponse = await fetch(
      `${baseUrl}/api/import-operations/distillation-evidence?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
      { headers: headers() },
    );
    const second = await secondResponse.json() as {
      records: Array<{ operationId: string }>;
      nextCursor: string | null;
    };
    expect(second.records).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.records, ...second.records].map((record) => record.operationId)).size).toBe(2);
  });

  it("rejects unauthorized readers and actors, missing-source, sandbox, and undone evidence", async () => {
    const unauthorizedApply = await apply("distill-unauthorized-0001", {
      importType: "spec",
      sourceLabel: "unauthorized.xlsx",
      sourceEvidence: { sourceText: "private", parseVersion: SPEC_IMPORT_PARSE_VERSION },
      changes: { brandProfiles: { upsert: [] } },
    }, "profiles");
    expect(unauthorizedApply.status).toBe(403);

    expect((await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers("profiles"),
    })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers("sandbox"),
    })).status).toBe(403);
    expect((await apply("distill-sandbox-source-0001", {
      importType: "spec",
      sourceLabel: "sandbox-source.xlsx",
      sourceEvidence: { sourceText: "Sandbox source", parseVersion: SPEC_IMPORT_PARSE_VERSION },
      changes: { brandProfiles: { upsert: [] } },
    }, "sandbox")).status).toBe(400);

    await apply("distill-missing-source-0001", {
      importType: "spec",
      sourceLabel: "legacy-no-source.xlsx",
      changes: { brandProfiles: { upsert: [] } },
    });
    const undone = await (await apply("distill-undone-source-0001", {
      importType: "spec",
      sourceLabel: "undone-source.xlsx",
      sourceEvidence: { sourceText: "Undone source", parseVersion: SPEC_IMPORT_PARSE_VERSION },
      changes: {
        brandProfiles: {
          upsert: [{
            key: "undone brand__flavor",
            brand: "Undone Brand",
            flavor: "Flavor",
            values: {},
            crustValues: {},
            updatedAtMs: 2,
          }],
        },
      },
    })).json() as any;
    const undoResponse = await fetch(`${baseUrl}/api/import-operations/distill-undone-source-0001/undo`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ expectedResultHash: undone.operation.resultHash }),
    });
    expect(undoResponse.status).toBe(200);

    const response = await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    const page = await response.json() as { records: Array<Record<string, unknown>> };
    expect(page.records).toHaveLength(0);
  });

  it("rolls back after failures at domain and history stages", async () => {
    const rollbackBody = {
      ...change(),
      changes: {
        ...change().changes,
        cheeseRecipes: {
          upsert: [{
            id: "rollback-cheese-recipe",
            name: "Rollback Cheese",
            brand: "Brand",
            flavors: [],
            shredderSetting: "",
            cellulose: "",
            notes: "",
            components: [],
            enabled: true,
          }],
        },
      },
    };
    for (const stage of ["after-mixes", "after-recipe-audit", "after-history"]) {
      route.setImportOperationFailureHookForTest((actual) => { if (actual === stage) throw new Error("injected"); });
      const response = await apply(`rollback-${stage.replace("-", "")}-001`, rollbackBody);
      expect(response.status).toBe(500);
      expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
      expect(await db.select().from(tables.cheeseRecipesTable)).toHaveLength(0);
      expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);
      expect(await db.select().from(tables.auditLogsTable)).toHaveLength(0);
      route.setImportOperationFailureHookForTest();
    }
  });

  it("retries idempotently and rejects request mismatches", async () => {
    const body = change();
    const first = await apply("retry-operation-000001", body);
    const second = await apply("retry-operation-000001", body);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(1);
    expect((await apply("retry-operation-000001", { ...body, sourceLabel: "different" })).status).toBe(409);
  });

  it("rejects a stale reviewed-state precondition", async () => {
    const response = await apply("stale-review-000001", { ...change(), expectedStateHash: "0".repeat(64) });
    expect(response.status).toBe(409);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
  });

  it("undoes successfully, accepts unrelated edits, and refuses affected edits", async () => {
    const created = await (await apply("undo-success-000001", change())).json() as any;
    const resultHash = created.operation.resultHash;
    const firstUndo = await fetch(`${baseUrl}/api/import-operations/undo-success-000001/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: resultHash }),
    });
    expect(firstUndo.status).toBe(200);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);

    const second = await (await apply("undo-refuse-000001", change("unrelated-target"))).json() as any;
    await db.insert(tables.mixesTable).values({ id: "unrelated", scope: "live", name: "Unrelated", brand: "", flavor: "", batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0, components: [], isPrep: false, enabled: true });
    expect((await fetch(`${baseUrl}/api/import-operations/undo-refuse-000001/undo`, { method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: second.operation.resultHash }) })).status).toBe(200);
    expect(await db.select().from(tables.mixesTable).where(eq(tables.mixesTable.id, "unrelated"))).toHaveLength(1);

    const third = await (await apply("undo-affected-000001", change("affected-again"))).json() as any;
    await db.update(tables.mixesTable).set({ name: "Manager Edit" }).where(and(eq(tables.mixesTable.scope, "live"), eq(tables.mixesTable.id, "affected-again")));
    expect((await fetch(`${baseUrl}/api/import-operations/undo-affected-000001/undo`, { method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: third.operation.resultHash }) })).status).toBe(409);
  });

  it("undoes touched aliases without deleting unrelated aliases", async () => {
    await db.insert(tables.specImportAliasesTable).values({
      scope: "live", kind: "brand", externalName: "Keep Me", canonicalName: "Unrelated", context: null,
    });
    const body = {
      importType: "spec",
      sourceLabel: "aliases.xlsx",
      changes: {
        specImportAliases: {
          upsert: [{ kind: "brand", externalName: "Sheet Brand", canonicalName: "Canonical Brand", context: null }],
        },
      },
    };
    const created = await (await apply("undo-aliases-000001", body)).json() as any;
    const undone = await fetch(`${baseUrl}/api/import-operations/undo-aliases-000001/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: created.operation.resultHash }),
    });
    expect(undone.status).toBe(200);
    const aliases = await db.select().from(tables.specImportAliasesTable);
    expect(aliases.map((row) => row.externalName)).toEqual(["Keep Me"]);
  });

  it("restores imported deletions and refuses after the deleted identity is recreated", async () => {
    const deletedRow = {
      id: "delete-me", scope: "live", name: "Delete Me", brand: "", flavor: "",
      batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0,
      components: [], isPrep: false, enabled: true,
    };
    await db.insert(tables.mixesTable).values(deletedRow);
    const first = await (await apply("undo-deletion-000001", {
      importType: "premix", sourceLabel: "delete.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    const restored = await fetch(`${baseUrl}/api/import-operations/undo-deletion-000001/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: first.operation.resultHash }),
    });
    expect(restored.status).toBe(200);
    expect(await db.select().from(tables.mixesTable).where(eq(tables.mixesTable.id, deletedRow.id))).toHaveLength(1);

    await db.delete(tables.mixesTable).where(eq(tables.mixesTable.id, deletedRow.id));
    await db.insert(tables.mixesTable).values(deletedRow);
    const second = await (await apply("undo-deletion-000002", {
      importType: "premix", sourceLabel: "delete-again.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    await db.insert(tables.mixesTable).values({ ...deletedRow, name: "Manager Recreated" });
    const refused = await fetch(`${baseUrl}/api/import-operations/undo-deletion-000002/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: second.operation.resultHash }),
    });
    expect(refused.status).toBe(409);
  });

  it("rejects oversized change lists without committing a partial import", async () => {
    const oversized = Array.from({ length: 501 }, (_, index) => ({
      id: `oversized-${index}`, name: `Oversized ${index}`, brand: "", flavor: "",
      batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0,
      components: [], isPrep: false, enabled: true,
    }));
    const response = await apply("oversized-operation-001", {
      importType: "premix", sourceLabel: "oversized.xlsx",
      changes: { mixes: { upsert: oversized } },
    });
    expect(response.status).toBe(400);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
    expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);
  });

  it("enforces importer capability and live/sandbox scope", async () => {
    expect((await apply("profile-capability-0001", change(), "profiles")).status).toBe(403);
    const sandbox = await apply("sandbox-operation-0001", change("sandbox-id"), "sandbox");
    expect(sandbox.status).toBe(200);
    expect(await db.select().from(tables.mixesTable).where(eq(tables.mixesTable.scope, "live"))).toHaveLength(0);
  });

  it("requires every changed entity capability for apply and undo", async () => {
    await db.update(tables.rolesTable)
      .set({ capabilities: ["manage-profiles"] })
      .where(eq(tables.rolesTable.name, "operator"));

    const mixedBody = {
      importType: "premix",
      sourceLabel: "mixed-capability.xlsx",
      changes: {
        mixes: {
          upsert: [{
            id: "mixed-capability-mix",
            name: "Mixed Capability Mix",
            brand: "",
            flavor: "",
            batchSize: 1,
            daysEarly: 0,
            notes: "",
            amountAlreadyMade: 0,
            components: [],
            isPrep: false,
            enabled: true,
          }],
        },
        specImportAliases: {
          upsert: [{
            kind: "brand",
            externalName: "Mixed Capability",
            canonicalName: "Canonical",
            context: null,
          }],
        },
      },
    };

    const rejectedApply = await apply(
      "mixed-capability-apply-0001",
      { ...mixedBody, importType: "spec" },
      "profiles",
    );
    expect(rejectedApply.status).toBe(403);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
    expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);

    const applied = await apply("mixed-capability-undo-0001", mixedBody);
    expect(applied.status).toBe(200);
    const rejectedUndo = await fetch(
      `${baseUrl}/api/import-operations/mixed-capability-undo-0001/undo`,
      {
        method: "POST",
        headers: headers("profiles"),
        body: JSON.stringify({}),
      },
    );
    expect(rejectedUndo.status).toBe(403);
    expect(
      await db.select().from(tables.mixesTable)
        .where(eq(tables.mixesTable.id, "mixed-capability-mix")),
    ).toHaveLength(1);
    expect(
      await db.select().from(tables.specImportAliasesTable)
        .where(eq(tables.specImportAliasesTable.externalName, "Mixed Capability")),
    ).toHaveLength(1);
    expect(
      (await db.select().from(tables.importOperationsTable))
        .find((row) => row.id === "mixed-capability-undo-0001")?.status,
    ).toBe("applied");
  });
});
