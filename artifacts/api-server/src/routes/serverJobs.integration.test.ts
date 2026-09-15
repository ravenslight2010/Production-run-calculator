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
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Readable } from "node:stream";
import express, { type Express, type Response as ExpressResponse } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import pg from "pg";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");

let db: DbModule["db"];
let pool: DbModule["pool"];
let serverJobsTable: DbModule["serverJobsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;
let clearSandboxCache: () => void;
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
type IsolatedApiProcess = ChildProcessByStdio<null, Readable, Readable>;

const ACTOR = "route-job-actor";
const OTHER_LIVE_ACTOR = "route-job-other-live-actor";
const SANDBOX_ACTOR = "route-job-sandbox-actor";
const OTHER_SANDBOX_ACTOR = "route-job-other-sandbox-actor";
const IDEMPOTENCY_KEY = "route-job-confirmation-lost";
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
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DATABASE_URL = testUrlString;

  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const rolesMod = await import("../lib/roles");
  const userValidityMod = await import("../lib/userValidity");
  const sandboxMod = await import("../lib/sandbox");
  db = dbMod.db;
  pool = dbMod.pool;
  serverJobsTable = dbMod.serverJobsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = rolesMod.seedRoles;
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  clearSandboxCache = sandboxMod.clearSandboxCache;

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
    TRUNCATE ${serverJobsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable}
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
  ]);
  await db.insert(userRolesTable).values([
    { userId: ACTOR, role: "manager" },
    { userId: OTHER_LIVE_ACTOR, role: "manager" },
    { userId: SANDBOX_ACTOR, role: "manager" },
    { userId: OTHER_SANDBOX_ACTOR, role: "manager" },
  ]);
});


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
    authorization: `Bearer ${signToken(actorId)}`,
  };
}

async function submitJob(actorId = ACTOR, body = JOB_BODY): Promise<globalThis.Response> {
  return submitJobAt(baseUrl, actorId, body);
}

async function submitJobAt(
  url: string,
  actorId = ACTOR,
  body = JOB_BODY,
): Promise<globalThis.Response> {
  return fetch(`${url}/api/server-jobs`, {
    method: "POST",
    headers: headers(actorId),
    body: JSON.stringify(body),
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

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
      for (const line of output.split("\n").slice(0, -1)) {
        try {
          const message = JSON.parse(line) as { port?: number };
          if (Number.isInteger(message.port) && message.port! > 0) {
            settled = true;
            resolve({ child, url: `http://127.0.0.1:${message.port}` });
            return;
          }
        } catch {
          // Startup diagnostics are allowed; only the JSON ready marker matters.
        }
      }
      output = output.slice(output.lastIndexOf("\n") + 1);
    });
    child.stderr.on("data", () => {});
    child.once("error", (error) => fail(error));
    child.once("exit", (code, signal) => {
      if (!settled) {
        fail(new Error(`Isolated API process exited before ready (${code ?? signal})`));
      }
    });
  });
}

async function stopIsolatedApiProcess(child: IsolatedApiProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
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
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => submitJob()),
    );

    expect(responses.every((candidate) => candidate.status === 200 || candidate.status === 202)).toBe(true);
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
    const instances = await Promise.all([
      startIsolatedApiProcess(),
      startIsolatedApiProcess(),
    ]);

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
  });
});