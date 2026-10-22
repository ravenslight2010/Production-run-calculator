import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { signLegacyTokenForTests } from "../src/lib/auth";
import { collectDatabaseCapacity } from "../src/lib/databaseCapacity";

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
const READINESS_PROBES_PER_ROUND = 4;
const MAX_CONCURRENT_REQUESTS = 16;
const MAX_SYNC_WRITE_ATTEMPTS_PER_RUN = MAX_CLIENTS;
const READINESS_INSTANCE_COUNT = 2;
const READINESS_ROUNDS = 2;
const READINESS_PROBES_PER_INSTANCE_PER_ROUND = 6;
const READINESS_PROBE_COUNT =
  READINESS_INSTANCE_COUNT * READINESS_ROUNDS * READINESS_PROBES_PER_INSTANCE_PER_ROUND;
const READINESS_SYNC_WRITE_COUNT = READINESS_INSTANCE_COUNT * READINESS_ROUNDS;
const READINESS_MAX_SYNC_WRITE_ATTEMPTS =
  READINESS_SYNC_WRITE_COUNT * MAX_SYNC_WRITE_ATTEMPTS_PER_RUN;
const READINESS_SYNC_SNAPSHOT_READS = READINESS_ROUNDS;
const READINESS_VERIFY_REQUESTS = 1;
const READINESS_DRAIN_PROBES = READINESS_INSTANCE_COUNT;
const MAX_TOTAL_REQUESTS =
  MAX_CLIENTS * ROUNDS * 2 * MAX_SYNC_WRITE_ATTEMPTS_PER_RUN
  + ROUNDS * 2
  + 3
  + MAX_CLIENTS * ROUNDS * 2
  + MAX_CLIENTS * ROUNDS
  + READINESS_PROBES_PER_ROUND * ROUNDS
  + READINESS_PROBE_COUNT
  + READINESS_MAX_SYNC_WRITE_ATTEMPTS
  + READINESS_SYNC_SNAPSHOT_READS
  + READINESS_VERIFY_REQUESTS
  + READINESS_DRAIN_PROBES;
