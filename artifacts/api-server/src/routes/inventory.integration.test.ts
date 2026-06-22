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
let inventoryLocationsTable: DbModule["inventoryLocationsTable"];
let consumeRun: InvModule["consumeRun"];
let drawDown: InvModule["drawDown"];
let adjustInventory: InvModule["adjustInventory"];
let mergeInventoryItems: InvModule["mergeInventoryItems"];
let transferStock: InvModule["transferStock"];

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  // Create a uniquely named throwaway database on the same Postgres server.
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
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
  inventoryLocationsTable = dbMod.inventoryLocationsTable;
  consumeRun = invMod.consumeRun;
  drawDown = invMod.drawDown;
  adjustInventory = invMod.adjustInventory;
  mergeInventoryItems = invMod.mergeInventoryItems;
  transferStock = invMod.transferStock;
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
}, 30_000);

beforeEach(async () => {
  // Each test starts from an empty inventory.
  await db.execute(
    sql`TRUNCATE ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryConsumedRunsTable}, ${inventoryLocationsTable}, ${inventoryItemsTable} RESTART IDENTITY CASCADE`,
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

// All "adjust" ledger rows for an item, oldest first, so a test can assert the
// recorded delta is the actual applied amount (not the requested one).
async function adjustLedger(itemId: number): Promise<Array<{ qtyDelta: number }>> {
  const rows = await db.select().from(inventoryLedgerTable);
  return rows
    .filter((r) => r.itemId === itemId && r.type === "adjust")
    .sort((a, b) => a.id - b.id)
    .map((r) => ({ qtyDelta: r.qtyDelta }));
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

describe("inventory manual adjust against a real database", () => {
  it("caps a downward adjustment at available stock and records the capped delta", async () => {
    const itemId = await makeItem("ingredient:Flour:lbs");
    // Two lots; FEFO should empty the earlier-expiring one first.
    await addLot(itemId, 3, { expirationDate: "2026-03-01" });
    await addLot(itemId, 2, { expirationDate: "2026-01-01" });
    expect(await onHand(itemId)).toBe(5);

    // Request to remove more than is on hand (-100); only the 5 available can go.
    const result = await adjustInventory(itemId, -100, "spilled a bag");
    expect(result).toEqual({ appliedDelta: -5, lotId: null });
    // Stock never goes negative — it bottoms out at zero.
    expect(await onHand(itemId)).toBe(0);
    // The ledger records the ACTUAL applied delta (-5), not the requested -100.
    expect(await adjustLedger(itemId)).toEqual([{ qtyDelta: -5 }]);

    // No lot is left negative; both were emptied.
    const lots = await db.select().from(inventoryLotsTable);
    expect(lots.filter((l) => l.itemId === itemId).every((l) => l.qtyRemaining === 0)).toBe(
      true,
    );
  });

  it("records the exact delta when a downward adjustment fits within stock", async () => {
    const itemId = await makeItem("ingredient:Yeast:lbs");
    await addLot(itemId, 10);

    const result = await adjustInventory(itemId, -4);
    expect(result.appliedDelta).toBe(-4);
    expect(result.lotId).toBeNull();
    expect(await onHand(itemId)).toBe(6);
    expect(await adjustLedger(itemId)).toEqual([{ qtyDelta: -4 }]);
  });

  it("lands a positive adjustment as a new lot and a positive ledger row", async () => {
    const itemId = await makeItem("ingredient:Salt:lbs");
    expect(await onHand(itemId)).toBe(0);

    const result = await adjustInventory(itemId, 12, "found extra stock");
    expect(result.appliedDelta).toBe(12);
    expect(result.lotId).not.toBeNull();
    expect(await onHand(itemId)).toBe(12);

    // The new lot exists, points at the returned id, and carries the full qty.
    const lots = (await db.select().from(inventoryLotsTable)).filter(
      (l) => l.itemId === itemId,
    );
    expect(lots).toHaveLength(1);
    expect(lots[0].id).toBe(result.lotId);
    expect(lots[0].qtyReceived).toBe(12);
    expect(lots[0].qtyRemaining).toBe(12);
    // The ledger row references that lot and records the positive delta.
    const ledger = await db.select().from(inventoryLedgerTable);
    const adjustRows = ledger.filter((r) => r.itemId === itemId && r.type === "adjust");
    expect(adjustRows).toHaveLength(1);
    expect(adjustRows[0].qtyDelta).toBe(12);
    expect(adjustRows[0].lotId).toBe(result.lotId);
  });

  it("treats an exactly-zero adjustment as a no-op (no lot, no ledger row)", async () => {
    const itemId = await makeItem("ingredient:Sugar:lbs");
    await addLot(itemId, 7);

    const result = await adjustInventory(itemId, 0, "noticed nothing changed");
    expect(result).toEqual({ appliedDelta: 0, lotId: null });
    // Stock is untouched and only the seeded lot exists.
    expect(await onHand(itemId)).toBe(7);
    const lots = (await db.select().from(inventoryLotsTable)).filter(
      (l) => l.itemId === itemId,
    );
    expect(lots).toHaveLength(1);
    // No adjust ledger row was written.
    expect(await adjustLedger(itemId)).toEqual([]);
  });

  it("serializes concurrent downward adjustments so stock never goes negative (FOR UPDATE)", async () => {
    const itemId = await makeItem("ingredient:Tomato:lbs");
    await addLot(itemId, 10);

    // Two staff correct the same item down by 7 at the same time. Without the
    // FOR UPDATE lock in drawDown both would read 10 and each apply -7, drifting
    // stock to -4; with it they serialize and the second is capped at what's left.
    const [a, b] = await Promise.all([
      adjustInventory(itemId, -7, "staff A recount"),
      adjustInventory(itemId, -7, "staff B recount"),
    ]);

    // One applied the full -7, the other only the remaining -3 — total exactly -10.
    const appliedTotal = a.appliedDelta + b.appliedDelta;
    expect(appliedTotal).toBe(-10);
    expect(await onHand(itemId)).toBe(0);

    // The ledger records the actual applied deltas, summing to -10, never below 0.
    const deltas = (await adjustLedger(itemId)).map((r) => r.qtyDelta);
    expect(deltas.reduce((acc, d) => acc + d, 0)).toBe(-10);

    // No lot is ever left negative.
    const lots = await db.select().from(inventoryLotsTable);
    expect(lots.filter((l) => l.itemId === itemId).every((l) => l.qtyRemaining >= 0)).toBe(
      true,
    );
  });

  it("serializes a concurrent run completion and manual downward adjustment without overselling", async () => {
    const itemId = await makeItem("ingredient:Basil:lbs");
    await addLot(itemId, 10);

    // A run finalizes (consuming 7) at the same instant a staffer corrects the
    // same item down by 7. Both paths draw through the same FOR UPDATE lock, so
    // together they can take at most the 10 on hand — never overselling.
    const [run, adjust] = await Promise.all([
      consumeRun("run-mixed-adjust", [{ itemKey: "ingredient:Basil:lbs", qty: 7 }]),
      adjustInventory(itemId, -7, "staff recount"),
    ]);

    expect(run.applied).toBe(true);

    // Whatever the consume took plus whatever the adjust capped at must equal the
    // 10 available, leaving stock at exactly zero.
    const consumed = await db
      .select()
      .from(inventoryLedgerTable)
      .then((rows) =>
        rows
          .filter((r) => r.itemId === itemId && r.type === "consume")
          .reduce((acc, r) => acc - r.qtyDelta, 0),
      );
    const adjusted = -adjust.appliedDelta;
    expect(consumed + adjusted).toBe(10);
    expect(await onHand(itemId)).toBe(0);

    // No lot is ever left negative.
    const lots = await db.select().from(inventoryLotsTable);
    expect(lots.filter((l) => l.itemId === itemId).every((l) => l.qtyRemaining >= 0)).toBe(
      true,
    );
  });
});

describe("inventory merge against a real database", () => {
  // Look an item up by its key; null if it was deleted (e.g. a merged source).
  async function findItem(key: string) {
    const rows = await db.select().from(inventoryItemsTable);
    return rows.find((r) => r.key === key) ?? null;
  }

  // Every ledger row for an item, oldest first.
  async function ledgerFor(itemId: number) {
    const rows = await db.select().from(inventoryLedgerTable);
    return rows.filter((r) => r.itemId === itemId).sort((a, b) => a.id - b.id);
  }

  it("folds a source with lots + history into the target, preserving stock and audit trail", async () => {
    const sourceId = await makeItem("ingredient:Mozz Whole:lbs");
    const targetId = await makeItem("ingredient:Mozzarella:lbs");
    // Source carries two lots (15 on hand) and a prior adjust ledger entry.
    await addLot(sourceId, 10, { expirationDate: "2026-03-01" });
    await addLot(sourceId, 5, { expirationDate: "2026-02-01" });
    await db.insert(inventoryLedgerTable).values({
      itemId: sourceId,
      lotId: null,
      type: "restock",
      qtyDelta: 15,
      note: "initial delivery",
    });
    // Target already has some of its own stock + history.
    await addLot(targetId, 4);
    await db.insert(inventoryLedgerTable).values({
      itemId: targetId,
      lotId: null,
      type: "restock",
      qtyDelta: 4,
      note: "target delivery",
    });

    const sourceLedgerBefore = (await ledgerFor(sourceId)).length;
    expect(sourceLedgerBefore).toBe(1); // the seeded restock
    expect(await onHand(sourceId)).toBe(15);
    expect(await onHand(targetId)).toBe(4);

    const { merged, results } = await mergeInventoryItems([
      {
        fromKey: "ingredient:Mozz Whole:lbs",
        toKey: "ingredient:Mozzarella:lbs",
        toName: "Mozzarella",
        unit: "lbs",
        category: "ingredient",
      },
    ]);
    expect(merged).toBe(1);
    expect(results).toEqual([
      {
        fromKey: "ingredient:Mozz Whole:lbs",
        toKey: "ingredient:Mozzarella:lbs",
        status: "applied",
      },
    ]);

    // The source item is gone; all its lots/ledger now belong to the target.
    expect(await findItem("ingredient:Mozz Whole:lbs")).toBeNull();
    const target = await findItem("ingredient:Mozzarella:lbs");
    expect(target).not.toBeNull();
    expect(target!.id).toBe(targetId);

    // On-hand total is preserved: 15 (source) + 4 (target) = 19.
    expect(await onHand(targetId)).toBe(19);

    // No lot or ledger row is left orphaned on the (deleted) source id.
    const allLots = await db.select().from(inventoryLotsTable);
    expect(allLots.every((l) => l.itemId === targetId)).toBe(true);
    expect(allLots).toHaveLength(3); // 2 from source + 1 from target

    const targetLedger = await ledgerFor(targetId);
    // 1 target restock + 1 source restock (re-pointed) + 1 "Merged from" row.
    expect(targetLedger).toHaveLength(3);
    const mergeRow = targetLedger.find((r) => r.note === "Merged from ingredient:Mozz Whole:lbs");
    expect(mergeRow).toBeDefined();
    expect(mergeRow!.type).toBe("adjust");
    expect(mergeRow!.qtyDelta).toBe(0); // a zero-delta audit marker, no stock change
    // The re-pointed source history survived intact.
    expect(targetLedger.some((r) => r.note === "initial delivery")).toBe(true);
    expect(targetLedger.some((r) => r.note === "target delivery")).toBe(true);
  });

  it("creates the target when it doesn't exist yet, carrying the source's stock over", async () => {
    const sourceId = await makeItem("ingredient:Old Name:lbs");
    await addLot(sourceId, 8);
    expect(await onHand(sourceId)).toBe(8);

    const { merged, results } = await mergeInventoryItems([
      {
        fromKey: "ingredient:Old Name:lbs",
        toKey: "ingredient:New Name:lbs",
        toName: "New Name",
        unit: "lbs",
        category: "ingredient",
      },
    ]);
    expect(merged).toBe(1);
    expect(results).toEqual([
      {
        fromKey: "ingredient:Old Name:lbs",
        toKey: "ingredient:New Name:lbs",
        status: "applied",
      },
    ]);

    // Source is gone; a brand-new target now holds the stock + a merge marker.
    expect(await findItem("ingredient:Old Name:lbs")).toBeNull();
    const target = await findItem("ingredient:New Name:lbs");
    expect(target).not.toBeNull();
    expect(target!.name).toBe("New Name");
    expect(await onHand(target!.id)).toBe(8);

    const ledger = await ledgerFor(target!.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].note).toBe("Merged from ingredient:Old Name:lbs");
    expect(ledger[0].qtyDelta).toBe(0);
  });

  it("folds several sources into one target in a single batch, preserving every source's stock and history", async () => {
    // One pre-existing target plus three distinct sources, each with its own
    // lot and a restock ledger row, all folded into the target in ONE batch.
    const targetId = await makeItem("ingredient:Cheese:lbs");
    await addLot(targetId, 4);
    await db.insert(inventoryLedgerTable).values({
      itemId: targetId,
      lotId: null,
      type: "restock",
      qtyDelta: 4,
      note: "target delivery",
    });

    const sources: Array<{ key: string; name: string; qty: number }> = [
      { key: "ingredient:Mozz Whole:lbs", name: "Mozz Whole", qty: 10 },
      { key: "ingredient:Mozz Shredded:lbs", name: "Mozz Shredded", qty: 5 },
      { key: "ingredient:Mozz Block:lbs", name: "Mozz Block", qty: 8 },
    ];
    for (const s of sources) {
      const id = await makeItem(s.key);
      await addLot(id, s.qty);
      await db.insert(inventoryLedgerTable).values({
        itemId: id,
        lotId: null,
        type: "restock",
        qtyDelta: s.qty,
        note: `${s.name} delivery`,
      });
    }

    const { merged, results } = await mergeInventoryItems(
      sources.map((s) => ({
        fromKey: s.key,
        toKey: "ingredient:Cheese:lbs",
        toName: "Cheese",
        unit: "lbs",
        category: "ingredient",
      })),
    );
    // Every source in the batch was folded.
    expect(merged).toBe(3);
    // Each entry is reported as applied, in order.
    expect(results).toEqual(
      sources.map((s) => ({
        fromKey: s.key,
        toKey: "ingredient:Cheese:lbs",
        status: "applied",
      })),
    );

    // All three sources are gone; only the target remains.
    for (const s of sources) {
      expect(await findItem(s.key)).toBeNull();
    }
    const target = await findItem("ingredient:Cheese:lbs");
    expect(target).not.toBeNull();
    expect(target!.id).toBe(targetId);

    // On-hand is the sum of all folded stock: 4 + 10 + 5 + 8 = 27.
    expect(await onHand(targetId)).toBe(27);

    // No lot is orphaned on a deleted source; all 4 now belong to the target.
    const allLots = await db.select().from(inventoryLotsTable);
    expect(allLots.every((l) => l.itemId === targetId)).toBe(true);
    expect(allLots).toHaveLength(4); // 1 target + 3 source lots

    const targetLedger = await ledgerFor(targetId);
    // 1 target restock + 3 re-pointed source restocks + 3 "Merged from" markers.
    expect(targetLedger).toHaveLength(7);
    // Every source got its own zero-delta merge marker (note uses the source's
    // name, which makeItem sets equal to its key).
    for (const s of sources) {
      const mergeRow = targetLedger.find((r) => r.note === `Merged from ${s.key}`);
      expect(mergeRow).toBeDefined();
      expect(mergeRow!.type).toBe("adjust");
      expect(mergeRow!.qtyDelta).toBe(0);
    }
    // Every source's original history survived the re-point.
    expect(targetLedger.some((r) => r.note === "target delivery")).toBe(true);
    for (const s of sources) {
      expect(targetLedger.some((r) => r.note === `${s.name} delivery`)).toBe(true);
    }
  });

  it("rolls the whole batch back when one merge fails mid-way (all-or-nothing)", async () => {
    // Three valid, tracked sources — each with a lot and a restock ledger row.
    const specs: Array<{ key: string; name: string; toKey: string; qty: number }> = [
      { key: "ingredient:Src A:lbs", name: "Src A", toKey: "ingredient:Dest A:lbs", qty: 9 },
      { key: "ingredient:Src B:lbs", name: "Src B", toKey: "ingredient:Dest B:lbs", qty: 6 },
      { key: "ingredient:Src C:lbs", name: "Src C", toKey: "ingredient:Dest C:lbs", qty: 3 },
    ];
    const sourceIds = new Map<string, number>();
    for (const s of specs) {
      const id = await makeItem(s.key);
      await addLot(id, s.qty);
      await db.insert(inventoryLedgerTable).values({
        itemId: id,
        lotId: null,
        type: "restock",
        qtyDelta: s.qty,
        note: `${s.name} delivery`,
      });
      sourceIds.set(s.key, id);
    }

    // A batch whose SECOND entry is invalid: a null target name violates the
    // NOT NULL column, throwing partway through the transaction (after the first
    // valid fold has already run). The first and third folds must both unwind.
    const batch = [
      {
        fromKey: "ingredient:Src A:lbs",
        toKey: "ingredient:Dest A:lbs",
        toName: "Dest A",
        unit: "lbs",
        category: "ingredient",
      },
      {
        fromKey: "ingredient:Src B:lbs",
        toKey: "ingredient:Dest B:lbs",
        toName: null as unknown as string, // invalid: name is NOT NULL
        unit: "lbs",
        category: "ingredient",
      },
      {
        fromKey: "ingredient:Src C:lbs",
        toKey: "ingredient:Dest C:lbs",
        toName: "Dest C",
        unit: "lbs",
        category: "ingredient",
      },
    ];

    await expect(mergeInventoryItems(batch)).rejects.toThrow();

    // Nothing committed: every source still exists, untouched, with its stock.
    for (const s of specs) {
      const src = await findItem(s.key);
      expect(src).not.toBeNull();
      expect(src!.id).toBe(sourceIds.get(s.key));
      expect(await onHand(src!.id)).toBe(s.qty);
      // Lots and ledger were never re-pointed: only the seeded restock remains.
      const ledger = await ledgerFor(src!.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0].note).toBe(`${s.name} delivery`);
    }

    // No target item was created (not even for the folds that "succeeded" first).
    for (const s of specs) {
      expect(await findItem(s.toKey)).toBeNull();
    }

    // Only the three original sources exist — nothing added, nothing deleted.
    const allItems = await db.select().from(inventoryItemsTable);
    expect(allItems).toHaveLength(3);

    // Not a single "Merged from" audit row was written anywhere.
    const allLedger = await db.select().from(inventoryLedgerTable);
    expect(allLedger.some((r) => r.note.startsWith("Merged from"))).toBe(false);
  });

  it("treats a merge into itself (fromKey == toKey) as a no-op", async () => {
    const itemId = await makeItem("ingredient:Self:lbs");
    await addLot(itemId, 6);

    const { merged, results } = await mergeInventoryItems([
      {
        fromKey: "ingredient:Self:lbs",
        toKey: "ingredient:Self:lbs",
        toName: "Self",
        unit: "lbs",
        category: "ingredient",
      },
    ]);
    expect(merged).toBe(0);
    expect(results).toEqual([
      {
        fromKey: "ingredient:Self:lbs",
        toKey: "ingredient:Self:lbs",
        status: "skipped",
        reason: "same-key",
      },
    ]);

    // Nothing moved, nothing deleted, no audit row written.
    const item = await findItem("ingredient:Self:lbs");
    expect(item).not.toBeNull();
    expect(item!.id).toBe(itemId);
    expect(await onHand(itemId)).toBe(6);
    expect(await ledgerFor(itemId)).toHaveLength(0);
  });

  it("reports an untracked source as skipped instead of silently swallowing it", async () => {
    // No item exists under the source key, so there is nothing to fold.
    const { merged, results } = await mergeInventoryItems([
      {
        fromKey: "ingredient:Ghost:lbs",
        toKey: "ingredient:Real:lbs",
        toName: "Real",
        unit: "lbs",
        category: "ingredient",
      },
    ]);
    expect(merged).toBe(0);
    expect(results).toEqual([
      {
        fromKey: "ingredient:Ghost:lbs",
        toKey: "ingredient:Real:lbs",
        status: "skipped",
        reason: "source-not-tracked",
      },
    ]);
    // The target was never minted just because we asked to merge into it.
    expect(await findItem("ingredient:Real:lbs")).toBeNull();
  });

  it("reports blank keys as skipped with a blank-key reason", async () => {
    const { merged, results } = await mergeInventoryItems([
      {
        fromKey: "   ",
        toKey: "ingredient:Real:lbs",
        toName: "Real",
        unit: "lbs",
        category: "ingredient",
      },
      {
        fromKey: "ingredient:Real:lbs",
        toKey: "",
        toName: "Real",
        unit: "lbs",
        category: "ingredient",
      },
    ]);
    expect(merged).toBe(0);
    expect(results).toEqual([
      { fromKey: "   ", toKey: "ingredient:Real:lbs", status: "skipped", reason: "blank-key" },
      { fromKey: "ingredient:Real:lbs", toKey: "", status: "skipped", reason: "blank-key" },
    ]);
    // No items were created or touched.
    expect(await db.select().from(inventoryItemsTable)).toHaveLength(0);
  });

  it("reports a per-entry mix of applied and skipped folds in one batch", async () => {
    // One valid, tracked source; one untracked; one self-merge; one blank.
    const okId = await makeItem("ingredient:Provolone:lbs");
    await addLot(okId, 9);

    const { merged, results } = await mergeInventoryItems([
      {
        fromKey: "ingredient:Provolone:lbs",
        toKey: "ingredient:Cheese:lbs",
        toName: "Cheese",
        unit: "lbs",
        category: "ingredient",
      },
      {
        fromKey: "ingredient:Nope:lbs",
        toKey: "ingredient:Cheese:lbs",
        toName: "Cheese",
        unit: "lbs",
        category: "ingredient",
      },
      {
        fromKey: "ingredient:Cheese:lbs",
        toKey: "ingredient:Cheese:lbs",
        toName: "Cheese",
        unit: "lbs",
        category: "ingredient",
      },
      {
        fromKey: "",
        toKey: "ingredient:Cheese:lbs",
        toName: "Cheese",
        unit: "lbs",
        category: "ingredient",
      },
    ]);

    // Only the first fold applied; the count reflects just that one.
    expect(merged).toBe(1);
    expect(results).toEqual([
      { fromKey: "ingredient:Provolone:lbs", toKey: "ingredient:Cheese:lbs", status: "applied" },
      {
        fromKey: "ingredient:Nope:lbs",
        toKey: "ingredient:Cheese:lbs",
        status: "skipped",
        reason: "source-not-tracked",
      },
      {
        fromKey: "ingredient:Cheese:lbs",
        toKey: "ingredient:Cheese:lbs",
        status: "skipped",
        reason: "same-key",
      },
      { fromKey: "", toKey: "ingredient:Cheese:lbs", status: "skipped", reason: "blank-key" },
    ]);

    // The one valid fold really happened: source gone, stock carried to target.
    expect(await findItem("ingredient:Provolone:lbs")).toBeNull();
    const target = await findItem("ingredient:Cheese:lbs");
    expect(target).not.toBeNull();
    expect(await onHand(target!.id)).toBe(9);
  });
});

// ── Location-aware drawdown + transfer ──────────────────────────────────────
async function makeLocation(name: string, isOnsite = false): Promise<number> {
  const [row] = await db
    .insert(inventoryLocationsTable)
    .values({ name, isOnsite })
    .returning();
  return row.id;
}

// Add a lot pinned to a specific location.
async function addLotAt(
  itemId: number,
  locationId: number | null,
  qty: number,
  opts: { expirationDate?: string | null } = {},
): Promise<void> {
  await db.insert(inventoryLotsTable).values({
    itemId,
    locationId,
    qtyReceived: qty,
    qtyRemaining: qty,
    receivedDate: null,
    expirationDate: opts.expirationDate ?? null,
  });
}

async function lotsForItem(itemId: number) {
  const lots = await db.select().from(inventoryLotsTable);
  return lots.filter((l) => l.itemId === itemId);
}

describe("location-aware consumption against a real database", () => {
  it("consume only draws from onsite (and null) lots, leaving offsite stock untouched", async () => {
    const onsite = await makeLocation("Onsite (Line)", true);
    const cold = await makeLocation("Cold Storage", false);
    const itemId = await makeItem("ingredient:Mozzarella:lbs");
    await addLotAt(itemId, onsite, 5);
    await addLotAt(itemId, cold, 50);

    const result = await consumeRun("run-loc-1", [
      { itemKey: "ingredient:Mozzarella:lbs", qty: 8 },
    ]);
    // Onsite only has 5, so consumption caps there; cold storage is untouched.
    expect(result.applied).toBe(true);
    expect(await onHand(itemId)).toBe(50); // 0 onsite + 50 cold
    const cells = await lotsForItem(itemId);
    expect(cells.find((l) => l.locationId === onsite)?.qtyRemaining).toBe(0);
    expect(cells.find((l) => l.locationId === cold)?.qtyRemaining).toBe(50);
  });

  it("with no location rows, consume still draws from null lots (pre-feature parity)", async () => {
    const itemId = await makeItem("ingredient:Sauce:lbs");
    await addLotAt(itemId, null, 10);
    const result = await consumeRun("run-loc-null", [
      { itemKey: "ingredient:Sauce:lbs", qty: 4 },
    ]);
    expect(result.applied).toBe(true);
    expect(await onHand(itemId)).toBe(6);
  });

  it("adjust down only touches onsite lots", async () => {
    const onsite = await makeLocation("Onsite (Line)", true);
    const cold = await makeLocation("Cold Storage", false);
    const itemId = await makeItem("ingredient:Flour:lbs");
    await addLotAt(itemId, onsite, 4);
    await addLotAt(itemId, cold, 20);

    const result = await adjustInventory(itemId, -10, "onsite spill");
    // Capped at the 4 onsite; cold storage is not drained.
    expect(result.appliedDelta).toBe(-4);
    expect(await onHand(itemId)).toBe(20);
  });
});

describe("inventory transfer against a real database", () => {
  it("moves stock between locations, preserving expiration and conserving on-hand", async () => {
    const onsite = await makeLocation("Onsite (Line)", true);
    const cold = await makeLocation("Cold Storage", false);
    const itemId = await makeItem("ingredient:Cheese:lbs");
    await addLotAt(itemId, cold, 30, { expirationDate: "2026-02-01" });

    const result = await transferStock(itemId, cold, onsite, 12, {
      fromIsOnsite: false,
      fromName: "Cold Storage",
      toName: "Onsite (Line)",
    });
    expect(result).toEqual({ transferred: 12 });
    // On-hand conserved across the move.
    expect(await onHand(itemId)).toBe(30);

    const cells = await lotsForItem(itemId);
    const onsiteLots = cells.filter((l) => l.locationId === onsite);
    const coldLots = cells.filter((l) => l.locationId === cold);
    expect(coldLots.reduce((a, l) => a + l.qtyRemaining, 0)).toBe(18);
    expect(onsiteLots.reduce((a, l) => a + l.qtyRemaining, 0)).toBe(12);
    // The destination lot carries the source's expiration date.
    expect(onsiteLots.every((l) => l.expirationDate === "2026-02-01")).toBe(true);

    // Paired transfer ledger entries net to zero.
    const ledger = await db.select().from(inventoryLedgerTable);
    const tx = ledger.filter((r) => r.itemId === itemId && r.type === "transfer");
    expect(tx).toHaveLength(2);
    expect(tx.reduce((a, r) => a + r.qtyDelta, 0)).toBe(0);
  });

  it("caps a transfer at the available source stock", async () => {
    const onsite = await makeLocation("Onsite (Line)", true);
    const cold = await makeLocation("Cold Storage", false);
    const itemId = await makeItem("ingredient:Pepperoni:lbs");
    await addLotAt(itemId, cold, 5);

    const result = await transferStock(itemId, cold, onsite, 100, {
      fromIsOnsite: false,
      fromName: "Cold Storage",
      toName: "Onsite (Line)",
    });
    expect(result.transferred).toBe(5);
    expect(await onHand(itemId)).toBe(5);
    const cells = await lotsForItem(itemId);
    expect(cells.filter((l) => l.locationId === cold).reduce((a, l) => a + l.qtyRemaining, 0)).toBe(0);
    expect(cells.filter((l) => l.locationId === onsite).reduce((a, l) => a + l.qtyRemaining, 0)).toBe(5);
  });

  it("transferring from onsite also sweeps still-null (onsite) lots", async () => {
    const onsite = await makeLocation("Onsite (Line)", true);
    const cold = await makeLocation("Cold Storage", false);
    const itemId = await makeItem("ingredient:Dough:lbs");
    await addLotAt(itemId, null, 6); // legacy null === onsite

    const result = await transferStock(itemId, onsite, cold, 4, {
      fromIsOnsite: true,
      fromName: "Onsite (Line)",
      toName: "Cold Storage",
    });
    expect(result.transferred).toBe(4);
    const cells = await lotsForItem(itemId);
    expect(cells.filter((l) => l.locationId === cold).reduce((a, l) => a + l.qtyRemaining, 0)).toBe(4);
  });
});
