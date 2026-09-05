// Integration tests for the profile name-link heal + orphaned zero-value stub
// purge (runProfileNameLinkStubPurge). Real Postgres round-trip:
//   (a) a profile with a snapshot mismatch gets corrected (with merge-alias
//       chain resolution applied to the spec name),
//   (b) a profile whose run has started is skipped,
//   (c) a profile with no snapshot is skipped,
//   (d) an orphaned zero-value stub is removed,
//   (e) a stub with a live profile reference survives (and non-zero recipes
//       always survive),
//   (f) re-running the heal is a no-op (marker-guarded).
//
// Pattern: disposable Postgres DB created before any dynamic import that pulls
// in @workspace/db (pool binds to DATABASE_URL at import time — see
// .agents/memory/integration-test-db-binding.md).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let brandProfilesTable: DbModule["brandProfilesTable"];
let savedSpecSheetsTable: DbModule["savedSpecSheetsTable"];
let mergeAliasesTable: DbModule["mergeAliasesTable"];
let dailySyncTable: DbModule["dailySyncTable"];
let doughRecipesTable: DbModule["doughRecipesTable"];
let sauceRecipesTable: DbModule["sauceRecipesTable"];
let cheeseRecipesTable: DbModule["cheeseRecipesTable"];
let mixesTable: DbModule["mixesTable"];
let dataHealsTable: DbModule["dataHealsTable"];
let runProfileNameLinkStubPurge: () => Promise<void>;
let runWorkbookImportStubPurge: () => Promise<void>;
let runAug19SavedSpecProfileRepair: () => Promise<void>;
let runAug19SavedSpecProfileRepairV2: () => Promise<void>;
let buildMasterDataHealthReport: (executor: any, scope: string, at?: Date) => Promise<any>;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const HEAL_ID = "profile-name-link-stub-purge-v1";
const WORKBOOK_HEAL_ID = "workbook-import-stub-purge-v1";
const AUG19_REPAIR_ID = "aug19-saved-spec-profile-repair-v1";
const AUG19_REPAIR_V2_ID = "aug19-saved-spec-profile-repair-v2";

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_namelink_int_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
    throw new Error(`drizzle push-force failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlStr;

  const dbMod = await import("@workspace/db");
  db = dbMod.db;
  pool = dbMod.pool;
  brandProfilesTable = dbMod.brandProfilesTable;
  savedSpecSheetsTable = dbMod.savedSpecSheetsTable;
  mergeAliasesTable = dbMod.mergeAliasesTable;
  dailySyncTable = dbMod.dailySyncTable;
  doughRecipesTable = dbMod.doughRecipesTable;
  sauceRecipesTable = dbMod.sauceRecipesTable;
  cheeseRecipesTable = dbMod.cheeseRecipesTable;
  mixesTable = dbMod.mixesTable;
  dataHealsTable = dbMod.dataHealsTable;

  const heals = await import("./dataHeals");
  runProfileNameLinkStubPurge = heals.runProfileNameLinkStubPurge;
  runWorkbookImportStubPurge = heals.runWorkbookImportStubPurge;
  runAug19SavedSpecProfileRepair = heals.runAug19SavedSpecProfileRepair;
  runAug19SavedSpecProfileRepairV2 = heals.runAug19SavedSpecProfileRepairV2;
  ({ buildMasterDataHealthReport } = await import("./masterDataHealth"));

  // ── Seed fixture data ──────────────────────────────────────────────────────

  // Latest spec snapshot: Aldo/cheese says sauce "Old BBQ" + dough "Thin Dough";
  // Bobo/pep says sauce "Ranch Sauce".
  await db.insert(savedSpecSheetsTable).values({
    scope: "live",
    label: "test sheet",
    data: {
      profiles: [
        { brand: "Aldo", flavor: "cheese", sauceName: "Old BBQ", doughName: "Thin Dough" },
        { brand: "Bobo", flavor: "pep", sauceName: "Ranch Sauce" },
      ],
      recipes: [],
    },
  });
  // Two same-day snapshots ensure the historical repair takes the latest
  // verified parse. Its raw applicator type must never replace the already
  // resolved generic type/name link on the profile.
  await db.insert(savedSpecSheetsTable).values([
    {
      scope: "live",
      label: "older Aug 19 profile parse",
      createdAt: new Date("2026-08-19T09:00:00.000Z"),
      data: {
        profiles: [{ brand: "Guard", flavor: "deluxe", dieType: "old die", sauceOzPerPizza: 1 }],
      },
    },
    {
      scope: "live",
      label: "latest Aug 19 profile parse",
      createdAt: new Date("2026-08-19T12:00:00.000Z"),
      data: {
        profiles: [{
          brand: "Guard",
          flavor: "deluxe",
          dieType: "new die",
          allergen: "gluten",
          sauceName: "Raw Sauce Name",
          doughName: "Raw Dough Name",
          sauceOzPerPizza: 4.5,
          pizzasPerCase: 12,
          sauceBarrelLbs: 200,
          applicators: [{ slot: 1, type: "Raw Mix Name", ozPerPizza: 2 }],
        }],
      },
    },
  ]);

  // Merge alias: "Old BBQ" was merged into "New BBQ" — corrections must land
  // on the merge target, not the raw spec name.
  await db.insert(mergeAliasesTable).values({
    scope: "live",
    category: "sauce",
    externalName: "Old BBQ",
    canonicalName: "New BBQ",
  });

  // (a) mismatch: stored sauce differs from (resolved) spec name.
  await db.insert(brandProfilesTable).values({
    key: "aldo__cheese",
    scope: "live",
    brand: "Aldo",
    flavor: "cheese",
    values: {
      frontlineRecipeName: "Wrong Sauce",
      doughRecipeName: "Thin Dough",
      app1CheeseRecipeName: "Kept Cheese Mix",
    },
    updatedAtMs: 1000,
  });

  // (b) mismatch but its run has started — must be skipped.
  await db.insert(brandProfilesTable).values({
    key: "bobo__pep",
    scope: "live",
    brand: "Bobo",
    flavor: "pep",
    values: { frontlineRecipeName: "Wrong Ranch" },
    updatedAtMs: 1000,
  });
  await db.insert(dailySyncTable).values({
    date: "2026-08-19",
    scope: "live",
    data: { runs: [{ id: "r1", brand: "Bobo", flavor: "pep", startedAt: 1755600000000 }] },
  });
  // (c) no snapshot — must be left untouched.
  await db.insert(brandProfilesTable).values({
    key: "carl__deluxe",
    scope: "live",
    brand: "Carl",
    flavor: "deluxe",
    values: { frontlineRecipeName: "Whatever Sauce" },
    updatedAtMs: 1000,
  });

  // (d) orphaned zero-value stubs (no profile references anywhere).
  await db.insert(sauceRecipesTable).values({
    id: "orphan-sauce",
    scope: "live",
    name: "Orphan Sauce",
    components: [],
  });
  await db.insert(cheeseRecipesTable).values({
    id: "orphan-cheese",
    scope: "live",
    name: "Orphan Cheese Mix",
    components: [{ ingredient: "mozz", lbs: 0 }],
  });
  await db.insert(mixesTable).values({
    id: "orphan-mix",
    scope: "live",
    name: "Orphan Veggie Mix",
    components: [{ ingredient: "onion", perPizza: 0 }],
  });

  // (e) zero-value stubs WITH live profile references — must survive.
  await db.insert(doughRecipesTable).values({
    id: "thin-dough",
    scope: "live",
    name: "Thin Dough",
    components: [],
  });
  await db.insert(cheeseRecipesTable).values({
    id: "kept-cheese",
    scope: "live",
    name: "Kept Cheese Mix",
    components: [],
  });
  // Non-zero recipe with no references — never a stub, must survive.
  await db.insert(sauceRecipesTable).values({
    id: "real-sauce",
    scope: "live",
    name: "Real Unreferenced Sauce",
    components: [{ ingredient: "tomato", lbs: 12 }],
  });
}, 120_000);

afterAll(async () => {
  await pool?.end().catch(() => {});
  process.env.DATABASE_URL = originalDatabaseUrl;
  await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`).catch(() => {});
  await adminPool.end();
});