const REQUEST_TIMEOUT_MS = 10_000;
const DATE = "2032-04-09";
const SCHEDULED_DATE = "2032-04-10";
const MANAGER_ID = "api-load-manager";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const METRICS_PATH = resolve(repoRoot, "api-load-workload/metrics.json");
const API_ENTRY_PATH = resolve(repoRoot, "artifacts/api-server/src/index.ts");
const TSX_PATH = resolve(repoRoot, "scripts/node_modules/.bin/tsx");

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
  healthProbeCount: 0,
  healthProbeElapsedMs: 0,
  healthProbeP95Ms: 0,
  readinessInstances: READINESS_INSTANCE_COUNT,
  readinessProbeCount: 0,
  readinessProbeElapsedMs: 0,
  readinessProbeP95Ms: 0,
  readinessSyncWrites: 0,
  readinessSyncWriteAttempts: 0,
  readinessOptionalReadsPerInstance: 0,
  readinessMaxPoolWaitingCount: 0,
  readinessPoolWaitersAtDrain: 0,
  maxPoolWaitingCount: 0,
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
  options: { method?: string; body?: unknown; manager?: boolean; baseUrl?: string } = {},
): Promise<{ body: unknown; headers: Headers }> {
  inFlightRequests += 1;
  peakConcurrentRequests = Math.max(peakConcurrentRequests, inFlightRequests);
  try {
    const response = await fetch(`${options.baseUrl ?? baseUrl}${path}`, {
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
  options: { method?: string; body?: unknown; manager?: boolean; baseUrl?: string } = {},
): Promise<unknown> {
  return (await requestApi(path, options)).body;
}

async function probeReadiness(durations: number[], requestBaseUrl = baseUrl): Promise<void> {
  const startedAt = performance.now();
  try {
    const result = await requestJson("/api/readyz", { baseUrl: requestBaseUrl }) as {
      status?: string;
      checks?: { database?: string; auditProtection?: string };
    };
    expect(result.status).toBe("ok");
    expect(result.checks?.database).toBe("ok");
    expect(result.checks?.auditProtection).toBe("ok");
    metrics.healthProbeCount += 1;
  } finally {
    durations.push(Math.max(0, performance.now() - startedAt));
  }
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

async function readSyncSnapshot(date: string, requestBaseUrl = baseUrl): Promise<string> {
  const path = date === DATE
    ? `/api/sync/today?today=${DATE}`
    : `/api/sync/${date}?today=${DATE}`;
  metrics.syncSnapshotReads += 1;
  const response = await requestApi(path, {
    manager: date !== DATE,
    baseUrl: requestBaseUrl,
  });
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
  requestBaseUrl = baseUrl,
): Promise<void> {
  const path = date === DATE
    ? `/api/sync/today?today=${DATE}&epoch=0`
    : `/api/sync/${date}?today=${DATE}&epoch=0`;
  let baseSnapshotId = initialSnapshotId;
  let payload: Record<string, any> = buildRunPayload(date, runId, client, round, baseSnapshotId);
  for (let attempt = 0; attempt < MAX_SYNC_WRITE_ATTEMPTS_PER_RUN; attempt += 1) {
    metrics.syncWriteAttempts += 1;
    const result = await requestJson(path, {
      method: "PUT",
      manager: date !== DATE,
      baseUrl: requestBaseUrl,
      body: { senderId: `api-load-client-${client}`, payload },
    }) as {
      ok?: boolean;
      stale?: boolean;
      partialFallback?: boolean;
      snapshotId?: string;
      data?: {
        dayState?: { runs?: Array<{ id?: string }> };
        runValues?: Record<string, Record<string, number>>;
      };
    };
    expect(result.stale).not.toBe(true);
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

type ReadinessWorkerMetrics = {
  processId: number;
  databaseChecks: number;
  auditChecks: number;
  backgroundReads: number;
  cacheReads: number;
  poolWaiters: number;
};

type ReadinessApiInstance = {
  child: ChildProcess;
  baseUrl: string;
  logs: string;
  baselineMetrics?: ReadinessWorkerMetrics;
  startError?: string;
};

function readinessWorkerMetrics(headers: Headers): ReadinessWorkerMetrics {
  const readNumber = (name: string): number => {
    const raw = headers.get(name);
    const value = Number(raw);
    if (raw === null || !Number.isInteger(value) || value < 0) {
      throw new Error(`Readiness worker omitted bounded test metric ${name}.`);
    }
    return value;
  };
  return {
    processId: readNumber("x-test-readiness-process"),
    databaseChecks: readNumber("x-test-readiness-database-checks"),
    auditChecks: readNumber("x-test-readiness-audit-checks"),
    backgroundReads: readNumber("x-test-readiness-background-reads"),
    cacheReads: readNumber("x-test-readiness-cache-reads"),
    poolWaiters: readNumber("x-test-readiness-pool-waiters"),
  };
}

async function reserveLoopbackPort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

function appendBoundedLog(instance: ReadinessApiInstance, chunk: Buffer): void {
  instance.logs = `${instance.logs}${chunk.toString("utf8")}`.slice(-64 * 1024);
}

function startReadinessApiInstance(port: number): ReadinessApiInstance {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|SIGNING_KEYS|CREDENTIAL|API_KEY|PRODUCTION|WEBHOOK|(?:SIGNUP|ACCESS|RECOVERY)_?CODE)|^PROD_|^GIT_URL$/iu.test(key)) {
      delete environment[key];
    }
  }
  for (const key of [
    "REPLIT_DEPLOYMENT",
    "REPLIT_ENVIRONMENT",
    "REPLIT_DEPLOYMENT_ID",
    "REPLIT_DEPLOYMENT_TYPE",
    "LOCAL_AI_BASE_URL",
    "LOCAL_AI_STRICT_READINESS",
    "IMPORT_GOLD_LOCAL_ENABLED",
    "IMPORT_GOLD_LOCAL_BASE_URL",
  ]) {
    delete environment[key];
  }
  const child = spawn(TSX_PATH, [API_ENTRY_PATH], {
    cwd: repoRoot,
    env: {
      ...environment,
      NODE_ENV: "test",
      APP_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL,
      AUTH_TOKEN_SECRET: "api-load-workload-test-only",
      PORT: String(port),
      E2E_TEST_DB: "1",
      E2E_APPROVED_DESTRUCTIVE_MODE: "1",
      API_LOAD_TEST_DISPOSABLE_DB: "1",
      API_LOAD_TEST_RUNNER: "1",
      API_LOAD_TEST_METRICS_PATH: METRICS_PATH,
      API_LOAD_READINESS_INSTRUMENTATION: "1",
      API_LOAD_READINESS_OPTIONAL_DELAY_MS: "125",
      DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS: "1",
      MASTER_DATA_HEALTH_STARTUP_DELAY_MS: "21600000",
      MASTER_DATA_HEALTH_SCAN_INTERVAL_MS: "21600000",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const instance: ReadinessApiInstance = {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
    logs: "",
  };
  child.once("error", () => {
    instance.startError = "Readiness API child could not be started.";
  });
  instance.child.stdout?.on("data", (chunk: Buffer) => appendBoundedLog(instance, chunk));
  instance.child.stderr?.on("data", (chunk: Buffer) => appendBoundedLog(instance, chunk));
  return instance;
}

async function waitForReadinessApiInstance(
  instance: ReadinessApiInstance,
  timeoutMs = 60_000,
): Promise<ReadinessWorkerMetrics> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (instance.startError) throw new Error(instance.startError);
    if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
      throw new Error(`Readiness API child exited before becoming ready: ${instance.logs}`);
    }
    try {
      const response = await fetch(`${instance.baseUrl}/api/readyz`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        const body = await response.json() as {
          checks?: { database?: string; auditProtection?: string };
        };
        if (body.checks?.database === "ok" && body.checks.auditProtection === "ok") {
          return readinessWorkerMetrics(response.headers);
        }
      }
    } catch {
      // A newly spawned process may not have bound its port yet.
    }
    await delay(100);
  }
  throw new Error(`Readiness API child did not become ready: ${instance.logs}`);
}

async function waitForChildClose(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve) => {
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      child.off("close", onClose);
      resolve({ code, signal });
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => finish(code, signal);
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolve(null);
    }, timeoutMs);
    child.once("close", onClose);
  });
}

