// Integration tests for the cheese-recipes duplicate-name protections and the
// cheese-component-oz-strip-v2 data heal:
//
//   1. POST /cheese-recipes must NOT insert a NEW id whose trimmed,
//      case-insensitive name already exists in the scope — this is the race
//      that filled the pool with exact same-name duplicate rows (multi-file
//      imports deduping against a stale pool snapshot). Existing ids still
//      update freely (rename/edit by id is the intended flow), and within a
//      single batch the first NEW id for a name wins.
//   2. The boot data heal (cheese-recipe-name-dedupe-v1) removes exact-name
//      duplicates that already exist, keeping the best row per (scope, name):
//      curated per-batch lbs beats none, then more components, then oldest.
//   3. The boot data heal (cheese-component-oz-strip-v2) strips ozPerPizza from
//      cheese recipe components and recomputes sharePct from lbs so shares are
//      fully lbs-authoritative — no silent oz fallback.
//
// Same disposable-Postgres pattern as cycleCount.integration.test.ts: the
// throwaway DB is created and DATABASE_URL repointed BEFORE any dynamic import
// pulls in @workspace/db (see .agents/memory/integration-test-db-binding.md).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let cheeseRecipesTable: DbModule["cheeseRecipesTable"];
let dataHealsTable: DbModule["dataHealsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let runDataHeals: () => Promise<void>;
let clearUserValidityCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const MANAGER = "manager-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_cheesedup_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const userValidityMod = await import("../lib/userValidity");
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  db = dbMod.db;
  pool = dbMod.pool;
  cheeseRecipesTable = dbMod.cheeseRecipesTable;
  dataHealsTable = dbMod.dataHealsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  runDataHeals = (await import("../lib/dataHeals")).runDataHeals;

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
}, 120_000);

beforeEach(async () => {
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${cheeseRecipesTable}, ${dataHealsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  await db.insert(usersTable).values([{ id: MANAGER, username: "manager", passwordHash: "x" }]);
  await db.insert(userRolesTable).values([{ userId: MANAGER, role: "manager" }]);
});

type ApiRecipe = {
  id: string;
  name: string;
  brand: string;
  flavors: string[];
  shredderSetting: string;
  cellulose: string;
  notes: string;
  components: { ingredient: string; lbs: number; ozPerPizza: number }[];
  enabled: boolean;
};

function recipe(id: string, name: string, extra?: Partial<ApiRecipe>): ApiRecipe {
  return {
    id,
    name,
    brand: "",
    flavors: [],
    shredderSetting: "",
    cellulose: "",
    notes: "",
    components: [],
    enabled: true,
    ...extra,
  };
}

async function post(items: ApiRecipe[]): Promise<ApiRecipe[]> {
  const res = await fetch(`${baseUrl}/api/cheese-recipes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${signToken(MANAGER)}`,
    },
    body: JSON.stringify({ items }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: ApiRecipe[] }).items;
}

