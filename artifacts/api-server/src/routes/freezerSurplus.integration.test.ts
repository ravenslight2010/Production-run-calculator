// Integration coverage for the dated finished-case freezer surplus ledger.
// This uses a disposable database so the tests exercise auth, scope isolation,
// the real transaction/row locks, and persistence rather than a mocked route.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signLegacyTokenForTests } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let freezerSurplusLotsTable: DbModule["freezerSurplusLotsTable"];
let freezerSurplusAllocationsTable: DbModule["freezerSurplusAllocationsTable"];
let freezerSurplusAdjustmentsTable: DbModule["freezerSurplusAdjustmentsTable"];
let freezerSurplusConfirmationsTable: DbModule["freezerSurplusConfirmationsTable"];
let freezerSurplusDecisionCorrectionsTable: DbModule["freezerSurplusDecisionCorrectionsTable"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryLocationsTable: DbModule["inventoryLocationsTable"];
let dailySyncTable: DbModule["dailySyncTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;
let clearSandboxCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;
let untouchedIngredientId: number;

const MANAGER = "surplus-manager";
const SANDBOX_MANAGER = "surplus-sandbox";
const OPERATOR = "surplus-operator";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_surplus_int_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const rolesMod = await import("../lib/roles");
  const userValidityMod = await import("../lib/userValidity");
  const sandboxMod = await import("../lib/sandbox");

  db = dbMod.db;
  pool = dbMod.pool;
  freezerSurplusLotsTable = dbMod.freezerSurplusLotsTable;
  freezerSurplusAllocationsTable = dbMod.freezerSurplusAllocationsTable;
  freezerSurplusAdjustmentsTable = dbMod.freezerSurplusAdjustmentsTable;
  freezerSurplusConfirmationsTable = dbMod.freezerSurplusConfirmationsTable;
  freezerSurplusDecisionCorrectionsTable = dbMod.freezerSurplusDecisionCorrectionsTable;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryLocationsTable = dbMod.inventoryLocationsTable;
  dailySyncTable = dbMod.dailySyncTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = rolesMod.seedRoles;
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  clearSandboxCache = sandboxMod.clearSandboxCache;

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
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 90_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 90_000);

beforeEach(async () => {
  clearUserValidityCache();
  clearSandboxCache();
  await db.execute(sql`
    TRUNCATE ${freezerSurplusConfirmationsTable}, ${freezerSurplusDecisionCorrectionsTable},
      ${freezerSurplusAdjustmentsTable},
      ${freezerSurplusAllocationsTable}, ${freezerSurplusLotsTable},
      ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryItemsTable}, ${inventoryLocationsTable},
      ${dailySyncTable}, ${userRolesTable}, ${usersTable}, ${rolesTable}
      RESTART IDENTITY CASCADE
  `);
  await db.insert(inventoryLocationsTable).values([
    { scope: "live", name: "Test Freezer", isOnsite: false },
    { scope: "sandbox", name: "Test Freezer", isOnsite: false },
  ]);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: MANAGER, passwordHash: "x" },
    { id: SANDBOX_MANAGER, username: SANDBOX_MANAGER, passwordHash: "x", sandbox: true },
    { id: OPERATOR, username: OPERATOR, passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: SANDBOX_MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
  ]);
  const [ingredient] = await db.insert(inventoryItemsTable).values({
    scope: "live", key: "ingredient:Pepperoni:lbs", category: "ingredient",
    name: "Already charged ingredient sentinel", unit: "lbs",
  }).returning();
  untouchedIngredientId = ingredient.id;
  await db.insert(inventoryLotsTable).values({
    scope: "live", itemId: ingredient.id, qtyReceived: 100, qtyRemaining: 100,
  });
});