async function stopReadinessApiInstances(
  instances: ReadinessApiInstance[],
): Promise<Array<{ code: number | null; signal: NodeJS.Signals | null }>> {
  for (const instance of instances) {
    if (instance.child.exitCode === null && instance.child.signalCode === null) {
      instance.child.kill("SIGTERM");
    }
  }
  const results = await Promise.all(instances.map(({ child }) => waitForChildClose(child, 8_000)));
  const settled: Array<{ code: number | null; signal: NodeJS.Signals | null }> = [];
  for (let index = 0; index < instances.length; index += 1) {
    if (results[index] !== null) {
      settled.push(results[index]!);
      continue;
    }
    const child = instances[index]!.child;
    child.kill("SIGKILL");
    settled.push((await waitForChildClose(child, 2_000)) ?? {
      code: child.exitCode,
      signal: child.signalCode,
    });
  }
  return settled;
}

async function writeMetrics(): Promise<void> {
  metrics.peakConcurrentRequests = peakConcurrentRequests;
  metrics.durationMs = Math.max(0, Date.now() - workloadStartedAt);
  metrics.totalRequests =
    metrics.syncWriteAttempts
    + metrics.syncSnapshotReads
    + metrics.consumeRequests
    + metrics.adjustmentRequests
    + metrics.verificationRequests
    + metrics.healthProbeCount
    + metrics.readinessProbeCount;
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
  metrics.peakConcurrentRequests = peakConcurrentRequests;
  metrics.totalRequests =
    metrics.syncWriteAttempts
    + metrics.syncSnapshotReads
    + metrics.consumeRequests
    + metrics.adjustmentRequests
    + metrics.verificationRequests
    + metrics.healthProbeCount
    + metrics.readinessProbeCount;
  metrics.durationMs = Math.max(0, Date.now() - workloadStartedAt);
  await writeMetrics();
});