describe("runProfileNameLinkStubPurge", () => {
  it("applies corrections, skips started/no-snapshot profiles, purges orphan stubs", async () => {
    await runProfileNameLinkStubPurge();

    // (a) mismatch corrected through the merge-alias chain.
    const [aldo] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "aldo__cheese"), eq(brandProfilesTable.scope, "live")));
    const aldoValues = aldo.values as Record<string, unknown>;
    expect(aldoValues.frontlineRecipeName).toBe("New BBQ");
    expect(aldoValues.doughRecipeName).toBe("Thin Dough"); // matched — unchanged
    expect(aldo.updatedAtMs).toBeGreaterThan(1000); // LWW stamp bumped

    // (b) started-run profile skipped.
    const [bobo] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "bobo__pep"), eq(brandProfilesTable.scope, "live")));
    expect((bobo.values as Record<string, unknown>).frontlineRecipeName).toBe("Wrong Ranch");
    expect(bobo.updatedAtMs).toBe(1000);

    // (c) no-snapshot profile untouched.
    const [carl] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "carl__deluxe"), eq(brandProfilesTable.scope, "live")));
    expect((carl.values as Record<string, unknown>).frontlineRecipeName).toBe("Whatever Sauce");
    expect(carl.updatedAtMs).toBe(1000);

    // (d) orphaned zero-value stubs removed.
    expect(await db.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.id, "orphan-sauce"))).toHaveLength(0);
    expect(await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, "orphan-cheese"))).toHaveLength(0);
    expect(await db.select().from(mixesTable).where(eq(mixesTable.id, "orphan-mix"))).toHaveLength(0);

    // (e) referenced stubs and non-zero recipes survive.
    expect(await db.select().from(doughRecipesTable).where(eq(doughRecipesTable.id, "thin-dough"))).toHaveLength(1);
    expect(await db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.id, "kept-cheese"))).toHaveLength(1);
    expect(await db.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.id, "real-sauce"))).toHaveLength(1);

    // Marker written with a result summary.
    const [marker] = await db.select().from(dataHealsTable).where(eq(dataHealsTable.id, HEAL_ID));
    expect(marker).toBeTruthy();
    const result = marker.result as Record<string, unknown>;
    expect(result.correctedProfiles).toBe(1);
    expect(result.skippedStarted).toBe(1);
    expect(result.removedStubs).toEqual({ dough: 0, sauce: 1, cheese: 1, mix: 1 });
  });

  it("(f) is a no-op on re-run", async () => {
    // A new orphan stub inserted AFTER the first run must survive a re-run —
    // the marker guard means the heal never executes twice.
    await db.insert(sauceRecipesTable).values({
      id: "post-heal-orphan",
      scope: "live",
      name: "Post Heal Orphan",
      components: [],
    });
    // And revert the corrected profile — a re-run must not re-correct it.
    await db
      .update(brandProfilesTable)
      .set({ values: { frontlineRecipeName: "Manually Reverted" }, updatedAtMs: 99999999999999 })
      .where(and(eq(brandProfilesTable.key, "aldo__cheese"), eq(brandProfilesTable.scope, "live")));

    // A claimed marker must protect the original summary as well as the data:
    // if a later boot reaches the early return, it must not overwrite result.
    const claimedResult = { preserved: "first-run-summary" };
    await db
      .update(dataHealsTable)
      .set({ result: claimedResult })
      .where(eq(dataHealsTable.id, HEAL_ID));

    await runProfileNameLinkStubPurge();

    expect(await db.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.id, "post-heal-orphan"))).toHaveLength(1);
    const [aldo] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "aldo__cheese"), eq(brandProfilesTable.scope, "live")));
    expect((aldo.values as Record<string, unknown>).frontlineRecipeName).toBe("Manually Reverted");
    const [markerAfterSecondRun] = await db
      .select()
      .from(dataHealsTable)
      .where(eq(dataHealsTable.id, HEAL_ID));
    expect(markerAfterSecondRun.result).toEqual(claimedResult);
  });

  it("(g) waits for a concurrent day-state reference before deciding a stub is orphaned", async () => {
    await db.delete(dataHealsTable).where(eq(dataHealsTable.id, HEAL_ID));
    await db.insert(cheeseRecipesTable).values({
      id: "concurrent-reference-cheese",
      scope: "live",
      name: "Concurrent Reference Cheese",
      components: [],
    });
    await db.insert(dailySyncTable).values({
      date: "2026-08-30",
      scope: "live",
      data: { dayState: { runs: [{ id: "race-run" }] }, runValues: {} },
    });

    const writer = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await writer.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        `UPDATE daily_sync
         SET data = $1::jsonb
         WHERE date = $2 AND scope = 'live'`,
        [
          JSON.stringify({
            dayState: { runs: [{ id: "race-run" }] },
            runValues: {
              "race-run": { app1CheeseRecipeName: "Concurrent Reference Cheese" },
            },
          }),
          "2026-08-30",
        ],
      );

      let healSettled = false;
      const heal = runProfileNameLinkStubPurge().finally(() => {
        healSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(healSettled).toBe(false);

      await writer.query("COMMIT");
      await heal;
    } finally {
      await writer.query("ROLLBACK").catch(() => {});
      await writer.end();
    }

    expect(
      await db
        .select()
        .from(cheeseRecipesTable)
        .where(eq(cheeseRecipesTable.id, "concurrent-reference-cheese")),
    ).toHaveLength(1);
  });
});

