// Route-level regression coverage for user-requested server jobs.
//
// The first request deliberately loses its database connection after the
// idempotent insert has committed and before the HTTP confirmation is sent.
// The retry must therefore recover by reading the committed row rather than
// creating a second job.
//
// This suite creates and drops its own PostgreSQL database. It never points the
// application pool at the configured database until after the throwaway schema
// has been created, and it uses only synthetic users and job input.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express, type Response as ExpressResponse } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import pg from "pg";
import { signLegacyTokenForTests } from "../lib/auth";
import { assertIsolatedConcurrencyTrial, runIsolatedBackgroundConcurrencyTrial } from "../lib/isolatedBackgroundConcurrencyTrial";
import {
  stopIsolatedApiProcess,
  waitForIsolatedApiProcess,
  type IsolatedApiProcess,
} from "./serverJobsProcess";

type DbModule = typeof import("@workspace/db");
const concurrencyTrial = process.env.RUN_ISOLATED_BACKGROUND_CONCURRENCY_TRIAL === "1";
if (concurrencyTrial) assertIsolatedConcurrencyTrial("1", process.env.NODE_ENV, process.env.DATABASE_URL);

let db: DbModule["db"];
let pool: DbModule["pool"];
let serverJobsTable: DbModule["serverJobsTable"];
let serverJobAttemptsTable: DbModule["serverJobAttemptsTable"];
let scheduledJobCleanupPlansTable: DbModule["scheduledJobCleanupPlansTable"];
let auditLogsTable: DbModule["auditLogsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;
let clearSandboxCache: () => void;
let readScheduledEvaluationQueueSnapshot: typeof import("../lib/serverJobs")["readScheduledEvaluationQueueSnapshot"];
let ServerJobWorker: typeof import("../lib/serverJobs")["ServerJobWorker"];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

let adminPool: pg.Pool;
let killer: pg.Client;
let testDbName: string;
let testDatabaseUrl: string;
let originalDatabaseUrl: string | undefined;
let originalPoolMax: string | undefined;
let server: Server;
let baseUrl: string;
const apiProcessEntrypoint = path.resolve(repoRoot, "scripts/node_modules/.bin/tsx");
const apiProcessFixture = fileURLToPath(new URL("./serverJobs.process.fixture.ts", import.meta.url));
let confirmationLoss: Promise<number> | undefined;
let loseFirstConfirmation = false;
const ACTOR = "route-job-actor";
const OTHER_LIVE_ACTOR = "route-job-other-live-actor";
const SANDBOX_ACTOR = "route-job-sandbox-actor";
const OTHER_SANDBOX_ACTOR = "route-job-other-sandbox-actor";
const OPERATOR_ACTOR = "route-job-operator";
const IDEMPOTENCY_KEY = "route-job-confirmation-lost";
const SENSITIVE_IDEMPOTENCY_KEY = "job-sensitive-input-001";
const JOB_BODY = {
  type: "workbook-parse",
  idempotencyKey: IDEMPOTENCY_KEY,
  input: { workbookText: "synthetic disposable route fixture" },
};

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_server_jobs_route_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlString = testUrl.toString();
  testDatabaseUrl = testUrlString;
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlString },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  // A single application connection makes the backend used by the route the
  // same backend checked out by loseCommittedReply after the insert completes.
  originalPoolMax = process.env.DATABASE_POOL_MAX;
  process.env.DATABASE_POOL_MAX = concurrencyTrial ? "4" : "1";
  process.env.DATABASE_URL = testUrlString;

  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const jobsMod = await import("../lib/serverJobs");
  const rolesMod = await import("../lib/roles");
  const userValidityMod = await import("../lib/userValidity");
  const sandboxMod = await import("../lib/sandbox");
  db = dbMod.db;
  pool = dbMod.pool;
  serverJobsTable = dbMod.serverJobsTable;
  serverJobAttemptsTable = dbMod.serverJobAttemptsTable;
  scheduledJobCleanupPlansTable = dbMod.scheduledJobCleanupPlansTable;
  auditLogsTable = dbMod.auditLogsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = rolesMod.seedRoles;
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  clearSandboxCache = sandboxMod.clearSandboxCache;
  readScheduledEvaluationQueueSnapshot = jobsMod.readScheduledEvaluationQueueSnapshot;
  ServerJobWorker = jobsMod.ServerJobWorker;

  killer = new pg.Client({ connectionString: testUrlString });
  killer.on("error", () => {});
  await killer.connect();

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));

  // The real API router is mounted below a small response fault injector. The
  // injector waits until the route calls res.json (the insert has already
  // returned and auto-committed), terminates the just-released DB backend, and
  // destroys the HTTP response so the client experiences a lost confirmation.
  app.use((req, res, next) => {
    if (req.method !== "POST" || req.url !== "/api/server-jobs" || !loseFirstConfirmation) {
      next();
      return;
    }
    res.json = ((body: unknown) => {
      loseFirstConfirmation = false;
      confirmationLoss = loseCommittedReply();
      void confirmationLoss.then(
        () => res.destroy(),
        () => res.destroy(),
      );
      return res;
    }) as ExpressResponse["json"];
    next();
  });
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", routerMod.default);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  if (killer) await killer.end().catch(() => {});
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalPoolMax === undefined) delete process.env.DATABASE_POOL_MAX;
  else process.env.DATABASE_POOL_MAX = originalPoolMax;
}, 60_000);