describe("bounded API application workload against disposable PostgreSQL", () => {
  it("preserves live and scheduled sync data while inventory mutations remain consistent", async () => {
    workloadStartedAt = Date.now();
    const healthProbeDurations: number[] = [];
    const poolWaitSampler = setInterval(() => {
      metrics.maxPoolWaitingCount = Math.max(metrics.maxPoolWaitingCount, pool.waitingCount);
    }, 5);
    try {
      const syncStartedAt = Date.now();
      for (let round = 0; round < ROUNDS; round += 1) {
        const [liveSnapshotId, scheduledSnapshotId] = await Promise.all([
          readSyncSnapshot(DATE),
          readSyncSnapshot(SCHEDULED_DATE),
        ]);
        await Promise.all([
          Promise.all(
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
          ),
          Promise.all(
            Array.from({ length: READINESS_PROBES_PER_ROUND }, () =>
              probeReadiness(healthProbeDurations),
            ),
          ),
        ]);
      }
      metrics.syncElapsedMs = Date.now() - syncStartedAt;
      const sortedHealthProbeDurations = [...healthProbeDurations].sort((a, b) => a - b);
      metrics.healthProbeElapsedMs = healthProbeDurations.reduce((sum, duration) => sum + duration, 0);
      metrics.healthProbeP95Ms = Math.ceil(
        sortedHealthProbeDurations.length * 0.95,
      ) > 0
        ? sortedHealthProbeDurations[
          Math.min(sortedHealthProbeDurations.length - 1, Math.ceil(sortedHealthProbeDurations.length * 0.95) - 1)
        ]!
        : 0;

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
        + metrics.verificationRequests
        + metrics.healthProbeCount;
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
      clearInterval(poolWaitSampler);
      metrics.peakConcurrentRequests = peakConcurrentRequests;
      metrics.totalRequests =
        metrics.syncWriteAttempts
        + metrics.syncSnapshotReads
        + metrics.consumeRequests
        + metrics.adjustmentRequests
        + metrics.verificationRequests
        + metrics.healthProbeCount;
      metrics.durationMs = Math.max(0, Date.now() - workloadStartedAt);
      await writeMetrics();
    }
  }, 180_000);

  it("keeps readiness coalesced per API process while both processes accept sync writes", async () => {
    const instances: ReadinessApiInstance[] = [];
    const readinessDurations: number[] = [];
    const syncWritesAtStart = metrics.syncWrites;
    const syncAttemptsAtStart = metrics.syncWriteAttempts;
    const processIds = new Set<number>();
    let shutdownResults: Array<{ code: number | null; signal: NodeJS.Signals | null }> = [];

    try {
      const ports = await Promise.all(
        Array.from({ length: READINESS_INSTANCE_COUNT }, () => reserveLoopbackPort()),
      );
      instances.push(...ports.map(startReadinessApiInstance));
      const startupMetrics = await Promise.all(
        instances.map((instance) => waitForReadinessApiInstance(instance)),
      );
      for (let index = 0; index < instances.length; index += 1) {
        instances[index]!.baselineMetrics = startupMetrics[index]!;
        processIds.add(startupMetrics[index]!.processId);
      }
      expect(processIds.size).toBe(READINESS_INSTANCE_COUNT);

      const syncStartedAt = Date.now();
      for (let round = 0; round < READINESS_ROUNDS; round += 1) {
        const baseSnapshotId = await readSyncSnapshot(DATE, instances[0]!.baseUrl);
        const perInstanceProbeMetrics = instances.map((): ReadinessWorkerMetrics[] => []);
        const probeBatches = instances.map((instance) =>
          Array.from({ length: READINESS_PROBES_PER_INSTANCE_PER_ROUND }, async () => {
            const startedAt = performance.now();
            try {
              const { body, headers } = await requestApi("/api/readyz", {
                baseUrl: instance.baseUrl,
              });
              const result = body as {
                status?: string;
                checks?: { database?: string; auditProtection?: string };
              };
              expect(result.status).toBe("ok");
              expect(result.checks?.database).toBe("ok");
              expect(result.checks?.auditProtection).toBe("ok");
              const observed = readinessWorkerMetrics(headers);
              perInstanceProbeMetrics[instances.indexOf(instance)]!.push(observed);
              metrics.readinessProbeCount += 1;
              return observed;
            } finally {
              readinessDurations.push(Math.max(0, performance.now() - startedAt));
            }
          }),
        );
        await Promise.all([
          ...probeBatches.flat(),
          ...instances.map((instance, index) =>
            writeSyncRun(
              DATE,
              `api-readiness-instance-${index}-${round}`,
              index,
              round,
              baseSnapshotId,
              instance.baseUrl,
            ),
          ),
        ]);

        for (let index = 0; index < instances.length; index += 1) {
          const baseline = instances[index]!.baselineMetrics!;
          const observed = perInstanceProbeMetrics[index]!;
          expect(observed).toHaveLength(READINESS_PROBES_PER_INSTANCE_PER_ROUND);
          expect(observed.every((entry) => entry.processId === baseline.processId)).toBe(true);
          expect(Math.max(...observed.map((entry) => entry.databaseChecks))).toBe(
            baseline.databaseChecks +
              (round + 1) * READINESS_PROBES_PER_INSTANCE_PER_ROUND,
          );
          expect(Math.max(...observed.map((entry) => entry.auditChecks))).toBe(
            baseline.auditChecks +
              (round + 1) * READINESS_PROBES_PER_INSTANCE_PER_ROUND,
          );
          expect(Math.max(...observed.map((entry) => entry.backgroundReads))).toBe(
            baseline.backgroundReads + round + 1,
          );
          expect(Math.max(...observed.map((entry) => entry.cacheReads))).toBe(
            baseline.cacheReads + round + 1,
          );
          metrics.readinessMaxPoolWaitingCount = Math.max(
            metrics.readinessMaxPoolWaitingCount,
            ...observed.map((entry) => entry.poolWaiters),
          );
        }
      }
      metrics.syncElapsedMs += Date.now() - syncStartedAt;

      const verification = await requestApi(`/api/sync/today?today=${DATE}`, {
        baseUrl: instances[0]!.baseUrl,
      });
      metrics.verificationRequests += 1;
      const canonical = verification.body as {
        dayState?: { runs?: Array<{ id: string }> };
        runValues?: Record<string, Record<string, number>>;
      };
      const expectedRunIds = Array.from(
        { length: READINESS_SYNC_WRITE_COUNT },
        (_, index) =>
          `api-readiness-instance-${Math.floor(index / READINESS_ROUNDS)}-${index % READINESS_ROUNDS}`,
      ).sort();
      const actualRunIds = (canonical.dayState?.runs ?? [])
        .map(({ id }) => id)
        .filter((id) => id.startsWith("api-readiness-instance-"));
      expect(actualRunIds.sort()).toEqual(expectedRunIds);
      expect(new Set(actualRunIds).size).toBe(READINESS_SYNC_WRITE_COUNT);
      for (let index = 0; index < READINESS_INSTANCE_COUNT; index += 1) {
        for (let round = 0; round < READINESS_ROUNDS; round += 1) {
          expect(
            canonical.runValues?.[`api-readiness-instance-${index}-${round}`]?.casesNeeded,
          ).toBe(10 + round);
        }
      }

      const drainMetrics = await Promise.all(instances.map(async (instance) => {
        const startedAt = performance.now();
        try {
          const { body, headers } = await requestApi("/api/readyz", {
            baseUrl: instance.baseUrl,
          });
          expect((body as { status?: string }).status).toBe("ok");
          metrics.readinessProbeCount += 1;
          const observed = readinessWorkerMetrics(headers);
          const baseline = instance.baselineMetrics!;
          expect(observed.processId).toBe(baseline.processId);
          expect(observed.databaseChecks).toBe(
            baseline.databaseChecks +
              READINESS_ROUNDS * READINESS_PROBES_PER_INSTANCE_PER_ROUND + 1,
          );
          expect(observed.auditChecks).toBe(
            baseline.auditChecks +
              READINESS_ROUNDS * READINESS_PROBES_PER_INSTANCE_PER_ROUND + 1,
          );
          expect(observed.backgroundReads).toBe(baseline.backgroundReads + READINESS_ROUNDS + 1);
          expect(observed.cacheReads).toBe(baseline.cacheReads + READINESS_ROUNDS + 1);
          return observed;
        } finally {
          readinessDurations.push(Math.max(0, performance.now() - startedAt));
        }
      }));
      metrics.readinessOptionalReadsPerInstance = READINESS_ROUNDS + 1;
      metrics.readinessPoolWaitersAtDrain = Math.max(
        ...drainMetrics.map((entry) => entry.poolWaiters),
      );
      metrics.readinessMaxPoolWaitingCount = Math.max(
        metrics.readinessMaxPoolWaitingCount,
        ...drainMetrics.map((entry) => entry.poolWaiters),
      );
      expect(metrics.readinessPoolWaitersAtDrain).toBe(0);
      expect(metrics.readinessProbeCount).toBe(READINESS_PROBE_COUNT + READINESS_DRAIN_PROBES);
      expect(readinessDurations).toHaveLength(metrics.readinessProbeCount);

      const sortedProbeDurations = [...readinessDurations].sort((left, right) => left - right);
      metrics.readinessProbeElapsedMs = readinessDurations.reduce((sum, value) => sum + value, 0);
      metrics.readinessProbeP95Ms = sortedProbeDurations[
        Math.max(0, Math.ceil(sortedProbeDurations.length * 0.95) - 1)
      ] ?? 0;
      metrics.readinessSyncWrites = metrics.syncWrites - syncWritesAtStart;
      metrics.readinessSyncWriteAttempts = metrics.syncWriteAttempts - syncAttemptsAtStart;
      expect(metrics.readinessSyncWrites).toBe(READINESS_SYNC_WRITE_COUNT);
      expect(metrics.readinessSyncWriteAttempts).toBeGreaterThanOrEqual(READINESS_SYNC_WRITE_COUNT);
      expect(metrics.readinessSyncWriteAttempts).toBeLessThanOrEqual(
        READINESS_MAX_SYNC_WRITE_ATTEMPTS,
      );
      expect(metrics.readinessMaxPoolWaitingCount).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
      expect(metrics.readinessProbeP95Ms).toBeLessThan(REQUEST_TIMEOUT_MS);
    } catch (error) {
      metrics.assertionFailures = 1;
      throw error;
    } finally {
      shutdownResults = await stopReadinessApiInstances(instances);
      metrics.totalRequests =
        metrics.syncWriteAttempts
        + metrics.syncSnapshotReads
        + metrics.consumeRequests
        + metrics.adjustmentRequests
        + metrics.verificationRequests
        + metrics.healthProbeCount
        + metrics.readinessProbeCount;
      await writeMetrics();
    }

    expect(shutdownResults).toEqual(
      Array.from({ length: READINESS_INSTANCE_COUNT }, () => ({ code: 0, signal: null })),
    );
  }, 180_000);

  it("attributes a controlled PostgreSQL lock wait without exposing query text", async () => {
    const blocker = await pool.connect();
    const waiter = await pool.connect();
    const lockKey = "3463202610";
    let lockAcquired = false;
    let waitingQuery: Promise<unknown> | undefined;

    try {
      await blocker.query("SELECT pg_advisory_lock($1::bigint)", [lockKey]);
      lockAcquired = true;
      waitingQuery = waiter.query("SELECT pg_advisory_lock($1::bigint)", [lockKey]);
      void waitingQuery.catch(() => undefined);

      const deadline = Date.now() + 2_500;
      let measurement: Awaited<ReturnType<typeof collectDatabaseCapacity>> | undefined;
      while (Date.now() < deadline) {
        measurement = await collectDatabaseCapacity(pool);
        if (
          measurement.status === "observed" &&
          measurement.lockWaitingBackends >= 1 &&
          measurement.activeWaitingBackends >= 1
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(measurement).toMatchObject({ status: "observed" });
      expect(measurement?.activeWaitingBackends).toBeGreaterThanOrEqual(1);
      expect(measurement?.lockWaitingBackends).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(measurement)).not.toMatch(/pg_advisory_lock|3463202610|queryText|pid/i);
    } finally {
      try {
        if (lockAcquired) {
          await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
        }
      } finally {
        try {
          if (waitingQuery) await waitingQuery;
        } finally {
          waiter.release();
          blocker.release();
        }
      }
    }

    expect(pool.waitingCount).toBe(0);
  }, 15_000);
});
