// Integration tests for the DB-backed auto-deduct wiring in ./inventory.ts.
//
// Unlike inventoryLogic.test.ts (pure, DB-free), these exercise the real SQL:
// the FOR UPDATE row-locking read in `drawDown`, the race-safe
// `onConflictDoNothing` run-claim insert, and the full `consumeRun` transaction
// boundaries. To do that safely they spin up a *disposable* Postgres database
// (created from the dev DATABASE_URL's server, schema pushed via drizzle-kit,
// dropped on teardown) so nothing here ever touches real data.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so we
// must create the throwaway DB and point DATABASE_URL at it BEFORE importing the
// module-under-test — hence the dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import pg from "pg";

// Filled in by beforeAll once the throwaway DB exists and the module is loaded.
type DbModule = typeof import("@workspace/db");
type InvModule = typeof import("./inventory");
let db: DbModule["db"];
let pool: DbModule["pool"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryConsumedRunsTable: DbModule["inventoryConsumedRunsTable"];
let consumeRun: InvModule["consumeRun"];
let drawDown: InvModule["drawDown"];

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  // Create a uniquely named throwaway database on the same Postgres server.
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  testDbName = `helium_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();

  // Build the real schema in the throwaway DB via drizzle-kit (no hand-written
  // DDL to drift out of sync with lib/db/src/schema).
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  // Point the app's db at the throwaway DB, THEN load the modules so the
  // singleton pool binds to it.
  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const invMod = await import("./inventory");
  db = dbMod.db;
  pool = dbMod.pool;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryConsumedRunsTable = dbMod.inventoryConsumedRunsTable;
  consumeRun = invMod.consumeRun;
  drawDown = invMod.drawDown;
}, 60_000);

afterAll(async () => {
  // Close the app pool so the database has no open connections, then drop it.
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
});

beforeEach(async () => {
  // Each test starts from an empty inventory.
  await db.execute(
    sql`TRUNCATE ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryConsumedRunsTable}, ${inventoryItemsTable} RESTART IDENTITY CASCADE`,
  );
});

// Insert a tracked item; returns its id.
async function makeItem(key: string): Promise<number> {
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({ key, category: "ingredient", name: key, unit: "lbs" })
    .returning();
  return item.id;
}

// Add a lot to an item (mirrors what a restock produces).
async function addLot(
  itemId: number,
  qty: number,
  opts: { expirationDate?: string | null; receivedDate?: string | null } = {},
): Promise<void> {
  await db.insert(inventoryLotsTable).values({
    itemId,
    qtyReceived: qty,
    qtyRemaining: qty,
    receivedDate: opts.receivedDate ?? null,
    expirationDate: opts.expirationDate ?? null,
  });
}

// Current on-hand = sum of remaining across an item's lots.
async function onHand(itemId: number): Promise<number> {
  const lots = await db.select().from(inventoryLotsTable);
  return lots
    .filter((l) => l.itemId === itemId)
    .reduce((acc, l) => acc + l.qtyRemaining, 0);
}

async function consumeLedgerCount(itemId: number): Promise<number> {
  const rows = await db.select().from(inventoryLedgerTable);
  return rows.filter((r) => r.itemId === itemId && r.type === "consume").length;
}

describe("inventory auto-deduct against a real database", () => {
  it("restocks an item, finalizes a run, and drops stock exactly once", async () => {
    const itemId = await makeItem("ingredient:Mozzarella:lbs");
    // Two lots; FEFO should empty the earlier-expiring one first.
    await addLot(itemId, 5, { expirationDate: "2026-03-01" });
    await addLot(itemId, 5, { expirationDate: "2026-01-01" });
    expect(await onHand(itemId)).toBe(10);

    const result = await consumeRun("run-real-1", [
      { itemKey: "ingredient:Mozzarella:lbs", qty: 7 },
    ]);
    expect(result).toEqual({ applied: true, consumed: 1 });
    expect(await onHand(itemId)).toBe(3);
    expect(await consumeLedgerCount(itemId)).toBe(1);

    // The earlier-expiring lot (id 2, exp 2026-01-01) should be emptied first.
    const lots = await db.select().from(inventoryLotsTable);
    const byId = new Map(lots.map((l) => [l.id, l.qtyRemaining]));
    expect(byId.get(2)).toBe(0); // earlier expiration emptied
    expect(byId.get(1)).toBe(3); // remainder taken from the later lot
  });

  it("finalizing the same run twice deducts only once (claim marker blocks the retry)", async () => {
    const itemId = await makeItem("ingredient:Sauce:lbs");
    await addLot(itemId, 10);

    const first = await consumeRun("run-dupe-real", [
      { itemKey: "ingredient:Sauce:lbs", qty: 4 },
    ]);
    expect(first).toEqual({ applied: true, consumed: 1 });
    expect(await onHand(itemId)).toBe(6);

    const second = await consumeRun("run-dupe-real", [
      { itemKey: "ingredient:Sauce:lbs", qty: 4 },
    ]);
    expect(second).toEqual({ applied: false, consumed: 0 });
    // Stock and ledger are untouched by the no-op retry.
    expect(await onHand(itemId)).toBe(6);
    expect(await consumeLedgerCount(itemId)).toBe(1);

    // Exactly one claim row exists for the run.
    const claims = await db.select().from(inventoryConsumedRunsTable);
    expect(claims.filter((c) => c.runId === "run-dupe-real")).toHaveLength(1);
  });

  it("claims the marker even for a zero-consume run, blocking a later re-consume", async () => {
    // No matching item exists yet, so nothing is drawn down, but the run is
    // still claimed.
    const empty = await consumeRun("run-zero-real", [
      { itemKey: "ingredient:Pepperoni:lbs", qty: 5 },
    ]);
    expect(empty).toEqual({ applied: true, consumed: 0 });

    // Now the item is restocked. Re-finalizing the SAME run must not deduct.
    const itemId = await makeItem("ingredient:Pepperoni:lbs");
    await addLot(itemId, 10);
    const retry = await consumeRun("run-zero-real", [
      { itemKey: "ingredient:Pepperoni:lbs", qty: 5 },
    ]);
    expect(retry).toEqual({ applied: false, consumed: 0 });
    expect(await onHand(itemId)).toBe(10);
  });

  it("never draws stock below zero when more is requested than available", async () => {
    const itemId = await makeItem("ingredient:Cheese:lbs");
    await addLot(itemId, 3);
    const result = await consumeRun("run-overdraw", [
      { itemKey: "ingredient:Cheese:lbs", qty: 100 },
    ]);
    expect(result).toEqual({ applied: true, consumed: 1 });
    expect(await onHand(itemId)).toBe(0);
  });

  it("serializes concurrent consumes for the same item so stock never goes negative (FOR UPDATE)", async () => {
    const itemId = await makeItem("ingredient:Dough:lbs");
    await addLot(itemId, 10);

    // Two distinct runs each try to take 7 of the same 10 in parallel. Without
    // the FOR UPDATE lock both would read 10 and lose an update; with it they
    // serialize and the second only gets what's left.
    const [a, b] = await Promise.all([
      consumeRun("run-concurrent-a", [{ itemKey: "ingredient:Dough:lbs", qty: 7 }]),
      consumeRun("run-concurrent-b", [{ itemKey: "ingredient:Dough:lbs", qty: 7 }]),
    ]);

    expect(a.applied).toBe(true);
    expect(b.applied).toBe(true);
    // One run took 7, the other took the remaining 3 — total exactly 10.
    const totalConsumed = await db
      .select()
      .from(inventoryLedgerTable)
      .then((rows) =>
        rows
          .filter((r) => r.itemId === itemId && r.type === "consume")
          .reduce((acc, r) => acc - r.qtyDelta, 0),
      );
    expect(totalConsumed).toBe(10);
    expect(await onHand(itemId)).toBe(0);

    // No lot is ever left negative.
    const lots = await db.select().from(inventoryLotsTable);
    expect(lots.every((l) => l.qtyRemaining >= 0)).toBe(true);
  });

  it("drawDown inside a transaction locks and never oversells under parallel calls", async () => {
    const itemId = await makeItem("packaging:Boxes:cases");
    await addLot(itemId, 8);

    // Fire many parallel drawDowns of 3 each (would total 18 > 8). The lock must
    // cap total consumed at the 8 available.
    const draws = await Promise.all(
      Array.from({ length: 6 }, () => db.transaction((tx) => drawDown(tx, itemId, 3))),
    );
    const totalDrawn = draws.reduce((acc, n) => acc + n, 0);
    expect(totalDrawn).toBe(8);
    expect(await onHand(itemId)).toBe(0);
  });
});
