// Real-Postgres coverage for the reviewed 2026-08-26 source-library heal.
// Import @workspace/db only after DATABASE_URL is switched: its pool binds on
// module evaluation.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"]; let pool: DbModule["pool"];
let doughRecipesTable: DbModule["doughRecipesTable"]; let sauceRecipesTable: DbModule["sauceRecipesTable"];
let cheeseRecipesTable: DbModule["cheeseRecipesTable"]; let mixesTable: DbModule["mixesTable"];
let brandProfilesTable: DbModule["brandProfilesTable"]; let dailySyncTable: DbModule["dailySyncTable"];
let specImportAliasesTable: DbModule["specImportAliasesTable"]; let dataHealsTable: DbModule["dataHealsTable"];
let runSourceLibraryReconciliationHeal: () => Promise<void>;
let runProfileNameLinkStubPurge: () => Promise<void>;
let runWorkbookImportStubPurge: () => Promise<void>;
let admin: pg.Pool; let databaseName: string; let originalUrl: string | undefined;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const HEAL = "source-library-reconciliation-2026-08-26-v1";
const STUBS = [
  ["cheese:spec:basha-s-ultra-thin-crust-basha-s-ultra-thin-bbq-chicken-cheese-mix", "basha's ultra thin crust Basha's Ultra Thin BBQ Chicken Cheese Mix"],
  ["cheese:spec:basha-s-ultra-thin-crust-basha-s-ultra-thin-pepperoni-cheese-mix", "basha's ultra thin crust Basha's Ultra Thin Pepperoni Cheese Mix"],
  ["cheese:spec:basha-s-ultra-thin-crust-basha-s-ultra-thin-pepperoni-romano-cheese-mix", "basha's ultra thin crust Basha's Ultra Thin Pepperoni/Romano Cheese Mix"],
] as const;

