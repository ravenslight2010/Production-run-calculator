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
    TRUNCATE ${freezerSurplusAdjustmentsTable}, ${freezerSurplusAllocationsTable}, ${freezerSurplusLotsTable},
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

async function finishedInventoryBalance(scope = "live") {
  const items = await db.select().from(inventoryItemsTable);
  const item = items.find(
    (row) => row.scope === scope && row.key === "finished:acme:pepperoni",
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
): Promise<void> {
  const [existing] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, "2026-08-29"), eq(dailySyncTable.scope, "live")))
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
      .where(and(eq(dailySyncTable.date, "2026-08-29"), eq(dailySyncTable.scope, "live")));
  } else {
    await db.insert(dailySyncTable).values({
      date: "2026-08-29",
      scope: "live",
      data: nextData,
    });
  }
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

  it("rolls back a damage event when freezer inventory cannot cover the quantity", async () => {
    const lotResponse = await confirm(MANAGER, { cases: 6 });
    const lotId = ((await lotResponse.json()) as { createdLot: { id: string } }).createdLot.id;
    const stockLots = await db.select().from(inventoryLotsTable);
    const stockLot = stockLots.find((candidate) => candidate.scope === "live");
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