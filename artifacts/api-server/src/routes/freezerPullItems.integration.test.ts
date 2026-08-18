// Integration tests for POST/GET /api/freezer-pull-items confirming that every
// field (ingredient, daysEarly, enabled) survives the full DB round-trip through
// POST → DB → GET, and that the upsert path correctly overwrites changed values.
//
// Pattern mirrors mixes.integration.test.ts: disposable Postgres DB created
// before any dynamic import that pulls in @workspace/db (pool binds to
// DATABASE_URL at import time — see .agents/memory/integration-test-db-binding.md).
// Full index router mounted so requireAuth + requireCapability("manage-inventory")
// are live.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import type { FreezerPullItem } from "@workspace/freezer-pull";
import { signToken } from "../lib/auth";

// ── DB handles (bound after repointing DATABASE_URL) ────────────────────────
type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let freezerPullItemsTable: DbModule["freezerPullItemsTable"];
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

const MANAGER = "mgr-fpi-test-1";
const OPERATOR = "op-fpi-test-1";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

// ── Setup/teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_fpi_int_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const routerMod = await import("./index");
  const userValidityMod = await import("../lib/userValidity");

  db = dbMod.db;
  pool = dbMod.pool;
  freezerPullItemsTable = dbMod.freezerPullItemsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  clearUserValidityCache = userValidityMod.clearUserValidityCache;

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
}, 90_000);

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
}, 90_000);

beforeEach(async () => {
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${freezerPullItemsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: "mgr", passwordHash: "x" },
    { id: OPERATOR, username: "op", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
  ]);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function managerHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${signToken(MANAGER)}`,
  };
}

async function postItems(
  items: Partial<FreezerPullItem>[],
): Promise<{ status: number; items: FreezerPullItem[] }> {
  const res = await fetch(`${baseUrl}/api/freezer-pull-items`, {
    method: "POST",
    headers: managerHeaders(),
    body: JSON.stringify({ items }),
  });
  const body = (await res.json()) as { items: FreezerPullItem[] };
  return { status: res.status, items: body.items ?? [] };
}

async function getItems(): Promise<{ status: number; items: FreezerPullItem[] }> {
  const res = await fetch(`${baseUrl}/api/freezer-pull-items`, {
    headers: { Authorization: `Bearer ${signToken(MANAGER)}` },
  });
  const body = (await res.json()) as { items: FreezerPullItem[] };
  return { status: res.status, items: body.items ?? [] };
}

function makeItem(overrides: Partial<FreezerPullItem> = {}): FreezerPullItem {
  return {
    id: "fpi-cheese-blocks",
    ingredient: "Mozzarella Blocks",
    daysEarly: 2,
    enabled: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/freezer-pull-items — field round-trip", () => {
  it("saves all fields and returns them correctly on the POST response", async () => {
    const { status, items } = await postItems([
      makeItem({ daysEarly: 2, enabled: true }),
    ]);
    expect(status).toBe(200);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.ingredient).toBe("Mozzarella Blocks");
    expect(item.daysEarly).toBe(2);
    expect(item.enabled).toBe(true);
  });

  it("persists all fields so a subsequent GET returns them unchanged (not silently dropped)", async () => {
    await postItems([makeItem({ daysEarly: 2, enabled: true })]);

    const { status, items } = await getItems();
    expect(status).toBe(200);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.ingredient).toBe("Mozzarella Blocks");
    expect(item.daysEarly).toBe(2);
    expect(item.enabled).toBe(true);
  });

  it("saves enabled=false and returns it correctly — not reset to the default true", async () => {
    const { status, items } = await postItems([makeItem({ enabled: false })]);
    expect(status).toBe(200);
    expect(items[0].enabled).toBe(false);

    // Confirm persisted via GET
    const get = await getItems();
    expect(get.items[0].enabled).toBe(false);
  });

  it("saves a non-default daysEarly value (5) and returns it unchanged", async () => {
    await postItems([makeItem({ daysEarly: 5 })]);

    const { items } = await getItems();
    expect(items[0].daysEarly).toBe(5);
  });

  it("rejects POST without manager auth (401)", async () => {
    const res = await fetch(`${baseUrl}/api/freezer-pull-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [makeItem()] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/freezer-pull-items — upsert path", () => {
  it("upsert (re-POST same id) with changed daysEarly overwrites the stored value", async () => {
    // Initial save
    await postItems([makeItem({ daysEarly: 2 })]);

    // Manager changes how many days early and saves again
    const { items } = await postItems([makeItem({ daysEarly: 4 })]);
    expect(items[0].daysEarly).toBe(4);

    // GET confirms the update persisted
    const get = await getItems();
    expect(get.items[0].daysEarly).toBe(4);
  });

  it("upsert toggles enabled from true to false and persists the change", async () => {
    await postItems([makeItem({ enabled: true })]);

    // Manager disables the pull item
    const { items } = await postItems([makeItem({ enabled: false })]);
    expect(items[0].enabled).toBe(false);

    const get = await getItems();
    expect(get.items[0].enabled).toBe(false);
  });

  it("upsert with a changed ingredient name overwrites the stored ingredient", async () => {
    await postItems([makeItem({ ingredient: "Mozzarella Blocks" })]);

    const { items } = await postItems([makeItem({ ingredient: "Provolone Blocks" })]);
    expect(items[0].ingredient).toBe("Provolone Blocks");

    const get = await getItems();
    expect(get.items[0].ingredient).toBe("Provolone Blocks");
  });

  it("two items with different ids produce two independent DB rows (no cross-clobber)", async () => {
    await postItems([
      makeItem({ id: "fpi-cheese", ingredient: "Cheese Blocks", daysEarly: 2 }),
      makeItem({ id: "fpi-sauce", ingredient: "Sauce Drums", daysEarly: 1 }),
    ]);

    const { items } = await getItems();
    expect(items).toHaveLength(2);
    const cheese = items.find((i) => i.id === "fpi-cheese");
    const sauce = items.find((i) => i.id === "fpi-sauce");
    expect(cheese?.ingredient).toBe("Cheese Blocks");
    expect(cheese?.daysEarly).toBe(2);
    expect(sauce?.ingredient).toBe("Sauce Drums");
    expect(sauce?.daysEarly).toBe(1);
  });
});