beforeEach(async () => {
  loseFirstConfirmation = false;
  confirmationLoss = undefined;
  clearUserValidityCache();
  await db.execute(sql`
    TRUNCATE ${serverJobsTable}, ${serverJobAttemptsTable}, ${scheduledJobCleanupPlansTable},
      ${userRolesTable}, ${usersTable}, ${rolesTable}
    RESTART IDENTITY CASCADE
  `);
  await seedRoles();
  clearSandboxCache();
  await db.insert(usersTable).values([
    {
      id: ACTOR,
      username: "route-job-actor",
      passwordHash: "synthetic-test-password-hash",
      sandbox: false,
    },
    {
      id: OTHER_LIVE_ACTOR,
      username: "route-job-other-live-actor",
      passwordHash: "synthetic-test-password-hash",
      sandbox: false,
    },
    {
      id: SANDBOX_ACTOR,
      username: "route-job-sandbox-actor",
      passwordHash: "synthetic-test-password-hash",
      sandbox: true,
    },
    {
      id: OTHER_SANDBOX_ACTOR,
      username: "route-job-other-sandbox-actor",
      passwordHash: "synthetic-test-password-hash",
      sandbox: true,
    },
    {
      id: OPERATOR_ACTOR,
      username: "route-job-operator",
      passwordHash: "synthetic-test-password-hash",
    },
  ]);
  await db.insert(userRolesTable).values([
    { userId: ACTOR, role: "manager" },
    { userId: OTHER_LIVE_ACTOR, role: "manager" },
    { userId: SANDBOX_ACTOR, role: "manager" },
    { userId: OTHER_SANDBOX_ACTOR, role: "manager" },
    { userId: OPERATOR_ACTOR, role: "operator" },
  ]);
});

it.runIf(concurrencyTrial)("isolated background concurrency trial preserves protected jobs and reports both settings", async () => {
  const jobs = await import("../lib/serverJobs");
  const result = await runIsolatedBackgroundConcurrencyTrial({
    optIn: process.env.RUN_ISOLATED_BACKGROUND_CONCURRENCY_TRIAL,
    nodeEnv: process.env.NODE_ENV,
    parentDatabaseUrl: originalDatabaseUrl,
    databaseName: testDbName, actorId: ACTOR, pool, db, jobsTable: serverJobsTable,
    attemptsTable: serverJobAttemptsTable, jobs,
  });
  for (const metrics of [result.baseline, result.trial]) {
    expect(metrics).toMatchObject({
      succeeded: 10, cancelled: 1, failed: 0, pending: 0,
      acquisitionFailures: 0, duplicateEffects: 0, effectMismatches: 0, retryAttempts: 2, stoppedCleanly: true,
    });
    expect(metrics.eventLoopDelayMaxMs).not.toBeNull();
    expect(metrics.reminderLatencyMs).not.toBeNull();
  }
  expect(result.baseline.concurrency).toBe(2);
  expect(result.trial.concurrency).toBe(1);
  // Preserve bounded numeric evidence even when Vitest suppresses console logs.
  process.stdout.write(`ISOLATED_CONCURRENCY_METRICS=${JSON.stringify(result)}\n`);
}, 30_000);


async function loseCommittedReply(): Promise<number> {
  const result = await pool.query<{ pid: number }>("select pg_backend_pid()::int as pid");
  const pid = result.rows[0]!.pid;
  const clients = (pool as pg.Pool & { _clients?: pg.Client[] })._clients ?? [];
  clients.find((client) => (client as pg.Client & { processID?: number }).processID === pid)
    ?.on("error", () => {});

  await killer.query("select pg_terminate_backend($1)", [pid]);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const present = await killer.query<{ pid: number }>(
      "select pid::int from pg_stat_activity where pid = $1",
      [pid],
    );
    if (present.rows.length === 0) return pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out terminating committed route backend ${pid}`);
}

function headers(actorId = ACTOR): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${signLegacyTokenForTests(actorId)}`,
  };
}

async function submitJob(
  actorId = ACTOR,
  body: Record<string, unknown> = JOB_BODY,
): Promise<globalThis.Response> {
  return submitJobAt(baseUrl, actorId, body);
}

async function submitJobAt(
  url: string,
  actorId = ACTOR,
  body: Record<string, unknown> = JOB_BODY,
): Promise<globalThis.Response> {
  return fetch(`${url}/api/server-jobs`, {
    method: "POST",
    headers: headers(actorId),
    body: JSON.stringify(body),
  });
}

