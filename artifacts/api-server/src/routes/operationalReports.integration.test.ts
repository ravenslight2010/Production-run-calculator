// End-to-end coverage for the server-derived operational reads. Keep db-backed
// imports dynamic: @workspace/db captures DATABASE_URL when it is imported.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let completedRunHistoryTable: DbModule["completedRunHistoryTable"];
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

const MANAGER = "operational-manager";
const OPERATOR = "operational-operator";
const SANDBOX_MANAGER = "operational-sandbox-manager";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_operational_reports_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);
  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot, env: { ...process.env, DATABASE_URL: testUrlStr }, encoding: "utf8",
  });
  if (push.status !== 0) throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);

  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  db = dbMod.db;
  pool = dbMod.pool;
  dailySyncTable = dbMod.dailySyncTable;
  completedRunHistoryTable = dbMod.completedRunHistoryTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  clearUserValidityCache = (await import("../lib/userValidity")).clearUserValidityCache;
  clearSandboxCache = (await import("../lib/sandbox")).clearSandboxCache;

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", routerMod.default);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

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
}, 60_000);

beforeEach(async () => {
  clearUserValidityCache();
  clearSandboxCache();
  await db.execute(sql`TRUNCATE ${completedRunHistoryTable}, ${dailySyncTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: MANAGER, passwordHash: "x" },
    { id: OPERATOR, username: OPERATOR, passwordHash: "x" },
    { id: SANDBOX_MANAGER, username: SANDBOX_MANAGER, passwordHash: "x", sandbox: true },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
    { userId: SANDBOX_MANAGER, role: "manager" },
  ]);
});

async function req(userId: string | null, method: string, pathname: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (userId) headers.authorization = `Bearer ${signToken(userId)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function snapshot(run: Record<string, unknown>, casesNeeded = 100, date = "2026-09-06"): Record<string, unknown> {
  const id = run.id as string;
  return {
    dayState: { date, resetAt: 10, runs: [run] },
    runValues: {
      [id]: {
        pizzasPerCase: 10, casesPerSkid: 20, casesNeeded, crustsPerCycle: 4,
        cycleSpeed: 10, speedAdjustment: 1, freezerTime: 10,
        tempFreezerTime: 30, tempCrustsPerCycle: 5, tempCycleSpeed: 12,
      },
    },
    packagingProgress: { [id]: { skidsCompleted: 2, casesOnCurrentSkid: 3 } },
  };
}

describe("operational report endpoints", () => {
  it("rejects signed-out and capability-less callers, while review-incidents users pass", async () => {
    expect((await req(null, "GET", "/api/reports/operational-view?date=2026-09-06&runId=x")).status).toBe(401);
    expect((await req(OPERATOR, "POST", "/api/reports/operational", { scope: "day", date: "2026-09-06" })).status).toBe(403);
    const accepted = await req(MANAGER, "GET", "/api/reports/operational-view?date=2026-09-06&runId=x");
    expect(accepted.status).toBe(404);
    expect(await accepted.json()).toMatchObject({ error: { code: "snapshot-not-found" } });
  });

  it("derives active, paused, and ended views from scoped canonical snapshots with freshness and provenance", async () => {
    const old = new Date(Date.now() - 120_000);
    await db.insert(dailySyncTable).values([
      { scope: "live", date: "2026-09-06", updatedAt: old, data: snapshot({ id: "active", brand: "Live", flavor: "Active", startedAt: 1_000 }) },
      { scope: "live", date: "2026-09-07", updatedAt: old, data: snapshot({ id: "paused", brand: "Live", flavor: "Paused", startedAt: 1_000, pausedAt: 2_000, stoppages: [{ type: "pause", startedAt: 2_000, stopTunnel: true }] }, 100, "2026-09-07") },
      { scope: "live", date: "2026-09-08", updatedAt: old, data: snapshot({ id: "ended", brand: "Live", flavor: "Ended", startedAt: 1_000, endedAt: 2_000 }, 100, "2026-09-08") },
    ]);
    const active = await req(MANAGER, "GET", "/api/reports/operational-view?date=2026-09-06&runId=active");
    expect(active.status).toBe(200);
    expect(await active.json()).toMatchObject({
      observed: { status: "running", temporaryOverrides: { freezerTime: true, crustsPerCycle: true, cycleSpeed: true } },
      freshness: { status: "stale", capturedAt: old.getTime() },
      formulaProvenance: {
        policy: "operational-run-view",
        policyVersion: 1,
        calculator: "computeServerCalc",
        calculatorVersion: 1,
        temporaryOverrides: "applyTemporaryOverrides",
        linePhasesVersion: 1,
      },
    });
    const paused = await req(MANAGER, "GET", "/api/reports/operational-view?date=2026-09-07&runId=paused");
    expect((await paused.json() as { observed: { status: string } }).observed.status).toBe("paused");
    const ended = await req(MANAGER, "GET", "/api/reports/operational-view?date=2026-09-08&runId=ended");
    expect((await ended.json() as { observed: { status: string } }).observed.status).toBe("ended");
  });

  it("keeps live and sandbox snapshots isolated and returns structured missing-run status", async () => {
    await db.insert(dailySyncTable).values([
      { scope: "live", date: "2026-09-06", data: snapshot({ id: "live-run", brand: "Live", flavor: "Only" }) },
      { scope: "sandbox", date: "2026-09-06", data: snapshot({ id: "sandbox-run", brand: "Sandbox", flavor: "Only" }) },
    ]);
    const live = await req(MANAGER, "GET", "/api/reports/operational-view?date=2026-09-06&runId=live-run");
    expect((await live.json() as { observed: { brand: string } }).observed.brand).toBe("Live");
    const sandbox = await req(SANDBOX_MANAGER, "GET", "/api/reports/operational-view?date=2026-09-06&runId=sandbox-run");
    expect((await sandbox.json() as { observed: { brand: string } }).observed.brand).toBe("Sandbox");
    const missing = await req(SANDBOX_MANAGER, "GET", "/api/reports/operational-view?date=2026-09-06&runId=live-run");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "missing-run" } });
  });

  it("uses canonical dailySync production facts instead of stale legacy POST runs", async () => {
    await db.insert(dailySyncTable).values({
      scope: "live", date: "2026-09-06",
      data: snapshot({ id: "canonical", brand: "Canonical", flavor: "Facts", startedAt: 1_000, endedAt: 2_000 }, 100),
    });
    const res = await req(MANAGER, "POST", "/api/reports/operational", {
      scope: "day", date: "2026-09-06",
      runs: [{ brand: "Stale", flavor: "Browser", casesPlanned: 9999, casesProduced: 9999, finished: true, downtimeMinutes: 0, stoppageCount: 0 }],
    });
    expect(res.status).toBe(200);
    const report = await res.json() as { production: { runsPlanned: number; casesPlanned: number } };
    expect(report.production).toMatchObject({ runsPlanned: 1, casesPlanned: 100 });
  });

  it("counts only each immutable completion's own run when snapshots contain the full day", async () => {
    const runA = { id: "completed-a", brand: "Canonical", flavor: "A", startedAt: 1_000, endedAt: 2_000 };
    const runB = { id: "completed-b", brand: "Canonical", flavor: "B", startedAt: 2_000, endedAt: 3_000 };
    const snapshotA = snapshot(runA, 100);
    const snapshotB = snapshot(runB, 50);
    const sharedSnapshot = {
      ...snapshotA,
      dayState: { date: "2026-09-06", resetAt: 10, runs: [runA, runB] },
      runValues: {
        ...(snapshotA.runValues as Record<string, unknown>),
        ...(snapshotB.runValues as Record<string, unknown>),
      },
      packagingProgress: {
        ...(snapshotA.packagingProgress as Record<string, unknown>),
        ...(snapshotB.packagingProgress as Record<string, unknown>),
      },
    };
    await db.insert(completedRunHistoryTable).values([
      {
        id: "history-a", scope: "live", operationId: "operation-a", runId: runA.id,
        date: "2026-09-06", completedAt: new Date(), snapshot: sharedSnapshot,
        snapshotHash: "hash-a", actorId: MANAGER,
      },
      {
        id: "history-b", scope: "live", operationId: "operation-b", runId: runB.id,
        date: "2026-09-06", completedAt: new Date(), snapshot: sharedSnapshot,
        snapshotHash: "hash-b", actorId: MANAGER,
      },
    ]);

    const res = await req(MANAGER, "POST", "/api/reports/operational", {
      scope: "day", date: "2026-09-06",
    });
    expect(res.status).toBe(200);
    const report = await res.json() as {
      production: { runsPlanned: number; casesPlanned: number };
      productionRows: Array<{ id: string }>;
    };
    expect(report.production).toMatchObject({ runsPlanned: 2, casesPlanned: 150 });
    expect(report.productionRows.map((row) => row.id)).toEqual([
      "2026-09-06:completed-a",
      "2026-09-06:completed-b",
    ]);
  });

  it("refuses to label a partial canonical aggregate as authoritative", async () => {
    const malformed = snapshot(
      { id: "broken", brand: "Broken", flavor: "Lifecycle", startedAt: 2_000, endedAt: 1_000 },
      100,
    );
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: "2026-09-06",
      data: malformed,
    });

    const res = await req(MANAGER, "POST", "/api/reports/operational", {
      scope: "day",
      date: "2026-09-06",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "canonical-snapshot-invalid" },
    });
  });

  it("refuses an authoritative day report when its canonical snapshot is missing", async () => {
    const res = await req(MANAGER, "POST", "/api/reports/operational", {
      scope: "day",
      date: "2026-09-06",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "canonical-snapshot-invalid" },
    });
  });

  it("refuses an authoritative week report when any canonical date is missing", async () => {
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: "2026-09-06",
      data: snapshot({ id: "week-run", brand: "Weekly", flavor: "Run" }, 100),
    });

    const res = await req(MANAGER, "POST", "/api/reports/operational", {
      scope: "week",
      date: "2026-09-06",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "canonical-snapshot-invalid" },
    });
  });
});