describe("POST /api/freezer-pull-items — DELETE round-trip", () => {
  it("DELETE removes the item and GET returns an empty list", async () => {
    await postItems([makeItem()]);

    const del = await fetch(`${baseUrl}/api/freezer-pull-items`, {
      method: "DELETE",
      headers: managerHeaders(),
      body: JSON.stringify({ ids: ["fpi-cheese-blocks"] }),
    });
    expect(del.status).toBe(200);

    const { items } = await getItems();
    expect(items).toHaveLength(0);
  });

  it("DELETE only removes the targeted id, leaving other items intact", async () => {
    await postItems([
      makeItem({ id: "fpi-a", ingredient: "Cheese Blocks" }),
      makeItem({ id: "fpi-b", ingredient: "Sauce Drums" }),
    ]);

    await fetch(`${baseUrl}/api/freezer-pull-items`, {
      method: "DELETE",
      headers: managerHeaders(),
      body: JSON.stringify({ ids: ["fpi-a"] }),
    });

    const { items } = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("fpi-b");
  });
});

describe("DELETE /api/freezer-pull-items — auth gate", () => {
  it("rejects DELETE without any auth token (401)", async () => {
    // Seed an item so the delete has a target
    await postItems([makeItem()]);

    const res = await fetch(`${baseUrl}/api/freezer-pull-items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["fpi-cheese-blocks"] }),
    });
    expect(res.status).toBe(401);

    // Item must still be present — the delete was rejected
    const { items } = await getItems();
    expect(items).toHaveLength(1);
  });

  it("rejects DELETE from a plain operator (403)", async () => {
    // Seed an item so the delete has a target
    await postItems([makeItem()]);

    const res = await fetch(`${baseUrl}/api/freezer-pull-items`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(OPERATOR)}`,
      },
      body: JSON.stringify({ ids: ["fpi-cheese-blocks"] }),
    });
    expect(res.status).toBe(403);

    // Item must still be present — the delete was rejected
    const { items } = await getItems();
    expect(items).toHaveLength(1);
  });
});