async function req(
  userId: string | null,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (userId) headers.authorization = `Bearer ${signLegacyTokenForTests(userId)}`;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ledger(userId = MANAGER) {
  const response = await req(userId, "GET", "/api/freezer-surplus");
  expect(response.status).toBe(200);
  return (await response.json()) as {
    lots: Array<{ id: string; productionDate: string; remainingCases: number; totalCases: number }>;
    allocations: Array<{ lotId: string; runId: string; cases: number }>;
  };
}

async function adjustmentHistory(userId = MANAGER) {
  const response = await req(userId, "GET", "/api/freezer-surplus/adjustments");
  expect(response.status).toBe(200);
  return (await response.json()) as {
    adjustments: Array<{
      eventId: string;
      lotId: string;
      eventType: "damage" | "return" | "correction";
      cases: number;
      reason: string;
      actorId: string;
      runId?: string;
      correctsEventId?: string;
      createdAt: string;
    }>;
  };
}

async function finishedInventoryBalance(scope = "live", itemKey = "finished:acme:pepperoni") {
  const items = await db.select().from(inventoryItemsTable);
  const item = items.find(
    (row) => row.scope === scope && row.key === itemKey,
  );
  if (!item) return { onHand: 0, nonFreezerOnHand: 0, ledgerNet: 0, movementCount: 0 };

  const [lots, movements, locations] = await Promise.all([
    db.select().from(inventoryLotsTable),
    db.select().from(inventoryLedgerTable),
    db.select().from(inventoryLocationsTable),
  ]);
  const freezerLocationIds = new Set(
    locations.filter((location) => location.scope === scope && !location.isOnsite).map((location) => location.id),
  );
  const itemLots = lots.filter((lot) => lot.scope === scope && lot.itemId === item.id);
  return {
    onHand: itemLots
      .filter((lot) => lot.locationId != null && freezerLocationIds.has(lot.locationId))
      .reduce((sum, lot) => sum + lot.qtyRemaining, 0),
    nonFreezerOnHand: itemLots
      .filter((lot) => lot.locationId == null || !freezerLocationIds.has(lot.locationId))
      .reduce((sum, lot) => sum + lot.qtyRemaining, 0),
    ledgerNet: movements
      .filter((movement) => movement.scope === scope && movement.itemId === item.id)
      .reduce((sum, movement) => sum + movement.qtyDelta, 0),
    movementCount: movements.filter(
      (movement) => movement.scope === scope && movement.itemId === item.id,
    ).length,
  };
}

async function expectFreezerParity(expectedCases: number, expectedMovements: number) {
  const loaded = await ledger();
  expect(loaded.lots.reduce((sum, lot) => sum + lot.remainingCases, 0)).toBe(expectedCases);
  const inventory = await finishedInventoryBalance();
  expect(inventory).toEqual({
    onHand: expectedCases,
    nonFreezerOnHand: 0,
    ledgerNet: expectedCases,
    movementCount: expectedMovements,
  });
  const ingredientLots = await db.select().from(inventoryLotsTable)
    .where(eq(inventoryLotsTable.itemId, untouchedIngredientId));
  expect(ingredientLots.reduce((sum, lot) => sum + lot.qtyRemaining, 0)).toBe(100);
  expect(await db.select().from(inventoryLedgerTable)
    .where(eq(inventoryLedgerTable.itemId, untouchedIngredientId))).toHaveLength(0);
}

async function raceOnExistingFinishedStock<T>(start: () => Promise<T>): Promise<T> {
  const existing = await pool.query<{ id: number }>(`
    SELECT lots.id FROM inventory_lots lots
    JOIN inventory_items items ON items.id = lots.item_id
    WHERE items.scope = 'live' AND items.key = $1
    LIMIT 1
  `, ["finished:acme:pepperoni"]);
  expect(existing.rows).toHaveLength(1);
  const blocker = await pool.connect();
  let pending: Promise<T>;
  let bothWaiting = false;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM inventory_lots WHERE id = $1 FOR UPDATE", [
      existing.rows[0]!.id,
    ]);
    pending = start();
    // Hold the shared row until both independent transactions reach it.
    // Without read locking/atomic updates, both can precompute from the old
    // quantity while blocked, making the lost-update regression deterministic.
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await pool.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE '%inventory_lots%'
      `);
      if (waiting.rows[0]!.count >= 2) {
        bothWaiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  const result = await pending!;
  expect(bothWaiting).toBe(true);
  return result;
}

async function confirm(userId: string, overrides: Record<string, unknown> = {}) {
  return req(userId, "POST", "/api/freezer-surplus", {
    brand: "Acme",
    flavor: "Pepperoni",
    productionDate: "2026-08-28",
    cases: 20,
    ...overrides,
  });
}

async function confirmOutcome(
  userId: string,
  runId: string,
  overrides: Record<string, unknown> = {},
) {
  return req(userId, "POST", "/api/freezer-surplus/confirmations", {
    runId,
    cases: 0,
    ...overrides,
  });
}

async function correctOutcome(
  userId: string,
  runId: string,
  body: Record<string, unknown>,
) {
  return req(userId, "POST",
    `/api/freezer-surplus/confirmations/${encodeURIComponent(runId)}/corrections`, body);
}

async function readOutcome(userId: string, runId: string) {
  return req(userId, "GET",
    `/api/freezer-surplus/confirmations/${encodeURIComponent(runId)}/corrections`);
}

async function allocate(
  userId: string,
  runId: string,
  allocations: Array<{ lotId: string; cases: number }>,
  overrides: Record<string, unknown> = {},
) {
  return req(userId, "PUT", `/api/freezer-surplus/allocations/${encodeURIComponent(runId)}`, {
    runDate: "2026-08-29",
    brand: "Acme",
    flavor: "Pepperoni",
    allocations,
    ...overrides,
  });
}

const DAMAGE_EVENT_ID = "7b49117a-4a62-4b6e-9c1b-2712f5d2654e";
const DAMAGE_CORRECTION_ID = "9d93c272-e654-441b-8c5c-618f21b43479";
const RETURN_EVENT_ID = "681d17d8-e49f-43c5-8ce1-96767f8fc633";
const RETURN_CORRECTION_ID = "cf991a0c-5f83-4450-b823-0e41e5ec1998";

async function adjust(
  userId: string,
  lotId: string,
  body: Record<string, unknown>,
) {
  return req(userId, "POST", `/api/freezer-surplus/lots/${encodeURIComponent(lotId)}/adjustments`, body);
}

async function seedRun(
  id: string,
  overrides: Record<string, unknown> = {},
  date = "2026-08-29",
): Promise<void> {
  const [existing] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, "live")))
    .limit(1);
  const data = existing?.data as { dayState?: { runs?: unknown[] } } | null;
  const runs = Array.isArray(data?.dayState?.runs) ? data.dayState.runs : [];
  const nextData = {
    ...(data ?? {}),
    dayState: {
      ...(data?.dayState ?? {}),
      runs: [...runs, { id, brand: "Acme", flavor: "Pepperoni", casesNeeded: 500, ...overrides }],
    },
  };
  if (existing) {
    await db
      .update(dailySyncTable)
      .set({ data: nextData })
      .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, "live")));
  } else {
    await db.insert(dailySyncTable).values({
      date,
      scope: "live",
      data: nextData,
    });
  }
}

async function seedCompletedRun(
  id: string,
  overrides: Record<string, unknown> = {},
  date = "2026-08-29",
): Promise<void> {
  const endedAt = Date.now() - 15 * 60_000;
  await seedRun(id, { endedAt, ...overrides }, date);
  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, "live")))
    .limit(1);
  if (!row) throw new Error("Expected the seeded completed run day to exist");
  const data = row.data as Record<string, unknown>;
  const runValues =
    data.runValues && typeof data.runValues === "object"
      ? (data.runValues as Record<string, unknown>)
      : {};
  await db
    .update(dailySyncTable)
    .set({
      data: {
        ...data,
        runValues: {
          ...runValues,
          [id]: { freezerTime: "20" },
        },
      },
    })
    .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, "live")));
}

async function markRunStarted(id: string): Promise<void> {
  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, "2026-08-29"), eq(dailySyncTable.scope, "live")))
    .limit(1);
  if (!row) throw new Error("Expected the seeded run day to exist");
  const data = row.data as { dayState?: { runs?: Array<Record<string, unknown>> } };
  const runs = (data.dayState?.runs ?? []).map((run) =>
    run.id === id ? { ...run, startedAt: "2026-08-29T10:00:00.000Z" } : run,
  );
  await db
    .update(dailySyncTable)
    .set({ data: { ...data, dayState: { ...data.dayState, runs } } })
    .where(and(eq(dailySyncTable.date, "2026-08-29"), eq(dailySyncTable.scope, "live")));
}

describe("dated freezer surplus API", () => {
  it("records zero as a scoped receipt only and rejects conflicting outcomes", async () => {
    await seedCompletedRun("confirmed-none-run");
    const first = await confirmOutcome(MANAGER, "confirmed-none-run");
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      confirmation: {
        runId: "confirmed-none-run",
        runDate: "2026-08-29",
        brand: "Acme",
        flavor: "Pepperoni",
        cases: 0,
        productionDate: null,
        lotId: null,
      },
    });

    const replay = await confirmOutcome(MANAGER, "confirmed-none-run");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      confirmation: { runId: "confirmed-none-run", cases: 0, lotId: null },
    });
    expect((await confirmOutcome(MANAGER, "confirmed-none-run", { cases: 2, productionDate: "2026-08-29" })).status)
      .toBe(409);
    const visible = await req(OPERATOR, "GET", "/api/freezer-surplus/confirmations");
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({
      confirmations: [{ runId: "confirmed-none-run", cases: 0 }],
    });
    expect((await confirmOutcome(OPERATOR, "confirmed-none-run")).status).toBe(403);
    expect((await ledger()).lots).toHaveLength(0);
    expect(await db.select().from(freezerSurplusConfirmationsTable)).toHaveLength(1);
    expect(await db.select().from(inventoryItemsTable)).toHaveLength(1);
    expect(await db.select().from(inventoryLotsTable)).toHaveLength(1);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(0);

    const sandboxRead = await req(SANDBOX_MANAGER, "GET", "/api/freezer-surplus/confirmations");
    expect(await sandboxRead.json()).toEqual({ confirmations: [] });
    expect((await confirmOutcome(SANDBOX_MANAGER, "confirmed-none-run")).status).toBe(404);
  });

  it("creates positive lots once per run and allows independent same-product runs", async () => {
    await seedCompletedRun("confirmed-positive-run");
    await seedCompletedRun("independent-positive-run");
    const body = { cases: 12, productionDate: "2026-08-28" };
    const concurrent = await Promise.all([
      confirmOutcome(MANAGER, "confirmed-positive-run", body),
      confirmOutcome(MANAGER, "confirmed-positive-run", body),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 201]);
    expect((await confirmOutcome(MANAGER, "confirmed-positive-run", body)).status).toBe(200);
    expect((await confirmOutcome(MANAGER, "confirmed-positive-run", {
      cases: 10,
      productionDate: "2026-08-28",
    })).status).toBe(409);
    expect((await confirmOutcome(MANAGER, "independent-positive-run", body)).status).toBe(201);
    await expectFreezerParity(24, 2);
    expect(await db.select().from(freezerSurplusConfirmationsTable)).toHaveLength(2);
    expect(await db.select().from(freezerSurplusLotsTable)).toHaveLength(2);
  });

  it("preserves both independent cross-day confirmations sharing an existing inventory lot", async () => {
    expect((await confirm(MANAGER, { cases: 5 })).status).toBe(201);
    await seedCompletedRun("cross-day-a", {}, "2026-08-29");
    await seedCompletedRun("cross-day-b", {}, "2026-08-30");
    const responses = await raceOnExistingFinishedStock(() => Promise.all([
      confirmOutcome(MANAGER, "cross-day-a", { cases: 3, productionDate: "2026-08-29" }),
      confirmOutcome(MANAGER, "cross-day-b", { cases: 7, productionDate: "2026-08-29" }),
    ]));
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const receipts = await db.select().from(freezerSurplusConfirmationsTable);
    expect(receipts.map((receipt) => receipt.runDate).sort()).toEqual(["2026-08-29", "2026-08-30"]);
    expect(receipts.reduce((sum, receipt) => sum + receipt.cases, 0)).toBe(10);
    await expectFreezerParity(15, 3);
    expect((await confirmOutcome(MANAGER, "cross-day-a", {
      cases: 3, productionDate: "2026-08-29",
    })).status).toBe(200);
    expect((await confirmOutcome(MANAGER, "cross-day-b", {
      cases: 8, productionDate: "2026-08-29",
    })).status).toBe(409);
    await expectFreezerParity(15, 3);
  });

  it("preserves a concurrent existing-stock allocation and legacy lot creation", async () => {
    const initial = await confirm(MANAGER, { cases: 20 });
    const lotId = ((await initial.json()) as { createdLot: { id: string } }).createdLot.id;
    await seedRun("concurrent-pull", {}, "2026-08-29");
    const responses = await raceOnExistingFinishedStock(() => Promise.all([
      allocate(MANAGER, "concurrent-pull", [{ lotId, cases: 12 }]),
      confirm(MANAGER, {
        cases: 7, productionDate: "2026-08-29",
      }),
    ]));
    expect(responses.map((response) => response.status)).toEqual([200, 201]);
    expect(await db.select().from(freezerSurplusConfirmationsTable)).toHaveLength(0);
    await expectFreezerParity(15, 3);
  });

  it("rejects invalid counts and expired completed-run windows", async () => {
    await seedCompletedRun("invalid-count-run");
    for (const cases of [-1, 1.5, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect((await confirmOutcome(MANAGER, "invalid-count-run", { cases })).status).toBe(400);
    }
    expect((await confirmOutcome(MANAGER, "invalid-count-run", {
      cases: 1,
      productionDate: "2026-02-30",
    })).status).toBe(400);
    await seedCompletedRun("expired-confirmation-run", {
      endedAt: Date.now() - 40 * 60_000,
    });
    expect((await confirmOutcome(MANAGER, "expired-confirmation-run")).status).toBe(409);
    expect(await db.select().from(freezerSurplusConfirmationsTable)).toHaveLength(0);
  });

  it("requires a real completed run and freezer location for positive stock only", async () => {
    await seedRun("not-completed-run");
    await seedCompletedRun("future-completion-run", { endedAt: Date.now() + 60_000 });
    expect((await confirmOutcome(MANAGER, "not-completed-run")).status).toBe(409);
    expect((await confirmOutcome(MANAGER, "future-completion-run")).status).toBe(409);
    expect((await confirmOutcome(MANAGER, "missing-run")).status).toBe(404);
    expect((await confirmOutcome(MANAGER, "   ")).status).toBe(400);
    await db.delete(inventoryLocationsTable).where(eq(inventoryLocationsTable.isOnsite, false));
    await seedCompletedRun("missing-freezer-positive");
    await seedCompletedRun("no-freezer-none");
    expect((await confirmOutcome(MANAGER, "missing-freezer-positive", {
      cases: 2,
      productionDate: "2026-08-28",
    })).status).toBe(409);
    expect((await confirmOutcome(MANAGER, "no-freezer-none")).status).toBe(201);
    expect(await db.select().from(freezerSurplusLotsTable)).toHaveLength(0);
    expect(await db.select().from(inventoryItemsTable)).toHaveLength(1);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(0);
  });

  it("rolls back lot and stock effects if the confirmation receipt cannot be committed", async () => {
    await seedCompletedRun("receipt-rollback-run");
    await db.execute(sql`
      ALTER TABLE freezer_surplus_confirmations
      ADD CONSTRAINT freezer_surplus_confirmations_test_reject_42 CHECK (cases <> 42)
    `);
    const failed = await confirmOutcome(MANAGER, "receipt-rollback-run", {
      cases: 42,
      productionDate: "2026-08-28",
    });
    expect(failed.status).toBe(500);
    expect(await db.select().from(freezerSurplusConfirmationsTable)).toHaveLength(0);
    expect(await db.select().from(freezerSurplusLotsTable)).toHaveLength(0);
    expect(await db.select().from(inventoryItemsTable)).toHaveLength(1);
    expect(await db.select().from(inventoryLotsTable)).toHaveLength(1);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(0);
    await db.execute(sql`
      ALTER TABLE freezer_surplus_confirmations
      DROP CONSTRAINT freezer_surplus_confirmations_test_reject_42
    `);
  });

  it("corrects a saved decision with append-only, idempotent stock deltas", async () => {
    await seedCompletedRun("correct-count-run");
    expect((await confirmOutcome(MANAGER, "correct-count-run", {
      cases: 5, productionDate: "2026-08-28",
    })).status).toBe(201);
    const original = await db.select().from(freezerSurplusConfirmationsTable);
    const saved = await (await readOutcome(MANAGER, "correct-count-run")).json() as {
      revision: string; original: { cases: number }; current: { cases: number };
    };
    expect(saved.original.cases).toBe(5);
    const requestBody = {
      eventId: "correct-count-event-001", previousRevision: saved.revision,
      cases: 8, productionDate: "2026-08-28", reason: "Counted one case twice",
    };
    expect((await correctOutcome(OPERATOR, "correct-count-run", requestBody)).status).toBe(403);
    const [first, retry] = await Promise.all([
      correctOutcome(MANAGER, "correct-count-run", requestBody),
      correctOutcome(MANAGER, "correct-count-run", requestBody),
    ]);
    expect([first.status, retry.status].sort()).toEqual([200, 201]);
    expect((await correctOutcome(MANAGER, "correct-count-run", requestBody)).status).toBe(200);
    expect((await correctOutcome(MANAGER, "correct-count-run", {
      ...requestBody, cases: 9,
    })).status).toBe(409);
    expect(await db.select().from(freezerSurplusConfirmationsTable)).toEqual(original);
    expect(await db.select().from(freezerSurplusDecisionCorrectionsTable)).toHaveLength(1);
    expect((await (await readOutcome(MANAGER, "correct-count-run")).json() as {
      current: { cases: number }; corrections: unknown[];
    })).toMatchObject({ current: { cases: 8 }, corrections: [expect.any(Object)] });
    await expectFreezerParity(8, 2);
    const raised = await (await readOutcome(MANAGER, "correct-count-run")).json() as {
      revision: string;
    };
    expect((await correctOutcome(MANAGER, "correct-count-run", {
      eventId: "correct-count-reduce", previousRevision: raised.revision,
      cases: 6, productionDate: "2026-08-28", reason: "Remove two cases from the recount",
    })).status).toBe(201);
    const preservedLots = await db.select().from(freezerSurplusLotsTable);
    expect(preservedLots.map((lot) => lot.totalCases).sort((a, b) => a - b)).toEqual([3, 5]);
    await expectFreezerParity(6, 3);
    expect((await correctOutcome(MANAGER, "correct-count-run", {
      ...requestBody, eventId: "correct-count-stale", cases: 4,
    })).status).toBe(409);
    const replayAfterNextCorrection = await correctOutcome(MANAGER, "correct-count-run", requestBody);
    expect(replayAfterNextCorrection.status).toBe(200);
    expect((await replayAfterNextCorrection.json() as { current: { cases: number } }).current.cases).toBe(6);
  });

  it("rejects a competing correction based on a stale revision", async () => {
    await seedCompletedRun("competing-corrections-run");
    expect((await confirmOutcome(MANAGER, "competing-corrections-run", {
      cases: 5, productionDate: "2026-08-28",
    })).status).toBe(201);
    const saved = await (await readOutcome(MANAGER, "competing-corrections-run")).json() as {
      revision: string;
    };
    const [left, right] = await Promise.all([
      correctOutcome(MANAGER, "competing-corrections-run", {
        eventId: "competing-correction-left", previousRevision: saved.revision,
        cases: 6, productionDate: "2026-08-28", reason: "First corrected count",
      }),
      correctOutcome(MANAGER, "competing-corrections-run", {
        eventId: "competing-correction-right", previousRevision: saved.revision,
        cases: 7, productionDate: "2026-08-28", reason: "Second corrected count",
      }),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    expect(await db.select().from(freezerSurplusDecisionCorrectionsTable)).toHaveLength(1);
    const current = await (await readOutcome(MANAGER, "competing-corrections-run")).json() as {
      current: { cases: number };
    };
    expect([6, 7]).toContain(current.current.cases);
    await expectFreezerParity(current.current.cases, 2);
  });

  it("supports zero-to-positive and positive-to-zero without reusing the confirmation write", async () => {
    await seedCompletedRun("zero-correction-run");
    expect((await confirmOutcome(MANAGER, "zero-correction-run")).status).toBe(201);
    const zero = await (await readOutcome(MANAGER, "zero-correction-run")).json() as {
      revision: string; original: { cases: number };
    };
    expect(zero.original.cases).toBe(0);
    expect((await correctOutcome(MANAGER, "zero-correction-run", {
      eventId: "zero-to-positive", previousRevision: zero.revision, cases: 4,
      productionDate: "2026-08-28", reason: "Found four cases from this run",
    })).status).toBe(201);
    const positive = await (await readOutcome(MANAGER, "zero-correction-run")).json() as {
      revision: string; original: { cases: number }; corrections: Array<{ lotIds: string[] }>;
    };
    expect(positive.corrections[0]?.lotIds).toHaveLength(1);
    const zeroing = await correctOutcome(MANAGER, "zero-correction-run", {
      eventId: "positive-to-zero", previousRevision: positive.revision, cases: 0,
      reason: "These cases belonged to another run",
    });
    expect(zeroing.status, await zeroing.clone().text()).toBe(201);
    const final = await (await readOutcome(MANAGER, "zero-correction-run")).json() as {
      original: { cases: number }; current: { cases: number; lotId: string | null }; corrections: unknown[];
    };
    expect(final).toMatchObject({ original: { cases: 0 }, current: { cases: 0, lotId: null }, corrections: [{}, {}] });
    const stockLots = await db.select().from(freezerSurplusLotsTable);
    expect(stockLots).toHaveLength(1);
    expect(stockLots[0]).toMatchObject({ totalCases: 4, remainingCases: 0 });
    await expectFreezerParity(0, 2);
  });

  it("allows an unused date change but rejects allocated stock reductions and date changes", async () => {
    await seedCompletedRun("date-correction-run");
    expect((await confirmOutcome(MANAGER, "date-correction-run", {
      cases: 5, productionDate: "2026-08-28",
    })).status).toBe(201);
    const saved = await (await readOutcome(MANAGER, "date-correction-run")).json() as {
      revision: string;
    };
    expect((await correctOutcome(MANAGER, "date-correction-run", {
      eventId: "change-date-unused", previousRevision: saved.revision, cases: 5,
      productionDate: "2026-08-29", reason: "Correct production date",
    })).status).toBe(201);
    const changed = await (await readOutcome(MANAGER, "date-correction-run")).json() as {
      revision: string; current: { lotId: string };
    };
    await seedRun("allocated-correction-target", {}, "2026-08-29");
    expect((await allocate(MANAGER, "allocated-correction-target", [
      { lotId: changed.current.lotId, cases: 3 },
    ])).status).toBe(200);
    expect((await correctOutcome(MANAGER, "date-correction-run", {
      eventId: "reject-allocated-reduction", previousRevision: changed.revision,
      cases: 2, productionDate: "2026-08-29", reason: "Reduce beyond available cases",
    })).status).toBe(409);
    expect((await correctOutcome(MANAGER, "date-correction-run", {
      eventId: "reject-allocated-date", previousRevision: changed.revision,
      cases: 5, productionDate: "2026-08-30", reason: "Try to move allocated stock",
    })).status).toBe(409);
    await expectFreezerParity(2, 4);
    expect((await readOutcome(SANDBOX_MANAGER, "date-correction-run")).status).toBe(404);
  });

  it("blocks date changes when a legacy lot's allocation history is unknown", async () => {
    await seedCompletedRun("legacy-date-correction-run");
    expect((await confirmOutcome(MANAGER, "legacy-date-correction-run", {
      cases: 2, productionDate: "2026-08-28",
    })).status).toBe(201);
    await db.update(freezerSurplusLotsTable).set({ dateCorrectionSafe: false });
    const saved = await (await readOutcome(MANAGER, "legacy-date-correction-run")).json() as {
      revision: string;
    };
    expect((await correctOutcome(MANAGER, "legacy-date-correction-run", {
      eventId: "legacy-date-correction-event", previousRevision: saved.revision,
      cases: 2, productionDate: "2026-08-29", reason: "Correct the recorded date",
    })).status).toBe(409);
    await expectFreezerParity(2, 1);
  });

  it("rolls back stock movement when correction evidence cannot be committed", async () => {
    await seedCompletedRun("correction-rollback-run");
    expect((await confirmOutcome(MANAGER, "correction-rollback-run", {
      cases: 5, productionDate: "2026-08-28",
    })).status).toBe(201);
    const saved = await (await readOutcome(MANAGER, "correction-rollback-run")).json() as {
      revision: string;
    };
    await db.execute(sql`
      ALTER TABLE freezer_surplus_decision_corrections
      ADD CONSTRAINT surplus_correction_test_reject_42 CHECK (cases <> 42)
    `);
    try {
      expect((await correctOutcome(MANAGER, "correction-rollback-run", {
        eventId: "correction-rollback-event", previousRevision: saved.revision,
        cases: 42, productionDate: "2026-08-28", reason: "Test transaction rollback",
      })).status).toBe(500);
      expect(await db.select().from(freezerSurplusDecisionCorrectionsTable)).toHaveLength(0);
      await expectFreezerParity(5, 1);
    } finally {
      await db.execute(sql`
        ALTER TABLE freezer_surplus_decision_corrections
        DROP CONSTRAINT surplus_correction_test_reject_42
      `);
    }
  });

  it("requires authentication and preserves separate dated lots on reload", async () => {
    expect((await req(null, "GET", "/api/freezer-surplus")).status).toBe(401);

    expect((await confirm(MANAGER)).status).toBe(201);
    expect((await confirm(MANAGER, { productionDate: "2026-08-29", cases: 7 })).status).toBe(201);
    const loaded = await ledger();
    expect(loaded.lots).toHaveLength(2);
    expect(loaded.lots.map((lot) => lot.productionDate).sort()).toEqual(["2026-08-28", "2026-08-29"]);
    expect(loaded.lots.map((lot) => lot.remainingCases).sort((a, b) => a - b)).toEqual([7, 20]);
  });

  it("rejects malformed dates and keeps scopes isolated", async () => {
    expect((await confirm(MANAGER, { productionDate: "2026-02-30" })).status).toBe(400);
    expect((await confirm(MANAGER)).status).toBe(201);
    expect((await ledger(SANDBOX_MANAGER)).lots).toHaveLength(0);
    expect((await confirm(SANDBOX_MANAGER, { cases: 4 })).status).toBe(201);
    expect((await ledger(SANDBOX_MANAGER)).lots).toHaveLength(1);
    expect((await ledger(MANAGER)).lots).toHaveLength(1);
  });

  it("supports idempotent partial allocation, revision, release, and effective demand", async () => {
    const lotResponse = await confirm(MANAGER);
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    await expectFreezerParity(20, 1);
    await seedRun("run-1");

    expect((await allocate(MANAGER, "run-1", [{ lotId, cases: 12 }])).status).toBe(200);
    let loaded = await ledger();
    expect(loaded.lots[0].remainingCases).toBe(8);
    expect(loaded.allocations).toEqual([
      expect.objectContaining({ lotId, runId: "run-1", cases: 12 }),
    ]);
    await expectFreezerParity(8, 2);

    // Retrying the same PUT leaves both balances and the stock-movement ledger unchanged.
    expect((await allocate(MANAGER, "run-1", [{ lotId, cases: 12 }])).status).toBe(200);
    await expectFreezerParity(8, 2);

    expect((await allocate(MANAGER, "run-1", [{ lotId, cases: 5 }])).status).toBe(200);
    loaded = await ledger();
    expect(loaded.lots[0].remainingCases).toBe(15);
    expect(loaded.allocations[0].cases).toBe(5);
    await expectFreezerParity(15, 4);

    expect((await allocate(MANAGER, "run-1", [])).status).toBe(200);
    await expectFreezerParity(20, 5);

    // A repeated release is also a no-op.
    expect((await allocate(MANAGER, "run-1", [])).status).toBe(200);
    await expectFreezerParity(20, 5);
  });

  it("keeps each dated lot and finished-case stock aligned through multi-lot retries, replacement, and release", async () => {
    const firstLotResponse = await confirm(MANAGER, { productionDate: "2026-08-28", cases: 20 });
    const firstLotId = ((await firstLotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    const secondLotResponse = await confirm(MANAGER, { productionDate: "2026-08-29", cases: 7 });
    const secondLotId = ((await secondLotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    await expectFreezerParity(27, 2);
    await seedRun("multi-lot-run");

    const expectLotBalances = async (firstCases: number, secondCases: number) => {
      const loaded = await ledger();
      expect(loaded.lots).toHaveLength(2);
      expect(Object.fromEntries(loaded.lots.map((lot) => [lot.id, lot.remainingCases]))).toEqual({
        [firstLotId]: firstCases,
        [secondLotId]: secondCases,
      });
      return loaded;
    };

    const initialSelection = [
      { lotId: firstLotId, cases: 12 },
      { lotId: secondLotId, cases: 3 },
    ];
    expect((await allocate(MANAGER, "multi-lot-run", initialSelection)).status).toBe(200);
    let loaded = await expectLotBalances(8, 4);
    expect(loaded.allocations).toHaveLength(2);
    expect(Object.fromEntries(loaded.allocations.map((allocation) => [allocation.lotId, allocation.cases]))).toEqual({
      [firstLotId]: 12,
      [secondLotId]: 3,
    });
    await expectFreezerParity(12, 3);

    // An exact retry must not change either dated lot or add inventory movements.
    expect((await allocate(MANAGER, "multi-lot-run", initialSelection)).status).toBe(200);
    loaded = await expectLotBalances(8, 4);
    expect(loaded.allocations).toHaveLength(2);
    await expectFreezerParity(12, 3);

    const replacementSelection = [
      { lotId: firstLotId, cases: 5 },
      { lotId: secondLotId, cases: 2 },
    ];
    expect((await allocate(MANAGER, "multi-lot-run", replacementSelection)).status).toBe(200);
    loaded = await expectLotBalances(15, 5);
    expect(loaded.allocations).toHaveLength(2);
    expect(Object.fromEntries(loaded.allocations.map((allocation) => [allocation.lotId, allocation.cases]))).toEqual({
      [firstLotId]: 5,
      [secondLotId]: 2,
    });
    await expectFreezerParity(20, 5);

    // Retrying the replacement is also a no-op for stock and the movement ledger.
    expect((await allocate(MANAGER, "multi-lot-run", replacementSelection)).status).toBe(200);
    loaded = await expectLotBalances(15, 5);
    expect(loaded.allocations).toHaveLength(2);
    await expectFreezerParity(20, 5);

    expect((await allocate(MANAGER, "multi-lot-run", [])).status).toBe(200);
    loaded = await expectLotBalances(20, 7);
    expect(loaded.allocations).toHaveLength(0);
    await expectFreezerParity(27, 6);

    // Releasing an already released run must not add another stock movement.
    expect((await allocate(MANAGER, "multi-lot-run", [])).status).toBe(200);
    loaded = await expectLotBalances(20, 7);
    expect(loaded.allocations).toHaveLength(0);
    await expectFreezerParity(27, 6);
  });

  it("rejects mismatches and protects a lot from concurrent over-allocation", async () => {
    const lotResponse = await confirm(MANAGER);
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    await seedRun("run-1");

    expect(
      (await allocate(MANAGER, "run-1", [{ lotId, cases: 1 }], { flavor: "Cheese" })).status,
    ).toBe(400);
    await expectFreezerParity(20, 1);
    expect(
      (await allocate(MANAGER, "run-1", [{ lotId, cases: 21 }])).status,
    ).toBe(400);
    await expectFreezerParity(20, 1);

    const [first, second] = await Promise.all([
      allocate(MANAGER, "run-a", [{ lotId, cases: 15 }]),
      allocate(MANAGER, "run-b", [{ lotId, cases: 15 }]),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    await expectFreezerParity(5, 2);
  });

  it("rejects a pull after a run has started", async () => {
    const lotResponse = await confirm(MANAGER);
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    await seedRun("started-run", { startedAt: "2026-08-29T10:00:00.000Z" });
    expect((await allocate(MANAGER, "started-run", [{ lotId, cases: 1 }])).status).toBe(409);
    await expectFreezerParity(20, 1);
  });

  it("records damage atomically and appends an idempotent linked correction", async () => {
    const lotResponse = await confirm(MANAGER);
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    const damageBody = {
      eventId: DAMAGE_EVENT_ID,
      eventType: "damage",
      cases: 3,
      reason: "Three cases were damaged in freezer storage",
    };

    expect((await adjust(OPERATOR, lotId, damageBody)).status).toBe(403);
    expect((await req(OPERATOR, "GET", "/api/freezer-surplus/adjustments")).status).toBe(403);
    expect((await adjust(MANAGER, lotId, { ...damageBody, eventId: "not-a-uuid" })).status).toBe(400);
    const firstAttempts = await Promise.all([
      adjust(MANAGER, lotId, damageBody),
      adjust(MANAGER, lotId, damageBody),
    ]);
    expect(firstAttempts.map((response) => response.status).sort()).toEqual([200, 201]);
    await expectFreezerParity(17, 2);

    const loaded = await ledger();
    expect(loaded.lots[0].remainingCases).toBe(17);
    const history = await adjustmentHistory();
    expect(history.adjustments).toEqual([
      expect.objectContaining({
        eventId: DAMAGE_EVENT_ID,
        lotId,
        eventType: "damage",
        cases: 3,
        reason: damageBody.reason,
        actorId: MANAGER,
      }),
    ]);
    const movement = (await db.select().from(inventoryLedgerTable)).at(-1);
    expect(movement).toMatchObject({
      type: "adjust",
      qtyDelta: -3,
      note: `Finished-case damage: ${damageBody.reason}`,
    });

    expect((await adjust(MANAGER, lotId, damageBody)).status).toBe(200);
    await expectFreezerParity(17, 2);
    expect(
      (await adjust(MANAGER, lotId, { ...damageBody, cases: 2 })).status,
    ).toBe(409);
    expect(
      (
        await adjust(MANAGER, lotId, {
          ...damageBody,
          eventId: "0d2d2ba7-cac7-42cc-bfdb-388cf3a9fef6",
          cases: 18,
        })
      ).status,
    ).toBe(409);
    await expectFreezerParity(17, 2);

    const correctionBody = {
      eventId: DAMAGE_CORRECTION_ID,
      eventType: "correction",
      cases: 1,
      reason: "One case was incorrectly included in the damage count",
      correctsEventId: DAMAGE_EVENT_ID,
    };
    expect((await adjust(MANAGER, lotId, correctionBody)).status).toBe(201);
    await expectFreezerParity(18, 3);
    expect((await adjust(MANAGER, lotId, correctionBody)).status).toBe(200);
    expect(
      (
        await adjust(MANAGER, lotId, {
          ...correctionBody,
          eventId: "e31ab479-f222-4c36-9f9f-919ea89116f0",
          cases: 3,
        })
      ).status,
    ).toBe(409);
    const correctedHistory = await adjustmentHistory();
    expect(correctedHistory.adjustments.map((event) => event.eventType)).toEqual(["damage", "correction"]);
    expect(correctedHistory.adjustments[1]).toMatchObject({
      correctsEventId: DAMAGE_EVENT_ID,
      actorId: MANAGER,
      cases: 1,
    });
    await expectFreezerParity(18, 3);
  });

  it("keeps finished-case adjustments on the surviving inventory item after a merge", async () => {
    const lotResponse = await confirm(MANAGER, { cases: 10 });
    const lotBody = await lotResponse.json() as { createdLot: Record<string, unknown> & { id: string } };
    const lotId = lotBody.createdLot.id;
    expect(lotBody.createdLot).not.toHaveProperty("inventoryItemId");
    const source = (await db.select().from(inventoryItemsTable)).find(
      (item) => item.scope === "live" && item.key === "finished:acme:pepperoni",
    );
    if (!source) throw new Error("Expected the finished-case inventory item");
    await db
      .update(freezerSurplusLotsTable)
      .set({ inventoryItemId: null })
      .where(eq(freezerSurplusLotsTable.id, lotId));

    const mergedResponse = await req(MANAGER, "POST", "/api/inventory/merge", {
      merges: [{
        fromKey: source.key,
        toKey: "finished:acme:pepperoni-survivor",
        toName: "Acme Pepperoni Cases",
        unit: "cases",
        category: "ingredient",
      }],
    });
    expect(mergedResponse.status).toBe(200);
    const target = (await db.select().from(inventoryItemsTable)).find(
      (item) => item.scope === "live" && item.key === "finished:acme:pepperoni-survivor",
    );
    if (!target) throw new Error("Expected the surviving finished-case inventory item");
    const [linkedLot] = await db
      .select()
      .from(freezerSurplusLotsTable)
      .where(eq(freezerSurplusLotsTable.id, lotId));
    expect(linkedLot?.inventoryItemId).toBe(target.id);
    // Simulate a lot whose merge happened before the durable pointer existed.
    await db
      .update(freezerSurplusLotsTable)
      .set({ inventoryItemId: null })
      .where(eq(freezerSurplusLotsTable.id, lotId));

    const damage = {
      eventId: "7e0c283b-a912-4f8f-920b-0fc5d7381a45",
      eventType: "damage",
      cases: 2,
      reason: "Two cases damaged after item merge",
    };
    const first = await adjust(MANAGER, lotId, damage);
    expect(first.status).toBe(201);
    expect((await adjust(MANAGER, lotId, damage)).status).toBe(200);

    expect((await ledger()).lots[0].remainingCases).toBe(8);
    const [relinkedLot] = await db
      .select()
      .from(freezerSurplusLotsTable)
      .where(eq(freezerSurplusLotsTable.id, lotId));
    expect(relinkedLot?.inventoryItemId).toBe(target.id);
    expect(await finishedInventoryBalance("live", target.key)).toEqual({
      onHand: 8,
      nonFreezerOnHand: 0,
      ledgerNet: 8,
      movementCount: 3, // initial restock, merge marker, and one damage movement
    });
    expect(await db.select().from(freezerSurplusAdjustmentsTable)).toHaveLength(1);

    await seedRun("edited-after-adjustment-run");
    const syncPath = "/api/sync/today?today=2026-08-29";
    const baselineResponse = await req(MANAGER, "GET", syncPath);
    expect(baselineResponse.status).toBe(200);
    const baseline = await baselineResponse.json() as Record<string, any>;
    const baseSnapshotId = baselineResponse.headers.get("X-Sync-Snapshot");
    expect(baseSnapshotId).toMatch(/^[a-f0-9]{64}$/);
    const payload = {
      syncVersion: 1,
      completeness: "complete",
      baseSnapshotId,
      dayState: {
        ...baseline.dayState,
        runs: (baseline.dayState.runs as Array<Record<string, unknown>>).map((run) =>
          run.id === "edited-after-adjustment-run"
            ? { ...run, actualCases: 510 }
            : run,
        ),
      },
      runValues: {
        ...(baseline.runValues as Record<string, Record<string, unknown>>),
        "edited-after-adjustment-run": { casesNeeded: 510 },
      },
      runValuesUpdatedAt: {
        ...(baseline.runValuesUpdatedAt as Record<string, number>),
        "edited-after-adjustment-run": Date.now(),
      },
    };
    const syncWrite = await req(
      MANAGER,
      "PUT",
      `${syncPath}&epoch=0`,
      { senderId: "freezer-adjustment-sync-test", payload },
    );
    expect(syncWrite.status).toBe(200);
    expect(await finishedInventoryBalance("live", target.key)).toEqual({
      onHand: 8,
      nonFreezerOnHand: 0,
      ledgerNet: 8,
      movementCount: 3,
    });
  });

  it("rolls back a damage event when freezer inventory cannot cover the quantity", async () => {
    const lotResponse = await confirm(MANAGER, { cases: 6 });
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    const stockLots = await db.select().from(inventoryLotsTable);
    const [finishedItem] = await db.select().from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.scope, "live"), eq(inventoryItemsTable.key, "finished:acme:pepperoni")));
    const stockLot = stockLots.find((candidate) =>
      candidate.scope === "live" && candidate.itemId === finishedItem?.id);
    if (!stockLot) throw new Error("Expected the confirmed freezer inventory lot");
    await db
      .update(inventoryLotsTable)
      .set({ qtyRemaining: 1 })
      .where(eq(inventoryLotsTable.id, stockLot.id));

    expect(
      (
        await adjust(MANAGER, lotId, {
          eventId: "09f02711-4382-4b93-90fb-5bf9734ac12b",
          eventType: "damage",
          cases: 2,
          reason: "Two cases damaged",
        })
      ).status,
    ).toBe(409);

    const loaded = await ledger();
    expect(loaded.lots[0].remainingCases).toBe(6);
    expect((await adjustmentHistory()).adjustments).toEqual([]);
    expect(await db.select().from(freezerSurplusAdjustmentsTable)).toHaveLength(0);
    expect((await db.select().from(inventoryLotsTable)).find((candidate) => candidate.id === stockLot.id)?.qtyRemaining).toBe(1);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(1);
  });

  it("limits returns to started-run allocations and exposes manager-only correction history", async () => {
    const lotResponse = await confirm(MANAGER);
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    await seedRun("return-run");
    await seedRun("unstarted-return-run");
    expect((await allocate(MANAGER, "return-run", [{ lotId, cases: 8 }])).status).toBe(200);
    expect((await allocate(MANAGER, "unstarted-return-run", [{ lotId, cases: 2 }])).status).toBe(200);
    await markRunStarted("return-run");
    await expectFreezerParity(10, 3);

    const returnBody = {
      eventId: RETURN_EVENT_ID,
      eventType: "return",
      cases: 3,
      reason: "Three unused cases returned from the started run",
      runId: "return-run",
    };
    expect((await adjust(MANAGER, lotId, returnBody)).status).toBe(201);
    await expectFreezerParity(13, 4);
    expect((await adjust(MANAGER, lotId, returnBody)).status).toBe(200);
    expect(
      (
        await adjust(MANAGER, lotId, {
          ...returnBody,
          eventId: "3344e236-dd3e-47f0-83ee-86c7f50a27d3",
          cases: 6,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await adjust(MANAGER, lotId, {
          ...returnBody,
          eventId: "b39b06dd-8833-48c8-9861-e948384b1e63",
          runId: "unstarted-return-run",
          cases: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await adjust(MANAGER, lotId, {
          ...returnBody,
          eventId: "b46b2553-900f-4c56-94a5-e3da565597e4",
          runId: "missing-run",
          cases: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await adjust(SANDBOX_MANAGER, lotId, {
          ...returnBody,
          eventId: "80b6f02a-0d91-4315-94d2-6c5cc6fa5987",
        })
      ).status,
    ).toBe(404);
    expect((await adjustmentHistory(SANDBOX_MANAGER)).adjustments).toEqual([]);
    await expectFreezerParity(13, 4);

    const correctionBody = {
      eventId: RETURN_CORRECTION_ID,
      eventType: "correction",
      cases: 1,
      reason: "One returned case was entered twice",
      correctsEventId: RETURN_EVENT_ID,
    };
    expect((await adjust(MANAGER, lotId, correctionBody)).status).toBe(201);
    await expectFreezerParity(12, 5);
    const finalReturn = {
      ...returnBody,
      eventId: "4e21f7ed-36cb-40b1-b12b-7806bfc53ead",
      cases: 6,
    };
    expect((await adjust(MANAGER, lotId, finalReturn)).status).toBe(201);
    await expectFreezerParity(18, 6);

    const history = await adjustmentHistory();
    expect(history.adjustments.map((event) => event.eventType)).toEqual([
      "return",
      "correction",
      "return",
    ]);
    expect(history.adjustments[0]).toMatchObject({
      runId: "return-run",
      actorId: MANAGER,
    });
    expect(history.adjustments[1]).toMatchObject({ correctsEventId: RETURN_EVENT_ID });
    expect(await db.select().from(freezerSurplusAdjustmentsTable)).toHaveLength(3);
  });
});