async function createCleanupPlan(actorId = ACTOR): Promise<Response> {
  return fetch(`${baseUrl}/api/server-jobs/scheduled-evaluation-cleanup/plans`, {
    method: "POST",
    headers: headers(actorId),
    body: "{}",
  });
}

async function applyCleanupPlan(
  plan: { planId: string; manifestDigest: string },
  actorId = ACTOR,
  reason = "Owner-approved duplicate cleanup",
): Promise<Response> {
  return fetch(`${baseUrl}/api/server-jobs/scheduled-evaluation-cleanup/plans/${plan.planId}/apply`, {
    method: "POST",
    headers: headers(actorId),
    body: JSON.stringify({ manifestDigest: plan.manifestDigest, reason }),
  });
}

async function startIsolatedApiProcess(): Promise<{
  child: IsolatedApiProcess;
  url: string;
}> {
  const child = spawn(apiProcessEntrypoint, [apiProcessFixture], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl, DATABASE_POOL_MAX: "2" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return waitForIsolatedApiProcess(child);
}

describe("server job route idempotency", () => {
  it("replays one committed user job when its creation confirmation is lost", async () => {
    loseFirstConfirmation = true;
    const firstRequest = submitJob();
    await expect(firstRequest).rejects.toThrow();

    // The response injector only destroys the socket after the database backend
    // has been terminated. Awaiting it proves the fault happened after commit,
    // not before the insert.
    const loss = confirmationLoss;
    expect(loss).toBeDefined();
    await loss;

    const retry = await submitJob();
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as {
      id: string;
      status: string;
      idempotentReplay: boolean;
    };
    expect(retryBody).toMatchObject({
      status: "queued",
      idempotentReplay: true,
    });

    const jobs = await db.select().from(serverJobsTable).where(and(
      eq(serverJobsTable.scope, "live"),
      eq(serverJobsTable.actorId, ACTOR),
      eq(serverJobsTable.idempotencyKey, IDEMPOTENCY_KEY),
    ));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: retryBody.id,
      scope: "live",
      actorId: ACTOR,
      type: "workbook-parse",
      idempotencyKey: IDEMPOTENCY_KEY,
      status: "queued",
    });
  });

  it("returns one canonical job when identical submissions arrive concurrently", async () => {
    const instances = Array.from({ length: 12 }, () => ({ url: baseUrl }));
    const responses = await Promise.all(
      instances.map(({ url }) => submitJobAt(url)),
    );

    expect(
      responses.every((candidate) => candidate.status === 200 || candidate.status === 202),
    ).toBe(true);
    const responseBodies = await Promise.all(responses.map(async (candidate) => (
      await candidate.json() as {
        id: string;
        status: string;
        idempotentReplay: boolean;
      }
    )));
    const responseIds = responseBodies.map((body) => body.id);
    expect(responseIds).toHaveLength(12);
    expect(new Set(responseIds)).toHaveLength(1);
    expect(responseIds[0]).toEqual(expect.any(String));
    expect(responseBodies.every((body) => body.status === "queued")).toBe(true);

    const jobs = await db.select().from(serverJobsTable).where(and(
      eq(serverJobsTable.scope, "live"),
      eq(serverJobsTable.actorId, ACTOR),
      eq(serverJobsTable.idempotencyKey, IDEMPOTENCY_KEY),
    ));
    expect(jobs).toHaveLength(1);
    expect(responseBodies.every((body) => body.id === jobs[0]!.id)).toBe(true);
    expect(responseBodies.filter((body) => body.idempotentReplay)).toHaveLength(11);
  });

  it("rejects sensitive workbook job input before it is queued", async () => {
    const response = await submitJob(ACTOR, {
      ...JOB_BODY,
      idempotencyKey: SENSITIVE_IDEMPOTENCY_KEY,
      input: {
        workbookText: "Brand\tFlavor",
        logs: ["Bearer must-not-leave"],
      } as Record<string, unknown>,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Sensitive or unrelated fields are not allowed in AI requests",
    });
    const jobs = await db.select().from(serverJobsTable).where(and(
      eq(serverJobsTable.scope, "live"),
      eq(serverJobsTable.actorId, ACTOR),
      eq(serverJobsTable.idempotencyKey, SENSITIVE_IDEMPOTENCY_KEY),
    ));
    expect(jobs).toHaveLength(0);
  });

  it("isolates identical keys by actor and by live or sandbox scope", async () => {
    const actors = [
      { id: ACTOR, scope: "live" },
      { id: OTHER_LIVE_ACTOR, scope: "live" },
      { id: SANDBOX_ACTOR, scope: "sandbox" },
      { id: OTHER_SANDBOX_ACTOR, scope: "sandbox" },
    ] as const;

    const created = await Promise.all(actors.map(async ({ id }) => {
      const result = await submitJob(id);
      expect(result.status).toBe(202);
      return {
        actorId: id,
        body: await result.json() as { id: string; idempotentReplay: boolean },
      };
    }));

    expect(created.every(({ body }) => !body.idempotentReplay)).toBe(true);
    expect(new Set(created.map(({ body }) => body.id))).toHaveLength(actors.length);

    for (const { actorId, body } of created) {
      const replay = await submitJob(actorId);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({
        id: body.id,
        idempotentReplay: true,
      });
    }

    for (const { actorId, body } of created) {
      const list = await fetch(`${baseUrl}/api/server-jobs`, {
        headers: headers(actorId),
      });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual([
        expect.objectContaining({ id: body.id }),
      ]);

      for (const other of created) {
        if (other.actorId === actorId) continue;

        const detail = await fetch(`${baseUrl}/api/server-jobs/${other.body.id}`, {
          headers: headers(actorId),
        });
        expect(detail.status).toBe(404);

        const cancel = await fetch(`${baseUrl}/api/server-jobs/${other.body.id}/cancel`, {
          method: "POST",
          headers: headers(actorId),
          body: "{}",
        });
        expect(cancel.status).toBe(404);
      }
    }

    const persisted = await db.select({
      id: serverJobsTable.id,
      scope: serverJobsTable.scope,
      actorId: serverJobsTable.actorId,
      idempotencyKey: serverJobsTable.idempotencyKey,
    }).from(serverJobsTable).where(eq(serverJobsTable.idempotencyKey, IDEMPOTENCY_KEY));
    expect(persisted).toHaveLength(actors.length);
    expect(persisted).toEqual(expect.arrayContaining(actors.map(({ id, scope }) => (
      expect.objectContaining({
        scope,
        actorId: id,
        idempotencyKey: IDEMPOTENCY_KEY,
      })
    ))));
  });

  it("returns one canonical job across isolated API processes", async () => {
    const startup = await Promise.allSettled([
      startIsolatedApiProcess(),
      startIsolatedApiProcess(),
    ]);
    const instances = startup.flatMap((result) => (
      result.status === "fulfilled" ? [result.value] : []
    ));
    const startupFailure = startup.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (startupFailure) {
      await Promise.all(instances.map(({ child }) => stopIsolatedApiProcess(child)));
      throw startupFailure.reason;
    }

    try {
      const responses = await Promise.all(
        instances.map(({ url }) => submitJobAt(url)),
      );

      expect(
        responses.every((candidate) => candidate.status === 200 || candidate.status === 202),
      ).toBe(true);
      const responseBodies = await Promise.all(responses.map(async (candidate) => (
        await candidate.json() as {
          id: string;
          status: string;
          idempotentReplay: boolean;
        }
      )));
      expect(new Set(responseBodies.map((body) => body.id))).toHaveLength(1);
      expect(responseBodies.every((body) => body.status === "queued")).toBe(true);

      const jobs = await db.select().from(serverJobsTable).where(and(
        eq(serverJobsTable.scope, "live"),
        eq(serverJobsTable.actorId, ACTOR),
        eq(serverJobsTable.idempotencyKey, IDEMPOTENCY_KEY),
      ));
      expect(jobs).toHaveLength(1);
      expect(responseBodies.every((body) => body.id === jobs[0]!.id)).toBe(true);
      expect(responseBodies.filter((body) => body.idempotentReplay)).toHaveLength(1);
    } finally {
      await Promise.all(instances.map(({ child }) => stopIsolatedApiProcess(child)));
    }
  }, 90_000);

  it("inventories duplicate scheduled buckets without mutating rows or audit records", async () => {
    const now = Date.now();
    const bucketStart = Date.parse("2030-04-02T12:00:00.000Z");
    const expiresAt = new Date(now + 60 * 60_000);
    const key = `scheduled-evaluation:live:${bucketStart}`;
    const rows = await db.insert(serverJobsTable).values([
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-queued", idempotencyKey: key,
        input: { scheduledFor: bucketStart }, expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-leased", idempotencyKey: key,
        input: { scheduledFor: bucketStart }, status: "running", attempt: 1, maxAttempts: 3,
        leaseToken: "00000000-0000-4000-8000-000000000002", leaseExpiresAt: new Date(now + 60_000), expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-retryable", idempotencyKey: key,
        input: { scheduledFor: bucketStart }, status: "running", attempt: 1, maxAttempts: 3,
        leaseToken: "00000000-0000-4000-8000-000000000003", leaseExpiresAt: new Date(now - 1), expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-expired-without-token", idempotencyKey: key,
        input: { scheduledFor: bucketStart }, status: "running", attempt: 1, maxAttempts: 3,
        leaseExpiresAt: new Date(now - 1), expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-exhausted", idempotencyKey: key,
        input: { scheduledFor: bucketStart }, status: "running", attempt: 3, maxAttempts: 3,
        leaseToken: "00000000-0000-4000-8000-000000000004", leaseExpiresAt: new Date(now - 1), expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-terminal", idempotencyKey: key,
        input: { scheduledFor: bucketStart }, status: "succeeded", finishedAt: new Date(now), expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-no-lease-a",
        idempotencyKey: `scheduled-evaluation:live:${bucketStart + 180_000}`,
        input: { scheduledFor: bucketStart + 180_000 }, status: "running", attempt: 1, maxAttempts: 3, expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-no-lease-b",
        idempotencyKey: `scheduled-evaluation:live:${bucketStart + 180_000}`,
        input: { scheduledFor: bucketStart + 180_000 }, status: "running", attempt: 1, maxAttempts: 3, expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-exhausted-queued-a",
        idempotencyKey: `scheduled-evaluation:live:${bucketStart + 240_000}`,
        input: { scheduledFor: bucketStart + 240_000 }, attempt: 3, maxAttempts: 3, expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-exhausted-queued-b",
        idempotencyKey: `scheduled-evaluation:live:${bucketStart + 240_000}`,
        input: { scheduledFor: bucketStart + 240_000 }, attempt: 3, maxAttempts: 3, expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-terminal-success",
        idempotencyKey: `scheduled-evaluation:live:${bucketStart + 300_000}`,
        input: { scheduledFor: bucketStart + 300_000 }, status: "succeeded", finishedAt: new Date(now), expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-terminal-cancelled",
        idempotencyKey: `scheduled-evaluation:live:${bucketStart + 300_000}`,
        input: { scheduledFor: bucketStart + 300_000 }, status: "cancelled", finishedAt: new Date(now), expiresAt,
      },
    ]).returning();
    const auditCountBefore = (await db.select({ value: count() }).from(auditLogsTable))[0]?.value;
    const rowState = (await db.select({
      id: serverJobsTable.id,
      status: serverJobsTable.status,
      leaseToken: serverJobsTable.leaseToken,
      leaseExpiresAt: serverJobsTable.leaseExpiresAt,
    }).from(serverJobsTable)).sort((left, right) => left.id.localeCompare(right.id));

    const snapshot = await readScheduledEvaluationQueueSnapshot(now);
    const repeated = await readScheduledEvaluationQueueSnapshot(now);
    const mixedState = snapshot.duplicateBucketInventory.find((group) => group.rowCount === 6);

    expect(mixedState).toMatchObject({
      statuses: { queued: 1, running: 4, succeeded: 1, failed: 0, cancelled: 0 },
      queuedRunnable: 1,
      runningWithValidLease: 1,
      runningWithoutLease: 1,
      runningLeaseExpiredRetryable: 2,
      runningLeaseExpiredExhausted: 1,
      candidateCounts: {
        preserveQueuedRunnable: 1,
        preserveValidLease: 1,
        preserveExpiredRetryableLease: 2,
        workerResolutionRequired: 1,
        manualReviewRequired: 0,
        preserveTerminalHistory: 1,
        safeRemoval: 0,
      },
      reviewClass: "preserve_runnable_or_leased",
    });
    expect(snapshot.duplicateBucketInventory.map(({ reviewClass }) => reviewClass)).toEqual(
      expect.arrayContaining([
        "manual_review_required",
        "preserve_runnable_or_leased",
        "worker_resolution_required",
        "terminal_only",
      ]),
    );
    expect(snapshot.duplicateBucketInventory).toEqual(repeated.duplicateBucketInventory);
    expect(snapshot.duplicateBucketInventory.every((group) => group.candidateCounts.safeRemoval === 0)).toBe(true);
    expect(snapshot.duplicateBucketInventoryTruncated).toBe(false);
    expect(JSON.stringify(snapshot)).not.toMatch(/legacy-|idempotencyKey|scheduledFor|scope/i);
    expect((await db.select({ value: count() }).from(serverJobAttemptsTable))[0]?.value).toBe(0);
    expect((await db.select({ value: count() }).from(auditLogsTable))[0]?.value).toBe(auditCountBefore);
    expect((await db.select({
      id: serverJobsTable.id,
      status: serverJobsTable.status,
      leaseToken: serverJobsTable.leaseToken,
      leaseExpiresAt: serverJobsTable.leaseExpiresAt,
    }).from(serverJobsTable)).sort((left, right) => left.id.localeCompare(right.id))).toEqual(rowState);
    expect(rows).toHaveLength(12);
  });

  it("keeps duplicate work claimable by a worker after an inventory read", async () => {
    const now = Date.now();
    const bucketStart = Date.parse("2030-04-04T12:00:00.000Z");
    const expiresAt = new Date(now + 60 * 60_000);
    const key = `scheduled-evaluation:live:${bucketStart}`;
    const rows = await db.insert(serverJobsTable).values([
      {
        scope: "live", type: "scheduled-evaluation", actorId: "race-queued", idempotencyKey: key,
        input: { scheduledFor: bucketStart }, expiresAt,
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "race-leased", idempotencyKey: key,
        input: { scheduledFor: bucketStart }, status: "running", attempt: 1, maxAttempts: 3,
        leaseToken: "00000000-0000-4000-8000-000000000005", leaseExpiresAt: new Date(now + 60_000), expiresAt,
      },
    ]).returning();
    const auditCountBefore = (await db.select({ value: count() }).from(auditLogsTable))[0]?.value;

    const [inventory, claim] = await Promise.all([
      readScheduledEvaluationQueueSnapshot(now),
      new ServerJobWorker("duplicate-inventory-race-worker").claimNext(),
    ]);

    expect(inventory.duplicateTimeBucketGroups).toBe(1);
    expect(claim?.job.id).toBe(rows[0]?.id);
    expect((await db.select().from(serverJobsTable)).map(({ status }) => status).sort())
      .toEqual(["running", "running"]);
    expect((await db.select({ value: count() }).from(serverJobAttemptsTable))[0]?.value).toBe(1);
    expect((await db.select({ value: count() }).from(auditLogsTable))[0]?.value).toBe(auditCountBefore);
  });

  it("does not merge different legacy date keys that share a time suffix", async () => {
    const now = Date.now();
    const suffix = "1791290340000";
    await db.insert(serverJobsTable).values([
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-date-a",
        idempotencyKey: `scheduled-evaluation:2026-10-06:${suffix}`,
        input: { date: "2026-10-06", scheduledFor: 1791290398722 },
        status: "succeeded", finishedAt: new Date(now), expiresAt: new Date(now + 60_000),
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "legacy-date-b",
        idempotencyKey: `scheduled-evaluation:2026-10-07:${suffix}`,
        input: { date: "2026-10-07", scheduledFor: 1791290398722 },
        status: "succeeded", finishedAt: new Date(now), expiresAt: new Date(now + 60_000),
      },
    ]);

    const inventory = await readScheduledEvaluationQueueSnapshot(now);
    const plan = await createCleanupPlan();
    const planBody = await plan.json() as {
      planId: string; manifestDigest: string; candidateCount: number; groups: unknown[];
    };

    expect(inventory.duplicateTimeBucketGroups).toBe(0);
    expect(planBody.candidateCount).toBe(0);
    expect(planBody.groups).toEqual([]);
    expect((await applyCleanupPlan(planBody)).status).toBe(409);
    expect((await db.select({ value: count() }).from(serverJobsTable))[0]?.value).toBe(2);
  });

  it("limits plan creation and approval to live managers", async () => {
    expect((await createCleanupPlan(OPERATOR_ACTOR)).status).toBe(403);
    expect((await createCleanupPlan(SANDBOX_ACTOR)).status).toBe(403);

    const malformed = await fetch(`${baseUrl}/api/server-jobs/scheduled-evaluation-cleanup/plans`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ deleteAll: true }),
    });
    expect(malformed.status).toBe(400);
    expect((await db.select({ value: count() }).from(scheduledJobCleanupPlansTable))[0]?.value).toBe(0);
  });

  it("applies only the exact approved terminal rows and preserves runnable, leased, and receipt-bearing jobs", async () => {
    const now = Date.now();
    const key = `scheduled-evaluation:live:${Date.parse("2030-04-05T12:00:00.000Z")}`;
    const expiresAt = new Date(now + 60 * 60_000);
    const [queued, leased, terminalWithReceipt, removable, ...unused] =
      await db.insert(serverJobsTable).values([
        {
          scope: "live", type: "scheduled-evaluation", actorId: "keep-queued", idempotencyKey: key,
          input: { scheduledFor: 1 }, expiresAt,
        },
        {
          scope: "live", type: "scheduled-evaluation", actorId: "keep-leased", idempotencyKey: key,
          input: { scheduledFor: 1 }, status: "running", attempt: 1, maxAttempts: 3,
          leaseToken: "00000000-0000-4000-8000-000000000101", leaseExpiresAt: new Date(now + 60_000),
          expiresAt,
        },
        {
          scope: "live", type: "scheduled-evaluation", actorId: "keep-history", idempotencyKey: key,
          input: { scheduledFor: 1 }, status: "failed", attempt: 1, maxAttempts: 3,
          finishedAt: new Date(now), expiresAt,
        },
        {
          scope: "live", type: "scheduled-evaluation", actorId: "remove-terminal", idempotencyKey: key,
          input: { scheduledFor: 1 }, status: "succeeded", finishedAt: new Date(now), expiresAt,
        },
      ]).returning();
    expect(unused).toHaveLength(0);
    await db.insert(serverJobAttemptsTable).values([
      { jobId: leased!.id, attempt: 1, workerId: "cleanup-test-worker" },
      { jobId: terminalWithReceipt!.id, attempt: 1, workerId: "cleanup-test-worker", outcome: "failed" },
    ]);

    const proposalResponse = await createCleanupPlan();
    expect(proposalResponse.status).toBe(201);
    const plan = await proposalResponse.json() as {
      planId: string; manifestDigest: string; candidateCount: number; candidateIds: string[];
      groups: Array<{ members: Array<{ id: string; candidate: boolean; disposition: string }> }>;
    };
    expect(plan.candidateCount).toBe(1);
    expect(plan.candidateIds).toEqual([removable!.id]);
    expect(plan.groups[0]?.members.find(({ id }) => id === terminalWithReceipt!.id)?.disposition)
      .toBe("preserve_attempt_receipts");
    expect(plan.groups[0]?.members.find(({ id }) => id === queued!.id)?.disposition)
      .toBe("preserve_runnable_job");

    const jobsBeforeApproval = await db.select({ id: serverJobsTable.id }).from(serverJobsTable);
    expect(jobsBeforeApproval).toHaveLength(4);
    const approvalReason = "Approved after exact manifest review";
    const appliedResponse = await applyCleanupPlan(plan, ACTOR, approvalReason);
    expect(appliedResponse.status).toBe(200);
    expect(await appliedResponse.json()).toEqual({
      outcome: "applied",
      deletedCount: 1,
      candidateIds: [removable!.id],
    });

    const survivors = await db.select().from(serverJobsTable);
    expect(survivors.map(({ id }) => id)).toEqual(expect.arrayContaining([
      queued!.id, leased!.id, terminalWithReceipt!.id,
    ]));
    expect(survivors).toHaveLength(3);
    expect(survivors.find(({ id }) => id === queued!.id)?.status).toBe("queued");
    expect(survivors.find(({ id }) => id === leased!.id)?.leaseToken)
      .toBe("00000000-0000-4000-8000-000000000101");
    expect((await db.select().from(serverJobAttemptsTable)).map(({ jobId }) => jobId))
      .toEqual(expect.arrayContaining([leased!.id, terminalWithReceipt!.id]));
    const audit = (await db.select().from(auditLogsTable))
      .filter(({ action, resource }) => action === "scheduled_job_cleanup" && resource === "scheduled-job-cleanup-plan")
      .at(-1);
    expect(audit).toMatchObject({
      scope: "live",
      actor: ACTOR,
      action: "scheduled_job_cleanup",
      changes: {
        outcome: "applied",
        reason: approvalReason,
        candidateIds: [removable!.id],
      },
    });
  });

  it("fails closed and audits a stale plan after a candidate changes", async () => {
    const now = Date.now();
    const key = `scheduled-evaluation:live:${Date.parse("2030-04-06T12:00:00.000Z")}`;
    const rows = await db.insert(serverJobsTable).values([
      {
        scope: "live", type: "scheduled-evaluation", actorId: "stale-old", idempotencyKey: key,
        input: {}, status: "succeeded", finishedAt: new Date(now), expiresAt: new Date(now + 60_000),
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "stale-new", idempotencyKey: key,
        input: {}, status: "failed", finishedAt: new Date(now), expiresAt: new Date(now + 60_000),
      },
    ]).returning();
    const proposal = await (await createCleanupPlan()).json() as {
      planId: string; manifestDigest: string; candidateIds: string[];
    };
    expect(proposal.candidateIds).toHaveLength(1);
    await db.update(serverJobsTable).set({
      status: "queued",
      finishedAt: null,
    }).where(eq(serverJobsTable.id, proposal.candidateIds[0]!));

    const response = await applyCleanupPlan(proposal, ACTOR, "Review became stale");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ outcome: "stale" });
    expect((await db.select().from(serverJobsTable)).map(({ id }) => id))
      .toEqual(expect.arrayContaining(rows.map(({ id }) => id)));
    const [planRow] = await db.select().from(scheduledJobCleanupPlansTable)
      .where(eq(scheduledJobCleanupPlansTable.id, proposal.planId));
    expect(planRow?.status).toBe("stale");
    const audit = (await db.select().from(auditLogsTable))
      .filter(({ action, changes }) =>
        action === "scheduled_job_cleanup" &&
        (changes as Record<string, unknown>).reason === "Review became stale")
      .at(-1);
    expect(audit?.changes).toMatchObject({
      outcome: "stale",
      reason: "Review became stale",
      candidateIds: proposal.candidateIds,
    });
  });

  it("serializes approval against a concurrent worker claim", async () => {
    const now = Date.now();
    const key = `scheduled-evaluation:live:${Date.parse("2030-04-07T12:00:00.000Z")}`;
    const rows = await db.insert(serverJobsTable).values([
      {
        scope: "live", type: "scheduled-evaluation", actorId: "claim-race-queued",
        idempotencyKey: key, input: {}, expiresAt: new Date(now + 60 * 60_000),
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "claim-race-terminal",
        idempotencyKey: key, input: {}, status: "succeeded", finishedAt: new Date(now),
        expiresAt: new Date(now + 60 * 60_000),
      },
    ]).returning();
    const proposal = await (await createCleanupPlan()).json() as {
      planId: string; manifestDigest: string; candidateIds: string[];
    };
    expect(proposal.candidateIds).toContain(rows[1]!.id);

    const [approval, claim] = await Promise.all([
      applyCleanupPlan(proposal, ACTOR, "Race check"),
      new ServerJobWorker("cleanup-approval-race").claimNext(),
    ]);
    expect(claim?.job.id).toBe(rows[0]!.id);
    expect([200, 409]).toContain(approval.status);
    const remaining = await db.select().from(serverJobsTable);
    expect(remaining.some(({ id, status }) => id === rows[0]!.id && status === "running")).toBe(true);
    if (approval.status === 409) {
      expect(remaining.some(({ id }) => id === rows[1]!.id)).toBe(true);
    } else {
      expect(remaining.some(({ id }) => id === rows[1]!.id)).toBe(false);
    }
    expect((await db.select().from(serverJobAttemptsTable)).some(({ jobId }) => jobId === rows[0]!.id)).toBe(true);
  });

  it("rolls back job deletion and plan approval if audit persistence fails", async () => {
    const now = Date.now();
    const key = `scheduled-evaluation:live:${Date.parse("2030-04-08T12:00:00.000Z")}`;
    const rows = await db.insert(serverJobsTable).values([
      {
        scope: "live", type: "scheduled-evaluation", actorId: "rollback-a", idempotencyKey: key,
        input: {}, status: "succeeded", finishedAt: new Date(now), expiresAt: new Date(now + 60_000),
      },
      {
        scope: "live", type: "scheduled-evaluation", actorId: "rollback-b", idempotencyKey: key,
        input: {}, status: "failed", finishedAt: new Date(now), expiresAt: new Date(now + 60_000),
      },
    ]).returning();
    const proposal = await (await createCleanupPlan()).json() as {
      planId: string; manifestDigest: string; candidateIds: string[];
    };
    await killer.query(`
      CREATE OR REPLACE FUNCTION test_reject_cleanup_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'scheduled_job_cleanup' THEN
          RAISE EXCEPTION 'synthetic cleanup audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await killer.query(`
      CREATE TRIGGER test_reject_cleanup_audit
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION test_reject_cleanup_audit()
    `);
    try {
      const response = await applyCleanupPlan(proposal, ACTOR, "Rollback on audit failure");
      expect(response.status).toBe(500);
    } finally {
      await killer.query("DROP TRIGGER IF EXISTS test_reject_cleanup_audit ON audit_logs");
      await killer.query("DROP FUNCTION IF EXISTS test_reject_cleanup_audit()");
    }

    expect((await db.select().from(serverJobsTable)).map(({ id }) => id))
      .toEqual(expect.arrayContaining(rows.map(({ id }) => id)));
    const [planRow] = await db.select().from(scheduledJobCleanupPlansTable)
      .where(eq(scheduledJobCleanupPlansTable.id, proposal.planId));
    expect(planRow?.status).toBe("pending");
    expect((await db.select().from(auditLogsTable))
      .some(({ action, changes }) =>
        action === "scheduled_job_cleanup" &&
        (changes as Record<string, unknown>).reason === "Rollback on audit failure"))
      .toBe(false);
  });

  it.each([
    { groupCount: 99, inventoryCount: 99, truncated: false },
    { groupCount: 100, inventoryCount: 100, truncated: false },
    { groupCount: 101, inventoryCount: 100, truncated: true },
  ])("reports $groupCount duplicate groups and bounds detailed inventory", async ({
    groupCount,
    inventoryCount,
    truncated,
  }) => {
    const now = Date.now();
    const expiresAt = new Date(now + 60 * 60_000);
    const rows = Array.from({ length: groupCount }, (_, index) => {
      const bucketStart = Date.parse("2030-04-03T12:00:00.000Z") + index * 60_000;
      return ["a", "b"].map((suffix) => ({
        scope: "live",
        type: "scheduled-evaluation",
        actorId: `bounded-${index}-${suffix}`,
        idempotencyKey: `scheduled-evaluation:live:${bucketStart}`,
        input: { scheduledFor: bucketStart },
        expiresAt,
      }));
    }).flat();
    await db.insert(serverJobsTable).values(rows);

    const inventory = await readScheduledEvaluationQueueSnapshot(now);

    expect(inventory.duplicateTimeBucketGroups).toBe(groupCount);
    expect(inventory.duplicateGroupsTruncated).toBe(truncated);
    expect(inventory.duplicateBucketInventory).toHaveLength(inventoryCount);
    expect(inventory.duplicateBucketInventoryTruncated).toBe(truncated);
  });
});