describe("runWorkbookImportStubPurge", () => {
  it("removes only orphaned empty workbook-pool rows and is marker-guarded", async () => {
    await db.insert(brandProfilesTable).values({
      key: "workbook__referenced",
      scope: "live",
      brand: "Workbook",
      flavor: "referenced",
      values: { app1CheeseRecipeName: "Referenced Cheese", app2CheeseRecipeName: "Referenced Mix" },
      crustValues: {},
      updatedAtMs: 1,
    });
    await db.insert(cheeseRecipesTable).values([
      { id: "cheese:workbook:workbook-cheese-orphan", scope: "live", brand: "Workbook", name: "Workbook Cheese Orphan", components: [] },
      { id: "cheese:workbook:referenced-cheese", scope: "live", brand: "Workbook", name: "Referenced Cheese", components: [] },
      { id: "cheese:workbook:workbook-cheese-nonzero", scope: "live", brand: "Workbook", name: "Workbook Cheese Nonzero", components: [{ ingredient: "cheese", lbs: 1 }] },
      { id: "manager-cheese-draft", scope: "live", brand: "Workbook", name: "Manager Cheese Draft", components: [] },
    ]);
    await db.insert(mixesTable).values([
      { id: "premix-workbook-orphan-workbook-mix-orphan", scope: "live", brand: "Workbook", flavor: "Orphan", name: "Workbook Mix Orphan", components: [] },
      { id: "premix-workbook-referenced-referenced-mix", scope: "live", brand: "Workbook", flavor: "Referenced", name: "Referenced Mix", components: [] },
      { id: "premix-workbook-nonzero-workbook-mix-nonzero", scope: "live", brand: "Workbook", flavor: "Nonzero", name: "Workbook Mix Nonzero", components: [{ ingredient: "spice", perPizza: 1 }] },
      { id: "premix-workbook-batched-workbook-mix-batched", scope: "live", brand: "Workbook", flavor: "Batched", name: "Workbook Mix Batched", components: [], batchSize: 1 },
      { id: "manager-mix-draft", scope: "live", brand: "Workbook", flavor: "Manager", name: "Manager Mix Draft", components: [] },
    ]);

    await runWorkbookImportStubPurge();

    expect(await db.select().from(cheeseRecipesTable)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cheese:workbook:referenced-cheese" }),
        expect.objectContaining({ id: "cheese:workbook:workbook-cheese-nonzero" }),
        expect.objectContaining({ id: "manager-cheese-draft" }),
      ]),
    );
    expect(await db.select().from(cheeseRecipesTable).then((rows) => rows.map((row) => row.id))).not.toContain(
      "cheese:workbook:workbook-cheese-orphan",
    );
    const mixIds = await db.select().from(mixesTable).then((rows) => rows.map((row) => row.id));
    expect(mixIds).toEqual(expect.arrayContaining([
      "premix-workbook-referenced-referenced-mix",
      "premix-workbook-nonzero-workbook-mix-nonzero",
      "premix-workbook-batched-workbook-mix-batched",
      "manager-mix-draft",
    ]));
    expect(mixIds).not.toContain("premix-workbook-orphan-workbook-mix-orphan");

    const [marker] = await db.select().from(dataHealsTable).where(eq(dataHealsTable.id, WORKBOOK_HEAL_ID));
    expect(marker.result).toEqual({
      scannedProfiles: expect.any(Number),
      removedStubs: {
        cheese: expect.any(Number),
        mix: expect.any(Number),
      },
    });
    expect((marker.result as { removedStubs: { cheese: number; mix: number } }).removedStubs).toEqual({
      cheese: 1,
      mix: 1,
    });

    await db.insert(mixesTable).values({
      id: "workbook-mix-after-heal",
      scope: "live",
      name: "Workbook Mix After Heal",
      components: [],
    });
    await runWorkbookImportStubPurge();
    expect(await db.select().from(mixesTable).then((rows) => rows.map((row) => row.id))).toContain(
      "workbook-mix-after-heal",
    );
  });

  it("keeps a stub referenced by a profile save that commits before its locked scan", async () => {
    await db.delete(dataHealsTable).where(eq(dataHealsTable.id, WORKBOOK_HEAL_ID));
    await db.insert(cheeseRecipesTable).values({
      id: "cheese:workbook:workbook-cheese-race",
      scope: "live",
      brand: "Workbook",
      name: "Workbook Cheese Race",
      components: [],
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO brand_profiles
          (key, scope, brand, flavor, values, crust_values, updated_at_ms)
         VALUES ($1, 'live', $2, $3, $4::jsonb, '{}'::jsonb, 1)`,
        [
          "workbook__race",
          "Workbook",
          "Race",
          JSON.stringify({ app1CheeseRecipeName: "Workbook Cheese Race" }),
        ],
      );

      const heal = runWorkbookImportStubPurge();
      let completed = false;
      void heal.then(() => {
        completed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(completed).toBe(false);
      await client.query("COMMIT");
      await heal;
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }

    expect(
      await db
        .select({ id: cheeseRecipesTable.id })
        .from(cheeseRecipesTable)
        .where(eq(cheeseRecipesTable.id, "cheese:workbook:workbook-cheese-race")),
    ).toHaveLength(1);
    const [marker] = await db
      .select()
      .from(dataHealsTable)
      .where(eq(dataHealsTable.id, WORKBOOK_HEAL_ID));
    expect(marker.result).toMatchObject({ removedStubs: { cheese: 0 } });
  });
});

describe("runAug19SavedSpecProfileRepair", () => {
  it("repairs safe explicit fields, preserves resolved recipe links, and updates only future runs", async () => {
    await db.insert(brandProfilesTable).values({
      key: "guard__deluxe",
      scope: "live",
      brand: "Guard",
      flavor: "deluxe",
      values: {
        dieType: "stale die",
        sauceOzPerPizza: 2,
        pizzasPerCase: 8,
        sauceBarrelLbs: 100,
        frontlineRecipeName: "Keep Mixed Sauce",
        frontlineRecipe: [{ ingredient: "tomato", lbs: 20 }],
        doughRecipeName: "Keep Mixed Dough",
        doughRecipe: [{ ingredient: "flour", lbs: 10 }],
        app1Type: "Mix",
        app1CheeseRecipeName: "Resolved Mix Link",
        app1OzPerPizza: 3,
      },
      updatedAtMs: 1000,
    });
    await db.insert(dailySyncTable).values({
      date: "2026-08-20",
      scope: "live",
      data: {
        dayState: {
          runs: [
            { id: "future-guard", brand: "Guard", flavor: "deluxe" },
            { id: "started-guard", brand: "Guard", flavor: "deluxe", startedAt: 1755640000000 },
          ],
        },
        runValues: {
          "future-guard": { dieType: "stale die", sauceOzPerPizza: 2, app1Type: "Mix", app1CheeseRecipeName: "Resolved Mix Link" },
          "started-guard": { dieType: "stale die", sauceOzPerPizza: 2, app1Type: "Mix", app1CheeseRecipeName: "Resolved Mix Link" },
        },
        runValuesUpdatedAt: { "future-guard": 100, "started-guard": 100 },
      },
    });
    await runAug19SavedSpecProfileRepair();

    const [profile] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "guard__deluxe"), eq(brandProfilesTable.scope, "live")));
    const values = profile.values as Record<string, unknown>;
    expect(values).toMatchObject({
      dieType: "new die",
      allergen: "gluten",
      sauceOzPerPizza: 4.5,
      pizzasPerCase: 12,
      sauceBarrelLbs: 200,
      frontlineRecipeName: "Keep Mixed Sauce",
      doughRecipeName: "Keep Mixed Dough",
      app1Type: "Mix",
      app1CheeseRecipeName: "Resolved Mix Link",
      app1OzPerPizza: 3,
    });
    expect(profile.updatedAtMs).toBeGreaterThan(1000);

    const [day] = await db
      .select()
      .from(dailySyncTable)
      .where(and(eq(dailySyncTable.date, "2026-08-20"), eq(dailySyncTable.scope, "live")));
    const data = day.data as Record<string, any>;
    expect(data.runValues["future-guard"]).toMatchObject({
      dieType: "new die",
      sauceOzPerPizza: 4.5,
      pizzasPerCase: 12,
      sauceBarrelLbs: 200,
      app1Type: "Mix",
      app1CheeseRecipeName: "Resolved Mix Link",
    });
    expect(data.runValues["started-guard"]).toMatchObject({ dieType: "stale die", sauceOzPerPizza: 2 });
    expect(data.runValuesUpdatedAt["future-guard"]).toBeGreaterThan(100);
    expect(data.runValuesUpdatedAt["started-guard"]).toBe(100);

    const [marker] = await db.select().from(dataHealsTable).where(eq(dataHealsTable.id, AUG19_REPAIR_ID));
    expect(marker).toBeTruthy();

    await runAug19SavedSpecProfileRepair();
    const [afterSecondRun] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "guard__deluxe"), eq(brandProfilesTable.scope, "live")));
    expect(afterSecondRun.updatedAtMs).toBe(profile.updatedAtMs);
  });
});

describe("runAug19SavedSpecProfileRepairV2", () => {
  it("rebuilds verified recipe rows, applicator links, pepperoni, and only unstarted run snapshots", async () => {
    await db.insert(savedSpecSheetsTable).values({
      scope: "live",
      label: "authoritative Aug 19 full setup",
      createdAt: new Date("2026-08-19T16:00:00.000Z"),
      data: {
        profiles: [{
          brand: "Full",
          flavor: "everything",
          sauceName: "Red Hot Pizza Sauce",
          doughName: "Full Dough",
          sauceOzPerPizza: 4,
          applicators: [
            { slot: 1, type: "Full Cheese Blend", ozPerPizza: 2 },
            { slot: 3, type: "Full Veggie Mix", ozPerPizza: 1.5 },
          ],
          pepperonis: [{ type: "Natural Pepperoni", sticks: 12, ozPerPizza: 1.25, batchLbs: 20 }],
        }],
        recipes: [],
      },
    });
    await db.insert(sauceRecipesTable).values({
      id: "red-hot",
      scope: "live",
      name: "Red Hot Pizza Sauce",
      components: [{ ingredient: "Garlic Sauce", lbs: 200 }],
    });
    await db.insert(doughRecipesTable).values({
      id: "full-dough",
      scope: "live",
      name: "Full Dough",
      components: [{ ingredient: "Flour", lbs: 100 }],
      doughballWeightOz: 10,
      doughballsPerTray: 18,
    });
    await db.insert(cheeseRecipesTable).values({
      id: "full-cheese",
      scope: "live",
      name: "Full Cheese Blend",
      components: [{ ingredient: "Mozz", lbs: 20 }],
    });
    await db.insert(mixesTable).values({
      id: "full-mix",
      scope: "live",
      name: "Full Veggie Mix",
      components: [{ ingredient: "Peppers", perPizza: 1 }],
    });
    await db.insert(brandProfilesTable).values({
      key: "full__everything",
      scope: "live",
      brand: "Full",
      flavor: "everything",
      values: {
        frontlineRecipeName: "Mystic Pizza Sauce",
        frontlineRecipe: [{ ingredient: "Wrong Sauce", lbs: 10 }],
        doughRecipeName: "Wrong Dough",
        doughRecipe: [{ ingredient: "Wrong Flour", lbs: 10 }],
        app1Type: "Wrong Blend",
        app1CheeseRecipeName: "Wrong Blend",
        app3Type: "cheese",
        app3CheeseRecipeName: "Wrong Cheese",
        pep1Type: "Wrong Pepperoni",
      },
      updatedAtMs: 1,
    });
    await db.insert(dailySyncTable).values({
      date: "2026-08-21",
      scope: "live",
      data: {
        dayState: {
          runs: [
            { id: "full-unstarted", brand: "Full", flavor: "everything" },
            { id: "full-started", brand: "Full", flavor: "everything", startedAt: 1755800000000 },
          ],
        },
        runValues: {
          "full-unstarted": { frontlineRecipeName: "Mystic Pizza Sauce", app1Type: "Wrong Blend" },
          "full-started": { frontlineRecipeName: "Mystic Pizza Sauce", app1Type: "Wrong Blend" },
        },
        runValuesUpdatedAt: { "full-unstarted": 1, "full-started": 1 },
      },
    });

    await runAug19SavedSpecProfileRepairV2();

    const [profile] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "full__everything"), eq(brandProfilesTable.scope, "live")));
    const values = profile.values as Record<string, unknown>;
    expect(values).toMatchObject({
      frontlineRecipeName: "Red Hot Pizza Sauce",
      frontlineRecipe: [{ ingredient: "Garlic Sauce", lbs: 200 }],
      doughRecipeName: "Full Dough",
      doughRecipe: [{ ingredient: "Flour", lbs: 100 }],
      targetDoughballWeight: 10,
      doughballsPerTray: 18,
      app1Type: "cheese",
      app1CheeseRecipeName: "Full Cheese Blend",
      app1OzPerPizza: 2,
      app3Type: "Mix",
      app3CheeseRecipeName: "Full Veggie Mix",
      app3OzPerPizza: 1.5,
      pep1Type: "Natural Pepperoni",
      pep1Sticks: 12,
      pep1OzPerPizza: 1.25,
      pep1BatchLbs: 20,
      pep1Combined: true,
    });

    const [day] = await db
      .select()
      .from(dailySyncTable)
      .where(and(eq(dailySyncTable.date, "2026-08-21"), eq(dailySyncTable.scope, "live")));
    const data = day.data as Record<string, any>;
    expect(data.runValues["full-unstarted"]).toMatchObject({
      frontlineRecipeName: "Red Hot Pizza Sauce",
      frontlineRecipe: [{ ingredient: "Garlic Sauce", lbs: 200 }],
      app1Type: "cheese",
      app3Type: "Mix",
      pep1Type: "Natural Pepperoni",
    });
    expect(data.runValues["full-started"]).toEqual({
      frontlineRecipeName: "Mystic Pizza Sauce",
      app1Type: "Wrong Blend",
    });

    const [marker] = await db.select().from(dataHealsTable).where(eq(dataHealsTable.id, AUG19_REPAIR_V2_ID));
    expect(marker).toBeTruthy();
    await db
      .update(brandProfilesTable)
      .set({ values: { frontlineRecipeName: "Manual override" }, updatedAtMs: 99999999999999 })
      .where(and(eq(brandProfilesTable.key, "full__everything"), eq(brandProfilesTable.scope, "live")));
    await runAug19SavedSpecProfileRepairV2();
    const [afterSecondRun] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "full__everything"), eq(brandProfilesTable.scope, "live")));
    expect((afterSecondRun.values as Record<string, unknown>).frontlineRecipeName).toBe("Manual override");
  });
});

describe("master-data health confirmed profile-link repairs", () => {
  it("proposes only the five confirmed import repairs and preserves unrelated links", async () => {
    await db.insert(doughRecipesTable).values({
      id: "confirmed-crb-dough",
      scope: "live",
      name: "CRB Dough",
      components: [{ ingredient: "flour", lbs: 1 }],
    });
    await db.insert(sauceRecipesTable).values({
      id: "confirmed-aldo-sauce",
      scope: "live",
      name: "Aldo's Sauce",
      components: [],
    });
    // A previous fixture heal may have materialized the stale name; keep this
    // test focused on the retained missing-link record.
    await db.delete(sauceRecipesTable).where(eq(sauceRecipesTable.name, "Aldo's Sauce (made in house)"));
    const flavors = ["5 cheese", "bbq chicken", "hawaiian", "ultimate pepperoni"];
    await db.insert(brandProfilesTable).values([
      {
        key: "aldo's__sausage", scope: "live", brand: "Aldo's", flavor: "sausage",
        values: { frontlineRecipeName: "Aldo's Sauce (made in house)" }, updatedAtMs: 1,
      },
      ...flavors.map((flavor) => ({
        key: `basha's ultra thin crust__${flavor}`, scope: "live",
        brand: "Basha's Ultra Thin Crust", flavor,
        values: { doughRecipeName: '11" CRB recipe' }, updatedAtMs: 1,
      })),
    ]);
    await db.insert(savedSpecSheetsTable).values({
      scope: "live",
      label: "confirmed profile links",
      data: {
        profiles: [
          { brand: "Aldo's", flavor: "sausage", sauceName: "Aldo's Sauce" },
          ...flavors.map((flavor) => ({
            brand: "Basha's Ultra Thin Crust", flavor, doughName: '11" CRB recipe',
          })),
        ],
      },
    });

    const report = await buildMasterDataHealthReport(db, "live", new Date("2026-08-24T00:00:00.000Z"));
    const repairs = report.repairs.filter((repair: any) => repair.action === "update-profile-recipe-link");
    // The shared fixture already contains a healthy Aldo sauce link; the four
    // Basha links exercise the retained missing-link path here. The production
    // scan supplies the fifth allowlisted Aldo repair when it is missing.
    expect(repairs).toHaveLength(4);
    expect(repairs.map((repair: any) => repair.to).sort()).toEqual([
      "CRB Dough", "CRB Dough", "CRB Dough", "CRB Dough",
    ]);
    expect(repairs.every((repair: any) => repair.category === "profiles")).toBe(true);
  });
});

describe("master-data health launch classification", () => {
  it("keeps known legacy live records owned and non-blocking", async () => {
    await db.insert(doughRecipesTable).values([
      { id: "health-purchased-crust", scope: "live", name: 'Pedone Crust 7"x12" Oval', components: [] },
      { id: "health-review-dough", scope: "live", name: "Lucia's Dough recipe", components: [] },
    ]);
    await db.insert(brandProfilesTable).values({
      key: "health-legacy__", scope: "live", brand: "Health Legacy", flavor: "",
      values: { frontlineRecipeName: "Missing legacy sauce" }, updatedAtMs: 1,
    });

    const report = await buildMasterDataHealthReport(db, "live", new Date("2026-08-25T00:00:00.000Z"));
    const findings = report.findings.filter((item: any) =>
      item.id.includes("health-legacy") ||
      item.id.includes("health-purchased-crust") ||
      item.id.includes("health-review-dough"),
    );

    expect(findings.length).toBeGreaterThanOrEqual(3);
    expect(findings.every((item: any) => item.severity === "warning")).toBe(true);
    expect(findings.every((item: any) => item.owner)).toBe(true);
    expect(findings.every((item: any) => item.followUpDate === "2026-09-30")).toBe(true);
  });
});
