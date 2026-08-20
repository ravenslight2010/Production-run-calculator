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
let runAug19SavedSpecProfileRepair: () => Promise<void>;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const HEAL_ID = "profile-name-link-stub-purge-v1";
const AUG19_REPAIR_ID = "aug19-saved-spec-profile-repair-v1";

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
  runAug19SavedSpecProfileRepair = heals.runAug19SavedSpecProfileRepair;

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

    await runProfileNameLinkStubPurge();

    expect(await db.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.id, "post-heal-orphan"))).toHaveLength(1);
    const [aldo] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.key, "aldo__cheese"), eq(brandProfilesTable.scope, "live")));
    expect((aldo.values as Record<string, unknown>).frontlineRecipeName).toBe("Manually Reverted");
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
