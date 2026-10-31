import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import pino from "pino";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
let tables: typeof import("@workspace/db");
let service: typeof import("../lib/masterDataOperations");
let db: typeof import("@workspace/db").db;
let admin: pg.Pool; let dbName: string; let created = false;
let originalUrl: string | undefined; let server: Server; let base: string;
const tokens = new Map<string, string>();

beforeAll(async () => {
  originalUrl = process.env.DATABASE_URL;
  if (!originalUrl) throw new Error("DATABASE_URL is required for disposable-database tests");
  admin = new pg.Pool({ connectionString: originalUrl });
  dbName = `guarded_master_undo_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
  const url = new URL(originalUrl); url.pathname = `/${dbName}`;
  const pushed = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8",
  });
  if (pushed.status !== 0) throw new Error(`Disposable schema setup failed (exit ${pushed.status}); no application data was used.`);
  process.env.DATABASE_URL = url.toString();
  tables = await import("@workspace/db"); db = tables.db;
  service = await import("../lib/masterDataOperations");
  const { observabilityMiddleware } = await import("../lib/observability");
  const { requireAuth } = await import("../middlewares/requireAuth");
  const { requireCapability } = await import("../middlewares/requireCapability");
  const { currentScope } = await import("../lib/requestScope");
  const { masterDataReadEpoch, masterDataMutationFence } = await import("../lib/masterDataWriteFence");
  const route = await import("./masterDataOperations");
  const sync = await import("./sync");
  const ingredients = await import("./ingredients");
  const app = express(); app.use(express.json({ limit: "1mb" }));
  const logger = pino({ enabled: false });
  app.use((req, _res, next) => { req.log = logger; next(); });
  app.use(observabilityMiddleware);
  app.use("/api", requireAuth, masterDataReadEpoch, masterDataMutationFence, route.default);
  app.get("/api/dough-recipes", async (_req, res) => {
    res.json({ items: await db.select().from(tables.doughRecipesTable).where(eq(tables.doughRecipesTable.scope, currentScope())) });
  });
  app.post("/api/dough-recipes/fixture-edit", requireAuth, requireCapability("manage-factory-settings"), async (req, res) => {
    await db.update(tables.doughRecipesTable).set({ notes: String(req.body.notes), updatedAt: new Date() })
      .where(and(eq(tables.doughRecipesTable.scope, currentScope()), eq(tables.doughRecipesTable.id, String(req.body.id))));
    res.status(req.body.reject ? 400 : 200).json({ ok: !req.body.reject });
  });
  app.use("/api", requireAuth, sync.default);
  app.use("/api", requireAuth, ingredients.default);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 180_000);

afterAll(async () => {
  service?.setMasterDataOperationFailureHookForTest();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await tables?.pool.end();
  if (created) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  await admin?.end(); process.env.DATABASE_URL = originalUrl;
});
beforeEach(async () => {
  service.setMasterDataOperationFailureHookForTest();
  await db.execute(sql`TRUNCATE ${tables.masterDataOperationsTable}, ${tables.masterDataUndoEpochsTable},
    ${tables.syncOutboxEventsTable}, ${tables.syncOutboxCursorsTable}, ${tables.dailySyncTable}, ${tables.factoryKvTable}, ${tables.ingredientsTable},
    ${tables.doughRecipesTable}, ${tables.sauceRecipesTable}, ${tables.cheeseRecipesTable}, ${tables.mixesTable},
    ${tables.brandProfilesTable}, ${tables.runTemplatesTable}, ${tables.dieTypesTable}, ${tables.specImportAliasesTable},
    ${tables.mergeAliasesTable}, ${tables.mergedAwayTable}, ${tables.ingredientBatchWeightsTable},
    ${tables.completedRunHistoryTable}, ${tables.inventoryItemsTable},
    ${tables.authSessionsTable}, ${tables.userRolesTable}, ${tables.usersTable} RESTART IDENTITY CASCADE`);
  await (await import("../lib/roles")).seedRoles();
   const { signToken } = await import("../lib/auth");
  const { recordSession } = await import("../lib/authSessions");
  tokens.clear();
  for (const [id, role, sandbox] of [["manager-a", "manager", false], ["manager-b", "manager", false],
    ["staff", "operator", false], ["sandbox-manager", "manager", true]] as const) {
    await db.insert(tables.usersTable).values({ id, username: id, passwordHash: "synthetic-test-only", sandbox });
    await db.insert(tables.userRolesTable).values({ userId: id, role });
    const token = signToken(id); tokens.set(id, token); await recordSession(id, token);
  }
  await db.insert(tables.doughRecipesTable).values({ id: "old-recipe", name: "Old Recipe", components: [{ ingredient: "Flour", lbs: 10 }] });
});
function headers(user = "manager-a", epoch?: string) {
  return { "content-type": "application/json", authorization: `Bearer ${tokens.get(user)}`,
    ...(epoch === undefined ? {} : { "x-master-data-epoch": epoch }) };
}
async function post(pathname: string, body: unknown = {}, user = "manager-a", epoch?: string) {
  return fetch(`${base}${pathname}`, { method: "POST", headers: headers(user, epoch), body: JSON.stringify(body) });
}
const rename = { action: "rename", category: "dough", sources: ["Old Recipe"], target: "New Recipe" };
const readJson = async (response: Response) => await response.json() as Record<string, unknown>;
async function apply(command: unknown = rename, id = "operation-test-0001", user = "manager-a") {
  const preview = await post(`/master-data-operations/${id}/preview`, command, user);
  expect(preview.status).toBe(200);
  const body = await readJson(preview);
  const response = await post(`/master-data-operations/${id}/apply`, { command, expectedStateHash: body.expectedStateHash }, user);
  return { response, preview: body, body: await readJson(response), id };
}
const rows = () => db.select().from(tables.doughRecipesTable);
async function expectNewDependencyConflict(id: string) {
  const canonical = async () => ({
    recipes: await rows(), ingredients: await db.select().from(tables.ingredientsTable),
    profiles: await db.select().from(tables.brandProfilesTable),
    templates: await db.select().from(tables.runTemplatesTable),
    days: await db.select().from(tables.dailySyncTable),
    directories: await db.select().from(tables.factoryKvTable),
    epochs: await db.select().from(tables.masterDataUndoEpochsTable),
    invalidations: await db.select().from(tables.syncOutboxEventsTable),
  });
  const before = await canonical();
  expect((await post(`/master-data-operations/${id}/undo`, {}, "manager-b")).status).toBe(409);
  expect(await canonical()).toEqual(before);
  const [ledger] = await db.select().from(tables.masterDataOperationsTable);
  expect(ledger.status).toBe("applied");
  expect(ledger.conflictCount).toBe(1);
  expect(ledger.lastConflictBy).toBe("manager-b");
}
async function seedReferences(started = false) {
  await db.insert(tables.brandProfilesTable).values({ key: "acme__plain", brand: "Acme", flavor: "Plain",
    values: { doughRecipeName: "Old Recipe", cases: 10 }, crustValues: { doughRecipeName: "Old Recipe" }, updatedAtMs: 100 });
  await db.insert(tables.runTemplatesTable).values({ id: "template-one", name: "Synthetic template", createdAt: "2026-10-23T00:00:00.000Z",
    brand: "Acme", flavor: "Plain", values: { doughRecipeName: "Old Recipe", cases: 77 }, revision: 1 });
  await db.insert(tables.dailySyncTable).values({ date: "2026-10-23", data: {
    dayState: { date: "2026-10-23", currentIndex: 0, runs: [
      { id: "pending", brand: "Acme", flavor: "Plain", startedAt: started ? 100 : null, endedAt: null, metaUpdatedAt: 100 },
      { id: "live-unrelated", brand: "Other", flavor: "Other", startedAt: 99, endedAt: null, metaUpdatedAt: 99 },
    ] }, runValues: { pending: { doughRecipeName: "Old Recipe", cases: 10, doughBatches: 8 },
      "live-unrelated": { doughRecipeName: "Other Recipe", cases: 55, doughBatches: 7, frontlineBarrels: 5 } },
    runValuesUpdatedAt: { pending: 100, "live-unrelated": 99 }, lastModified: 100,
  } });
}

describe("scoped atomic master-data operations", () => {
  it.each(["brand", "flavor"] as const)("restores a %s merge's exact profile, template and pending metadata while preserving target-owned values", async (category) => {
    await seedReferences();
    await db.insert(tables.factoryKvTable).values([
      { key: "run-calc-brands", value: ["Acme", "Target"] },
      { key: "run-calc-brand-flavors", value: { Acme: ["Plain", "Spicy"], Target: ["Plain"] } },
    ]);
    const targetBrand = category === "brand" ? "Target" : "Acme";
    const targetFlavor = category === "brand" ? "Plain" : "Spicy";
    await db.insert(tables.brandProfilesTable).values({ key: "target-owned-legacy-key", brand: targetBrand, flavor: targetFlavor,
      values: { doughRecipeName: "Old Recipe", cases: 90 }, updatedAtMs: 200 });
    const operation = await apply({ action: "merge", category, sources: [category === "brand" ? "Acme" : "Plain"],
      target: category === "brand" ? "Target" : "Spicy", ...(category === "flavor" ? { brand: "Acme" } : {}) });
    expect(operation.response.status).toBe(200);
    expect(operation.body.eligible).toBe(true);
    expect((await db.select().from(tables.brandProfilesTable)).find((row) => row.brand === targetBrand && row.flavor === targetFlavor)?.values)
      .toMatchObject({ cases: 90 });
    expect((await db.select().from(tables.runTemplatesTable))[0]).toMatchObject({ brand: targetBrand, flavor: targetFlavor, values: { cases: 77 } });
    expect((await post(`/master-data-operations/${operation.id}/undo`, {}, "manager-b")).status).toBe(200);
    const profiles = await db.select().from(tables.brandProfilesTable);
    expect(profiles.find((row) => row.key === "acme__plain")).toMatchObject({ brand: "Acme", flavor: "Plain", values: { cases: 10 } });
    expect(profiles.find((row) => row.key === "target-owned-legacy-key")).toMatchObject({ brand: targetBrand, flavor: targetFlavor, values: { cases: 90 } });
    expect((await db.select().from(tables.runTemplatesTable))[0]).toMatchObject({ brand: "Acme", flavor: "Plain", values: { cases: 77 } });
    expect((await db.select().from(tables.dailySyncTable))[0].data).toMatchObject({
      dayState: { runs: [{ id: "pending", brand: "Acme", flavor: "Plain" }, { id: "live-unrelated", brand: "Other", flavor: "Other" }] },
      runValues: { pending: { cases: 10, doughBatches: 8 }, "live-unrelated": { cases: 55, doughBatches: 7, frontlineBarrels: 5 } },
    });
  });
  it("a sleeping client's complete renamed snapshot cannot replay the compensated pending-run reference", async () => {
    await seedReferences();
    const operation = await apply();
    expect(operation.response.status).toBe(200);
    const sleeping = await fetch(`${base}/sync/today?today=2026-10-23`, { headers: headers() });
    expect(sleeping.status).toBe(200);
    const snapshot = await readJson(sleeping);
    expect(snapshot).toMatchObject({ runValues: { pending: { doughRecipeName: "New Recipe" } } });
    expect((await post(`/master-data-operations/${operation.id}/undo`, {}, "manager-b")).status).toBe(200);
    const replay = await fetch(`${base}/sync/today?today=2026-10-23&epoch=${String(snapshot.resetEpoch)}`, {
      method: "PUT", headers: headers(), body: JSON.stringify({ senderId: "synthetic-sleeping-client", payload: snapshot }),
    });
    // Existing compatibility modes either return the protected canonical state
    // or explicitly reject the old complete-write protocol; neither may replay it.
    expect([200, 409, 426]).toContain(replay.status);
    expect((await db.select().from(tables.dailySyncTable))[0].data).toMatchObject({ runValues: {
      pending: { doughRecipeName: "Old Recipe", cases: 10, doughBatches: 8 },
      "live-unrelated": { doughRecipeName: "Other Recipe", cases: 55, doughBatches: 7, frontlineBarrels: 5 },
    } });
  });
  it("records server facts and supports another manager's idempotent Undo, without reverting unrelated work", async () => {
    const first = await apply();
    expect(first.response.status).toBe(200); expect(first.body.status).toBe("applied");
    expect(first.body.actorId).toBe("manager-a");
    await db.insert(tables.sauceRecipesTable).values({ id: "unrelated", name: "Later Sauce", components: [] });
    const undone = await post(`/master-data-operations/${first.id}/undo`, {}, "manager-b");
    expect(undone.status).toBe(200); expect((await readJson(undone)).undoneBy).toBe("manager-b");
    expect((await rows()).find((row) => row.id === "old-recipe")?.name).toBe("Old Recipe");
    expect(await db.select().from(tables.sauceRecipesTable)).toHaveLength(1);
    expect((await post(`/master-data-operations/${first.id}/undo`, {}, "manager-a")).status).toBe(200);
    const replay = await post(`/master-data-operations/${first.id}/apply`, { command: rename, expectedStateHash: first.preview.expectedStateHash });
    expect((await readJson(replay)).status).toBe("undone");
    const [ledger] = await db.select().from(tables.masterDataOperationsTable);
    expect(ledger.facts.some((fact) => fact.entity === "doughRecipes")).toBe(true);
    expect(ledger.facts.some((fact) => /auth|history|inventory|session/i.test(fact.entity))).toBe(false);
  });
  it.each(["after-mutations", "after-evidence"])("rolls back action AND receipt on injected %s failure", async (stage) => {
    service.setMasterDataOperationFailureHookForTest((at) => { if (at === stage) throw new Error("synthetic injected failure"); });
    expect((await apply()).response.status).toBe(500);
    expect((await rows())[0].name).toBe("Old Recipe");
    expect(await db.select().from(tables.masterDataOperationsTable)).toHaveLength(0);
    expect(await db.select().from(tables.masterDataUndoEpochsTable)).toHaveLength(0);
    expect(await db.select().from(tables.syncOutboxEventsTable)).toHaveLength(0);
  });
  it.each(["after-compensation", "after-undo-evidence"])("rolls back every Undo effect on %s failure", async (stage) => {
    const first = await apply();
    const before = await db.select().from(tables.factoryKvTable);
    service.setMasterDataOperationFailureHookForTest((at) => { if (at === stage) throw new Error("synthetic injected failure"); });
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(500);
    expect((await rows())[0].name).toBe("New Recipe");
    expect(await db.select().from(tables.factoryKvTable)).toEqual(before);
    expect((await db.select().from(tables.masterDataOperationsTable))[0].status).toBe("applied");
    expect((await db.select().from(tables.masterDataUndoEpochsTable))[0].epoch).toBe(1);
  });
  it("rejects same-time canonical edits, audits the conflict, and never restores a partial fact set", async () => {
    const first = await apply(); const [recipe] = await rows();
    await db.update(tables.doughRecipesTable).set({ notes: "Later manager work", updatedAt: recipe.updatedAt })
      .where(eq(tables.doughRecipesTable.id, recipe.id));
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(409);
    expect((await rows())[0].name).toBe("New Recipe");
    expect((await rows())[0].notes).toBe("Later manager work");
    const [ledger] = await db.select().from(tables.masterDataOperationsTable);
    expect(ledger.conflictCount).toBe(1); expect(ledger.lastConflictBy).toBe("manager-a");
    expect(ledger.status).toBe("applied");
  });
  it("rejects a stale preview and operation-ID reuse by another actor or command", async () => {
    const first = await apply();
    expect((await post(`/master-data-operations/${first.id}/apply`, { command: rename, expectedStateHash: first.preview.expectedStateHash }, "manager-b")).status).toBe(409);
    const oldPreview = await post("/master-data-operations/operation-stale-001/apply", { command: rename, expectedStateHash: first.preview.expectedStateHash });
    expect(oldPreview.status).toBe(409);
  });
  it("serializes simultaneous same-ID retries into one receipt and one epoch", async () => {
    const preview = await post("/master-data-operations/concurrent-0001/preview", rename);
    const { expectedStateHash } = await readJson(preview);
    const responses = await Promise.all([0, 1].map(() => post("/master-data-operations/concurrent-0001/apply", { command: rename, expectedStateHash })));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await db.select().from(tables.masterDataOperationsTable)).toHaveLength(1);
    expect((await db.select().from(tables.masterDataUndoEpochsTable))[0].epoch).toBe(1);
  });
  it("fences stale legacy full-record writes, even after a new canonical read, and rolls back error responses", async () => {
    const first = await apply();
    await post(`/master-data-operations/${first.id}/undo`);
    const read = await fetch(`${base}/dough-recipes`, { headers: headers() });
    expect(read.headers.get("x-master-data-epoch")).toBe("2");
    expect((await post("/dough-recipes/fixture-edit", { id: "old-recipe", notes: "sleeping old payload" }, "manager-a", "0")).status).toBe(409);
    expect((await post("/dough-recipes/fixture-edit", { id: "old-recipe", notes: "must roll back", reject: true }, "manager-a", "2")).status).toBe(400);
    expect((await rows())[0].notes).toBe("");
    expect((await post("/dough-recipes/fixture-edit", { id: "old-recipe", notes: "fresh explicit edit" }, "manager-a", "2")).status).toBe(200);
    expect((await rows())[0].notes).toBe("fresh explicit edit");
  });
  it("restricts both history and compensation by live scope and current role", async () => {
    const first = await apply();
    expect((await fetch(`${base}/master-data-operations`, { headers: headers("staff") })).status).toBe(403);
    expect((await post(`/master-data-operations/${first.id}/undo`, {}, "staff")).status).toBe(403);
    const sandbox = await fetch(`${base}/master-data-operations`, { headers: headers("sandbox-manager") });
    expect((await readJson(sandbox)).items).toEqual([]);
    expect((await post(`/master-data-operations/${first.id}/undo`, {}, "sandbox-manager")).status).toBe(409);
    await db.update(tables.userRolesTable).set({ role: "operator" }).where(eq(tables.userRolesTable.userId, "manager-a"));
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(403);
    expect((await rows())[0].name).toBe("New Recipe");
  });
  it("rejects browser evidence, unknown intent fields, oversized source lists and unsafe cursors", async () => {
    for (const command of [{ ...rename, before: { localStorage: "not evidence" } }, { ...rename, sources: Array(51).fill("Old") },
      { ...rename, sources: ["\n"] }, { ...rename, destination: "bogus" }]) {
      expect((await post("/master-data-operations/invalid-command-001/preview", command)).status).toBe(400);
    }
    for (const query of ["limit=51", "before=0", "before=1.1", "unexpected=true"]) {
      expect((await fetch(`${base}/master-data-operations?${query}`, { headers: headers() })).status).toBe(400);
    }
    expect(await db.select().from(tables.masterDataOperationsTable)).toHaveLength(0);
  });
  it("publishes newer inverse tombstones and canonical invalidations instead of restoring obsolete clocks", async () => {
    const first = await apply();
    const before = await db.select().from(tables.factoryKvTable);
    const oldClock = before.find((row) => row.key === "run-calc-deleted-stamps")?.value as Record<string, Record<string, number>>;
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(200);
    const after = await db.select().from(tables.factoryKvTable);
    const restored = after.find((row) => row.key === "run-calc-undeleted-stamps")?.value as Record<string, Record<string, number>>;
    expect(restored.doughRecipeNames["old recipe"]).toBeGreaterThan(oldClock.doughRecipeNames["old recipe"]);
    const removed = after.find((row) => row.key === "run-calc-deleted-items")?.value as Record<string, string[]>;
    expect(removed.doughRecipeNames).toContain("new recipe");
    expect(await db.select().from(tables.syncOutboxEventsTable)).toHaveLength(8);
  });
  it("restores exact profile, template and pending-run references, never live counters or security settings", async () => {
    await seedReferences();
    await db.insert(tables.factoryKvTable).values({ key: "unrelated-security-fixture", value: { pin: "synthetic-private-sentinel" } });
    const [beforeDay] = await db.select().from(tables.dailySyncTable);
    const first = await apply(); expect(first.body.status).toBe("applied");
    expect((await db.select().from(tables.brandProfilesTable))[0].values.doughRecipeName).toBe("New Recipe");
    const [appliedTemplate] = await db.select().from(tables.runTemplatesTable);
    expect(appliedTemplate.values).toMatchObject({ doughRecipeName: "New Recipe", cases: 77 });
    expect((await post(`/master-data-operations/${first.id}/undo`, {}, "manager-b")).status).toBe(200);
    const [profile] = await db.select().from(tables.brandProfilesTable);
    expect(profile.values).toEqual({ doughRecipeName: "Old Recipe", cases: 10 });
    expect(profile.crustValues).toEqual({ doughRecipeName: "Old Recipe" });
    const [template] = await db.select().from(tables.runTemplatesTable);
    expect(template.values).toEqual({ doughRecipeName: "Old Recipe", cases: 77 });
    expect(template.revision).toBeGreaterThan(appliedTemplate.revision);
    const day = (await db.select().from(tables.dailySyncTable))[0].data as { runValues: Record<string, unknown>; dayState: { runs: unknown[] } };
    const original = beforeDay.data as typeof day;
    expect(day.runValues.pending).toEqual({ doughRecipeName: "Old Recipe", cases: 10, doughBatches: 8 });
    expect(day.runValues["live-unrelated"]).toEqual(original.runValues["live-unrelated"]);
    expect(day.dayState.runs[1]).toEqual(original.dayState.runs[1]);
    expect((await db.select().from(tables.factoryKvTable)).find((row) => row.key === "unrelated-security-fixture")?.value)
      .toEqual({ pin: "synthetic-private-sentinel" });
    expect(JSON.stringify((await db.select().from(tables.masterDataOperationsTable))[0].facts)).not.toContain("synthetic-private-sentinel");
  });
  it.each(["profile values", "profile crustValues", "template values", "pending-run values"] as const)(
    "conflicts without partial restoration when a later %s references the renamed target", async (container) => {
      const first = await apply();
      expect(first.body.status).toBe("applied");
      if (container.startsWith("profile")) {
        await db.insert(tables.brandProfilesTable).values({
          key: "later__profile", brand: "Later", flavor: "Profile", updatedAtMs: 200,
          values: container === "profile values" ? { doughRecipeName: "New Recipe" } : {},
          crustValues: container === "profile crustValues" ? { doughRecipeName: "New Recipe" } : {},
        });
      } else if (container === "template values") {
        await db.insert(tables.runTemplatesTable).values({
          id: "later-template", name: "Later template", createdAt: "2026-10-23T00:00:00.000Z",
          brand: "Later", flavor: "Template", values: { doughRecipeName: "New Recipe" }, revision: 1,
        });
      } else {
        await db.insert(tables.dailySyncTable).values({ date: "2026-10-23", data: {
          dayState: { date: "2026-10-23", currentIndex: 0, runs: [
            { id: "later-run", brand: "Later", flavor: "Run", startedAt: null, endedAt: null },
          ] },
          runValues: { "later-run": { doughRecipeName: "New Recipe", cases: 10 } },
        } });
      }
      await expectNewDependencyConflict(first.id);
    });
  it.each(["values", "crustValues"] as const)(
    "conflicts without partial restoration for a later ingredient row in profile %s", async (container) => {
      await db.insert(tables.ingredientsTable).values({
        id: "ingredient-old", name: "Old Ingredient", categories: ["general"],
      });
      const first = await apply({
        action: "rename", category: "ingredient", sources: ["Old Ingredient"], target: "New Ingredient",
      });
      expect(first.body.status).toBe("applied");
      const linked = { doughRecipe: [{ ingredient: "New Ingredient", ingredientId: "ingredient-old", lbs: 3 }] };
      await db.insert(tables.brandProfilesTable).values({
        key: "later__ingredient", brand: "Later", flavor: "Ingredient", updatedAtMs: 200,
        values: container === "values" ? linked : {}, crustValues: container === "crustValues" ? linked : {},
      });
      await expectNewDependencyConflict(first.id);
    });
  it("makes a started dependency explicitly non-undoable and never rewrites that run's values", async () => {
    await seedReferences(true);
    const first = await apply(); expect(first.body.status).toBe("unavailable");
    expect(first.preview.eligible).toBe(false);
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(409);
    const day = (await db.select().from(tables.dailySyncTable))[0].data as { runValues: Record<string, unknown> };
    expect(day.runValues.pending).toEqual({ doughRecipeName: "Old Recipe", cases: 10, doughBatches: 8 });
  });
  it("conflicts if an affected pending run starts after the original change", async () => {
    await seedReferences();
    const first = await apply();
    const [day] = await db.select().from(tables.dailySyncTable);
    const data = day.data as { dayState: { runs: Array<Record<string, unknown>> } };
    data.dayState.runs[0].startedAt = 200;
    await db.update(tables.dailySyncTable).set({ data }).where(eq(tables.dailySyncTable.date, day.date));
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(409);
    expect((await rows())[0].name).toBe("New Recipe");
    expect((await db.select().from(tables.brandProfilesTable))[0].values.doughRecipeName).toBe("New Recipe");
  });
  it("keeps completed evidence immutable and routes protected changes to an explicit unavailable receipt", async () => {
    await db.insert(tables.completedRunHistoryTable).values({ id: "immutable", operationId: "completed-op", runId: "finished",
      date: "2026-10-22", completedAt: new Date("2026-10-22T12:00:00Z"), snapshot: { doughRecipeName: "Old Recipe", cases: 123 },
      snapshotHash: "1".repeat(64), actorId: "manager-a" });
    const before = await db.select().from(tables.completedRunHistoryTable);
    const first = await apply(); expect(first.body.status).toBe("unavailable");
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(409);
    expect(await db.select().from(tables.completedRunHistoryTable)).toEqual(before);
  });
  it("conflicts on a new inventory dependency without changing its accounting identity or quantities", async () => {
    await db.insert(tables.ingredientsTable).values({ id: "ingredient-old", name: "Old Ingredient", categories: ["general"] });
    const first = await apply({ action: "rename", category: "ingredient", sources: ["Old Ingredient"], target: "New Ingredient" });
    expect(first.body.status).toBe("applied");
    await db.insert(tables.inventoryItemsTable).values({ key: "synthetic-stock", name: "Synthetic stock", category: "ingredient",
      unit: "lbs", productionIngredientId: "ingredient-old", conversionFactor: 20 });
    const before = await db.select().from(tables.inventoryItemsTable);
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(409);
    expect(await db.select().from(tables.inventoryItemsTable)).toEqual(before);
    expect((await db.select().from(tables.ingredientsTable))[0].name).toBe("New Ingredient");
  });
  it.each([
    { action: "add", category: "dough", sources: ["Added Recipe"] },
    { action: "remove", category: "dough", sources: ["Old Recipe"] },
    { action: "move", category: "dough", sources: ["Old Recipe"], destination: "sauce" },
  ])("compensates ordinary canonical $action commands", async (command) => {
    const first = await apply(command); expect(first.response.status).toBe(200);
    expect((await post(`/master-data-operations/${first.id}/undo`, {}, "manager-b")).status).toBe(200);
    expect((await rows()).find((row) => row.id === "old-recipe")).toMatchObject({ name: "Old Recipe", enabled: true });
    expect((await rows()).filter((row) => row.enabled)).toHaveLength(1);
    expect((await db.select().from(tables.sauceRecipesTable)).filter((row) => row.enabled)).toHaveLength(0);
  });
  it("restores merge sources and alias edges while retaining the target recipe's native contents", async () => {
    await db.insert(tables.doughRecipesTable).values({ id: "target", name: "Target Recipe", components: [{ ingredient: "Flour", lbs: 25 }] });
    await db.insert(tables.specImportAliasesTable).values({ kind: "recipeName", context: "dough", externalName: "Earlier name", canonicalName: "Old Recipe" });
    const first = await apply({ action: "merge", category: "dough", sources: ["Old Recipe"], target: "Target Recipe" });
    expect(first.response.status).toBe(200);
    expect((await rows()).find((row) => row.id === "old-recipe")?.enabled).toBe(false);
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(200);
    expect((await rows()).find((row) => row.id === "old-recipe")?.enabled).toBe(true);
    expect((await rows()).find((row) => row.id === "target")?.components).toEqual([{ ingredient: "Flour", lbs: 25 }]);
    expect((await db.select().from(tables.specImportAliasesTable)).map((row) => [row.externalName, row.canonicalName]))
      .toEqual([["Earlier name", "Old Recipe"]]);
  });
  it("preserves later independent guarded additions, including names in the same directory", async () => {
    const first = await apply({ action: "add", category: "dough", sources: ["Independent A"] }, "independent-first");
    const second = await apply({ action: "add", category: "dough", sources: ["Independent B"] }, "independent-second");
    expect(first.response.status).toBe(200); expect(second.response.status).toBe(200);
    expect((await post(`/master-data-operations/${first.id}/undo`, {}, "manager-b")).status).toBe(200);
    expect((await rows()).find((row) => row.name === "Independent B")?.enabled).toBe(true);
    const names = (await db.select().from(tables.factoryKvTable)).find((row) => row.key === "run-calc-dough-recipe-names")?.value;
    expect(names).toContain("Independent B"); expect(names).not.toContain("Independent A");
    expect((await post(`/master-data-operations/${second.id}/undo`)).status).toBe(200);
  });
  it("bounds evidence before mutation and rejects a changed retained evidence fingerprint", async () => {
    await db.insert(tables.brandProfilesTable).values({ key: "large__plain", brand: "Large", flavor: "Plain",
      values: { doughRecipeName: "Old Recipe", notes: "x".repeat(600_000) }, crustValues: {} });
    const oversized = await post("/master-data-operations/oversized-preview/preview", rename);
    expect(oversized.status).toBe(400);
    expect((await readJson(oversized)).error).toMatch(/bounded.*evidence/iu);
    expect((await rows())[0].name).toBe("Old Recipe");
    expect(await db.select().from(tables.masterDataOperationsTable)).toHaveLength(0);
    await db.delete(tables.brandProfilesTable);
    const first = await apply();
    await db.update(tables.masterDataOperationsTable).set({ resultHash: "0".repeat(64) });
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(409);
    expect((await rows())[0].name).toBe("New Recipe");
  });
  it("paginates stably across identical timestamps without exposing row snapshots", async () => {
    for (const name of ["First", "Second", "Third"]) await apply({ action: "add", category: "brand", sources: [name] }, `page-record-${name}`);
    await db.update(tables.masterDataOperationsTable).set({ createdAt: new Date("2026-10-23T00:00:00Z") });
    const ids: unknown[] = []; let cursor: number | undefined;
    do {
      const response = await fetch(`${base}/master-data-operations?limit=1${cursor ? `&before=${cursor}` : ""}`, { headers: headers("manager-b") });
      const page = await response.json() as { items: Array<Record<string, unknown>>; nextCursor: number | null };
      expect(page.items).toHaveLength(1); expect(page.items[0]).not.toHaveProperty("facts");
      expect(page.items[0]).not.toHaveProperty("affectedRunReferences");
      ids.push(page.items[0].id); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(["page-record-Third", "page-record-Second", "page-record-First"]);
  });
  it.each(["role", "session", "scope"])("rechecks %s after waiting for the transaction, not just at the HTTP entry", async (change) => {
    const first = await apply();
    const lock = await tables.pool.connect();
    await lock.query("BEGIN");
    await lock.query("SELECT pg_advisory_xact_lock(hashtext('guarded-master-data'), hashtext('live'))");
    const response = post(`/master-data-operations/${first.id}/undo`);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await db.execute(sql`SELECT count(*) AS waiting FROM pg_stat_activity WHERE wait_event = 'advisory' AND datname = current_database()`);
        if (Number(result.rows[0]?.waiting) > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      if (change === "role") await db.update(tables.userRolesTable).set({ role: "operator" }).where(eq(tables.userRolesTable.userId, "manager-a"));
      if (change === "session") await db.update(tables.authSessionsTable).set({ revokedAt: new Date() }).where(eq(tables.authSessionsTable.userId, "manager-a"));
      if (change === "scope") await db.update(tables.usersTable).set({ sandbox: true }).where(eq(tables.usersTable.id, "manager-a"));
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    expect((await response).status).toBe(403);
    expect((await rows())[0].name).toBe("New Recipe");
    expect((await db.select().from(tables.masterDataOperationsTable))[0].status).toBe("applied");
  });
  it("rejects an undone ingredient full-pool body even if a later GET supplied a fresh epoch", async () => {
    await db.insert(tables.ingredientsTable).values({ id: "ingredient-old", name: "Old Ingredient", categories: ["general"] });
    const first = await apply({ action: "rename", category: "ingredient", sources: ["Old Ingredient"], target: "New Ingredient" });
    const staleRead = await fetch(`${base}/ingredients`, { headers: headers() });
    const stale = await readJson(staleRead);
    expect((await post(`/master-data-operations/${first.id}/undo`)).status).toBe(200);
    const fresh = await fetch(`${base}/ingredients`, { headers: headers() });
    expect(fresh.headers.get("x-master-data-epoch")).toBe("2");
    const replay = await post("/ingredients", stale, "manager-a", "2");
    expect(replay.status).toBe(409);
    expect((await db.select().from(tables.ingredientsTable))[0].name).toBe("Old Ingredient");
  });
});
