// Integration tests for the factory-wide brand+flavor setup-profile pool,
// asserting the behavior that motivated moving profiles out of the per-day
// sync payload: the server-side per-profile last-write-wins stamp guard.
//
//   1. Any signed-in user (plain operator) can save and read profiles — floor
//      staff have always saved profiles implicitly from the run form.
//   2. An upsert carrying an OLDER stamp than the stored row is ignored (the
//      stale-device republish that used to clobber fresh edits via the
//      unstamped sync map).
//   3. An EQUAL stamp is also ignored (idempotent migration pushes), and a
//      strictly NEWER stamp overwrites.
//   4. Deletes remove rows by key; malformed items are dropped silently.
//
// As with cycleCount.integration.test.ts, this stands up the *real* router
// against a *disposable* Postgres database (created from the dev DATABASE_URL's
// server, schema pushed via drizzle-kit, dropped on teardown). @workspace/db
// binds its pool to process.env.DATABASE_URL at import time, so the throwaway
// DB is created and DATABASE_URL repointed BEFORE importing anything that pulls
// in @workspace/db (see .agents/memory/integration-test-db-binding.md).
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
let brandProfilesTable: DbModule["brandProfilesTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_brandprofiles_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  brandProfilesTable = dbMod.brandProfilesTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;

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
    sql`TRUNCATE ${brandProfilesTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: OPERATOR, username: "operator", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
  ]);
});

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

type ApiProfile = {
  key: string;
  brand: string;
  flavor: string;
  values: Record<string, unknown>;
  crustValues: Record<string, unknown>;
  updatedAt: number;
};

function profile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    key: "basha's__pepperoni",
    brand: "basha's",
    flavor: "pepperoni",
    values: { dieType: "12in", app1Type: "Pepperoni" },
    crustValues: { crustsPerCycle: 5 },
    updatedAt: 1000,
    ...overrides,
  };
}

async function listAs(userId: string): Promise<ApiProfile[]> {
  const res = await req(userId, "GET", "/api/brand-profiles");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: ApiProfile[] };
  return body.items;
}

describe("brand-profiles auth boundary", () => {
  it("rejects unauthenticated access", async () => {
    const resGet = await req(null, "GET", "/api/brand-profiles");
    expect(resGet.status).toBe(401);
    const resPost = await req(null, "POST", "/api/brand-profiles", { items: [profile()] });
    expect(resPost.status).toBe(401);
  });

  it("rejects profile writes from a plain operator with 403 (manage-profiles gate)", async () => {
    const save = await req(OPERATOR, "POST", "/api/brand-profiles", { items: [profile()] });
    expect(save.status).toBe(403);
    const del = await req(OPERATOR, "DELETE", "/api/brand-profiles", { keys: ["basha's__pepperoni"] });
    expect(del.status).toBe(403);
    // Reads stay open to any signed-in user.
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(0);
  });

  it("lets a manager save and any signed-in user read the shared pool", async () => {
    const save = await req(MANAGER, "POST", "/api/brand-profiles", { items: [profile()] });
    expect(save.status).toBe(200);
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("basha's__pepperoni");
    expect(items[0].values.dieType).toBe("12in");
    expect(items[0].crustValues.crustsPerCycle).toBe(5);
    expect(items[0].updatedAt).toBe(1000);
  });
});

describe("brand-profiles per-profile last-write-wins stamp guard", () => {
  it("ignores an upsert carrying an OLDER stamp (stale republish)", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 2000, values: { dieType: "Argus" } })],
    });
    // A stale device pushes an older form with an older stamp — must be a no-op.
    const res = await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 1000, values: { dieType: "12in" } })],
    });
    expect(res.status).toBe(200);
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(1);
    expect(items[0].values.dieType).toBe("Argus");
    expect(items[0].updatedAt).toBe(2000);
    // The underlying row, not just the response shape.
    const [row] = await db
      .select()
      .from(brandProfilesTable)
      .where(sql`${brandProfilesTable.key} = ${"basha's__pepperoni"}`);
    expect((row.values as Record<string, unknown>).dieType).toBe("Argus");
    expect(row.updatedAtMs).toBe(2000);
  });

  it("ignores an EQUAL stamp (idempotent migration push) and accepts a strictly newer one", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 1000, values: { dieType: "first" } })],
    });
    // Equal stamp from a second migrating device: first write wins.
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 1000, values: { dieType: "second" } })],
    });
    let items = await listAs(OPERATOR);
    expect(items[0].values.dieType).toBe("first");
    // Strictly newer stamp overwrites.
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 1001, values: { dieType: "edited" } })],
    });
    items = await listAs(OPERATOR);
    expect(items[0].values.dieType).toBe("edited");
    expect(items[0].updatedAt).toBe(1001);
  });

  it("rejects a FORCED upsert from a plain operator (403) without touching the row", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 5000, values: { dieType: "current" } })],
    });
    const res = await req(OPERATOR, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 9000, values: { dieType: "hijacked" }, force: true } as never)],
    });
    expect(res.status).toBe(403);
    const items = await listAs(MANAGER);
    expect(items).toHaveLength(1);
    expect(items[0].values.dieType).toBe("current");
    expect(items[0].updatedAt).toBe(5000);
  });

  it("rejects a MIXED batch containing a forced item from an operator before any write", async () => {
    const res = await req(OPERATOR, "POST", "/api/brand-profiles", {
      items: [
        profile({ key: "craft__supreme", brand: "craft", flavor: "supreme", updatedAt: 100 }),
        profile({ updatedAt: 100, force: true } as never),
      ],
    });
    expect(res.status).toBe(403);
    const items = await listAs(MANAGER);
    expect(items).toHaveLength(0);
  });

  it("still accepts an ordinary non-forced save from a manager", async () => {
    const res = await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 100, values: { dieType: "staff-save" } })],
    });
    expect(res.status).toBe(200);
    const items = await listAs(MANAGER);
    expect(items[0].values.dieType).toBe("staff-save");
  });

  it("a FORCED upsert overwrites a stored row with a NEWER stamp and advances past it", async () => {
    // The wrong profile got saved with a newer stamp (the Hannaford Tikka
    // Masala incident): an explicit manager Apply must still win.
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 5000, values: { dieType: "wrong" } })],
    });
    const res = await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 1000, values: { dieType: "corrected" }, force: true } as never)],
    });
    expect(res.status).toBe(200);
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(1);
    expect(items[0].values.dieType).toBe("corrected");
    // Stored stamp advanced PAST the previous one so the forced write also
    // wins future LWW comparisons (no manual timestamp bump needed).
    expect(items[0].updatedAt).toBe(5001);
    const [row] = await db
      .select()
      .from(brandProfilesTable)
      .where(sql`${brandProfilesTable.key} = ${"basha's__pepperoni"}`);
    expect((row.values as Record<string, unknown>).dieType).toBe("corrected");
    expect(row.updatedAtMs).toBe(5001);
  });

  it("a FORCED upsert with a newer stamp keeps its own (already-winning) stamp", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 1000, values: { dieType: "old" } })],
    });
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 9000, values: { dieType: "applied" }, force: true } as never)],
    });
    const items = await listAs(OPERATOR);
    expect(items[0].values.dieType).toBe("applied");
    expect(items[0].updatedAt).toBe(9000);
  });

  it("a FORCED upsert inserts normally when no row exists", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 1234, values: { dieType: "fresh" }, force: true } as never)],
    });
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(1);
    expect(items[0].values.dieType).toBe("fresh");
    expect(items[0].updatedAt).toBe(1234);
  });

  it("force is sticky across same-key duplicates within one request", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 5000, values: { dieType: "wrong" } })],
    });
    // The forced (older-stamped) duplicate loses the in-request stamp dedupe,
    // but the batch's authoritative intent must survive onto the winner.
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [
        profile({ updatedAt: 900, values: { dieType: "forced-older" }, force: true } as never),
        profile({ updatedAt: 1000, values: { dieType: "newer" } }),
      ],
    });
    const items = await listAs(OPERATOR);
    expect(items[0].values.dieType).toBe("newer");
    expect(items[0].updatedAt).toBe(5001);
  });

  it("a non-forced upsert is still blocked by a newer stored stamp (guard intact)", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 5000, values: { dieType: "current" } })],
    });
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ updatedAt: 1000, values: { dieType: "stale" }, force: false } as never)],
    });
    const items = await listAs(OPERATOR);
    expect(items[0].values.dieType).toBe("current");
    expect(items[0].updatedAt).toBe(5000);
  });

  it("dedupes same-key items within one request keeping the newest stamp", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [
        profile({ updatedAt: 500, values: { dieType: "older" } }),
        profile({ updatedAt: 900, values: { dieType: "newer" } }),
      ],
    });
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(1);
    expect(items[0].values.dieType).toBe("newer");
  });
});

describe("brand-profiles applicator-audit route", () => {
  it("returns audit findings (not the raw profile pool) for any signed-in user", async () => {
    // Profile A owns "Mozz Blend" as its primary app1; profile B wrongly has
    // it at app3 — the cross-profile contamination signal.
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [
        profile({ values: { app1CheeseRecipeName: "Mozz Blend" } }),
        profile({
          key: "craft__supreme",
          brand: "craft",
          flavor: "supreme",
          values: { app3CheeseRecipeName: "Mozz Blend", app3Type: "cheese" },
        }),
      ],
    });
    const res = await req(OPERATOR, "GET", "/api/brand-profiles/applicator-audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      key: "craft__supreme",
      slot: "app3",
      recipeName: "Mozz Blend",
      reason: "cross-profile",
    });
  });

  it.each(["app3", "app4"] as const)(
    "manager can clear only the selected %s audit slot",
    async (slot) => {
      await req(MANAGER, "POST", "/api/brand-profiles", {
        items: [
          profile({
            key: "source__mozz",
            brand: "source",
            flavor: "mozz",
            values: { app1CheeseRecipeName: "Mozz Blend" },
          }),
          profile({
            key: "craft__supreme",
            brand: "craft",
            flavor: "supreme",
            values: {
              app1CheeseRecipeName: "Craft Blend",
              app3CheeseRecipeName: "Mozz Blend",
              app3Type: "cheese",
              app4CheeseRecipeName: "",
              app4Type: "Pepperoni",
              dieType: "12in",
            },
            crustValues: { crustsPerCycle: 7 },
          }),
        ],
      });

      const clear = await req(MANAGER, "PATCH", "/api/brand-profiles/craft__supreme/clear-slot", {
        slot,
      });
      expect(clear.status).toBe(200);
      const clearBody = (await clear.json()) as { items: Array<Record<string, unknown>> };
      expect(clearBody.items).toHaveLength(1);
      expect(clearBody.items[0]).toMatchObject({
        key: "craft__supreme",
        slot: slot === "app3" ? "app4" : "app3",
      });
      expect(clearBody.items.some((item) => item.slot === slot)).toBe(false);

      const saved = (await listAs(OPERATOR)).find((item) => item.key === "craft__supreme");
      expect(saved).toBeDefined();
      expect(saved).toMatchObject({
        key: "craft__supreme",
        values: {
          app1CheeseRecipeName: "Craft Blend",
          app3CheeseRecipeName: slot === "app3" ? "" : "Mozz Blend",
          app3Type: slot === "app3" ? "" : "cheese",
          app4CheeseRecipeName: "",
          app4Type: slot === "app4" ? "" : "Pepperoni",
          dieType: "12in",
        },
        crustValues: { crustsPerCycle: 7 },
      });
    },
  );

  it("rejects clearing an audit slot without manage-profiles", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [
        profile({
          key: "source__mozz",
          brand: "source",
          flavor: "mozz",
          values: { app1CheeseRecipeName: "Mozz Blend" },
        }),
        profile({
          key: "craft__supreme",
          brand: "craft",
          flavor: "supreme",
          values: {
            app3CheeseRecipeName: "Mozz Blend",
            app3Type: "cheese",
            app4CheeseRecipeName: "",
            app4Type: "Pepperoni",
          },
        }),
      ],
    });

    const clear = await req(OPERATOR, "PATCH", "/api/brand-profiles/craft__supreme/clear-slot", {
      slot: "app3",
    });
    expect(clear.status).toBe(403);

    const saved = (await listAs(OPERATOR)).find((item) => item.key === "craft__supreme");
    expect(saved).toBeDefined();
    expect(saved.values).toMatchObject({
      app3CheeseRecipeName: "Mozz Blend",
      app3Type: "cheese",
      app4CheeseRecipeName: "",
      app4Type: "Pepperoni",
    });
    const audit = await req(OPERATOR, "GET", "/api/brand-profiles/applicator-audit");
    expect(audit.status).toBe(200);
    const auditBody = (await audit.json()) as { items: Array<Record<string, unknown>> };
    expect(auditBody.items.map((item) => item.slot)).toEqual(["app3", "app4"]);
  });
});

describe("brand-profiles delete + input hygiene", () => {
  it("deletes rows by key", async () => {
    await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [
        profile(),
        profile({ key: "craft__supreme", brand: "craft", flavor: "supreme" }),
      ],
    });
    const del = await req(MANAGER, "DELETE", "/api/brand-profiles", {
      keys: ["basha's__pepperoni"],
    });
    expect(del.status).toBe(200);
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("craft__supreme");
  });

  it("silently drops keys without the brand__flavor separator (stray marker keys)", async () => {
    // The web spec-sheet cleanup marker ("run-calc-profile-cleanup-v1") shares
    // the profile localStorage prefix; a client sweep that picks it up must not
    // be able to create a junk pool row.
    const res = await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [
        { key: "cleanup-v1", brand: "cleanup-v1", flavor: "", values: {}, crustValues: {}, updatedAt: 1 },
      ],
    });
    expect(res.status).toBe(200);
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(0);
  });

  it("silently drops items whose key disagrees with brand+flavor", async () => {
    const res = await req(MANAGER, "POST", "/api/brand-profiles", {
      items: [profile({ key: "someone-else__cheese" })],
    });
    expect(res.status).toBe(200);
    const items = await listAs(OPERATOR);
    expect(items).toHaveLength(0);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await req(MANAGER, "POST", "/api/brand-profiles", { items: "nope" });
    expect(res.status).toBe(400);
  });
});