beforeAll(async () => {
  originalUrl = process.env.DATABASE_URL; if (!originalUrl) throw new Error("DATABASE_URL must be set");
  admin = new pg.Pool({ connectionString: originalUrl }); admin.on("error", () => {});
  databaseName = `helium_reconcile_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(originalUrl); url.pathname = `/${databaseName}`;
  const pushed = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8",
  });
  if (pushed.status !== 0) throw new Error(`push failed: ${pushed.stderr}`);
  process.env.DATABASE_URL = url.toString();
  const mod = await import("@workspace/db");
  ({ db, pool, doughRecipesTable, sauceRecipesTable, cheeseRecipesTable, mixesTable,
    brandProfilesTable, dailySyncTable, specImportAliasesTable, dataHealsTable } = mod);
  ({
    runSourceLibraryReconciliationHeal,
    runProfileNameLinkStubPurge,
    runWorkbookImportStubPurge,
  } = await import("./dataHeals"));

  // One audited automatic replacement in every pool. All begin with nonblank,
  // conflicting data so the assertions prove this is an overwrite, not fill.
  await db.insert(doughRecipesTable).values({
    id: "dough:masa-dough", scope: "live", name: "Masa Dough",
    components: [{ ingredient: "manager wrong", lbs: 99 }], doughballWeightOz: 99, doughballsPerTray: 99,
  });
  await db.insert(sauceRecipesTable).values({
    id: "sauce:bobo-s-buffalo-pizza-sauce", scope: "live", name: "Bobo's Buffalo Pizza Sauce",
    components: [{ ingredient: "manager wrong", lbs: 99 }],
  });
  await db.insert(cheeseRecipesTable).values([
    { id: "cheese:aldo:aldo-s-standard-cheese-mix", scope: "live", name: "Aldo's Standard Cheese Mix", components: [{ ingredient: "manager wrong", lbs: 99 }] },
    // An audited replacement id with a manager rename: stale id+name guard
    // must skip it rather than overwriting its nonblank components.
    { id: "cheese:basha-s-original:basha-s-original-cheese-cheese-mix", scope: "live", name: "Manager renamed replacement", components: [{ ingredient: "must survive", lbs: 7 }] },
    { id: "cheese:corner-booth:corner-bbq-chicken-cheese-mix", scope: "live", name: "Corner Booth BBQ Chicken Cheese Mix", components: [{ ingredient: "x", lbs: 1 }] },
    { id: "cheese:four-hands:4hands-chicken-bacon-club-cheese-mix", scope: "live", name: "Manager renamed", components: [{ ingredient: "x", lbs: 1 }] },
    { id: STUBS[0][0], scope: "live", name: STUBS[0][1], components: [] },
    { id: STUBS[1][0], scope: "live", name: STUBS[1][1], components: [] },
    { id: STUBS[2][0], scope: "live", name: STUBS[2][1], components: [{ ingredient: "protected", lbs: 1 }] },
    { id: "cheese:basha-s-ultra-thin:basha-s-ultra-thin-bbq-chicken-cheese-mix", scope: "live", name: "Basha's Ultra Thin BBQ Chicken Cheese Mix", components: [{ ingredient: "canonical", lbs: 1 }] },
  ]);
  await db.insert(mixesTable).values({
    id: "premix--bobo-s-deluxe-bobo-s-deluxe-veggie-mix", scope: "live", name: "Bobo's Deluxe Veggie Mix",
    components: [{ ingredient: "manager wrong", perPizza: 99 }], batchSize: 99,
  });
  await db.insert(brandProfilesTable).values([
    { key: "link__profile", scope: "live", brand: "Link", flavor: "Profile",
      values: { app1CheeseRecipeName: "Corner BBQ Chicken Cheese Mix" }, updatedAtMs: 100 },
    { key: "stub__repoint", scope: "live", brand: "Stub", flavor: "Repoint",
      values: { app1CheeseRecipeName: STUBS[0][1] }, updatedAtMs: 100 },
  ]);
  await db.insert(dailySyncTable).values([
    { date: "2026-08-26", scope: "live", data: { dayState: { runs: [
      { id: "pending" }, { id: "stub-pending" }, { id: "started", startedAt: 1 },
    ] }, runValues: {
      pending: { app1CheeseRecipeName: "Corner BBQ Chicken Cheese Mix" },
      "stub-pending": { app1CheeseRecipeName: STUBS[0][1] },
      started: { app1CheeseRecipeName: STUBS[1][1] },
    }, runValuesUpdatedAt: { pending: 10, "stub-pending": 10, started: 10 } } },
    { date: "2026-08-25", scope: "live", data: { dayState: { runs: [{ id: "history" }] },
      runValues: { history: { app1CheeseRecipeName: STUBS[1][1] } },
      runValuesUpdatedAt: { history: 10 } } },
  ]);
}, 120_000);

afterAll(async () => {
  await pool?.end().catch(() => {}); process.env.DATABASE_URL = originalUrl;
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => {});
  await admin.end();
});

describe("runSourceLibraryReconciliationHeal", () => {
  it("overwrites audited pools, repoints only pending live links, and protects guarded rows", async () => {
    // Exercise the two generic stub purges that run earlier during production
    // boot. A historical-only reference must keep its recipe alive until the
    // reconciliation heal performs its own preservation check.
    await runProfileNameLinkStubPurge();
    await runWorkbookImportStubPurge();
    expect(await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, STUBS[1][0]))).toHaveLength(1);
    await runSourceLibraryReconciliationHeal();
    const [dough] = await db.select().from(doughRecipesTable).where(eq(doughRecipesTable.id, "dough:masa-dough"));
    const [sauce] = await db.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.id, "sauce:bobo-s-buffalo-pizza-sauce"));
    const [cheese] = await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, "cheese:aldo:aldo-s-standard-cheese-mix"));
    const [mix] = await db.select().from(mixesTable).where(eq(mixesTable.id, "premix--bobo-s-deluxe-bobo-s-deluxe-veggie-mix"));
    expect(dough.components).toEqual(expect.arrayContaining([expect.objectContaining({ ingredient: "ADM WHEAT FLOUR", lbs: 200 })]));
    expect(dough.doughballWeightOz).toBe(12);
    expect(sauce.components).toEqual([{ ingredient: "Legacy Buffalo Ranch Sauce", lbs: 400 }, { ingredient: "Frank's Red Hot Sauce", lbs: 16 }]);
    expect(cheese.components).toHaveLength(4);
    expect(mix.batchSize).toBe(147.4875);
    expect((await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, "cheese:basha-s-original:basha-s-original-cheese-cheese-mix")))[0].components).toEqual([{ ingredient: "must survive", lbs: 7 }]);
    expect((await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, "cheese:four-hands:4hands-chicken-bacon-club-cheese-mix")))[0].name).toBe("Manager renamed");

    const [alias] = await db.select().from(specImportAliasesTable).where(and(
      eq(specImportAliasesTable.scope, "live"), eq(specImportAliasesTable.kind, "appType"),
      eq(specImportAliasesTable.externalName, "Corner BBQ Chicken Cheese Mix"),
    ));
    expect(alias.canonicalName).toBe("Corner Booth BBQ Chicken Cheese Mix");
    const [profile] = await db.select().from(brandProfilesTable).where(eq(brandProfilesTable.key, "link__profile"));
    expect((profile.values as any).app1CheeseRecipeName).toBe("Corner Booth BBQ Chicken Cheese Mix");
    expect(profile.updatedAtMs).toBeGreaterThan(100);
    const [stubProfile] = await db.select().from(brandProfilesTable).where(eq(brandProfilesTable.key, "stub__repoint"));
    expect((stubProfile.values as any).app1CheeseRecipeName).toBe("Basha's Ultra Thin BBQ Chicken Cheese Mix");
    const rows = await db.select().from(dailySyncTable);
    const future = rows.find((row) => row.date === "2026-08-26")!.data as any;
    const history = rows.find((row) => row.date === "2026-08-25")!.data as any;
    expect(future.runValues.pending.app1CheeseRecipeName).toBe("Corner Booth BBQ Chicken Cheese Mix");
    expect(future.runValues["stub-pending"].app1CheeseRecipeName).toBe("Basha's Ultra Thin BBQ Chicken Cheese Mix");
    expect(future.runValuesUpdatedAt["stub-pending"]).toBeGreaterThan(10);
    expect(future.runValuesUpdatedAt.pending).toBeGreaterThan(10);
    expect(future.runValues.started.app1CheeseRecipeName).toBe(STUBS[1][1]);
    expect(history.runValues.history.app1CheeseRecipeName).toBe(STUBS[1][1]);

    expect(await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, STUBS[0][0]))).toHaveLength(0);
    expect(await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, STUBS[1][0]))).toHaveLength(1);
    expect(await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, STUBS[2][0]))).toHaveLength(1);
    const [marker] = await db.select().from(dataHealsTable).where(eq(dataHealsTable.id, HEAL));
    expect(marker.result).toEqual({ replacements: 4, aliasesInserted: 2, repointedProfiles: 2, repointedRuns: 2, deletedStubs: 1 });
  });

  it("is marker-guarded on the second execution", async () => {
    await db.update(brandProfilesTable).set({ values: { app1CheeseRecipeName: "Manual override" }, updatedAtMs: 9999 })
      .where(eq(brandProfilesTable.key, "link__profile"));
    await runSourceLibraryReconciliationHeal();
    const [profile] = await db.select().from(brandProfilesTable).where(eq(brandProfilesTable.key, "link__profile"));
    expect((profile.values as any).app1CheeseRecipeName).toBe("Manual override");
    const [marker] = await db.select().from(dataHealsTable).where(eq(dataHealsTable.id, HEAL));
    expect(marker.result).toEqual({ replacements: 4, aliasesInserted: 2, repointedProfiles: 2, repointedRuns: 2, deletedStubs: 1 });
  });
});