describe("POST /cheese-recipes duplicate-name guard", () => {
  it("skips a NEW id whose name already exists (trim/case-insensitive)", async () => {
    await post([recipe("a", "Whole Mozzarella Cheese Mix")]);
    const items = await post([recipe("b", "  whole mozzarella cheese mix ")]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("a");
  });

  it("within one batch, only the first NEW id for a name is inserted", async () => {
    const items = await post([
      recipe("a", "Monterey Jack Cheese Mix"),
      recipe("b", "Monterey Jack Cheese Mix"),
      recipe("c", "monterey jack cheese mix"),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("a");
  });

  it("still updates an EXISTING id freely, including renames", async () => {
    await post([recipe("a", "Skim Mozzarella")]);
    const items = await post([
      recipe("a", "Skim Mozzarella Blend", {
        components: [{ ingredient: "Skim Mozz", lbs: 20, ozPerPizza: 0 }],
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Skim Mozzarella Blend");
    expect(items[0].components).toHaveLength(1);
  });

  it("two CONCURRENT posts of the same name with different ids yield ONE row", async () => {
    const [a, b] = await Promise.all([
      post([recipe("race-a", "Raced Cheese Blend")]),
      post([recipe("race-b", "raced cheese blend")]),
    ]);
    expect(a.filter((r) => r.name.trim().toLowerCase() === "raced cheese blend")).toHaveLength(1);
    expect(b.filter((r) => r.name.trim().toLowerCase() === "raced cheese blend")).toHaveLength(1);
    const rows = await db.select().from(cheeseRecipesTable);
    expect(rows).toHaveLength(1);
  });

  it("allows genuinely new names alongside a skipped duplicate", async () => {
    await post([recipe("a", "Five Cheese Spice Blend")]);
    const items = await post([
      recipe("b", "Five Cheese Spice Blend"),
      recipe("c", "Parmesan Blend"),
    ]);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(["Five Cheese Spice Blend", "Parmesan Blend"]);
  });
});

describe("cheese-recipe-name-dedupe-v1 data heal", () => {
  async function seedRow(id: string, name: string, components: object[], createdAt: Date) {
    await db.insert(cheeseRecipesTable).values({
      id,
      scope: "live",
      name,
      brand: "",
      flavors: [],
      shredderSetting: "",
      cellulose: "",
      notes: "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: components as any,
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    });
  }

  it("removes exact-name duplicates, keeping the row with curated lbs", async () => {
    const t = new Date("2026-07-12T16:49:43Z");
    await seedRow("keep", "Mozzarella Cheese Mix", [{ ingredient: "Mozz", lbs: 10, ozPerPizza: 0 }], t);
    await seedRow("drop1", "mozzarella cheese mix ", [], t);
    await seedRow("drop2", "Mozzarella Cheese Mix", [{ ingredient: "Mozz", lbs: 0, ozPerPizza: 2 }], new Date("2026-07-10T00:00:00Z"));
    await seedRow("other", "Monterey Jack Cheese Mix", [], t);

    await runDataHeals();

    const rows = await db.select().from(cheeseRecipesTable);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["keep", "other"]);
  });

  it("scopes deletes: a loser id shared with another scope only dies in its own scope", async () => {
    const t = new Date("2026-07-12T16:49:43Z");
    // Same id "shared" exists in both scopes; it's a duplicate loser in live
    // but the only row of its name in sandbox — sandbox's copy must survive.
    await seedRow("keep", "Whole Mozzarella Cheese Mix", [{ ingredient: "Mozz", lbs: 5, ozPerPizza: 0 }], t);
    await seedRow("shared", "Whole Mozzarella Cheese Mix", [], t);
    await db.insert(cheeseRecipesTable).values({
      id: "shared",
      scope: "sandbox",
      name: "Whole Mozzarella Cheese Mix",
      brand: "",
      flavors: [],
      shredderSetting: "",
      cellulose: "",
      notes: "",
      components: [],
      enabled: true,
      createdAt: t,
      updatedAt: t,
    });

    await runDataHeals();

    const rows = await db.select().from(cheeseRecipesTable);
    const keys = rows.map((r) => `${r.scope}:${r.id}`).sort();
    expect(keys).toEqual(["live:keep", "sandbox:shared"]);
  });

  it("is marker-guarded: a second run is a no-op even after new dupes appear", async () => {
    await runDataHeals();
    const t = new Date();
    await seedRow("x1", "Dup After Heal", [], t);
    await seedRow("x2", "Dup After Heal", [], t);
    await runDataHeals();
    const rows = await db.select().from(cheeseRecipesTable);
    expect(rows).toHaveLength(2);
  });
});

// ── cheese-component-oz-strip-v2 data heal ────────────────────────────────────
// Verifies that after runDataHeals():
//   1. Both the v1 no-op guard and v2 marker rows exist in data_heals.
//   2. The v2 result carries plausible scanned/updatedRows/strippedComponents.
//   3. ozPerPizza is stripped from every component (by property presence).
//   4. sharePct is recomputed from lbs so shares are lbs-authoritative — the
//      "v1 already ran but left stale oz-derived sharePct" scenario is fixed.
//   5. A recipe that was already clean (correct lbs-derived sharePct, no oz)
//      is not touched (updatedRows does not include it).
//   6. cheeseComponentShares() on the post-heal rows returns lbs-based fractions.
//   7. The heal is marker-guarded (a second runDataHeals() is a no-op).
describe("cheese-component-oz-strip-v2 data heal", () => {
  // Shared component helper — typed so TS catches field typos but flexible
  // enough to inject ozPerPizza for the "pre-heal" seeding.
  type RawComp = { ingredient: string; lbs: number; ozPerPizza?: number; sharePct?: number };

  async function seedCheeseRow(id: string, name: string, components: RawComp[]) {
    const t = new Date("2026-01-01T00:00:00Z");
    await db.insert(cheeseRecipesTable).values({
      id,
      scope: "live",
      name,
      brand: "TestBrand",
      flavors: [],
      shredderSetting: "",
      cellulose: "",
      notes: "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: components as any,
      enabled: true,
      createdAt: t,
      updatedAt: t,
    });
  }

  async function loadComponents(id: string): Promise<RawComp[]> {
    const rows = await db.select().from(cheeseRecipesTable);
    const row = rows.find((r) => r.id === id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (row?.components ?? []) as any;
  }

  async function loadHealRow(healId: string) {
    const rows = await db.select().from(dataHealsTable);
    return rows.find((r) => r.id === healId) ?? null;
  }

  it("claims both the v1 no-op marker and the v2 marker after running heals", async () => {
    await runDataHeals();
    const v1 = await loadHealRow("cheese-component-oz-strip-v1");
    const v2 = await loadHealRow("cheese-component-oz-strip-v2");
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
  });

  it("strips ozPerPizza and recomputes sharePct from lbs (fresh-DB / oz-still-present scenario)", async () => {
    // Recipe A: both components carry ozPerPizza AND oz-derived (wrong) sharePct.
    // lbs proportions: 20/(20+8) ≈ 71.43%, 8/(20+8) ≈ 28.57%.
    // oz proportions:  4/(4+1.5) ≈ 72.73%, 1.5/(4+1.5) ≈ 27.27% — different enough to detect.
    await seedCheeseRow("oz-strip-a", "Whole Mozz Cheese Mix", [
      { ingredient: "Mozzarella", lbs: 20, ozPerPizza: 4,   sharePct: 72.73 },
      { ingredient: "Provolone",  lbs: 8,  ozPerPizza: 1.5, sharePct: 27.27 },
    ]);

    await runDataHeals();

    const comps = await loadComponents("oz-strip-a");

    // ozPerPizza must be gone from both components.
    expect(comps.every((c) => !("ozPerPizza" in c))).toBe(true);

    // sharePct must now reflect lbs proportions, not oz proportions.
    // 20/28 ≈ 71.43, 8/28 ≈ 28.57
    expect(comps[0].sharePct).toBeCloseTo(71.43, 1);
    expect(comps[1].sharePct).toBeCloseTo(28.57, 1);
  });

  it("fixes stale oz-derived sharePct even when ozPerPizza was already removed (v1 scenario)", async () => {
    // Recipe B: v1 heal already stripped ozPerPizza but left behind oz-derived
    // sharePct (20% / 80%) that does NOT match lbs proportions (80% / 20%).
    // cheeseComponentShares() would have returned the wrong oz-derived shares.
    await seedCheeseRow("oz-strip-b", "Skim Mozzarella Blend", [
      { ingredient: "Mozzarella", lbs: 20, sharePct: 20 }, // stale oz-derived, wrong
      { ingredient: "Provolone",  lbs: 5,  sharePct: 80 }, // stale oz-derived, wrong
    ]);

    await runDataHeals();

    const comps = await loadComponents("oz-strip-b");

    // No ozPerPizza was ever stored here, so none to check.
    expect(comps.every((c) => !("ozPerPizza" in c))).toBe(true);

    // sharePct must now match lbs: 20/(20+5) = 80, 5/(20+5) = 20.
    expect(comps[0].sharePct).toBeCloseTo(80, 1);
    expect(comps[1].sharePct).toBeCloseTo(20, 1);
  });

  it("does not touch a recipe that is already clean (correct lbs-derived sharePct, no oz)", async () => {
    // Recipe C: already lbs-correct — 15/(15+5)=75%, 5/(15+5)=25%.
    const cleanComps: RawComp[] = [
      { ingredient: "Mozzarella", lbs: 15, sharePct: 75 },
      { ingredient: "Parmesan",   lbs: 5,  sharePct: 25 },
    ];
    await seedCheeseRow("oz-strip-c", "Already Clean Blend", cleanComps);

    await runDataHeals();

    const comps = await loadComponents("oz-strip-c");
    expect(comps[0].sharePct).toBeCloseTo(75, 1);
    expect(comps[1].sharePct).toBeCloseTo(25, 1);
  });

  it("heal result carries plausible scanned / updatedRows / strippedComponents counts", async () => {
    // Three recipes: A (ozPerPizza + wrong sharePct), B (stale sharePct, no oz),
    // C (already clean).  Expected: scanned=3, updatedRows=2, strippedComponents=2.
    await seedCheeseRow("count-a", "Count Mix A", [
      { ingredient: "Mozz",     lbs: 20, ozPerPizza: 4,   sharePct: 72 },
      { ingredient: "Provolone",lbs: 8,  ozPerPizza: 1.5, sharePct: 28 },
    ]);
    await seedCheeseRow("count-b", "Count Mix B", [
      { ingredient: "Mozz",     lbs: 20, sharePct: 20 },
      { ingredient: "Provolone",lbs: 5,  sharePct: 80 },
    ]);
    await seedCheeseRow("count-c", "Count Mix C", [
      { ingredient: "Mozz",     lbs: 15, sharePct: 75 },
      { ingredient: "Parmesan", lbs: 5,  sharePct: 25 },
    ]);

    await runDataHeals();

    const healRow = await loadHealRow("cheese-component-oz-strip-v2");
    expect(healRow).not.toBeNull();
    const result = healRow!.result as { scanned: number; updatedRows: number; strippedComponents: number } | null;
    expect(result).not.toBeNull();
    // All three rows are scanned.
    expect(result!.scanned).toBeGreaterThanOrEqual(3);
    // A (oz present) and B (stale sharePct) are both written; C is left alone.
    expect(result!.updatedRows).toBeGreaterThanOrEqual(2);
    // A has 2 components with ozPerPizza; B has none.
    expect(result!.strippedComponents).toBeGreaterThanOrEqual(2);
  });

  it("cheeseComponentShares returns lbs-based fractions after the heal (no oz influence)", async () => {
    // Seed a recipe where oz proportions would give ≈73% / 27% but lbs give 80% / 20%.
    // After the heal, shares must track lbs.
    await seedCheeseRow("shares-check", "Share Verification Blend", [
      { ingredient: "Mozz",     lbs: 20, ozPerPizza: 4,   sharePct: 72.73 },
      { ingredient: "Provolone",lbs: 5,  ozPerPizza: 1.5, sharePct: 27.27 },
    ]);

    await runDataHeals();

    const comps = await loadComponents("shares-check");

    // cheeseComponentShares prefers sharePct (priority 1) over lbs.
    // After the heal sharePct must equal lbs proportions: 20/25=80%, 5/25=20%.
    const totalLbs = comps.reduce((s, c) => s + (c.lbs ?? 0), 0);
    const expectedShares = comps.map((c) => (totalLbs > 0 ? (c.lbs ?? 0) / totalLbs : 0));

    // sharePct (used by cheeseComponentShares) must match lbs-derived shares to 1dp.
    comps.forEach((c, i) => {
      expect((c.sharePct ?? 0) / 100).toBeCloseTo(expectedShares[i], 2);
    });

    // Spot-check absolute values: Mozz 80%, Provolone 20%.
    expect(comps[0].sharePct).toBeCloseTo(80, 1);
    expect(comps[1].sharePct).toBeCloseTo(20, 1);
  });

  it("cleans sandbox-scope rows too (heal has no scope filter)", async () => {
    // Seed a sandbox row with ozPerPizza and oz-derived (wrong) sharePct.
    // lbs proportions: 12/(12+3) = 80%, 3/(12+3) = 20%.
    // oz proportions:  4/(4+0.5) ≈ 88.9%, 0.5/(4+0.5) ≈ 11.1% — clearly different.
    const sbxTime = new Date("2026-01-01T00:00:00Z");
    await db.insert(cheeseRecipesTable).values({
      id: "oz-strip-sandbox",
      scope: "sandbox",
      name: "Sandbox Mozzarella Blend",
      brand: "TestBrand",
      flavors: [],
      shredderSetting: "",
      cellulose: "",
      notes: "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: [
        { ingredient: "Mozzarella", lbs: 12, ozPerPizza: 4,   sharePct: 88.89 },
        { ingredient: "Provolone",  lbs: 3,  ozPerPizza: 0.5, sharePct: 11.11 },
      ] as any,
      enabled: true,
      createdAt: sbxTime,
      updatedAt: sbxTime,
    });

    // Seed a live row that is already clean so we can confirm it is untouched.
    await seedCheeseRow("oz-strip-live-clean", "Live Clean Blend", [
      { ingredient: "Mozzarella", lbs: 9, sharePct: 75 },
      { ingredient: "Parmesan",   lbs: 3, sharePct: 25 },
    ]);

    await runDataHeals();

    // ── Sandbox row must be cleaned ──────────────────────────────────────────
    const sbxComps = await loadComponents("oz-strip-sandbox");

    // ozPerPizza must be stripped from both components.
    expect(sbxComps.every((c) => !("ozPerPizza" in c))).toBe(true);

    // sharePct must now reflect lbs proportions (80% / 20%), not oz (88.9% / 11.1%).
    expect(sbxComps[0].sharePct).toBeCloseTo(80, 1);
    expect(sbxComps[1].sharePct).toBeCloseTo(20, 1);

    // ── Live clean row must be unaffected ────────────────────────────────────
    const liveComps = await loadComponents("oz-strip-live-clean");
    expect(liveComps[0].sharePct).toBeCloseTo(75, 1);
    expect(liveComps[1].sharePct).toBeCloseTo(25, 1);
  });

  it("is marker-guarded: a second runDataHeals() does not re-process recipes", async () => {
    await seedCheeseRow("guard-a", "Guard Test Blend", [
      { ingredient: "Mozz", lbs: 20, ozPerPizza: 4, sharePct: 72 },
      { ingredient: "Prov", lbs: 8,  ozPerPizza: 1.5, sharePct: 28 },
    ]);

    // First run: heal fires.
    await runDataHeals();
    const afterFirst = await loadComponents("guard-a");
    expect(afterFirst.every((c) => !("ozPerPizza" in c))).toBe(true);

    // Manually re-introduce stale oz data to prove the second run does NOT pick it up.
    await db.execute(
      sql`UPDATE cheese_recipes SET components = ${JSON.stringify([
        { ingredient: "Mozz", lbs: 20, ozPerPizza: 99, sharePct: 99 },
        { ingredient: "Prov", lbs: 8,  ozPerPizza: 99, sharePct: 1  },
      ])}::jsonb WHERE id = 'guard-a'`,
    );

    // Second run: marker already claimed → heal is a no-op.
    await runDataHeals();
    const afterSecond = await loadComponents("guard-a");

    // The manually-injected poison was NOT cleaned (marker guarded it).
    expect(afterSecond[0].ozPerPizza).toBe(99);
  });
});
