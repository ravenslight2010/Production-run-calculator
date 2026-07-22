// Integration tests for the cheese-recipes duplicate-name protections:
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
}, 60_000);

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
