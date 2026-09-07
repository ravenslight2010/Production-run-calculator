// End-to-end coverage for the server-derived operational reads. Keep db-backed
// imports dynamic: @workspace/db captures DATABASE_URL when it is imported.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let completedRunHistoryTable: DbModule["completedRunHistoryTable"];
let finalizedOperationalReportsTable: DbModule["finalizedOperationalReportsTable"];
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
const REPORT_SIGNING_KEYRING = {
  activeKeyId: "test-current",
  keys: {
    "test-current": "test-operational-report-signing-key-current-0001",
    "test-previous": "test-operational-report-signing-key-previous-0001",
  },
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

beforeAll(async () => {
  process.env.OPERATIONAL_REPORT_SIGNING_KEYS = JSON.stringify(REPORT_SIGNING_KEYRING);
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
  finalizedOperationalReportsTable = dbMod.finalizedOperationalReportsTable;
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
  process.env.OPERATIONAL_REPORT_SIGNING_KEYS = JSON.stringify(REPORT_SIGNING_KEYRING);
  clearUserValidityCache();
  clearSandboxCache();
  await db.execute(sql`TRUNCATE ${finalizedOperationalReportsTable}, ${completedRunHistoryTable}, ${dailySyncTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`);
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

  it("finalizes only a server-derived snapshot, keeps it immutable, and lists/retrieves only its scope", async () => {
    await db.insert(dailySyncTable).values([
      { scope: "live", date: "2026-09-06", data: snapshot({ id: "live-final", brand: "Original", flavor: "Snapshot", startedAt: 1_000, endedAt: 2_000 }) },
      { scope: "sandbox", date: "2026-09-06", data: snapshot({ id: "sandbox-final", brand: "Sandbox", flavor: "Snapshot", startedAt: 1_000, endedAt: 2_000 }) },
    ]);
    expect((await req(null, "POST", "/api/reports/operational/finalize", { scope: "day", date: "2026-09-06" })).status).toBe(401);
    expect((await req(OPERATOR, "POST", "/api/reports/operational/finalize", { scope: "day", date: "2026-09-06" })).status).toBe(403);
    const created = await req(MANAGER, "POST", "/api/reports/operational/finalize", {
      scope: "day", date: "2026-09-06",
      // Must be ignored; this is not the canonical server output.
      report: { production: { casesProduced: 999999 } },
    });
    expect(created.status).toBe(201);
    const archived = await created.json() as { id: string; contentHash: string; hashContract: string; proofContract: string; proofKeyId: string; proofStatus: string; report: { production: { casesProduced: number }; productionRows: Array<{ run: string }> } };
    expect(archived.report.production.casesProduced).not.toBe(999999);
    expect(archived.report.productionRows[0]?.run).toMatch(/Original Snapshot/);
    expect(archived.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(archived.hashContract).toBe("canonical-json-v2");
    const persistedCreated = await db.select({
      hashContract: finalizedOperationalReportsTable.hashContract,
    }).from(finalizedOperationalReportsTable).where(
      eq(finalizedOperationalReportsTable.id, archived.id),
    );
    expect(persistedCreated).toEqual([{ hashContract: "canonical-json-v2" }]);
    expect(archived.proofContract).toBe("hmac-sha256-v1");
    expect(archived.proofKeyId).toBe("test-current");
    expect(archived.proofStatus).toBe("verified");

    await db.update(dailySyncTable).set({
      data: snapshot({ id: "live-final", brand: "Mutated", flavor: "Source", startedAt: 1_000, endedAt: 2_000 }, 500),
    }).where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, "2026-09-06")));
    const retry = await req(MANAGER, "POST", "/api/reports/operational/finalize", { scope: "day", date: "2026-09-06" });
    expect(retry.status).toBe(200);
    expect((await retry.json() as { id: string; idempotent: boolean; hashContract: string; report: { productionRows: Array<{ run: string }> } })).toMatchObject({
      id: archived.id,
      idempotent: true,
      hashContract: "canonical-json-v2",
      report: { productionRows: [{ run: "Original Snapshot" }] },
    });
    const listed = await req(MANAGER, "GET", "/api/reports/operational/finalized?scope=day&date=2026-09-06");
    expect((await listed.json() as Array<{ id: string }>).map((row) => row.id)).toEqual([archived.id]);
    const retrieved = await req(MANAGER, "GET", `/api/reports/operational/finalized/${archived.id}`);
    const retrievedArchive = await retrieved.json() as {
      hashContract: string;
      report: { productionRows: Array<{ run: string }> };
    };
    expect(retrievedArchive.hashContract).toBe("canonical-json-v2");
    expect(retrievedArchive.report.productionRows[0]?.run).toBe("Original Snapshot");
    expect(retrievedArchive).toMatchObject({
      proofContract: "hmac-sha256-v1",
      proofKeyId: "test-current",
      proofStatus: "verified",
    });
    process.env.OPERATIONAL_REPORT_SIGNING_KEYS = JSON.stringify({
      activeKeyId: "test-previous",
      keys: REPORT_SIGNING_KEYRING.keys,
    });
    const afterRotation = await req(MANAGER, "GET", `/api/reports/operational/finalized/${archived.id}`);
    expect(afterRotation.status).toBe(200);
    expect(await afterRotation.json()).toMatchObject({
      proofKeyId: "test-current",
      proofStatus: "verified",
    });
    process.env.OPERATIONAL_REPORT_SIGNING_KEYS = JSON.stringify({
      activeKeyId: "test-previous",
      keys: { "test-previous": REPORT_SIGNING_KEYRING.keys["test-previous"] },
    });
    const afterOldKeyRemoval = await req(MANAGER, "GET", `/api/reports/operational/finalized/${archived.id}`);
    expect(afterOldKeyRemoval.status).toBe(409);
    const listedWithoutOldKey = await req(MANAGER, "GET", "/api/reports/operational/finalized?scope=day&date=2026-09-06");
    expect(await listedWithoutOldKey.json()).toMatchObject([{
      id: archived.id,
      proofKeyId: "test-current",
      proofStatus: "key-unavailable",
    }]);
    expect((await req(SANDBOX_MANAGER, "GET", `/api/reports/operational/finalized/${archived.id}`)).status).toBe(404);
    expect((await req(SANDBOX_MANAGER, "GET", "/api/reports/operational/finalized?scope=day&date=2026-09-06")).status).toBe(200);
  });

  it("verifies and classifies legacy JSON hashes while still rejecting tampered legacy payloads", async () => {
    const legacyPayload = {
      scope: "day",
      date: "2026-09-05",
      periodStart: "2026-09-05",
      periodEnd: "2026-09-05",
      generatedAt: "2026-09-05T12:00:00.000Z",
      attribution: { generatedBy: MANAGER, source: "canonical-server" },
      freshness: {
        status: "current",
        asOf: "2026-09-05T11:59:00.000Z",
        note: "Released v1 fixture.",
      },
      calculation: {
        period: "2026-09-05 through 2026-09-05, inclusive.",
        production: "Canonical production facts.",
        quality: "Recorded quality checks.",
        incidents: "Recorded incidents.",
        inventory: "Recorded inventory state.",
      },
      production: {
        scope: "day",
        date: "2026-09-05",
        runsPlanned: 1,
        runsFinished: 1,
        casesPlanned: 100,
        casesProduced: 100,
        attainmentPct: 100,
        totalDowntimeMinutes: 0,
        totalStoppages: 0,
        topDowntime: null,
        unfinishedRuns: [],
        incidentCount: 0,
        wasteFlaggedCount: 0,
        hasData: true,
      },
      productionRows: [{
        id: "2026-09-05:legacy-run",
        date: "2026-09-05",
        run: "Legacy Snapshot",
        status: "finished",
        casesPlanned: 100,
        casesProduced: 100,
        attainmentPct: 100,
        downtimeMinutes: 0,
        stoppages: 0,
      }],
      quality: {
        availability: "available",
        value: { checks: 0, issues: 0, failed: 0, warnings: 0, rows: [] },
        note: "No quality checks were recorded.",
      },
      incidents: {
        availability: "available",
        value: { total: 0, unresolved: 0, rows: [] },
        note: "No incidents were recorded.",
      },
      inventory: {
        availability: "available",
        value: {
          flaggedItems: 0,
          rows: [],
          historical: {
            availability: "available",
            value: {
              totalEvents: 0,
              consumptionEvents: 0,
              wasteEvents: 0,
              adjustmentEvents: 0,
            },
            note: "No inventory events were recorded.",
          },
        },
        note: "Current inventory snapshot.",
      },
      unresolvedActions: {
        availability: "available",
        value: { total: 0, rows: [] },
        note: "No unresolved actions were recorded.",
      },
      evidence: {
        release: { version: "1.0.0", revision: "legacy-fixture", environment: "test" },
        recovery: {
          generatedAt: "2026-09-05T12:00:00.000Z",
          source: "live-database",
          complete: true,
        },
      },
    };
    const legacyHash = "017a9102a419302571a8f18ef3f055bd3f3c9af3a2c73889d33d9d5c0d47bae2";
    const legacyId = "10000000-0000-4000-8000-000000000001";
    const finalizedAt = new Date("2026-09-07T12:00:00.000Z");
    await db.insert(finalizedOperationalReportsTable).values({
      id: legacyId,
      scope: "live",
      reportScope: "day",
      periodStart: "2026-09-05",
      periodEnd: "2026-09-05",
      generatedAt: finalizedAt,
      generatedBy: MANAGER,
      finalizedAt,
      finalizedBy: MANAGER,
      contentHash: legacyHash,
      payload: legacyPayload,
    });

    const retrieved = await req(MANAGER, "GET", `/api/reports/operational/finalized/${legacyId}`);
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toMatchObject({
      id: legacyId,
      contentHash: legacyHash,
      hashContract: "json-v1",
      proofContract: null,
      proofKeyId: null,
      proofStatus: "unsigned-legacy",
      report: legacyPayload,
    });
    const classifiedLegacy = await db.select({
      hashContract: finalizedOperationalReportsTable.hashContract,
    }).from(finalizedOperationalReportsTable).where(
      eq(finalizedOperationalReportsTable.id, legacyId),
    );
    expect(classifiedLegacy).toEqual([{ hashContract: "json-v1" }]);
    const listed = await req(
      MANAGER,
      "GET",
      "/api/reports/operational/finalized?scope=day&date=2026-09-05",
    );
    const listedRows = await listed.json() as Array<Record<string, unknown>>;
    expect(listedRows).toMatchObject([{
      id: legacyId,
      contentHash: legacyHash,
      hashContract: "json-v1",
      proofStatus: "unsigned-legacy",
    }]);
    expect(listedRows[0]).not.toHaveProperty("report");

    const canonicalId = "10000000-0000-4000-8000-000000000002";
    await db.insert(finalizedOperationalReportsTable).values({
      id: canonicalId,
      scope: "live",
      reportScope: "day",
      periodStart: "2026-09-04",
      periodEnd: "2026-09-04",
      generatedAt: finalizedAt,
      generatedBy: MANAGER,
      finalizedAt,
      finalizedBy: MANAGER,
      contentHash: (await import("node:crypto"))
        .createHash("sha256")
        .update(canonicalJson(legacyPayload))
        .digest("hex"),
      payload: legacyPayload,
    });
    const canonicalLegacy = await req(MANAGER, "GET", `/api/reports/operational/finalized/${canonicalId}`);
    expect(canonicalLegacy.status).toBe(200);
    expect(await canonicalLegacy.json()).toMatchObject({
      id: canonicalId,
      hashContract: "canonical-json-v2",
      proofContract: null,
      proofKeyId: null,
      proofStatus: "unsigned-legacy",
    });

    await db.update(finalizedOperationalReportsTable).set({
      payload: { ...legacyPayload, tampered: true },
    }).where(eq(finalizedOperationalReportsTable.id, legacyId));

    const tampered = await req(MANAGER, "GET", `/api/reports/operational/finalized/${legacyId}`);
    expect(tampered.status).toBe(409);
    expect(await tampered.json()).toEqual({
      error: {
        code: "finalized-report-integrity-failure",
        message: "The finalized report failed integrity verification and cannot be exported.",
      },
    });
    const classificationAfterTamper = await db.select({
      hashContract: finalizedOperationalReportsTable.hashContract,
    }).from(finalizedOperationalReportsTable).where(
      eq(finalizedOperationalReportsTable.id, legacyId),
    );
    expect(classificationAfterTamper).toEqual([{ hashContract: "json-v1" }]);
  });

  it("rejects a signed report when a database writer changes both payload and content hash", async () => {
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: "2026-09-06",
      data: snapshot({ id: "signed-final", brand: "Signed", flavor: "Original", startedAt: 1_000, endedAt: 2_000 }),
    });
    const created = await req(MANAGER, "POST", "/api/reports/operational/finalize", {
      scope: "day",
      date: "2026-09-06",
    });
    expect(created.status).toBe(201);
    const archived = await created.json() as { id: string; report: Record<string, unknown> };
    const changedPayload = { ...archived.report, tamperedByDatabaseWriter: true };
    const changedHash = (await import("node:crypto"))
      .createHash("sha256")
      .update(canonicalJson(changedPayload))
      .digest("hex");
    await db.update(finalizedOperationalReportsTable).set({
      payload: changedPayload,
      contentHash: changedHash,
    }).where(eq(finalizedOperationalReportsTable.id, archived.id));
    const stored = await db.select().from(finalizedOperationalReportsTable)
      .where(eq(finalizedOperationalReportsTable.id, archived.id));
    expect(stored[0]?.contentHash).toBe(changedHash);

    const retrieved = await req(MANAGER, "GET", `/api/reports/operational/finalized/${archived.id}`);
    expect(retrieved.status).toBe(409);
    expect(await retrieved.json()).toMatchObject({
      error: { code: "finalized-report-integrity-failure" },
    });
    const listed = await req(MANAGER, "GET", "/api/reports/operational/finalized?scope=day&date=2026-09-06");
    expect(await listed.json()).toMatchObject([{
      id: archived.id,
      hashContract: "unrecognized",
      proofStatus: "invalid",
    }]);
  });

  it("does not finalize when the dedicated signing keyring is unavailable", async () => {
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: "2026-09-06",
      data: snapshot({ id: "unsigned-final", brand: "Unsigned", flavor: "Blocked", startedAt: 1_000, endedAt: 2_000 }),
    });
    delete process.env.OPERATIONAL_REPORT_SIGNING_KEYS;
    const response = await req(MANAGER, "POST", "/api/reports/operational/finalize", {
      scope: "day",
      date: "2026-09-06",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "finalized-report-signing-unavailable" },
    });
    expect(await db.select().from(finalizedOperationalReportsTable)).toHaveLength(0);
  });

  it("verifies persisted proofs when JSONB omits undefined optional report fields", async () => {
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: "2026-09-06",
      data: snapshot({
        id: "unfinished-proof",
        brand: "Pending",
        flavor: "Follow-up",
        startedAt: 1_000,
      }),
    });
    const created = await req(MANAGER, "POST", "/api/reports/operational/finalize", {
      scope: "day",
      date: "2026-09-06",
    });
    expect(created.status).toBe(201);
    const archived = await created.json() as {
      id: string;
      proofStatus: string;
      report: { unresolvedActions: { value: { total: number } } };
    };
    expect(archived.proofStatus).toBe("verified");
    expect(archived.report.unresolvedActions.value.total).toBeGreaterThan(0);

    const retrieved = await req(MANAGER, "GET", `/api/reports/operational/finalized/${archived.id}`);
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toMatchObject({
      id: archived.id,
      proofStatus: "verified",
    });
  });

  it("warns managers when a historical report proof key is no longer retained", async () => {
    const finalizedAt = new Date("2026-09-07T12:00:00.000Z");
    const proofRow = (id: string, proofKeyId: string, periodEnd: string) => ({
      id,
      scope: "live",
      reportScope: "day",
      periodStart: periodEnd,
      periodEnd,
      generatedAt: finalizedAt,
      generatedBy: MANAGER,
      finalizedAt,
      finalizedBy: MANAGER,
      contentHash: "a".repeat(64),
      hashContract: "canonical-json-v2",
      proofContract: "hmac-sha256-v1",
      proofKeyId,
      proofSignature: "b".repeat(64),
      payload: {},
    });
    await db.insert(finalizedOperationalReportsTable).values([
      proofRow("proof-health-active", "test-current", "2026-09-06"),
      proofRow("proof-health-retained", "test-previous", "2026-09-05"),
      proofRow("proof-health-missing", "removed-historical", "2026-09-04"),
      { ...proofRow("proof-health-other-scope", "sandbox-missing", "2026-09-03"), scope: "sandbox" },
    ]);

    expect((await req(OPERATOR, "GET", "/api/reports/operational/finalized/proof-key-health")).status).toBe(403);
    const response = await req(MANAGER, "GET", "/api/reports/operational/finalized/proof-key-health");
    expect(response.status).toBe(200);
    const health = await response.json() as Record<string, unknown>;
    expect(health).toMatchObject({
      status: "attention-required",
      scope: "live",
      activeKeyId: "test-current",
      storedProofKeyIds: ["removed-historical", "test-current", "test-previous"],
      availableStoredProofKeyIds: ["test-current", "test-previous"],
      missingStoredProofKeyIds: ["removed-historical"],
      scan: {
        limit: 100,
        checkedDistinctKeyIds: 3,
        truncated: false,
      },
      message: "Finalized report proof-key retention needs manager attention.",
    });
    expect(health.remediation).toContain("Restore the retained signing key");
    expect(health.remediation).toContain("removed-historical");
    expect(JSON.stringify(health)).not.toContain(REPORT_SIGNING_KEYRING.keys["test-current"]);
    expect(JSON.stringify(health)).not.toContain(REPORT_SIGNING_KEYRING.keys["test-previous"]);

    const indexes = await db.execute(sql`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'finalized_operational_reports_scope_proof_key_idx'
    `);
    expect(indexes.rows[0]?.indexdef).toMatch(
      /\(scope, proof_contract, proof_key_id\)/,
    );
  });

  it("reports healthy when every active and retained proof key remains configured", async () => {
    const finalizedAt = new Date("2026-09-07T12:00:00.000Z");
    await db.insert(finalizedOperationalReportsTable).values([
      {
        id: "proof-health-current",
        scope: "live",
        reportScope: "day",
        periodStart: "2026-09-06",
        periodEnd: "2026-09-06",
        generatedAt: finalizedAt,
        generatedBy: MANAGER,
        finalizedAt,
        finalizedBy: MANAGER,
        contentHash: "a".repeat(64),
        hashContract: "canonical-json-v2",
        proofContract: "hmac-sha256-v1",
        proofKeyId: "test-current",
        proofSignature: "b".repeat(64),
        payload: {},
      },
      {
        id: "proof-health-previous",
        scope: "live",
        reportScope: "day",
        periodStart: "2026-09-05",
        periodEnd: "2026-09-05",
        generatedAt: finalizedAt,
        generatedBy: MANAGER,
        finalizedAt,
        finalizedBy: MANAGER,
        contentHash: "c".repeat(64),
        hashContract: "canonical-json-v2",
        proofContract: "hmac-sha256-v1",
        proofKeyId: "test-previous",
        proofSignature: "d".repeat(64),
        payload: {},
      },
    ]);

    const response = await req(MANAGER, "GET", "/api/reports/operational/finalized/proof-key-health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "healthy",
      activeKeyId: "test-current",
      storedProofKeyIds: ["test-current", "test-previous"],
      availableStoredProofKeyIds: ["test-current", "test-previous"],
      missingStoredProofKeyIds: [],
      remediation: null,
    });
  });

  it("keeps the key-retention audit bounded and flags an incomplete scan", async () => {
    const finalizedAt = new Date("2026-09-07T12:00:00.000Z");
    await db.insert(finalizedOperationalReportsTable).values(
      Array.from({ length: 101 }, (_, index) => {
        const suffix = String(index).padStart(3, "0");
        return {
          id: `bounded-proof-health-${suffix}`,
          scope: "live",
          reportScope: "day",
          periodStart: `bounded-${suffix}`,
          periodEnd: `bounded-${suffix}`,
          generatedAt: finalizedAt,
          generatedBy: MANAGER,
          finalizedAt,
          finalizedBy: MANAGER,
          contentHash: "a".repeat(64),
          hashContract: "canonical-json-v2",
          proofContract: "hmac-sha256-v1",
          proofKeyId: `historical-${suffix}`,
          proofSignature: "b".repeat(64),
          payload: {},
        };
      }),
    );

    const response = await req(MANAGER, "GET", "/api/reports/operational/finalized/proof-key-health");
    expect(response.status).toBe(200);
    const health = await response.json() as {
      status: string;
      storedProofKeyIds: string[];
      missingStoredProofKeyIds: string[];
      scan: { limit: number; checkedDistinctKeyIds: number; truncated: boolean };
      remediation: string;
    };
    expect(health.status).toBe("attention-required");
    expect(health.storedProofKeyIds).toHaveLength(100);
    expect(health.missingStoredProofKeyIds).toHaveLength(100);
    expect(health.scan).toEqual({
      limit: 100,
      checkedDistinctKeyIds: 100,
      truncated: true,
    });
    expect(health.remediation).toContain("Restore the retained signing keys");
  });

  it("does not expand key-health results when many reports reuse one retained key", async () => {
    const finalizedAt = new Date("2026-09-07T12:00:00.000Z");
    await db.insert(finalizedOperationalReportsTable).values(
      Array.from({ length: 150 }, (_, index) => {
        const suffix = String(index).padStart(3, "0");
        return {
          id: `repeated-proof-health-${suffix}`,
          scope: "live",
          reportScope: "day",
          periodStart: `repeated-${suffix}`,
          periodEnd: `repeated-${suffix}`,
          generatedAt: finalizedAt,
          generatedBy: MANAGER,
          finalizedAt,
          finalizedBy: MANAGER,
          contentHash: "a".repeat(64),
          hashContract: "canonical-json-v2",
          proofContract: "hmac-sha256-v1",
          proofKeyId: "test-previous",
          proofSignature: "b".repeat(64),
          payload: {},
        };
      }),
    );

    const response = await req(MANAGER, "GET", "/api/reports/operational/finalized/proof-key-health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "healthy",
      storedProofKeyIds: ["test-previous"],
      availableStoredProofKeyIds: ["test-previous"],
      missingStoredProofKeyIds: [],
      scan: {
        limit: 100,
        checkedDistinctKeyIds: 1,
        truncated: false,
      },
    });
  });

  it("returns safe remediation when the signing keyring is unavailable", async () => {
    const finalizedAt = new Date("2026-09-07T12:00:00.000Z");
    await db.insert(finalizedOperationalReportsTable).values({
      id: "proof-health-keyring-unavailable",
      scope: "live",
      reportScope: "day",
      periodStart: "2026-09-06",
      periodEnd: "2026-09-06",
      generatedAt: finalizedAt,
      generatedBy: MANAGER,
      finalizedAt,
      finalizedBy: MANAGER,
      contentHash: "a".repeat(64),
      hashContract: "canonical-json-v2",
      proofContract: "hmac-sha256-v1",
      proofKeyId: "test-current",
      proofSignature: "b".repeat(64),
      payload: {},
    });
    delete process.env.OPERATIONAL_REPORT_SIGNING_KEYS;

    const response = await req(MANAGER, "GET", "/api/reports/operational/finalized/proof-key-health");
    expect(response.status).toBe(200);
    const health = await response.json() as Record<string, unknown>;
    expect(health).toMatchObject({
      status: "attention-required",
      activeKeyId: null,
      storedProofKeyIds: ["test-current"],
      availableStoredProofKeyIds: [],
      missingStoredProofKeyIds: ["test-current"],
      message: "Finalized report proof-key retention needs manager attention.",
    });
    expect(health.remediation).toContain("Restore a valid OPERATIONAL_REPORT_SIGNING_KEYS keyring");
    expect(JSON.stringify(health)).not.toContain(REPORT_SIGNING_KEYRING.keys["test-current"]);
  });

  it("searches a bounded date range across day and week reports within the manager facility", async () => {
    const finalizedAt = new Date("2026-09-07T12:00:00.000Z");
    const row = (
      id: string,
      scope: string,
      reportScope: "day" | "week",
      periodStart: string,
      periodEnd: string,
    ) => ({
      id,
      scope,
      reportScope,
      periodStart,
      periodEnd,
      generatedAt: finalizedAt,
      generatedBy: MANAGER,
      finalizedAt,
      finalizedBy: MANAGER,
      contentHash: id.padEnd(64, "a"),
      hashContract: null,
      payload: {},
    });
    await db.insert(finalizedOperationalReportsTable).values([
      { ...row("live-day-1", "live", "day", "2026-09-01", "2026-09-01"), hashContract: "json-v1" },
      { ...row("live-week-1", "live", "week", "2026-08-27", "2026-09-02"), hashContract: "canonical-json-v2" },
      { ...row("live-day-2", "live", "day", "2026-09-03", "2026-09-03"), hashContract: "future-json-v3" },
      row("outside-range", "live", "day", "2026-08-31", "2026-08-31"),
      row("sandbox-day", "sandbox", "day", "2026-09-03", "2026-09-03"),
    ]);

    expect((await req(OPERATOR, "GET", "/api/reports/operational/finalized/search?startDate=2026-09-01&endDate=2026-09-03")).status).toBe(403);
    const searched = await req(MANAGER, "GET", "/api/reports/operational/finalized/search?startDate=2026-09-01&endDate=2026-09-03");
    expect(searched.status).toBe(200);
    expect((await searched.json() as Array<{ id: string; reportScope: string; hashContract: string }>).map(({ id, reportScope, hashContract }) => ({ id, reportScope, hashContract }))).toEqual([
      { id: "live-day-2", reportScope: "day", hashContract: "unrecognized" },
      { id: "live-week-1", reportScope: "week", hashContract: "canonical-json-v2" },
      { id: "live-day-1", reportScope: "day", hashContract: "json-v1" },
    ]);

    const dayOnly = await req(MANAGER, "GET", "/api/reports/operational/finalized/search?startDate=2026-09-01&endDate=2026-09-03&scope=day&limit=1");
    expect((await dayOnly.json() as Array<{ id: string }>).map(({ id }) => id)).toEqual(["live-day-2"]);
    expect((await req(MANAGER, "GET", "/api/reports/operational/finalized/search?startDate=2026-09-03&endDate=2026-09-01")).status).toBe(400);
    expect((await req(MANAGER, "GET", "/api/reports/operational/finalized/search?startDate=2026-09-01&endDate=2026-09-03&limit=101")).status).toBe(400);
    expect((await req(MANAGER, "GET", "/api/reports/operational/finalized/search?startDate=2026-02-30&endDate=2026-09-03")).status).toBe(400);
    expect((await req(MANAGER, "GET", "/api/reports/operational/finalized/search?startDate=2026-09-01")).status).toBe(400);
    expect((await req(MANAGER, "GET", "/api/reports/operational/finalized/search?startDate=2025-09-01&endDate=2026-09-03")).status).toBe(400);
    expect((await req(MANAGER, "GET", "/api/reports/operational/finalized/search?startDate=2026-09-01&endDate=2026-09-03&date=2026-09-03")).status).toBe(400);
    expect((await req(MANAGER, "GET", "/api/reports/operational/finalized?scope=day&date=2026-09-03&startDate=2026-09-01")).status).toBe(400);

    const indexes = await db.execute(sql`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'finalized_operational_reports_scope_end_finalized_idx'
    `);
    expect(indexes.rows[0]?.indexdef).toMatch(/\(scope, period_end DESC(?: NULLS LAST)?, finalized_at DESC(?: NULLS LAST)?\)/);

    const hashContractColumn = await db.execute(sql`
      SELECT is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'finalized_operational_reports'
        AND column_name = 'hash_contract'
    `);
    expect(hashContractColumn.rows).toEqual([{
      is_nullable: "YES",
      column_default: null,
    }]);
  });

  it("leaves an unverified legacy row unclassified after metadata search and failed detail verification", async () => {
    const id = "20000000-0000-4000-8000-000000000001";
    const unsupportedId = "20000000-0000-4000-8000-000000000002";
    const finalizedAt = new Date("2026-09-07T12:00:00.000Z");
    await db.insert(finalizedOperationalReportsTable).values([
      {
        id,
        scope: "live",
        reportScope: "day",
        periodStart: "2026-09-04",
        periodEnd: "2026-09-04",
        generatedAt: finalizedAt,
        generatedBy: MANAGER,
        finalizedAt,
        finalizedBy: MANAGER,
        contentHash: "f".repeat(64),
        payload: { unknown: "contract" },
      },
      {
        id: unsupportedId,
        scope: "live",
        reportScope: "day",
        periodStart: "2026-09-03",
        periodEnd: "2026-09-03",
        generatedAt: finalizedAt,
        generatedBy: MANAGER,
        finalizedAt,
        finalizedBy: MANAGER,
        contentHash: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
        hashContract: "future-json-v3",
        payload: {},
      },
    ]);

    const listed = await req(
      MANAGER,
      "GET",
      "/api/reports/operational/finalized/search?startDate=2026-09-04&endDate=2026-09-04",
    );
    expect(await listed.json()).toMatchObject([{
      id,
      hashContract: "unrecognized",
    }]);
    expect((await db.select({
      hashContract: finalizedOperationalReportsTable.hashContract,
    }).from(finalizedOperationalReportsTable).where(
      eq(finalizedOperationalReportsTable.id, id),
    ))).toEqual([{ hashContract: null }]);

    const detail = await req(MANAGER, "GET", `/api/reports/operational/finalized/${id}`);
    expect(detail.status).toBe(409);
    expect((await db.select({
      hashContract: finalizedOperationalReportsTable.hashContract,
    }).from(finalizedOperationalReportsTable).where(
      eq(finalizedOperationalReportsTable.id, id),
    ))).toEqual([{ hashContract: null }]);

    const unsupportedDetail = await req(
      MANAGER,
      "GET",
      `/api/reports/operational/finalized/${unsupportedId}`,
    );
    expect(unsupportedDetail.status).toBe(409);
    expect((await db.select({
      hashContract: finalizedOperationalReportsTable.hashContract,
    }).from(finalizedOperationalReportsTable).where(
      eq(finalizedOperationalReportsTable.id, unsupportedId),
    ))).toEqual([{ hashContract: "future-json-v3" }]);
  });

  it("fails closed when an archived report payload no longer matches its content hash", async () => {
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: "2026-09-06",
      data: snapshot({ id: "tamper-check", brand: "Original", flavor: "Snapshot", startedAt: 1_000, endedAt: 2_000 }),
    });
    const created = await req(MANAGER, "POST", "/api/reports/operational/finalize", {
      scope: "day", date: "2026-09-06",
    });
    expect(created.status).toBe(201);
    const archived = await created.json() as { id: string; report: Record<string, unknown> };

    await db.update(finalizedOperationalReportsTable).set({
      payload: { ...archived.report, tampered: true },
    }).where(eq(finalizedOperationalReportsTable.id, archived.id));

    const retrieved = await req(MANAGER, "GET", `/api/reports/operational/finalized/${archived.id}`);
    expect(retrieved.status).toBe(409);
    expect(await retrieved.json()).toEqual({
      error: {
        code: "finalized-report-integrity-failure",
        message: "The finalized report failed integrity verification and cannot be exported.",
      },
    });

    const retry = await req(MANAGER, "POST", "/api/reports/operational/finalize", {
      scope: "day", date: "2026-09-06",
    });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({
      error: {
        code: "finalized-report-integrity-failure",
        message: "The finalized report failed integrity verification and cannot be exported.",
      },
    });
  });

  it("authenticates every canonical download and binds format bytes to archive identity and hash", async () => {
    const id = "30000000-0000-4000-8000-000000000001";
    const finalizedAt = new Date("2026-09-07T05:30:00.000-07:00");
    const payload = {
      scope: "day",
      date: "2026-09-06",
      periodStart: "2026-09-06",
      periodEnd: "2026-09-06",
      generatedAt: "2026-09-07T05:29:59.000-07:00",
      attribution: { generatedBy: MANAGER, source: "canonical-server" },
      production: {
        casesPlanned: 2, casesProduced: 1, attainmentPct: 50,
        totalDowntimeMinutes: 7, totalStoppages: 1, runsFinished: 0,
        runsPlanned: 1, unfinishedRuns: ["Café 栗🌶️"],
      },
      productionRows: [{
        id: "download-run-1", date: "2026-09-06", run: "Café 栗🌶️",
        status: "unfinished", casesPlanned: 2, casesProduced: 1,
        attainmentPct: 50, downtimeMinutes: 7, stoppages: 1,
      }],
      quality: {
        availability: "available",
        value: {
          rows: [{
            id: "download-quality-1",
            occurredAt: "2026-09-06T23:59:59-07:00",
            product: "Crème brûlée", status: "open", issues: 1,
            summary: "=HYPERLINK(\"https://example.test\",\"unsafe\")",
          }],
        },
      },
      incidents: {
        availability: "available",
        value: {
          rows: [{
            id: "download-incident-1",
            occurredAt: "2026-09-06T23:59:58-07:00",
            status: "open", priority: "high", reporter: "@night-shift",
            summary: "Temperature + humidity review",
          }],
        },
      },
      inventory: {
        availability: "available",
        value: {
          rows: [{
            id: "download-inventory-1", item: "-reorder-me", state: "low",
            onHand: 1, unit: "kg", reorderThreshold: 2,
          }],
        },
      },
      unresolvedActions: {
        availability: "available",
        value: {
          rows: [{
            id: "download-action-1", priority: "high", source: "quality",
            action: "Review", detail: "Café 栗🌶️",
          }],
        },
      },
    };
    const contentHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    await db.insert(finalizedOperationalReportsTable).values({
      id,
      scope: "live",
      reportScope: "day",
      periodStart: "2026-09-06",
      periodEnd: "2026-09-06",
      generatedAt: finalizedAt,
      generatedBy: MANAGER,
      finalizedAt,
      finalizedBy: MANAGER,
      contentHash,
      hashContract: "canonical-json-v2",
      payload,
    });

    expect((await req(null, "GET", `/api/reports/operational/finalized/${id}/export?format=csv`)).status).toBe(401);
    expect((await req(OPERATOR, "GET", `/api/reports/operational/finalized/${id}/export?format=csv`)).status).toBe(403);
    expect((await req(SANDBOX_MANAGER, "GET", `/api/reports/operational/finalized/${id}/export?format=csv`)).status).toBe(404);

    for (const format of ["csv", "xlsx", "print"] as const) {
      const response = await req(MANAGER, "GET", `/api/reports/operational/finalized/${id}/export?format=${format}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-canonical-snapshot-id")).toBe(`finalized:${id}:${contentHash}`);
      expect(response.headers.get("x-canonical-content-hash")).toBe(contentHash);
      expect(response.headers.get("content-disposition")).toContain(`canonical-operational-day-2026-09-06-`);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
      if (format === "csv") {
        const text = bytes.toString("utf8");
        expect(text).toContain(`finalized:${id}:${contentHash}`);
        expect(text).toContain("Café 栗🌶️");
        expect(text).toContain("'=HYPERLINK");
      } else if (format === "xlsx") {
        expect([...bytes.subarray(0, 4)]).toEqual([80, 75, 3, 4]);
      } else {
        const text = bytes.toString("utf8");
        expect(text).toContain(`finalized:${id}:${contentHash}`);
        expect(text).toContain("Café 栗🌶️");
        expect(text).toContain("@media print");
      }
    }
  });
});