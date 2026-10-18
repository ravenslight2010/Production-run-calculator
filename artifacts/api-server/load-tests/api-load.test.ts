import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signLegacyTokenForTests } from "../src/lib/auth";

type DbModule = typeof import("@workspace/db");
type ExpressRouter = typeof import("../src/routes/index");

let db: DbModule["db"];
let pool: DbModule["pool"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryConsumedRunsTable: DbModule["inventoryConsumedRunsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let server: Server;
let baseUrl: string;
let managerHeaders: Record<string, string>;
let itemId: number;
let inFlightRequests = 0;
let peakConcurrentRequests = 0;

const MAX_CLIENTS = 4;
const ROUNDS = 4;
const MAX_CONCURRENT_REQUESTS = 12;
const MAX_SYNC_WRITE_ATTEMPTS_PER_RUN = MAX_CLIENTS;
const MAX_TOTAL_REQUESTS =
  MAX_CLIENTS * ROUNDS * 2 * MAX_SYNC_WRITE_ATTEMPTS_PER_RUN
  + ROUNDS * 2
  + 3
  + MAX_CLIENTS * ROUNDS * 2
  + MAX_CLIENTS * ROUNDS;
const REQUEST_TIMEOUT_MS = 10_000;
const DATE = "2032-04-09";
const SCHEDULED_DATE = "2032-04-10";
const MANAGER_ID = "api-load-manager";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const METRICS_PATH = resolve(repoRoot, "api-load-workload/metrics.json");

const metrics = {
  schemaVersion: 1,
  clients: MAX_CLIENTS,
  rounds: ROUNDS,
  syncWrites: 0,
  syncWriteAttempts: 0,
  syncSnapshotReads: 0,
  syncFallbacks: 0,
  consumeRequests: 0,
  adjustmentRequests: 0,
  verificationRequests: 0,
  totalRequests: 0,
  peakConcurrentRequests: 0,
  syncElapsedMs: 0,
  inventoryElapsedMs: 0,
  durationMs: 0,
  assertionFailures: 0,
};

function requireIsolatedApiLoadEnvironment(environment = process.env): string {
  if (
    environment.NODE_ENV !== "test"
    || environment.API_LOAD_TEST_DISPOSABLE_DB !== "1"
    || environment.API_LOAD_TEST_RUNNER !== "1"
    || environment.E2E_TEST_DB !== "1"
    || environment.E2E_APPROVED_DESTRUCTIVE_MODE !== "1"
    || environment.REPLIT_DEPLOYMENT === "1"
    || /^(production|prod)$/iu.test(environment.APP_ENV ?? "")
  ) {
    throw new Error("API load tests require the isolated disposable test runner.");
  }
  const rawUrl = environment.DATABASE_URL?.trim();
  if (!rawUrl) throw new Error("The isolated API load database URL is missing.");
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("The isolated API load database URL is invalid.");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol)
    || databaseUrl.hostname !== "127.0.0.1"
    || databaseUrl.port !== "5432"
    || databaseUrl.username !== "postgres"
    || databaseUrl.password !== "api-load-ci"
    || databaseUrl.search !== ""
    || databaseUrl.hash !== ""
    || !/^api_load_test_[a-f0-9]{16}$/u.test(databaseName)
  ) {
    throw new Error("API load tests require their named loopback disposable database.");
  }
  if (environment.API_LOAD_TEST_METRICS_PATH !== METRICS_PATH) {
    throw new Error("API load tests require the runner-owned metrics path.");
  }
  return databaseUrl.toString();
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signLegacyTokenForTests(MANAGER_ID)}` };
}

async function requestApi(
  path: string,
  options: { method?: string; body?: unknown; manager?: boolean } = {},
): Promise<{ body: unknown; headers: Headers }> {
  inFlightRequests += 1;
  peakConcurrentRequests = Math.max(peakConcurrentRequests, inFlightRequests);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.manager ? managerHeaders : authHeaders()),
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`API load request failed with HTTP ${response.status}.`);
    }
    return { body: await response.json(), headers: response.headers };
  } finally {
    inFlightRequests -= 1;
  }
}

async function requestJson(
  path: string,
  options: { method?: string; body?: unknown; manager?: boolean } = {},
): Promise<unknown> {
  return (await requestApi(path, options)).body;
}

function buildRunPayload(
  date: string,
  runId: string,
  client: number,
  round: number,
  baseSnapshotId: string,
) {
  const stamp = Date.now() + client * 100 + round;
  const run = {
    id: runId,
    brand: "Load Fixture",
    flavor: "Cheese",
    startedAt: stamp,
    metaUpdatedAt: stamp,
  };
  const values = {
    casesNeeded: 10 + round,
    pizzasPerCase: 12,
    casesPerLayer: 0,
    frontlineRecipe: [],
    sauceBarrelLbs: 0,
    sauceOzPerPizza: 0,
    app1OzPerPizza: 0,
    app1BatchLbs: 0,
    app1Type: "",
    app1CheeseRecipe: [],
    app2OzPerPizza: 0,
    app2BatchLbs: 0,
    app2Type: "",
    app2CheeseRecipe: [],
    app3OzPerPizza: 0,
    app3BatchLbs: 0,
    app3Type: "",
    app4OzPerPizza: 0,
    app4BatchLbs: 0,
    app4Type: "",
    app4CheeseRecipe: [],
    pep1OzPerPizza: 0,
    pep1Sticks: 0,
    pep1BatchLbs: 0,
    pep1Type: "",
    pep2OzPerPizza: 0,
    pep2Sticks: 0,
    pep2BatchLbs: 0,
    pep2Type: "",
    crustsPerCycle: 0,
    cycleSpeed: 0,
    speedAdjustment: 0,
    doughRecipe: [{ ingredient: "Flour", lbs: 50 }],
    doughballWeightOz: 8,
    doughBatchYield: 100,
    cartoned: "no",
    casesOnCurrentSkid: round + 1,
  };
  return {
    syncVersion: 1,
    completeness: "complete",
    baseSnapshotId,
    dayState: { date, resetAt: 0, runs: [run] },
    runValues: { [runId]: values },
    runValuesUpdatedAt: { [runId]: stamp },
  };
}

function mergeRunOnCanonical(
  canonical: Record<string, any>,
  date: string,
  runId: string,
  client: number,
  round: number,
  baseSnapshotId: string,
): Record<string, any> {
  const incoming = buildRunPayload(date, runId, client, round, baseSnapshotId);
  const incomingRun = incoming.dayState.runs[0];
  return {
    ...canonical,
    syncVersion: 1,
    completeness: "complete",
    baseSnapshotId,
    dayState: {
      ...canonical.dayState,
      date,
      resetAt: canonical.dayState?.resetAt ?? 0,
      runs: [
        ...(canonical.dayState?.runs ?? []).filter((run: { id?: string }) => run.id !== runId),
        incomingRun,
      ],
    },
    runValues: { ...(canonical.runValues ?? {}), ...incoming.runValues },
    runValuesUpdatedAt: {
      ...(canonical.runValuesUpdatedAt ?? {}),
      ...incoming.runValuesUpdatedAt,
    },
  };
}

async function readSyncSnapshot(date: string): Promise<string> {
  const path = date === DATE
    ? `/api/sync/today?today=${DATE}`
    : `/api/sync/${date}?today=${DATE}`;
  metrics.syncSnapshotReads += 1;
  const response = await requestApi(path, { manager: date !== DATE });
  const snapshotId = response.headers.get("X-Sync-Snapshot");
  if (!snapshotId || !/^[a-f0-9]{64}$/u.test(snapshotId)) {
    throw new Error("API sync snapshot read returned no valid snapshot identity.");
  }
  return snapshotId;
}

async function writeSyncRun(
  date: string,
  runId: string,
  client: number,
  round: number,
  initialSnapshotId: string,
): Promise<void> {
  const path = date === DATE
    ? `/api/sync/today?today=${DATE}`
    : `/api/sync/${date}?today=${DATE}`;
  let baseSnapshotId = initialSnapshotId;
  let payload: Record<string, any> = buildRunPayload(date, runId, client, round, baseSnapshotId);
  for (let attempt = 0; attempt < MAX_SYNC_WRITE_ATTEMPTS_PER_RUN; attempt += 1) {
    metrics.syncWriteAttempts += 1;
    const result = await requestJson(path, {
      method: "PUT",
      manager: date !== DATE,
      body: { senderId: `api-load-client-${client}`, payload },
    }) as {
      ok?: boolean;
      partialFallback?: boolean;
      snapshotId?: string;
      data?: {
        dayState?: { runs?: Array<{ id?: string }> };
        runValues?: Record<string, Record<string, number>>;
      };
    };
    if (result.partialFallback) {
      metrics.syncFallbacks += 1;
      if (!result.snapshotId || !/^[a-f0-9]{64}$/u.test(result.snapshotId) || !result.data) {
        throw new Error("API sync fallback omitted its canonical retry snapshot.");
      }
      baseSnapshotId = result.snapshotId;
      payload = mergeRunOnCanonical(
        result.data,
        date,
        runId,
        client,
        round,
        baseSnapshotId,
      );
      continue;
    }
    expect(result.ok).toBe(true);
    expect(result.data?.dayState?.runs?.some((run) => run.id === runId)).toBe(true);
    expect(result.data?.runValues?.[runId]?.casesNeeded).toBe(10 + round);
    metrics.syncWrites += 1;
    return;
  }
  throw new Error("API sync write exceeded its bounded snapshot-retry count.");
}

async function writeMetrics(): Promise<void> {
  metrics.peakConcurrentRequests = peakConcurrentRequests;
  metrics.durationMs = Math.max(0, Date.now() - workloadStartedAt);
  metrics.totalRequests =
    metrics.syncWriteAttempts
    + metrics.syncSnapshotReads
    + metrics.consumeRequests
    + metrics.adjustmentRequests
    + metrics.verificationRequests;
  await mkdir(dirname(METRICS_PATH), { recursive: true });
  await writeFile(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

let workloadStartedAt = Date.now();
let originalDatabaseUrl: string | undefined;

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  const testDatabaseUrl = requireIsolatedApiLoadEnvironment();
  process.env.DATABASE_URL = testDatabaseUrl;

  const dbMod = await import("@workspace/db");
  const routerModule = await import("../src/routes/index") as ExpressRouter;
  const rolesModule = await import("../src/lib/roles");
  db = dbMod.db;
  pool = dbMod.pool;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryConsumedRunsTable = dbMod.inventoryConsumedRunsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  await rolesModule.seedRoles();
  await db.insert(usersTable).values({
    id: MANAGER_ID,
    username: MANAGER_ID,
    passwordHash: "test-fixture-only",
  });
  await db.insert(userRolesTable).values({ userId: MANAGER_ID, role: "manager" });

  const [item] = await db
    .insert(inventoryItemsTable)
    .values({
      key: "ingredient:Dough:batches",
      category: "ingredient",
      name: "Dough",
      unit: "batches",
    })
    .returning();
  if (!item) throw new Error("API load inventory fixture was not created.");
  itemId = item.id;
  await db.insert(inventoryLotsTable).values({
    itemId,
    qtyReceived: 24,
    qtyRemaining: 24,
    receivedDate: DATE,
  });

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", routerModule.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  managerHeaders = {
    authorization: `Bearer ${signLegacyTokenForTests(MANAGER_ID)}`,
  };
}, 45_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("bounded API application workload against disposable PostgreSQL", () => {
  it("preserves live and scheduled sync data while inventory mutations remain consistent", async () => {
    workloadStartedAt = Date.now();
    try {
      const syncStartedAt = Date.now();
      for (let round = 0; round < ROUNDS; round += 1) {
        const [liveSnapshotId, scheduledSnapshotId] = await Promise.all([
          readSyncSnapshot(DATE),
          readSyncSnapshot(SCHEDULED_DATE),
        ]);
        await Promise.all(
          Array.from({ length: MAX_CLIENTS }, (_, client) =>
            Promise.all([
              writeSyncRun(
                DATE,
                `api-load-live-${client}-${round}`,
                client,
                round,
                liveSnapshotId,
              ),
              writeSyncRun(
                SCHEDULED_DATE,
                `api-load-scheduled-${client}-${round}`,
                client,
                round,
                scheduledSnapshotId,
              ),
            ]),
          ),
        );
      }
      metrics.syncElapsedMs = Date.now() - syncStartedAt;

      const [live, scheduled, scheduledList] = await Promise.all([
        requestJson(`/api/sync/today?today=${DATE}`),
        requestJson(`/api/sync/${SCHEDULED_DATE}?today=${DATE}`, { manager: true }),
        requestJson(`/api/sync/scheduled?include=runs&today=${DATE}`, { manager: true }),
      ]) as [
        { dayState?: { runs?: Array<{ id: string }> }; runValues?: Record<string, Record<string, number>> },
        { dayState?: { runs?: Array<{ id: string }> }; runValues?: Record<string, Record<string, number>> } | null,
        Array<{ date: string; runs?: Array<{ id: string; casesNeeded: number }> }>,
      ];
      metrics.verificationRequests = 3;

      const expectedLiveIds = Array.from(
        { length: MAX_CLIENTS * ROUNDS },
        (_, index) => `api-load-live-${Math.floor(index / ROUNDS)}-${index % ROUNDS}`,
      ).sort();
      const expectedScheduledIds = Array.from(
        { length: MAX_CLIENTS * ROUNDS },
        (_, index) => `api-load-scheduled-${Math.floor(index / ROUNDS)}-${index % ROUNDS}`,
      ).sort();
      expect(live.dayState?.runs?.map(({ id }) => id).sort()).toEqual(expectedLiveIds);
      expect(scheduled?.dayState?.runs?.map(({ id }) => id).sort()).toEqual(expectedScheduledIds);
      expect(live.dayState?.runs?.map(({ id }) => id)).not.toContain(expectedScheduledIds[0]);
      expect(scheduled?.dayState?.runs?.map(({ id }) => id)).not.toContain(expectedLiveIds[0]);
      for (let client = 0; client < MAX_CLIENTS; client += 1) {
        for (let round = 0; round < ROUNDS; round += 1) {
          expect(live.runValues?.[`api-load-live-${client}-${round}`]?.casesNeeded).toBe(10 + round);
          expect(scheduled?.runValues?.[`api-load-scheduled-${client}-${round}`]?.casesNeeded).toBe(10 + round);
        }
      }
      expect(scheduledList).toHaveLength(1);
      expect(scheduledList[0]?.date).toBe(SCHEDULED_DATE);
      expect(scheduledList[0]?.runs?.map(({ id }) => id).sort()).toEqual(expectedScheduledIds);
      expect(scheduledList[0]?.runs?.some(({ id }) => expectedLiveIds.includes(id))).toBe(false);

      const inventoryStartedAt = Date.now();
      for (let round = 0; round < ROUNDS; round += 1) {
        await Promise.all(
          Array.from({ length: MAX_CLIENTS }, async (_, client) => {
            const runId = `api-load-live-${client}-${round}`;
            const consume = () => requestJson("/api/inventory/consume", {
              method: "POST",
              body: { runId, lines: [{ itemKey: "ingredient:Dough:batches", qty: 2 }] },
            });
            const [first, retry, adjustment] = await Promise.all([
              consume(),
              consume(),
              requestJson("/api/inventory/adjust", {
                method: "POST",
                manager: true,
                body: { itemId, qtyDelta: -1, note: "bounded API load fixture" },
              }),
            ]) as [
              { applied?: boolean; consumed?: number },
              { applied?: boolean; consumed?: number },
              unknown,
            ];
            expect([first.applied, retry.applied].sort()).toEqual([false, true]);
            expect([first, retry].filter((result) => result.applied)).toHaveLength(1);
            expect([first, retry].filter((result) => result.applied)[0]?.consumed).toBeLessThanOrEqual(1);
            expect(adjustment).toBeTruthy();
            metrics.consumeRequests += 2;
            metrics.adjustmentRequests += 1;
          }),
        );
      }
      metrics.inventoryElapsedMs = Date.now() - inventoryStartedAt;

      const [lots, ledger, consumedRuns] = await Promise.all([
        db.select().from(inventoryLotsTable),
        db.select().from(inventoryLedgerTable),
        db.select().from(inventoryConsumedRunsTable),
      ]);
      const itemLots = lots.filter((lot) => lot.itemId === itemId);
      const itemLedger = ledger.filter((entry) => entry.itemId === itemId);
      const itemClaims = consumedRuns.filter((claim) => claim.runId.startsWith("api-load-live-"));
      const consumeEntries = itemLedger.filter((entry) => entry.type === "consume");
      const adjustmentEntries = itemLedger.filter((entry) => entry.type === "adjust");
      const onHand = itemLots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);
      const ledgerDelta = itemLedger.reduce((sum, entry) => sum + entry.qtyDelta, 0);

      expect(itemLots.every((lot) => lot.qtyRemaining >= 0)).toBe(true);
      expect(onHand).toBeGreaterThanOrEqual(0);
      expect(itemClaims).toHaveLength(MAX_CLIENTS * ROUNDS);
      expect(consumeEntries.length).toBeLessThanOrEqual(MAX_CLIENTS * ROUNDS);
      expect(new Set(consumeEntries.map((entry) => entry.runId)).size).toBe(consumeEntries.length);
      expect(adjustmentEntries).toHaveLength(MAX_CLIENTS * ROUNDS);
      expect(onHand).toBe(24 + ledgerDelta);
      expect(onHand).toBe(0);
      expect(peakConcurrentRequests).toBeGreaterThan(1);
      expect(peakConcurrentRequests).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
      metrics.totalRequests =
        metrics.syncWriteAttempts
        + metrics.syncSnapshotReads
        + metrics.consumeRequests
        + metrics.adjustmentRequests
        + metrics.verificationRequests;
      expect(metrics.syncWrites).toBe(MAX_CLIENTS * ROUNDS * 2);
      expect(metrics.syncWriteAttempts).toBeLessThanOrEqual(
        MAX_CLIENTS * ROUNDS * 2 * MAX_SYNC_WRITE_ATTEMPTS_PER_RUN,
      );
      expect(metrics.syncFallbacks).toBe(metrics.syncWriteAttempts - metrics.syncWrites);
      expect(metrics.syncSnapshotReads).toBe(ROUNDS * 2);
      expect(metrics.totalRequests).toBeLessThanOrEqual(MAX_TOTAL_REQUESTS);
    } catch (error) {
      metrics.assertionFailures = 1;
      throw error;
    } finally {
      metrics.peakConcurrentRequests = peakConcurrentRequests;
      metrics.totalRequests =
        metrics.syncWriteAttempts
        + metrics.syncSnapshotReads
        + metrics.consumeRequests
        + metrics.adjustmentRequests
        + metrics.verificationRequests;
      metrics.durationMs = Math.max(0, Date.now() - workloadStartedAt);
      await writeMetrics();
    }
  }, 180_000);
});
