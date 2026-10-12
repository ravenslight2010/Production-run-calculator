import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";

type DbModule = typeof import("@workspace/db");

let db: DbModule["db"];
let pool: DbModule["pool"];
let serverJobsTable: DbModule["serverJobsTable"];
let serverJobAttemptsTable: DbModule["serverJobAttemptsTable"];
let adminPool: pg.Pool;
let raceClient: pg.Client;
let testDbName: string;
let testDatabaseUrl: string;
let originalDatabaseUrl: string | undefined;
let originalPoolMax: string | undefined;
let ServerJobWorker: typeof import("./serverJobs")["ServerJobWorker"];
let readScheduledEvaluationQueueSnapshot:
  typeof import("./serverJobs")["readScheduledEvaluationQueueSnapshot"];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_scheduled_inventory_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  testDatabaseUrl = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  originalPoolMax = process.env.DATABASE_POOL_MAX;
  process.env.DATABASE_POOL_MAX = "2";
  process.env.DATABASE_URL = testDatabaseUrl;
  const dbMod = await import("@workspace/db");
  const jobsMod = await import("./serverJobs");
  db = dbMod.db;
  pool = dbMod.pool;
  serverJobsTable = dbMod.serverJobsTable;
  serverJobAttemptsTable = dbMod.serverJobAttemptsTable;
  ServerJobWorker = jobsMod.ServerJobWorker;
  readScheduledEvaluationQueueSnapshot = jobsMod.readScheduledEvaluationQueueSnapshot;
  raceClient = new pg.Client({ connectionString: testDatabaseUrl });
  raceClient.on("error", () => {});
  await raceClient.connect();
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (raceClient) await raceClient.end().catch(() => {});
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalPoolMax === undefined) delete process.env.DATABASE_POOL_MAX;
  else process.env.DATABASE_POOL_MAX = originalPoolMax;
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${serverJobAttemptsTable}, ${serverJobsTable}`);
});

describe("scheduled evaluation duplicate inventory worker race", () => {
  it("keeps a worker claim safe while duplicate-bucket inventory is read concurrently", async () => {
    const now = Date.now();
    const bucketStart = Date.parse("2030-04-04T12:00:00.000Z");
    const expiresAt = new Date(now + 60 * 60_000);
    const key = `scheduled-evaluation:live:${bucketStart}`;
    const rows = await db.insert(serverJobsTable).values([
      {
        scope: "live",
        type: "scheduled-evaluation",
        actorId: "race-queued",
        idempotencyKey: key,
        input: { scheduledFor: bucketStart },
        expiresAt,
      },
      {
        scope: "live",
        type: "scheduled-evaluation",
        actorId: "race-leased",
        idempotencyKey: key,
        input: { scheduledFor: bucketStart },
        status: "running",
        attempt: 1,
        maxAttempts: 3,
        leaseToken: "00000000-0000-4000-8000-000000000005",
        leaseExpiresAt: new Date(now + 60_000),
        expiresAt,
      },
    ]).returning();

    await raceClient.query(`
      CREATE OR REPLACE FUNCTION scheduled_inventory_claim_sleep()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status = 'queued' AND NEW.status = 'running' THEN
          PERFORM pg_sleep(0.3);
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER scheduled_inventory_claim_sleep
      BEFORE UPDATE ON server_jobs
      FOR EACH ROW EXECUTE FUNCTION scheduled_inventory_claim_sleep();
    `);
    try {
      const claimPromise = new ServerJobWorker("duplicate-inventory-race-worker").claimNext();
      const deadline = Date.now() + 3_000;
      let workerIsPausedInClaim = false;
      while (Date.now() < deadline) {
        const active = await raceClient.query<{ pid: number }>(`
          SELECT pid::int
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event = 'PgSleep'
          LIMIT 1
        `);
        if (active.rows.length > 0) {
          workerIsPausedInClaim = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(workerIsPausedInClaim).toBe(true);

      const inventory = await readScheduledEvaluationQueueSnapshot(now);
      const claim = await claimPromise;

      expect(inventory.duplicateTimeBucketGroups).toBe(1);
      expect(inventory.duplicateBucketInventory).toHaveLength(1);
      expect(claim?.job.id).toBe(rows[0]?.id);
      expect((await db.select().from(serverJobsTable)).map(({ status }) => status).sort())
        .toEqual(["running", "running"]);
      expect((await db.select().from(serverJobAttemptsTable)).map(({ outcome }) => outcome))
        .toEqual(["running"]);
    } finally {
      await raceClient.query("DROP TRIGGER IF EXISTS scheduled_inventory_claim_sleep ON server_jobs");
      await raceClient.query("DROP FUNCTION IF EXISTS scheduled_inventory_claim_sleep()");
    }
  });
});
