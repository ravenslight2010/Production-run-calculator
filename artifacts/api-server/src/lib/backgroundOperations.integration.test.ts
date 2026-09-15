import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { count, eq, sql } from "drizzle-orm";

type DbModule = typeof import("@workspace/db");

let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let dataResetTable: DbModule["dataResetTable"];
let completedRunHistoryTable: DbModule["completedRunHistoryTable"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryConsumedRunsTable: DbModule["inventoryConsumedRunsTable"];
let serverJobsTable: DbModule["serverJobsTable"];
let serverJobAttemptsTable: DbModule["serverJobAttemptsTable"];
let webPushAlertArmsTable: DbModule["webPushAlertArmsTable"];
let scheduledAlertRecordsTable: DbModule["scheduledAlertRecordsTable"];
let backgroundOperationEventsTable: DbModule["backgroundOperationEventsTable"];

let adminPool: pg.Pool;
let killer: pg.Client;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let originalPoolMax: string | undefined;
let runBackgroundOperation: typeof import("./backgroundOperations")["runBackgroundOperation"];
let isTransientDatabaseConnectionError: typeof import("./backgroundOperations")["isTransientDatabaseConnectionError"];
let clearBackgroundOperationDiagnosticsForTests: typeof import("./backgroundOperations")["clearBackgroundOperationDiagnosticsForTests"];
let getBackgroundOperationDiagnostics: typeof import("./backgroundOperations")["getBackgroundOperationDiagnostics"];
let recordBackgroundOperationFailure: typeof import("./backgroundOperations")["recordBackgroundOperationFailure"];
let BACKGROUND_OPERATION_FAILURE_MAX_EVENTS: typeof import("./backgroundOperations")["BACKGROUND_OPERATION_FAILURE_MAX_EVENTS"];
let BACKGROUND_OPERATION_FAILURE_THRESHOLD: typeof import("./backgroundOperations")["BACKGROUND_OPERATION_FAILURE_THRESHOLD"];
let runDailyRollover: typeof import("../routes/sync")["runDailyRollover"];
let runWebPushAlerts: typeof import("./webPush")["runWebPushAlerts"];
let enqueueScheduledWebPushAlerts: typeof import("./webPush")["enqueueScheduledWebPushAlerts"];
let ServerJobWorker: typeof import("./serverJobs")["ServerJobWorker"];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCOPE = "live" as const;
const ROLLOVER_DATE = "2030-03-11";
const NEXT_DATE = "2030-03-12";
const ROLLOVER_NOW = Date.parse("2030-03-12T06:00:00.000Z");
const ROLLOVER_RUN = "failover-rollover-run";
const ALERT_DATE = "2030-04-01";

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_background_ops_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlString = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlString },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  // Nothing that imports the application database is loaded until this point.
  // This keeps the fixture's pool and every db-bound production helper pointed
  // at the disposable database rather than the developer's configured database.
  process.env.DATABASE_URL = testUrlString;
  // Keep a small application pool so a retry can immediately acquire a fresh
  // backend after the in-flight one is terminated.
  originalPoolMax = process.env.DATABASE_POOL_MAX;
  process.env.DATABASE_POOL_MAX = "2";
  const dbMod = await import("@workspace/db");
  const backgroundMod = await import("./backgroundOperations");
  const syncMod = await import("../routes/sync");
  const jobsMod = await import("./serverJobs");
  const webPushMod = await import("./webPush");

  db = dbMod.db;
  pool = dbMod.pool;
  dailySyncTable = dbMod.dailySyncTable;
  dataResetTable = dbMod.dataResetTable;
  completedRunHistoryTable = dbMod.completedRunHistoryTable;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryConsumedRunsTable = dbMod.inventoryConsumedRunsTable;
  serverJobsTable = dbMod.serverJobsTable;
  serverJobAttemptsTable = dbMod.serverJobAttemptsTable;
  webPushAlertArmsTable = dbMod.webPushAlertArmsTable;
  scheduledAlertRecordsTable = dbMod.scheduledAlertRecordsTable;
  backgroundOperationEventsTable = dbMod.backgroundOperationEventsTable;
  runBackgroundOperation = backgroundMod.runBackgroundOperation;
  isTransientDatabaseConnectionError = backgroundMod.isTransientDatabaseConnectionError;
  clearBackgroundOperationDiagnosticsForTests = backgroundMod.clearBackgroundOperationDiagnosticsForTests;
  getBackgroundOperationDiagnostics = backgroundMod.getBackgroundOperationDiagnostics;
  recordBackgroundOperationFailure = backgroundMod.recordBackgroundOperationFailure;
  BACKGROUND_OPERATION_FAILURE_MAX_EVENTS = backgroundMod.BACKGROUND_OPERATION_FAILURE_MAX_EVENTS;
  BACKGROUND_OPERATION_FAILURE_THRESHOLD = backgroundMod.BACKGROUND_OPERATION_FAILURE_THRESHOLD;
  runDailyRollover = syncMod.runDailyRollover;
  runWebPushAlerts = webPushMod.runWebPushAlerts;
  enqueueScheduledWebPushAlerts = webPushMod.enqueueScheduledWebPushAlerts;
  ServerJobWorker = jobsMod.ServerJobWorker;

  killer = new pg.Client({ connectionString: testUrlString });
  killer.on("error", () => {});
  await killer.connect();
  await killer.query(`
    CREATE OR REPLACE FUNCTION background_ops_sleep_data_reset()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(10);
      RETURN NEW;
    END;
    $$;
  `);
  await killer.query(`
    CREATE OR REPLACE FUNCTION background_ops_sleep_job_claim()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status = 'queued' AND NEW.status = 'running' THEN
        PERFORM pg_sleep(10);
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
}, 60_000);

afterAll(async () => {
  if (clearBackgroundOperationDiagnosticsForTests) {
    await clearBackgroundOperationDiagnosticsForTests();
  }
  if (pool) await pool.end();
  if (killer) await killer.end().catch(() => {});
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalPoolMax === undefined) delete process.env.DATABASE_POOL_MAX;
  else process.env.DATABASE_POOL_MAX = originalPoolMax;
}, 60_000);

beforeEach(async () => {
  await clearBackgroundOperationDiagnosticsForTests();
  await db.execute(sql`
    TRUNCATE
      ${backgroundOperationEventsTable},
      ${scheduledAlertRecordsTable},
      ${webPushAlertArmsTable},
      ${serverJobAttemptsTable},
      ${serverJobsTable},
      ${completedRunHistoryTable},
      ${dailySyncTable},
      ${dataResetTable},
      ${inventoryLedgerTable},
      ${inventoryLotsTable},
      ${inventoryConsumedRunsTable},
      ${inventoryItemsTable}
    RESTART IDENTITY CASCADE
  `);
  await killer.query("DROP TRIGGER IF EXISTS background_ops_data_reset_sleep ON data_reset");
  await killer.query("DROP TRIGGER IF EXISTS background_ops_job_claim_sleep ON server_jobs");
});

async function terminateSleepingBackend(
  queryFragment: string,
  triggerName: string,
  tableName: string,
): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    // The fixture role can see wait_event even when PostgreSQL redacts
    // state/query columns as "disabled"; PgSleep is the precise trigger point.
    const active = await killer.query<{ pid: number }>(`
      SELECT pid::int
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event = 'PgSleep'
      LIMIT 1
    `);
    const pid = active.rows[0]?.pid;
    if (pid !== undefined) {
      const clients = (pool as pg.Pool & { _clients?: pg.Client[] })._clients ?? [];
      clients.find((client) => (client as pg.Client & { processID?: number }).processID === pid)
        ?.on("error", () => {});
      await killer.query("select pg_terminate_backend($1)", [pid]);
      await killer.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName}`);
      const disconnectDeadline = Date.now() + 5_000;
      while (Date.now() < disconnectDeadline) {
        const present = await killer.query<{ pid: number }>(
          "select pid::int from pg_stat_activity where pid = $1",
          [pid],
        );
        if (present.rows.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${queryFragment} trigger backend`);
}

async function pooledBackendPid(): Promise<number> {
  const result = await pool.query<{ pid: number }>("select pg_backend_pid()::int as pid");
  return result.rows[0]!.pid;
}

async function freshBackendPid(): Promise<number> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await pooledBackendPid();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError ?? new Error("Timed out waiting for a fresh pooled backend");
}

async function preserveTransientDatabaseCause<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Drizzle wraps a terminated transaction's failed ROLLBACK and can hide
    // the server SQLSTATE on the outer error. Preserve the real 57P01 cause so
    // runBackgroundOperation exercises its normal transient retry path.
    let candidate: unknown = error;
    for (let depth = 0; depth < 4; depth++) {
      if (isTransientDatabaseConnectionError(candidate)) throw candidate;
      if (!candidate || typeof candidate !== "object" || !("cause" in candidate)) break;
      candidate = (candidate as { cause?: unknown }).cause;
    }
    throw error;
  }
}

describe("background operation PostgreSQL reconnection", () => {
  it("recovers daily rollover on a fresh backend without duplicating completion or inventory effects", async () => {
    await db.insert(dailySyncTable).values([
      {
        date: ROLLOVER_DATE,
        scope: SCOPE,
        data: {
          dayState: {
            date: ROLLOVER_DATE,
            runs: [{ id: ROLLOVER_RUN, startedAt: ROLLOVER_NOW - 3_600_000 }],
          },
          runValues: {
            [ROLLOVER_RUN]: {
              casesNeeded: 0,
              pizzasPerCase: 0,
              casesPerLayer: 0,
              sauceBarrelLbs: 0,
              sauceOzPerPizza: 0,
              app1OzPerPizza: 0,
              app1BatchLbs: 0,
              app1Type: "",
              app2OzPerPizza: 0,
              app2BatchLbs: 0,
              app2Type: "",
              app3OzPerPizza: 0,
              app3BatchLbs: 0,
              app3Type: "",
              app4OzPerPizza: 0,
              app4BatchLbs: 0,
              app4Type: "",
              pep1OzPerPizza: 0,
              pep1Sticks: 4,
              pep1BatchLbs: 0,
              pep1Type: "Pepperoni Stick",
              pep2OzPerPizza: 0,
              pep2Sticks: 0,
              pep2BatchLbs: 0,
              pep2Type: "",
              crustsPerCycle: 0,
              cycleSpeed: 0,
              speedAdjustment: 0,
              doughballWeightOz: 0,
              doughBatchYield: 0,
              cartonsPerCase: 0,
            },
          },
        },
      },
      {
        date: NEXT_DATE,
        scope: SCOPE,
        data: { dayState: { date: NEXT_DATE, runs: [] }, runValues: {} },
      },
    ]);
    const [item] = await db.insert(inventoryItemsTable).values({
      scope: SCOPE,
      key: "ingredient:Pepperoni Stick:lbs",
      category: "ingredient",
      name: "Pepperoni Stick",
      unit: "lbs",
    }).returning();
    await db.insert(inventoryLotsTable).values({
      scope: SCOPE,
      itemId: item.id,
      qtyReceived: 20,
      qtyRemaining: 20,
    });

    await killer.query(`
      CREATE TRIGGER background_ops_data_reset_sleep
      BEFORE INSERT ON data_reset
      FOR EACH ROW EXECUTE FUNCTION background_ops_sleep_data_reset()
    `);
    let retryPid: number | undefined;
    const rolloverOperation = runBackgroundOperation("daily-rollover", () => preserveTransientDatabaseCause(() => runDailyRollover(SCOPE, {
        nowMs: ROLLOVER_NOW,
        timeZone: "America/Chicago",
      })), { delay: async () => { retryPid = await freshBackendPid(); } });
    const terminatedPid = await terminateSleepingBackend(
      "data_reset",
      "background_ops_data_reset_sleep",
      "data_reset",
    );
    const result = await rolloverOperation;
    const recoveredPid = await pooledBackendPid();

    expect(result).toMatchObject({
      fromDate: ROLLOVER_DATE,
      toDate: NEXT_DATE,
      finalizedRuns: 1,
      rolled: true,
    });
    expect(terminatedPid).toBeTypeOf("number");
    expect(retryPid).toBeTypeOf("number");
    expect(retryPid).not.toBe(terminatedPid);
    expect(recoveredPid).not.toBe(terminatedPid);

    const [lot] = await db.select().from(inventoryLotsTable);
    expect(lot.qtyRemaining).toBe(16);
    const [completion] = await db.select().from(completedRunHistoryTable);
    expect(completion).toMatchObject({
      scope: SCOPE,
      operationId: `rollover:${ROLLOVER_DATE}:${ROLLOVER_RUN}`,
      runId: ROLLOVER_RUN,
      date: ROLLOVER_DATE,
    });
    const [consumedRun] = await db.select().from(inventoryConsumedRunsTable);
    expect(consumedRun).toMatchObject({ runId: ROLLOVER_RUN, scope: SCOPE });
    const [ledgerEntry] = await db.select().from(inventoryLedgerTable);
    expect(ledgerEntry).toMatchObject({
      scope: SCOPE,
      itemId: item.id,
      type: "consume",
      qtyDelta: -4,
      runId: ROLLOVER_RUN,
    });

    const duplicate = await runDailyRollover(SCOPE, {
      nowMs: ROLLOVER_NOW + 60_000,
      timeZone: "America/Chicago",
    });
    expect(duplicate).toMatchObject({ rolled: false, epoch: 1 });
    expect((await db.select().from(inventoryLotsTable))[0]!.qtyRemaining).toBe(16);
    expect(await db.select().from(completedRunHistoryTable)).toHaveLength(1);
    expect(await db.select().from(inventoryConsumedRunsTable)).toHaveLength(1);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(1);
  });

  it("recovers server-job scheduled web-push evaluation on a fresh backend with one attempt and one record", async () => {
    const now = Date.now();
    const endedAt = now - 120_000;
    const dueAt = endedAt + 60_000;
    await db.insert(dailySyncTable).values({
      date: ALERT_DATE,
      scope: SCOPE,
      data: {
        dayState: {
          date: ALERT_DATE,
          runs: [{ id: "scheduled-alert-run", startedAt: now - 300_000, endedAt }],
        },
        runValues: { "scheduled-alert-run": { freezerTime: 1 } },
      },
    });

    // Arm the freezer milestone before it is due. The production scheduled
    // handler will then claim the logical record after the milestone passes.
    await runWebPushAlerts(dueAt - 1, { scope: SCOPE, date: ALERT_DATE });
    const queued = await enqueueScheduledWebPushAlerts(now);
    expect(queued).toEqual({ examined: 1, enqueued: 1 });
    expect(await enqueueScheduledWebPushAlerts(now)).toEqual({ examined: 1, enqueued: 0 });

    const worker = new ServerJobWorker("failover-test-worker");
    await killer.query(`
      CREATE TRIGGER background_ops_job_claim_sleep
      BEFORE UPDATE ON server_jobs
      FOR EACH ROW EXECUTE FUNCTION background_ops_sleep_job_claim()
    `);
    let retryPid: number | undefined;
    const workerOperation = runBackgroundOperation("server-job-run", () => preserveTransientDatabaseCause(() => worker.runOnce()), {
      delay: async () => { retryPid = await freshBackendPid(); },
    });
    const terminatedPid = await terminateSleepingBackend(
      "server_jobs",
      "background_ops_job_claim_sleep",
      "server_jobs",
    );
    const ran = await workerOperation;
    const recoveredPid = await pooledBackendPid();

    expect(ran).toBe(true);
    expect(terminatedPid).toBeTypeOf("number");
    expect(retryPid).toBeTypeOf("number");
    expect(retryPid).not.toBe(terminatedPid);
    expect(recoveredPid).not.toBe(terminatedPid);

    const [job] = await db.select().from(serverJobsTable);
    expect(job).toMatchObject({
      scope: SCOPE,
      type: "scheduled-evaluation",
      status: "succeeded",
      attempt: 1,
    });
    expect(await db.select().from(serverJobAttemptsTable)).toHaveLength(1);
    const [jobAttempt] = await db.select().from(serverJobAttemptsTable);
    expect(jobAttempt).toMatchObject({
      jobId: job.id,
      attempt: 1,
      workerId: "failover-test-worker",
      outcome: "succeeded",
    });

    const [record] = await db.select().from(scheduledAlertRecordsTable);
    expect(record).toMatchObject({
      scope: SCOPE,
      date: ALERT_DATE,
      alertKind: "freezerEmpty",
      status: "no-subscriptions",
    });
    expect(await db.select().from(scheduledAlertRecordsTable)).toHaveLength(1);
  });

  it("keeps concurrent shared failure retention capped and visible after local state loss", async () => {
    await db.insert(backgroundOperationEventsTable).values(Array.from(
      { length: BACKGROUND_OPERATION_FAILURE_MAX_EVENTS },
      (_, index) => ({
        operation: "daily-rollover",
        errorCode: `SEED${index}`,
        occurredAt: new Date(Date.now() - index),
      }),
    ));
    await Promise.all(Array.from(
      { length: 10 },
      (_, index) => recordBackgroundOperationFailure(
        "daily-rollover",
        Object.assign(new Error("failed"), { code: `E${index}` }),
      ),
    ));

    await clearBackgroundOperationDiagnosticsForTests({ preserveShared: true });
    const [row] = await db
      .select({ value: count() })
      .from(backgroundOperationEventsTable)
      .where(eq(backgroundOperationEventsTable.operation, "daily-rollover"));
    expect(row?.value).toBe(BACKGROUND_OPERATION_FAILURE_MAX_EVENTS);
    expect((await getBackgroundOperationDiagnostics())["daily-rollover"]).toMatchObject({
      status: "warning",
      recentFailureCount: BACKGROUND_OPERATION_FAILURE_MAX_EVENTS,
    });
  });

  it("bounds shared lock waits and preserves local degradation when persistence times out", async () => {
    const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await locker.connect();
    await locker.query(
      "select pg_advisory_lock(hashtextextended($1, 0))",
      ["background-operation:web-push-schedule"],
    );
    try {
      const startedAt = performance.now();
      for (let index = 0; index < BACKGROUND_OPERATION_FAILURE_THRESHOLD; index += 1) {
        await recordBackgroundOperationFailure(
          "web-push-schedule",
          Object.assign(new Error("unavailable"), { code: "57P03" }),
        );
      }
      expect(performance.now() - startedAt).toBeLessThan(4_000);
      expect((await getBackgroundOperationDiagnostics())["web-push-schedule"]).toMatchObject({
        status: "warning",
        recentFailureCount: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
      });
    } finally {
      await locker.query(
        "select pg_advisory_unlock(hashtextextended($1, 0))",
        ["background-operation:web-push-schedule"],
      ).catch(() => {});
      await locker.end();
    }
  });
});
