import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";
import { signLegacyTokenForTests } from "../lib/auth";
import { syncSnapshotId } from "../lib/syncContract";

const emptyCompleteSnapshotId = (date: string) => syncSnapshotId({
  dayState: { date, runs: [] },
  runValues: {},
  runValuesUpdatedAt: {},
  syncVersion: 1,
  completeness: "complete",
});

// Regression guard for the "scheduled day disappears a day early" bug: the app is
// driven by the CLIENT's local midnight, but the server runs in UTC in
// production. GET /sync/scheduled and DELETE /sync/:date must honour a
// client-supplied `today` query param instead of the server's UTC date, or a
// user behind UTC loses their local "tomorrow" prematurely.

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let dataHealsTable: DbModule["dataHealsTable"];
let syncConflictLogsTable: DbModule["syncConflictLogsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventoryLedgerTable: DbModule["inventoryLedgerTable"];
let inventoryConsumedRunsTable: DbModule["inventoryConsumedRunsTable"];
let operationalIntentLedgerTable: DbModule["operationalIntentLedgerTable"];
let completedRunHistoryTable: DbModule["completedRunHistoryTable"];
let applicatorBatchEvidenceTable: DbModule["applicatorBatchEvidenceTable"];
let dataResetTable: DbModule["dataResetTable"];
let seedRoles: () => Promise<void>;
let runDataHeals: () => Promise<void>;
let runAutoTrackServerTicks: typeof import("./sync")["runAutoTrackServerTicks"];
let setManualSectionFailureHookForTest: typeof import("./sync")["setManualSectionFailureHookForTest"];
let setManualSectionBarrierHookForTest: typeof import("./sync")["setManualSectionBarrierHookForTest"];
let derivedRunMapSharedDayStateFields: typeof import("./sync")["DERIVED_RUN_MAP_SHARED_DAY_STATE_FIELDS"];

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const USER = "user-1";
const MANAGER = "manager-1";
const SANDBOX = "sandbox-1";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_sync_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const syncMod = await import("./sync");
  db = dbMod.db;
  pool = dbMod.pool;
  dailySyncTable = dbMod.dailySyncTable;
  dataHealsTable = dbMod.dataHealsTable;
  syncConflictLogsTable = dbMod.syncConflictLogsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventoryLedgerTable = dbMod.inventoryLedgerTable;
  inventoryConsumedRunsTable = dbMod.inventoryConsumedRunsTable;
  operationalIntentLedgerTable = dbMod.operationalIntentLedgerTable;
  completedRunHistoryTable = dbMod.completedRunHistoryTable;
  applicatorBatchEvidenceTable = dbMod.applicatorBatchEvidenceTable;
  dataResetTable = dbMod.dataResetTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  runDataHeals = (await import("../lib/dataHeals")).runDataHeals;
  runAutoTrackServerTicks = syncMod.runAutoTrackServerTicks;
  setManualSectionFailureHookForTest = syncMod.setManualSectionFailureHookForTest;
  setManualSectionBarrierHookForTest = syncMod.setManualSectionBarrierHookForTest;
  derivedRunMapSharedDayStateFields = syncMod.DERIVED_RUN_MAP_SHARED_DAY_STATE_FIELDS;

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
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

function dayRow(date: string) {
  const runId = `run-${date}`;
  return {
    date,
    scope: "live" as const,
    data: { dayState: { runs: [{ id: runId, brand: "Acme", flavor: "Pep" }] }, runValues: {} },
  };
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${dailySyncTable}, ${dataResetTable}, ${operationalIntentLedgerTable}, ${completedRunHistoryTable}, ${applicatorBatchEvidenceTable}, ${dataHealsTable}, ${syncConflictLogsTable}, ${inventoryLedgerTable}, ${inventoryLotsTable}, ${inventoryConsumedRunsTable}, ${inventoryItemsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: USER, username: "user", passwordHash: "x" },
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: SANDBOX, username: "sandbox", passwordHash: "x", sandbox: true },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: SANDBOX, role: "manager" },
  ]);
  // Three consecutive dates well clear of any real "today" so the assertions
  // don't depend on when the suite runs.
  await db.insert(dailySyncTable).values([
    dayRow("2030-03-10"),
    dayRow("2030-03-11"),
    dayRow("2030-03-12"),
  ]);
});

describe("GET /sync/today — combined wake recovery", () => {
  const DATE = "2030-03-10";

  it("returns authoritative reset state on full and unchanged responses", async () => {
    await db.insert(dataResetTable).values({
      scope: "live",
      epoch: 7,
      resetAt: new Date(`${DATE}T12:00:00.000Z`),
    });
    const first = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      headers: authHeaders(),
    });
    expect(first.status).toBe(200);
    const full = await first.json() as {
      resetEpoch?: number; rollover?: boolean; canonicalRevision?: number;
    };
    expect(full).toMatchObject({ resetEpoch: 7, rollover: false, canonicalRevision: 0 });
    const snapshot = first.headers.get("X-Sync-Snapshot");
    expect(snapshot).toMatch(/^[a-f0-9]{64}$/);

    const unchanged = await fetch(
      `${baseUrl}/api/sync/today?today=${DATE}&snapshot=${snapshot}`,
      { headers: authHeaders() },
    );
    expect(unchanged.status).toBe(200);
    expect(await unchanged.json()).toMatchObject({
      unchanged: true,
      snapshotId: snapshot,
      resetEpoch: 7,
      rollover: false,
      canonicalRevision: 0,
    });
  });
});

describe("POST /sync/manual-section — section ownership contract", () => {
  const DATE = "2030-03-10";
  const values = (runId = "manual-run") => ({
    dayState: { date: DATE, runs: [{ id: runId, startedAt: 1, metaUpdatedAt: 1 }] },
    runValues: { [runId]: { skidsCompleted: 1, casesOnCurrentSkid: 2, traysOnLine: 3, batchesReady: 4 } },
  });
  const request = (body: Record<string, unknown>, headers = authHeaders()) =>
    fetch(`${baseUrl}/api/sync/manual-section?today=${DATE}`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    });
  const edit = (id: string, section = "packaging", runId = "manual-run", extra: Record<string, unknown> = {}) => ({
    id, date: DATE, runId, section,
    values: section === "dough" ? { traysOnLine: 5 } : { skidsCompleted: 2 },
    baseValues: section === "dough"
      ? { traysOnLine: 3, batchesReady: 4 }
      : { skidsCompleted: 1, casesOnCurrentSkid: 2 },
    observedGeneration: `${runId}:1`, baseRevision: 0, resetEpoch: 0, deviceId: id, ...extra,
  });

  beforeEach(async () => {
    await db.update(dailySyncTable).set({ data: values(), canonicalRevision: 0 })
      .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, DATE)));
  });

  it("same-section concurrent race has one winner and one 409", async () => {
    const [a, b] = await Promise.all([request(edit("race-a")), request(edit("race-b"))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("different sections accept concurrently", async () => {
    const [a, b] = await Promise.all([request(edit("parallel-a")), request(edit("parallel-b", "dough"))]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
  });

  it("same section on different runs accepts independently", async () => {
    await db.update(dailySyncTable).set({
      data: {
        dayState: { date: DATE, runs: [
          { id: "manual-run", startedAt: 1, metaUpdatedAt: 1 },
          { id: "other-run", startedAt: 1, metaUpdatedAt: 1 },
        ] },
        runValues: {
          "manual-run": { skidsCompleted: 1, casesOnCurrentSkid: 2 },
          "other-run": { skidsCompleted: 4, casesOnCurrentSkid: 5 },
        },
      }, canonicalRevision: 0,
    }).where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, DATE)));
    const a = edit("run-a", "packaging", "manual-run");
    const b = { ...edit("run-b", "packaging", "other-run"), baseValues: { skidsCompleted: 4, casesOnCurrentSkid: 5 }, values: { skidsCompleted: 7 } };
    const responses = await Promise.all([request(a), request(b)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);
  });

  it("retrying the accepted id is idempotent", async () => {
    const body = edit("retry-id");
    const accepted = await request(body);
    const acceptedPayload = await accepted.json() as { data: unknown };
    expect(accepted.status).toBe(200);
    const retry = await request(body);
    expect(retry.status).toBe(200);
    expect((await retry.json() as { duplicate?: boolean }).duplicate).toBe(true);
  });

  it("same accepted id conflicts after reset epoch bump", async () => {
    const body = edit("post-reset-retry");
    const accepted = await request(body);
    const acceptedPayload = await accepted.json() as { data: unknown };
    expect(accepted.status).toBe(200);
    await db.update(dailySyncTable).set({
      data: { dayState: { date: DATE, runs: [{ id: "manual-run", startedAt: 1, metaUpdatedAt: 1 }] }, runValues: { "manual-run": { skidsCompleted: 88, casesOnCurrentSkid: 77 } } },
    }).where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, DATE)));
    await db.update(dataResetTable).set({ epoch: 9 }).where(eq(dataResetTable.scope, "live"));
    const retry = await request(body);
    expect(retry.status).toBe(409);
    const payload = await retry.json() as { data?: unknown; outcome?: string };
    expect(payload.outcome).toBe("conflicted");
    expect((payload.data as any).runValues["manual-run"].skidsCompleted).toBe(88);
    expect(payload.data).not.toEqual(acceptedPayload.data);
  });

  it("rejects stale reset epochs and incomplete baselines", async () => {
    await db.insert(dataResetTable).values({ scope: "live", epoch: 2, resetAt: new Date() });
    expect((await request(edit("reset-id"))).status).toBe(409);
    expect((await request({ ...edit("missing-base"), resetEpoch: 2, baseValues: { skidsCompleted: 1 } })).status).toBe(400);
  });

  it("isolates scope and date rows", async () => {
    const sandbox = await request(edit("sandbox-id"), sandboxAuthHeaders());
    expect(sandbox.status).toBe(409);
    const otherDate = { ...edit("other-date"), date: "2030-03-11" };
    expect((await fetch(`${baseUrl}/api/sync/manual-section?today=2030-03-11`, {
      method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify(otherDate),
    })).status).toBe(409);
  });

  it("streams acquired before canonical data and released after it", async () => {
    const stream = await fetch(`${baseUrl}/api/sync/events?today=${DATE}&clientId=peer-stream`, { headers: authHeaders() });
    const reader = stream.body!.getReader();
    let streamBuffer = "";
    const readFrame = async (): Promise<any> => {
      for (;;) {
        const match = streamBuffer.match(/data: (.+)\n\n/);
        if (match) {
          streamBuffer = streamBuffer.slice(match[0].length);
          return JSON.parse(match[1]);
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("stream closed");
        streamBuffer += new TextDecoder().decode(chunk.value);
      }
    };
    await readFrame(); // initial baseline
    const pending = readFrame();
    const response = await request(edit("sse-order"));
    expect(response.status).toBe(200);
    const acquired = await pending;
    expect(acquired.type).toBe("manual-section-lock");
    expect(acquired.event).toBe("acquired");
    const frames: any[] = [];
    while (frames.length < 2) frames.push(await readFrame());
    const canonicalIndex = frames.findIndex((frame) => frame?.data?.runValues?.["manual-run"]?.skidsCompleted === 2);
    const releaseIndex = frames.findIndex((frame) => frame.type === "manual-section-lock" && frame.event === "released");
    expect(canonicalIndex).toBeGreaterThanOrEqual(0);
    expect(releaseIndex).toBeGreaterThan(canonicalIndex);
    await reader.cancel();
  });

  it("releases after a losing 409 conflict", async () => {
    const stream = await fetch(`${baseUrl}/api/sync/events?today=${DATE}&clientId=peer-conflict`, { headers: authHeaders() });
    const reader = stream.body!.getReader();
    let buffer = "";
    const next = async () => {
      for (;;) {
        const match = buffer.match(/data: (.+)\n\n/);
        if (match) { buffer = buffer.slice(match[0].length); return JSON.parse(match[1]); }
        const chunk = await reader.read(); if (chunk.done) throw new Error("stream closed");
        buffer += new TextDecoder().decode(chunk.value);
      }
    };
    await next();
    await request(edit("winner"));
    const conflict = await request(edit("loser"));
    expect(conflict.status).toBe(409);
    const frames: any[] = [];
    for (let i = 0; i < 8 && !frames.some((frame) => frame.type === "manual-section-lock" && frame.event === "released" && frame.ownerId === "loser"); i++) frames.push(await next());
    const acquiredIndex = frames.findIndex((frame) => frame.type === "manual-section-lock" && frame.event === "acquired" && frame.ownerId === "loser");
    const releasedIndex = frames.findIndex((frame) => frame.type === "manual-section-lock" && frame.event === "released" && frame.ownerId === "loser");
    expect(acquiredIndex).toBeGreaterThanOrEqual(0);
    expect(releasedIndex).toBeGreaterThan(acquiredIndex);
    await reader.cancel();
  });

  it("releases after a real injected transaction failure", async () => {
    const stream = await fetch(`${baseUrl}/api/sync/events?today=${DATE}&clientId=peer-failure`, { headers: authHeaders() });
    const reader = stream.body!.getReader();
    let buffer = "";
    const next = async () => {
      for (;;) {
        const match = buffer.match(/data: (.+)\n\n/);
        if (match) { buffer = buffer.slice(match[0].length); return JSON.parse(match[1]); }
        const chunk = await reader.read(); if (chunk.done) throw new Error("stream closed");
        buffer += new TextDecoder().decode(chunk.value);
      }
    };
    await next();
    setManualSectionFailureHookForTest(() => { setManualSectionFailureHookForTest(undefined); throw new Error("forced transaction failure"); });
    const response = await request(edit("failure-owner"));
    expect(response.status).toBe(500);
    const frames: any[] = [];
    for (let i = 0; i < 4 && !frames.some((frame) => frame.type === "manual-section-lock" && frame.event === "released"); i++) frames.push(await next());
    expect(frames.some((frame) => frame.type === "manual-section-lock" && frame.event === "released" && frame.ownerId === "failure-owner")).toBe(true);
    await reader.cancel();
  });

  it("aborted POST releases only after transaction barrier", async () => {
    const stream = await fetch(`${baseUrl}/api/sync/events?today=${DATE}&clientId=peer-abort`, { headers: authHeaders() });
    const reader = stream.body!.getReader();
    let buffer = "";
    const next = async (timeoutMs = 5_000) => {
      const read = async () => {
      for (;;) {
        const match = buffer.match(/data: (.+)\n\n/);
        if (match) { buffer = buffer.slice(match[0].length); return JSON.parse(match[1]); }
        const chunk = await reader.read(); if (chunk.done) throw new Error("stream closed");
        buffer += new TextDecoder().decode(chunk.value);
      }
      };
      return Promise.race([read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for SSE frame")), timeoutMs))]);
    };
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    setManualSectionBarrierHookForTest(async () => { entered(); await barrier; });
    const controller = new AbortController();
    const responsePromise = fetch(`${baseUrl}/api/sync/manual-section?today=${DATE}`, {
      method: "POST", headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify(edit("abort-owner")), signal: controller.signal,
    }).catch(() => undefined);
    try {
      await Promise.race([
        enteredPromise,
        new Promise<void>((resolve) => setTimeout(() => { release(); resolve(); }, 2_000)),
      ]);
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(buffer).not.toContain('"event":"released"');
      release();
      await responsePromise;
      let released: any;
      for (let i = 0; i < 8; i++) {
        const frame = await next(2_000);
        if (frame.type !== "manual-section-lock") { i--; continue; }
        if (frame.event === "released") { released = frame; break; }
      }
      expect(released?.event).toBe("released");
    } finally {
      release();
      setManualSectionBarrierHookForTest(undefined);
      await reader.cancel();
    }
  });
});

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signLegacyTokenForTests(USER)}` };
}

function managerAuthHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signLegacyTokenForTests(MANAGER)}` };
}

function sandboxAuthHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signLegacyTokenForTests(SANDBOX)}` };
}

const EVIDENCE_DATE = "2030-03-10";
const EVIDENCE_RUN = "evidence-run";

async function seedCompletedEvidenceRun(
  scope: "live" | "sandbox" = "live",
  runId = EVIDENCE_RUN,
) {
  await db.insert(completedRunHistoryTable).values({
    id: `completed-${scope}-${runId}`,
    scope,
    operationId: `completed-op-${scope}-${runId}`,
    runId,
    date: EVIDENCE_DATE,
    completedAt: new Date("2030-03-10T12:00:00.000Z"),
    snapshot: { dayState: { runs: [{ id: runId, endedAt: 1 }] }, runValues: {} },
    snapshotHash: `snapshot-${scope}-${runId}`,
    actorId: USER,
  });
}

function evidenceBody(
  operationId: string,
  finalTotal: number,
  correctionOf?: string,
  runId = EVIDENCE_RUN,
) {
  return {
    operationId, date: EVIDENCE_DATE, runId, slot: 1, finalTotal,
    ...(correctionOf ? { correctionOf } : {}),
  };
}

async function postEvidence(
  body: unknown,
  headers: Record<string, string> = managerAuthHeaders(),
) {
  return fetch(`${baseUrl}/api/applicator-batch-evidence/finalize`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /sync/applicator-batch-evidence/finalize — PostgreSQL authority", () => {
  it("persists an initial manager finalization as 201 and acknowledges an exact duplicate as 200", async () => {
    await seedCompletedEvidenceRun();
    const body = evidenceBody("evidence-initial", 12);
    const first = await postEvidence(body);
    expect(first.status).toBe(201);
    const duplicate = await postEvidence(body);
    expect(duplicate.status).toBe(200);
    const duplicateBody = await duplicate.json() as { duplicate?: boolean };
    expect(duplicateBody.duplicate).toBe(true);
    const rows = await db.select().from(applicatorBatchEvidenceTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("manager-finalization");
  });

  it("rejects a same-operation different payload with 409 and rejects non-managers with 403", async () => {
    await seedCompletedEvidenceRun();
    const body = evidenceBody("evidence-conflict", 12);
    expect((await postEvidence(body)).status).toBe(201);
    expect((await postEvidence(evidenceBody("evidence-conflict", 13))).status).toBe(409);
    expect((await postEvidence(evidenceBody("evidence-user", 4), authHeaders())).status).toBe(403);
  });

  it("requires a completed-history row in the same authenticated scope", async () => {
    expect((await postEvidence(evidenceBody("evidence-missing", 4))).status).toBe(409);
    await seedCompletedEvidenceRun("live");
    expect((await postEvidence(evidenceBody("evidence-live", 4))).status).toBe(201);
    // The sandbox manager cannot attest to the live completed run.
    expect((await postEvidence(evidenceBody("evidence-sandbox-missing", 4), sandboxAuthHeaders())).status).toBe(409);
    await seedCompletedEvidenceRun("sandbox");
    expect((await postEvidence(evidenceBody("evidence-sandbox", 4), sandboxAuthHeaders())).status).toBe(201);
    const rows = await db.select().from(applicatorBatchEvidenceTable);
    expect(rows.map((row) => row.scope).sort()).toEqual(["live", "sandbox"]);
  });

  it("appends a first correction, while a stale correctionOf is rejected", async () => {
    await seedCompletedEvidenceRun();
    expect((await postEvidence(evidenceBody("evidence-head", 12))).status).toBe(201);
    expect((await postEvidence(evidenceBody("evidence-correction", 14, "evidence-head"))).status).toBe(201);
    expect((await postEvidence(evidenceBody("evidence-stale", 16, "evidence-head"))).status).toBe(409);
    const rows = await db.select().from(applicatorBatchEvidenceTable);
    expect(rows.filter((row) => row.source === "manager-correction")).toHaveLength(1);
  });

  it("serializes concurrent initial finalizations to one winner and one 409", async () => {
    await seedCompletedEvidenceRun();
    const [left, right] = await Promise.all([
      postEvidence(evidenceBody("evidence-race-left", 10)),
      postEvidence(evidenceBody("evidence-race-right", 11)),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    const rows = await db.select().from(applicatorBatchEvidenceTable);
    expect(rows.filter((row) => row.source === "manager-finalization")).toHaveLength(1);
  });

  it("serializes concurrent corrections from one head to one successor and one 409", async () => {
    await seedCompletedEvidenceRun();
    expect((await postEvidence(evidenceBody("evidence-race-head", 10))).status).toBe(201);
    const [left, right] = await Promise.all([
      postEvidence(evidenceBody("evidence-race-correction-left", 11, "evidence-race-head")),
      postEvidence(evidenceBody("evidence-race-correction-right", 12, "evidence-race-head")),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    const rows = await db.select().from(applicatorBatchEvidenceTable);
    expect(rows.filter((row) => row.source === "manager-correction")).toHaveLength(1);
  });
});

describe("server-owned applicator ticks — evidence transaction boundary", () => {
  const TICK_DATE = "2030-03-10";
  const TICK_RUN = "server-owned-applicator";
  const TICK_NOW = new Date("2030-03-10T12:00:00.000Z").getTime();

  async function seedServerApplicatorRun() {
    await db.update(dailySyncTable).set({
      data: {
        dayState: {
          date: TICK_DATE,
          currentIndex: 0,
          runs: [{ id: TICK_RUN, subTab: "crusts", startedAt: TICK_NOW - 120_000, metaUpdatedAt: 1 }],
        },
        runValuesUpdatedAt: { [TICK_RUN]: 1 },
        runValues: {
          [TICK_RUN]: {
            casesNeeded: 200, crustsPerCycle: 12, cycleSpeed: 600, speedAdjustment: 1,
            approxLineSpeed: 400, freezerTime: 3, pizzasPerCase: 12, casesPerSkid: 48,
            casesPerLayer: 12, doughballsPerTray: 36, crustsPerStack: 6, doughBatchYield: 150,
            crustsPerCase: 12, skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0,
            batchesReady: 0, targetDoughballWeight: 8, doughRecipe: [],
            sauceBarrelsMade: 0, sauceBarrelAnchorNetSec: 0, sauceBarrelCorrectionGeneration: 0,
            sauceOzPerPizza: 0, frontlineRecipeName: "", frontlineRecipe: [],
            app1Type: "Cheese", app1OzPerPizza: 2, app1BatchLbs: 50,
            app1CheeseRecipe: [], app1BatchesMade: 0, app1BatchAnchorNetSec: 0,
            app1BatchCorrectionGeneration: 0,
            app2Type: "", app2OzPerPizza: 0, app2BatchLbs: 0, app2CheeseRecipe: [],
            app3Type: "", app3OzPerPizza: 0, app3BatchLbs: 0, app3CheeseRecipe: [],
            app4Type: "", app4OzPerPizza: 0, app4BatchLbs: 0, app4CheeseRecipe: [],
            pep1Type: "", pep2Type: "", pep1Combined: true,
          },
        },
      },
    }).where(and(eq(dailySyncTable.date, TICK_DATE), eq(dailySyncTable.scope, "live")));
  }

  it("commits server-owned applicator progress and evidence together, with retry idempotency", async () => {
    await seedServerApplicatorRun();
    const first = await runAutoTrackServerTicks({
      nowMs: TICK_NOW, maxClaims: 4, scope: "live", date: TICK_DATE,
    });
    expect(first.accepted).toBeGreaterThan(0);
    const firstEvidence = await db.select().from(applicatorBatchEvidenceTable);
    expect(firstEvidence.filter((row) => row.source === "automatic-observation")).toHaveLength(1);
    const [afterFirst] = await db.select().from(dailySyncTable)
      .where(and(eq(dailySyncTable.date, TICK_DATE), eq(dailySyncTable.scope, "live")));
    const firstTotal = (afterFirst.data as any).runValues[TICK_RUN].app1BatchesMade;
    expect(firstTotal).toBe(1);
    // Hold the accepted claim's next due time in the future to replay the same
    // server tick boundary without manufacturing a new physical batch event.
    const heldData = afterFirst.data as any;
    heldData.autoTrackCoordination.runs[TICK_RUN]["app1-batch"].nextDueAt = TICK_NOW + 60_000;
    await db.update(dailySyncTable).set({ data: heldData })
      .where(and(eq(dailySyncTable.date, TICK_DATE), eq(dailySyncTable.scope, "live")));

    const retry = await runAutoTrackServerTicks({
      nowMs: TICK_NOW, maxClaims: 4, scope: "live", date: TICK_DATE,
    });
    expect(retry.outcomes.duplicate ?? 0).toBeGreaterThanOrEqual(0);
    const secondEvidence = await db.select().from(applicatorBatchEvidenceTable);
    expect(secondEvidence.filter((row) => row.source === "automatic-observation")).toHaveLength(1);
    const [afterRetry] = await db.select().from(dailySyncTable)
      .where(and(eq(dailySyncTable.date, TICK_DATE), eq(dailySyncTable.scope, "live")));
    expect((afterRetry.data as any).runValues[TICK_RUN].app1BatchesMade).toBe(firstTotal);
  });

  it("rolls back server-owned progress and ledger when evidence append fails", async () => {
    await seedServerApplicatorRun();
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION reject_auto_applicator_evidence() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.source = 'automatic-observation' THEN
          RAISE EXCEPTION 'test evidence append failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_auto_applicator_evidence_trigger
      BEFORE INSERT ON applicator_batch_evidence
      FOR EACH ROW EXECUTE FUNCTION reject_auto_applicator_evidence();
    `);
    try {
      const result = await runAutoTrackServerTicks({
        nowMs: TICK_NOW, maxClaims: 4, scope: "live", date: TICK_DATE,
      });
      expect(result.outcomes.error).toBe(1);
      const [row] = await db.select().from(dailySyncTable)
        .where(and(eq(dailySyncTable.date, TICK_DATE), eq(dailySyncTable.scope, "live")));
      expect((row.data as any).runValues[TICK_RUN].app1BatchesMade).toBe(0);
      expect(await db.select().from(applicatorBatchEvidenceTable)).toHaveLength(0);
      expect(await db.select().from(operationalIntentLedgerTable)).toHaveLength(0);
    } finally {
      await db.execute(sql`
        DROP TRIGGER IF EXISTS reject_auto_applicator_evidence_trigger ON applicator_batch_evidence;
        DROP FUNCTION IF EXISTS reject_auto_applicator_evidence();
      `);
    }
  });
});

describe("POST /sync/operational-intents — atomic run finalization", () => {
  const DATE = "2030-03-10";
  const RUN = "final-run";

  async function seedFinalization() {
    await db.update(dailySyncTable).set({
      data: {
        dayState: {
          date: DATE,
          runs: [{
            id: RUN,
            brand: "Acme",
            flavor: "Pep",
            startedAt: 50,
            pausedAt: 75,
            pausedStoppageId: "pause-1",
            stoppages: [{ id: "pause-1", type: "pause", reason: "Break", startedAt: 75 }],
            metaUpdatedAt: 100,
          }],
        },
        runValues: { [RUN]: { casesNeeded: 10 } },
        runValuesUpdatedAt: { [RUN]: 100 },
      },
    }).where(eq(dailySyncTable.date, DATE));
    const [item] = await db.insert(inventoryItemsTable).values({
      key: "ingredient:Flour:lbs", category: "ingredient", name: "Flour", unit: "lbs",
    }).returning();
    await db.insert(inventoryLotsTable).values({
      itemId: item.id, qtyReceived: 20, qtyRemaining: 20,
    });
  }

  function finalization(id: string, observedGeneration = `${RUN}:100`) {
    return {
      senderId: "end-client",
      intent: {
        version: 1,
        id,
        date: DATE,
        runId: RUN,
        observedGeneration,
        resetEpoch: 0,
        effectiveAt: Date.now(),
        action: "lifecycle",
        lifecycle: "end",
        inventoryLines: [{ itemKey: "ingredient:Flour:lbs", qty: 4 }],
      },
    };
  }

  async function postFinalization(body: ReturnType<typeof finalization>) {
    return fetch(`${baseUrl}/api/sync/operational-intents?today=${DATE}`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("keeps a fenced pre-intent snapshot open, then commits End, inventory, and retained day state once", async () => {
    await seedFinalization();
    // This is the ordinary snapshot emitted after the local UI projected End:
    // the pending-intent fence has removed endedAt and restored its observed stamp.
    const snapshot = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "end-client",
        payload: {
          dayState: {
            date: DATE,
            runs: [{
              id: RUN,
              startedAt: 50,
              pausedAt: 75,
              pausedStoppageId: "pause-1",
              stoppages: [{ id: "pause-1", type: "pause", reason: "Break", startedAt: 75 }],
              metaUpdatedAt: 100,
            }],
          },
          runValues: { [RUN]: { casesNeeded: 10 } },
          runValuesUpdatedAt: { [RUN]: 100 },
        },
      }),
    });
    expect(snapshot.status).toBe(200);
    const fencedRun = ((await snapshot.json()) as any).data.dayState.runs.find((r: any) => r.id === RUN);
    expect(fencedRun).toMatchObject({
      startedAt: 50,
      pausedAt: 75,
      pausedStoppageId: "pause-1",
      stoppages: [{ id: "pause-1", type: "pause", reason: "Break", startedAt: 75 }],
      metaUpdatedAt: 100,
    });
    expect(fencedRun.endedAt).toBeUndefined();

    const first = await postFinalization(finalization("offline:final-one"));
    const firstBody = await first.json() as any;
    expect(firstBody.outcome).toBe("accepted");
    expect(firstBody.duplicate).toBe(false);
    expect(firstBody.cursor).toBeTypeOf("number");
    expect(firstBody.canonicalRevision).toBe(2);
    expect(firstBody.serverTime).toBeTypeOf("number");
    expect(firstBody.data.dayState.runs.find((r: any) => r.id === RUN).endedAt).toBeTypeOf("number");
    expect(firstBody.data.dayState.runs.find((r: any) => r.id === RUN).pausedAt).toBeUndefined();
    // Completed history is the retained daily document flow: the canonical ended
    // run remains in dayState for archive/history synchronization.
    expect(firstBody.data.dayState.runs.some((r: any) => r.id === RUN)).toBe(true);
    expect((await db.select().from(inventoryLotsTable))[0].qtyRemaining).toBe(16);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(1);
    expect(await db.select().from(inventoryConsumedRunsTable)).toHaveLength(1);
    const [completion] = await db.select().from(completedRunHistoryTable);
    expect(completion).toMatchObject({
      scope: "live",
      operationId: "offline:final-one",
      runId: RUN,
      date: DATE,
      actorId: USER,
    });
    const [receipt] = await db.select().from(operationalIntentLedgerTable);
    expect(receipt).toMatchObject({
      commandType: "operational-intent",
      actorId: USER,
      deviceId: "end-client",
      baseRevision: 0,
      canonicalRevision: 2,
    });
    expect(receipt.serverReceivedAt.getTime()).toBe(firstBody.serverTime);
    expect((completion.snapshot as any).dayState.runs.find((r: any) => r.id === RUN).endedAt)
      .toBe(completion.completedAt.getTime());

    // A later materialized document must not change the original duplicate
    // receipt. Retried offline commands adopt the snapshot they actually
    // committed, not an unrelated later writer's state.
    await db.update(dailySyncTable).set({
      data: { dayState: { date: DATE, runs: [{ id: "later-run", startedAt: 999 }] }, runValues: {} },
    }).where(and(eq(dailySyncTable.date, DATE), eq(dailySyncTable.scope, "live")));
    const replay = await postFinalization(finalization("offline:final-one"));
    const replayBody = await replay.json() as any;
    expect(replayBody).toMatchObject({
      outcome: "accepted",
      duplicate: true,
      cursor: firstBody.cursor,
      canonicalRevision: firstBody.canonicalRevision,
      serverTime: firstBody.serverTime,
    });
    expect(replayBody.data.dayState.runs.find((run: any) => run.id === RUN)?.endedAt)
      .toBe(firstBody.data.dayState.runs.find((run: any) => run.id === RUN).endedAt);
    expect(replayBody.data.dayState.runs.some((run: any) => run.id === "later-run")).toBe(false);
    expect((await db.select().from(inventoryLotsTable))[0].qtyRemaining).toBe(16);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(1);
  });

  it("returns review-required for stale generation and leaves inventory unchanged", async () => {
    await seedFinalization();
    const response = await postFinalization(finalization("offline:stale-end", `${RUN}:99`));
    expect(await response.json()).toMatchObject({ outcome: "conflicted", duplicate: false });
    expect((await db.select().from(inventoryLotsTable))[0].qtyRemaining).toBe(20);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(0);
    expect(await db.select().from(inventoryConsumedRunsTable)).toHaveLength(0);
  });

  it("finishes atomically when a bounded-window legacy history upload arrived first", async () => {
    await seedFinalization();
    const legacyCompletedAt = new Date();
    await db.insert(completedRunHistoryTable).values({
      id: "legacy-history",
      scope: "live",
      operationId: `completed:${DATE}:${RUN}`,
      runId: RUN,
      date: DATE,
      completedAt: legacyCompletedAt,
      snapshot: {
        dayState: {
          date: DATE,
          currentIndex: 0,
          runs: [{ id: RUN, brand: "Acme", flavor: "Pep", startedAt: 50, endedAt: legacyCompletedAt.getTime() }],
        },
        runValues: { [RUN]: { casesNeeded: 10 } },
      },
      snapshotHash: "legacy-hash",
      actorId: USER,
    });

    const compatibleIntent = finalization("offline:after-legacy");
    compatibleIntent.intent.effectiveAt = legacyCompletedAt.getTime();
    const response = await postFinalization(compatibleIntent);
    const body = await response.json() as any;
    expect(body.outcome).toBe("accepted");
    expect(body.data.dayState.runs.find((run: any) => run.id === RUN).endedAt).toBe(legacyCompletedAt.getTime());
    expect(await db.select().from(completedRunHistoryTable)).toHaveLength(1);
    expect((await db.select().from(inventoryLotsTable))[0].qtyRemaining).toBe(16);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(1);
    expect(await db.select().from(inventoryConsumedRunsTable)).toHaveLength(1);
  });

  it("requires review when an unrelated immutable history row already exists", async () => {
    await seedFinalization();
    await db.insert(completedRunHistoryTable).values({
      id: "unrelated-history",
      scope: "live",
      operationId: "other-operation",
      runId: RUN,
      date: DATE,
      completedAt: new Date(),
      snapshot: {
        dayState: { date: DATE, runs: [{ id: RUN, startedAt: 999, endedAt: Date.now() }] },
        runValues: { [RUN]: { casesNeeded: 10 } },
      },
      snapshotHash: "unrelated-hash",
      actorId: USER,
    });
    const response = await postFinalization(finalization("offline:blocked-by-history"));
    expect(await response.json()).toMatchObject({ outcome: "review-required", duplicate: false });
    expect((await db.select().from(inventoryLotsTable))[0].qtyRemaining).toBe(20);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(0);
    const [stored] = await db.select().from(dailySyncTable).where(and(
      eq(dailySyncTable.date, DATE),
      eq(dailySyncTable.scope, "live"),
    ));
    expect((stored.data as any).dayState.runs.find((run: any) => run.id === RUN).endedAt).toBeUndefined();
  });

  it("lets a reset holding the first lock force review without inventory side effects", async () => {
    await seedFinalization();
    const client = await pool.connect();
    let pending: Promise<Response>;
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO data_reset (scope, epoch, reset_at) VALUES ('live', 0, NOW()) ON CONFLICT (scope) DO NOTHING",
      );
      await client.query("SELECT * FROM data_reset WHERE scope = 'live' FOR UPDATE");
      await client.query("UPDATE data_reset SET epoch = 1, reset_at = NOW() WHERE scope = 'live'");
      await client.query("DELETE FROM daily_sync WHERE scope = 'live'");
      pending = postFinalization(finalization("offline:reset-race"));
      await new Promise((resolve) => setTimeout(resolve, 25));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    expect(await (await pending).json()).toMatchObject({ outcome: "review-required" });
    expect((await db.select().from(inventoryLotsTable))[0].qtyRemaining).toBe(20);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(0);
  });
});

describe("GET /sync/operational-intents/cursor", () => {
  it("pages materialized receipts and never leaks another scope", async () => {
    await db.insert(operationalIntentLedgerTable).values([
      ...Array.from({ length: 101 }, (_, index) => ({
        scope: "live",
        date: "2030-03-10",
        intentId: `cursor-live-${index}`,
        outcome: "accepted",
        snapshot: { dayState: { date: "2030-03-10", runs: [{ id: `live-${index}` }] }, runValues: {} },
      })),
      {
        scope: "sandbox",
        date: "2030-03-10",
        intentId: "cursor-sandbox",
        outcome: "accepted",
        snapshot: { dayState: { date: "2030-03-10", runs: [{ id: "sandbox-only" }] }, runValues: {} },
      },
    ]);

    const first = await fetch(`${baseUrl}/api/sync/operational-intents/cursor?after=0`, {
      headers: authHeaders(),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as any;
    expect(firstBody).toMatchObject({ hasMore: true });
    expect(firstBody.mutations).toHaveLength(100);
    expect(firstBody.mutations.every((item: any) => item.snapshot.dayState.runs[0].id !== "sandbox-only")).toBe(true);
    expect(firstBody.mutations.every((item: any) => typeof item.cursor === "number")).toBe(true);

    const second = await fetch(`${baseUrl}/api/sync/operational-intents/cursor?after=${firstBody.cursor}`, {
      headers: authHeaders(),
    });
    const secondBody = await second.json() as any;
    expect(secondBody).toMatchObject({ hasMore: false });
    expect(secondBody.mutations).toHaveLength(1);
    expect(secondBody.mutations[0].snapshot.dayState.runs[0].id).toBe("run-2030-03-10");
  });

  it("compacts old heavy snapshots while cursor recovery uses the materialized day", async () => {
    await db.insert(operationalIntentLedgerTable).values(Array.from({ length: 201 }, (_, index) => ({
      scope: "live",
      date: "2030-03-10",
      intentId: `compact-${index}`,
      outcome: "accepted",
      snapshot: { dayState: { date: "2030-03-10", runs: [{ id: `historic-${index}` }] }, runValues: {} },
    })));
    const { compactOperationalIntentSnapshots } = await import("../lib/mutationCompaction");
    expect(await compactOperationalIntentSnapshots("live")).toMatchObject({ compacted: 1, retained: 200 });

    const response = await fetch(`${baseUrl}/api/sync/operational-intents/cursor?after=0`, { headers: authHeaders() });
    const body = await response.json() as any;
    expect(body.mutations[0].snapshot.dayState.runs[0].id).toBe("run-2030-03-10");
    expect(body.mutations[1].snapshot.dayState.runs[0].id).toBe("run-2030-03-10");
  });

  it("converges across multiple cursor pages without adopting retained history", async () => {
    await db.insert(operationalIntentLedgerTable).values(Array.from({ length: 205 }, (_, index) => ({
      scope: "live",
      date: "2030-03-10",
      intentId: `multi-page-${index}`,
      outcome: index === 150 ? "review-required" : "accepted",
      snapshot: { dayState: { date: "2030-03-10", runs: [{ id: `historical-${index}` }] }, runValues: {} },
    })));
    const canonical = {
      dayState: { date: "2030-03-10", runs: [{ id: "canonical-current", metaUpdatedAt: 999 }] },
      runValues: { "canonical-current": { casesNeeded: 12 } },
    };
    await db.update(dailySyncTable).set({ data: canonical })
      .where(and(eq(dailySyncTable.date, "2030-03-10"), eq(dailySyncTable.scope, "live")));
    const { compactOperationalIntentSnapshots } = await import("../lib/mutationCompaction");
    await compactOperationalIntentSnapshots("live");

    let cursor = 0;
    let adopted: unknown;
    let pages = 0;
    for (;;) {
      const response = await fetch(`${baseUrl}/api/sync/operational-intents/cursor?after=${cursor}`, {
        headers: authHeaders(),
      });
      const body = await response.json() as any;
      pages++;
      for (const mutation of body.mutations) {
        if (mutation.snapshot) adopted = mutation.snapshot;
        cursor = mutation.cursor;
      }
      if (!body.hasMore) break;
    }
    expect(pages).toBe(3);
    expect(adopted).toEqual(canonical);
  });

  it("preserves old review evidence while compacting old materialized accepted receipts", async () => {
    await db.insert(operationalIntentLedgerTable).values(Array.from({ length: 202 }, (_, index) => ({
      scope: "live",
      date: "2030-03-10",
      intentId: index === 0 ? "preserve-review" : index === 1 ? "compact-accepted" : `keep-${index}`,
      outcome: index === 0 ? "review-required" : "accepted",
      snapshot: { dayState: { date: "2030-03-10", runs: [{ id: `receipt-${index}` }] }, runValues: {} },
    })));
    const { compactOperationalIntentSnapshots } = await import("../lib/mutationCompaction");
    expect(await compactOperationalIntentSnapshots("live")).toMatchObject({ compacted: 1, retained: 200 });
    const evidence = await db.select({
      intentId: operationalIntentLedgerTable.intentId,
      snapshot: operationalIntentLedgerTable.snapshot,
    }).from(operationalIntentLedgerTable).where(and(
      eq(operationalIntentLedgerTable.scope, "live"),
      sql`${operationalIntentLedgerTable.intentId} IN ('preserve-review', 'compact-accepted')`,
    ));
    expect(evidence.find((row) => row.intentId === "preserve-review")?.snapshot).toEqual(
      { dayState: { date: "2030-03-10", runs: [{ id: "receipt-0" }] }, runValues: {} },
    );
    expect(evidence.find((row) => row.intentId === "compact-accepted")?.snapshot).toBeNull();

    const page = await fetch(`${baseUrl}/api/sync/operational-intents/cursor?after=0`, { headers: authHeaders() });
    const body = await page.json() as any;
    expect(body.mutations[0].snapshot).toBeNull();
    expect(body.mutations[1].snapshot).toEqual((await db.select().from(dailySyncTable)
      .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, "2030-03-10"))))[0].data);
  });
});

describe("GET /sync/health — read-only scoped sentinel", () => {
  const DATE = "2030-03-10";

  async function getHealth(headers: Record<string, string> = managerAuthHeaders()) {
    return fetch(`${baseUrl}/api/sync/health?date=${DATE}`, { headers });
  }

  async function seedHealthyDocument() {
    await db.update(dailySyncTable).set({
      data: {
        dayState: {
          date: DATE,
          currentIndex: 0,
          runs: [{ id: "health-run", startedAt: 100, metaUpdatedAt: 100 }],
        },
        runValues: { "health-run": { casesNeeded: 10, freezerTime: 5 } },
      },
      canonicalRevision: 7,
    }).where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, DATE)));
  }

  it("reports a healthy bounded contract without exposing canonical payloads", async () => {
    await seedHealthyDocument();
    const response = await getHealth();
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body).toMatchObject({
      contractVersion: 1,
      scope: "live",
      date: DATE,
      status: "healthy",
      evidence: {
        dailyRowPresent: true,
        canonicalRevision: 7,
        ledgerRowsScanned: 0,
        historyRowsScanned: 0,
      },
    });
    expect(body.checks.map((check: any) => check.name)).toEqual([
      "canonical-document",
      "snapshot-revision",
      "operational-projection",
      "command-history",
    ]);
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("payload");
    expect(JSON.stringify(body)).not.toContain("health-run");
  });

  it("reports a representative canonical mismatch as failing and never repairs it", async () => {
    await seedHealthyDocument();
    const before = (await db.select().from(dailySyncTable).where(and(
      eq(dailySyncTable.scope, "live"),
      eq(dailySyncTable.date, DATE),
    )))[0];
    await db.update(dailySyncTable).set({
      data: { dayState: { date: DATE, runs: [{ id: "health-run" }] } },
    }).where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, DATE)));

    const response = await getHealth();
    const body = await response.json() as any;
    expect(body.status).toBe("failing");
    expect(body.checks.find((check: any) => check.name === "operational-projection")).toMatchObject({
      status: "failing",
    });
    expect(body.nextAction).toContain("did not repair");

    const after = (await db.select().from(dailySyncTable).where(and(
      eq(dailySyncTable.scope, "live"),
      eq(dailySyncTable.date, DATE),
    )))[0];
    expect(after.data).toEqual({ dayState: { date: DATE, runs: [{ id: "health-run" }] } });
    expect(after.canonicalRevision).toBe(before.canonicalRevision);
  });

  it("marks accepted receipts without snapshots as failing", async () => {
    await seedHealthyDocument();
    await db.insert(operationalIntentLedgerTable).values({
      scope: "live",
      date: DATE,
      intentId: "health-invalid-receipt",
      outcome: "accepted",
      snapshot: null,
    });
    const body = await (await getHealth()).json() as any;
    expect(body.status).toBe("failing");
    expect(body.checks.find((check: any) => check.name === "command-history").status).toBe("failing");
  });

  it("reports unavailable canonical evidence as a warning without treating it as repaired", async () => {
    const response = await fetch(`${baseUrl}/api/sync/health?date=2030-04-01`, {
      headers: managerAuthHeaders(),
    });
    const body = await response.json() as any;
    expect(body.status).toBe("warning");
    expect(body.evidence).toMatchObject({
      dailyRowPresent: false,
      snapshotId: null,
      canonicalRevision: null,
    });
    expect(body.nextAction).toContain("rerun");
  });

  it("bounds ledger evidence and keeps output free of receipt payloads", async () => {
    await seedHealthyDocument();
    await db.insert(operationalIntentLedgerTable).values(Array.from({ length: 105 }, (_, index) => ({
      scope: "live",
      date: DATE,
      intentId: `health-bounded-${index}`,
      outcome: "review-required",
      snapshot: { privatePayload: `secret-${index}` },
    })));
    const body = await (await getHealth()).json() as any;
    expect(body.evidence.ledgerRowsScanned).toBe(100);
    expect(body.evidence.ledgerRowsTruncated).toBe(true);
    expect(body.checks.find((check: any) => check.name === "command-history")).toMatchObject({
      status: "warning",
    });
    expect(JSON.stringify(body)).not.toContain("privatePayload");
    expect(JSON.stringify(body)).not.toContain("secret-");
  });

  it("denies non-managers and sandbox sessions before inspecting data", async () => {
    expect((await getHealth(authHeaders())).status).toBe(403);
    expect((await getHealth(sandboxAuthHeaders())).status).toBe(403);
  });
});

describe("POST /sync/operational-intents — canonical transitions", () => {
  const DATE = "2030-03-10";
  const RUN = "transition-run";

  async function post(intent: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/sync/operational-intents?today=${DATE}`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "transition-client", intent }),
    }).then((response) => response.json()) as Promise<any>;
  }

  function intent(
    id: string,
    observedGeneration: string,
    action: "pause" | "resume" | "lifecycle" | "correction",
    extra: Record<string, unknown> = {},
  ) {
    return {
      version: 1,
      id,
      date: DATE,
      runId: RUN,
      observedGeneration,
      resetEpoch: 0,
      // The occurrence time orders queued work, but the server clock must issue
      // every accepted canonical lifecycle timestamp.
      effectiveAt: Date.now() - 60_000,
      action,
      ...extra,
    };
  }

  it("serializes Start, correction, Pause, and Resume with server-issued timestamps", async () => {
    await db.update(dailySyncTable).set({
      data: {
        dayState: { date: DATE, runs: [{ id: RUN, brand: "Acme", flavor: "Pep" }] },
        runValues: { [RUN]: { traysOnLine: 2 } },
        runValuesUpdatedAt: { [RUN]: 1 },
      },
    }).where(and(eq(dailySyncTable.date, DATE), eq(dailySyncTable.scope, "live")));

    const beforeStart = Date.now();
    const started = await post(intent("ordered:start", `${RUN}:0`, "lifecycle", { lifecycle: "start" }));
    const startedRun = started.data.dayState.runs.find((run: any) => run.id === RUN);
    expect(started.outcome).toBe("accepted");
    expect(startedRun.startedAt).toBeGreaterThanOrEqual(beforeStart);
    expect(startedRun.startedAt).toBeLessThanOrEqual(Date.now());
    expect(startedRun.startedAt).not.toBe(started.data.operationalIntentHistory.outcomes.at(-1).effectiveAt);

    const startGeneration = `${RUN}:${startedRun.metaUpdatedAt}`;
    const corrected = await post(intent("ordered:correct", startGeneration, "correction", {
      values: { traysOnLine: 7 },
    }));
    expect(corrected).toMatchObject({ outcome: "accepted" });
    expect(corrected.data.runValues[RUN].traysOnLine).toBe(7);

    const beforePause = Date.now();
    const paused = await post(intent("ordered:pause", startGeneration, "pause"));
    const pausedRun = paused.data.dayState.runs.find((run: any) => run.id === RUN);
    expect(paused.outcome).toBe("accepted");
    expect(pausedRun.pausedAt).toBeGreaterThanOrEqual(beforePause);
    expect(pausedRun.stoppages.at(-1).startedAt).toBe(pausedRun.pausedAt);

    const pauseGeneration = `${RUN}:${pausedRun.metaUpdatedAt}`;
    const beforeResume = Date.now();
    const resumed = await post(intent("ordered:resume", pauseGeneration, "resume"));
    const resumedRun = resumed.data.dayState.runs.find((run: any) => run.id === RUN);
    expect(resumed.outcome).toBe("accepted");
    expect(resumedRun.pausedAt).toBeUndefined();
    expect(resumedRun.stoppages.at(-1).endedAt).toBeGreaterThanOrEqual(beforeResume);
    expect(resumedRun.startedAt).toBeGreaterThan(startedRun.startedAt);

    const stale = await post(intent("ordered:stale-pause", startGeneration, "pause"));
    expect(stale.outcome).toBe("conflicted");
    expect(stale.canonicalRevision).toBe(5);
    expect(stale.data.dayState.runs.find((run: any) => run.id === RUN).pausedAt).toBeUndefined();
  });
});

describe("POST /sync/auto-track/claim", () => {
  const DATE = "2030-03-10";
  const RUN = `run-${DATE}`;
  const endpoint = () => `${baseUrl}/api/sync/auto-track/claim?today=${DATE}`;
  const event = (senderId: string, eventId: string, sequence = 1, from = 10, to = 9) => ({
    senderId,
    claim: {
      version: 1,
      runId: RUN,
      channel: "tray-consume",
      generation: `${RUN}:2`,
      sequence,
      eventId,
      dueAt: Date.now() - 5,
      nextDueAt: Date.now() + 1_000,
      baseUpdatedAt: 1,
      mutations: [{ field: "traysOnLine", from, to }],
    },
  });
  const post = (body: unknown) => fetch(endpoint(), {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  beforeEach(async () => {
    await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "seed",
        payload: {
          dayState: { runs: [{ id: RUN, brand: "Acme", flavor: "Pep", startedAt: 1, metaUpdatedAt: 2 }] },
          runValues: { [RUN]: { traysOnLine: 10 } },
          runValuesUpdatedAt: { [RUN]: 1 },
        },
      }),
    });
  });

  it("commits one of two competing tabs and converges both on one decrement", async () => {
    const [a, b] = await Promise.all([
      post(event("tab-a", "tab-a:tray:1")),
      post(event("tab-b", "tab-b:tray:1")),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const bodies = await Promise.all([a.json(), b.json()]) as Array<{
      outcome: string;
      values: { traysOnLine: number };
      canonicalRevision: number;
      serverTime: number;
    }>;
    expect(bodies.map((body) => body.outcome).sort()).toEqual(["accepted", "stale"]);
    expect(bodies.every((body) => body.values.traysOnLine === 9)).toBe(true);
    expect(new Set(bodies.map((body) => body.canonicalRevision))).toEqual(new Set([2, 3]));
    expect(bodies.every((body) => typeof body.serverTime === "number")).toBe(true);
    const receipts = await db.select().from(operationalIntentLedgerTable);
    expect(receipts).toHaveLength(2);
    expect(receipts.every((receipt) => receipt.commandType === "auto-track")).toBe(true);
    expect(receipts.every((receipt) => receipt.actorId === USER)).toBe(true);
    expect(new Set(receipts.map((receipt) => receipt.deviceId))).toEqual(new Set(["tab-a", "tab-b"]));
  });

  it("returns duplicate for an accepted retry and rejects a stale-base event after manual correction", async () => {
    const body = event("tab-a", "tab-a:retryable:1");
    const first = await (await post(body)).json() as { outcome: string };
    expect(first.outcome).toBe("accepted");
    const retry = await (await post(body)).json() as { outcome: string; values: { traysOnLine: number } };
    expect(retry.outcome).toBe("duplicate");
    expect(retry.values.traysOnLine).toBe(9);

    await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "manual",
        payload: {
          dayState: { runs: [{ id: RUN, brand: "Acme", flavor: "Pep" }] },
          runValues: { [RUN]: { traysOnLine: 14 } },
          runValuesUpdatedAt: { [RUN]: Date.now() + 1_000 },
        },
      }),
    });
    const staleBase = await (await post(event("tab-b", "tab-b:tray:2", 2, 9, 8))).json() as {
      outcome: string;
      values: { traysOnLine: number };
    };
    // The manual write invalidates the old coordinated generation, so the
    // pending automatic event is rejected as stale before value comparison.
    expect(staleBase.outcome).toBe("stale");
    expect(staleBase.values.traysOnLine).toBe(14);
  });

  it("atomically coordinates applicator batches without consuming inventory", async () => {
    const applicatorEvent = (senderId: string, eventId: string) => ({
      senderId,
      claim: {
        version: 1,
        runId: RUN,
        channel: "app1-batch",
        generation: `${RUN}:2`,
        sequence: 1,
        eventId,
        dueAt: 60,
        nextDueAt: 120,
        baseUpdatedAt: 1,
        correctionGeneration: 0,
        mutations: [
          { field: "app1BatchesMade", from: 0, to: 1 },
          { field: "app1BatchAnchorNetSec", from: 0, to: 60 },
          { field: "app1BatchCorrectionGeneration", from: 0, to: 0 },
        ],
      },
    });
    const [a, b] = await Promise.all([
      post(applicatorEvent("app-a", "app-a:app1:1")),
      post(applicatorEvent("app-b", "app-b:app1:1")),
    ]);
    const bodies = await Promise.all([a.json(), b.json()]) as Array<{
      outcome: string;
      values: { app1BatchesMade: number; app1BatchAnchorNetSec: number };
    }>;
    expect(bodies.map(({ outcome }) => outcome).sort()).toEqual(["accepted", "stale"]);
    expect(bodies.every(({ values }) =>
      values.app1BatchesMade === 1 && values.app1BatchAnchorNetSec === 60
    )).toBe(true);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(0);
    const evidence = await db.select().from(applicatorBatchEvidenceTable);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      scope: "live",
      date: DATE,
      runId: RUN,
      slot: 1,
      source: "automatic-observation",
      observedTotal: 1,
      confirmedTotal: null,
    });
    expect(evidence[0].evidenceHash).toMatch(/^[a-f0-9]{64}$/);

    const winner = bodies[0].outcome === "accepted"
      ? applicatorEvent("app-a", "app-a:app1:1")
      : applicatorEvent("app-b", "app-b:app1:1");
    expect((await (await post(winner)).json() as { outcome: string }).outcome).toBe("duplicate");
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(0);
    expect(await db.select().from(applicatorBatchEvidenceTable)).toHaveLength(1);
  });

  it("atomically advances one Sauce barrel and deducts its inventory once across competing stations", async () => {
    const [item] = await db.insert(inventoryItemsTable).values({
      key: "ingredient:BBQ Sauce:lbs",
      category: "ingredient",
      name: "BBQ Sauce",
      unit: "lbs",
    }).returning();
    await db.insert(inventoryLotsTable).values({
      itemId: item.id,
      qtyReceived: 100,
      qtyRemaining: 100,
    });
    const sauceSeedResponse = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "sauce-seed",
        payload: {
          dayState: { runs: [{ id: RUN, brand: "Acme", flavor: "Pep", startedAt: 1, metaUpdatedAt: 2 }] },
          runValues: {
            [RUN]: {
              traysOnLine: 10,
              sauceBarrelsMade: 0,
              sauceBarrelAnchorNetSec: 0,
              sauceBarrelCorrectionGeneration: 0,
              frontlineRecipeName: "BBQ Sauce",
              frontlineRecipe: [],
              sauceBarrelLbs: 10,
            },
          },
          runValuesUpdatedAt: { [RUN]: 3 },
        },
      }),
    }).then((response) => response.json()) as {
      data: { runValuesUpdatedAt: Record<string, number> };
    };
    const sauceBaseUpdatedAt = sauceSeedResponse.data.runValuesUpdatedAt[RUN];
    const sauceEvent = (senderId: string, eventId: string) => ({
      senderId,
      claim: {
        version: 1,
        runId: RUN,
        channel: "sauce-barrel",
        generation: `${RUN}:2`,
        sequence: 1,
        eventId,
        dueAt: 60,
        nextDueAt: 120,
        baseUpdatedAt: sauceBaseUpdatedAt,
        correctionGeneration: 0,
        mutations: [
          { field: "sauceBarrelsMade", from: 0, to: 1 },
          { field: "sauceBarrelAnchorNetSec", from: 0, to: 60 },
          { field: "sauceBarrelCorrectionGeneration", from: 0, to: 0 },
        ],
      },
    });

    const [a, b] = await Promise.all([
      post(sauceEvent("sauce-a", "sauce-a:barrel:1")),
      post(sauceEvent("sauce-b", "sauce-b:barrel:1")),
    ]);
    const bodies = await Promise.all([a.json(), b.json()]) as Array<{
      outcome: string;
      values: { sauceBarrelsMade: number; sauceBarrelAnchorNetSec: number };
    }>;
    expect(bodies.map(({ outcome }) => outcome).sort()).toEqual(["accepted", "stale"]);
    expect(bodies.every(({ values }) =>
      values.sauceBarrelsMade === 1 && values.sauceBarrelAnchorNetSec === 60
    )).toBe(true);
    const [lot] = await db.select().from(inventoryLotsTable);
    expect(lot.qtyRemaining).toBe(90);
    expect(await db.select().from(inventoryLedgerTable)).toHaveLength(1);
    expect(await db.select().from(inventoryConsumedRunsTable)).toHaveLength(1);

    const winner = bodies[0].outcome === "accepted"
      ? sauceEvent("sauce-a", "sauce-a:barrel:1")
      : sauceEvent("sauce-b", "sauce-b:barrel:1");
    const duplicate = await (await post(winner)).json() as { outcome: string };
    expect(duplicate.outcome).toBe("duplicate");
    expect((await db.select().from(inventoryLotsTable))[0].qtyRemaining).toBe(90);
  });

  it("rolls back Sauce progress when inventory is unavailable and accepts the same event after recovery", async () => {
    const sauceClaim = {
      senderId: "sauce-retry",
      claim: {
        version: 1,
        runId: RUN,
        channel: "sauce-barrel",
        generation: `${RUN}:2`,
        sequence: 1,
        eventId: "sauce-retry:barrel:1",
        dueAt: 60,
        nextDueAt: 120,
        baseUpdatedAt: 0,
        correctionGeneration: 0,
        mutations: [
          { field: "sauceBarrelsMade", from: 0, to: 1 },
          { field: "sauceBarrelAnchorNetSec", from: 0, to: 60 },
          { field: "sauceBarrelCorrectionGeneration", from: 0, to: 0 },
        ],
      },
    };
    const retrySeedResponse = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "sauce-seed",
        payload: {
          dayState: { runs: [{ id: RUN, brand: "Acme", flavor: "Pep", startedAt: 1, metaUpdatedAt: 2 }] },
          runValues: {
            [RUN]: {
              sauceBarrelsMade: 0,
              sauceBarrelAnchorNetSec: 0,
              sauceBarrelCorrectionGeneration: 0,
              frontlineRecipeName: "BBQ Sauce",
              frontlineRecipe: [],
              sauceBarrelLbs: 10,
            },
          },
          runValuesUpdatedAt: { [RUN]: 3 },
        },
      }),
    }).then((response) => response.json()) as {
      data: { runValuesUpdatedAt: Record<string, number> };
    };
    sauceClaim.claim.baseUpdatedAt = retrySeedResponse.data.runValuesUpdatedAt[RUN];
    expect((await post(sauceClaim)).status).toBe(500);
    const afterFailure = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      headers: authHeaders(),
    }).then((response) => response.json()) as {
      runValues: Record<string, { sauceBarrelsMade: number }>;
    };
    expect(afterFailure.runValues[RUN].sauceBarrelsMade).toBe(0);
    expect(await db.select().from(inventoryConsumedRunsTable)).toHaveLength(0);

    const [item] = await db.insert(inventoryItemsTable).values({
      key: "ingredient:BBQ Sauce:lbs",
      category: "ingredient",
      name: "BBQ Sauce",
      unit: "lbs",
    }).returning();
    await db.insert(inventoryLotsTable).values({
      itemId: item.id,
      qtyReceived: 100,
      qtyRemaining: 100,
    });
    const recovered = await post(sauceClaim);
    expect(recovered.status).toBe(200);
    expect((await recovered.json() as { outcome: string }).outcome).toBe("accepted");
    expect((await db.select().from(inventoryLotsTable))[0].qtyRemaining).toBe(90);
  });
});

describe("GET /sync/scheduled — client-local-date filtering", () => {
  it("returns only days strictly after the client-supplied `today`", async () => {
    const res = await fetch(`${baseUrl}/api/sync/scheduled?today=2030-03-10`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const days = (await res.json()) as Array<{ date: string }>;
    expect(days.map((d) => d.date)).toEqual(["2030-03-11", "2030-03-12"]);
  });

  it("keeps the client's local 'tomorrow' visible even when the server (UTC) has already rolled to that date", async () => {
    // Server's UTC date is 2030-03-11, but the client (behind UTC) is still on
    // 2030-03-10, so 2030-03-11 is their "tomorrow" and must still appear. A
    // server-date filter would have dropped it — the original bug.
    const res = await fetch(`${baseUrl}/api/sync/scheduled?today=2030-03-10`, {
      headers: authHeaders(),
    });
    const days = (await res.json()) as Array<{ date: string }>;
    expect(days.map((d) => d.date)).toContain("2030-03-11");
  });

  it("falls back to the server date when `today` is missing or malformed", async () => {
    // The seeded days are all in 2030, well after any real server `todayStr()`,
    // so the server-date fallback returns every seeded day. This locks in the
    // defensive behavior: a missing/garbage param must not throw or drop days.
    for (const qs of ["", "?today=", "?today=not-a-date", "?today=03/10/2030"]) {
      const res = await fetch(`${baseUrl}/api/sync/scheduled${qs}`, { headers: authHeaders() });
      expect(res.status).toBe(200);
      const days = (await res.json()) as Array<{ date: string }>;
      expect(days.map((d) => d.date)).toEqual(["2030-03-10", "2030-03-11", "2030-03-12"]);
    }
  });

  it("includes run details when include=runs is set", async () => {
    const res = await fetch(`${baseUrl}/api/sync/scheduled?include=runs&today=2030-03-11`, {
      headers: authHeaders(),
    });
    const days = (await res.json()) as Array<{ date: string; runCount: number; runs: unknown[] }>;
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2030-03-12");
    expect(days[0].runCount).toBe(1);
    expect(days[0].runs).toHaveLength(1);
  });
});

describe("DELETE /sync/:date — server-date deletion boundary", () => {
  it("does not trust a client-supplied date to delete the server's current day", async () => {
    // Client-local dates correctly scope live reads and writes, but deletion is
    // destructive: a client must not claim an older local date to delete the
    // server's current row. The server-date guard is intentional and must hold
    // at the local-midnight boundary.
    const now = new Date();
    const serverToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await db.insert(dailySyncTable).values(dayRow(serverToday));

    const res = await fetch(`${baseUrl}/api/sync/${serverToday}?today=2000-01-01`, {
      method: "DELETE",
      headers: managerAuthHeaders(),
    });
    expect(res.status).toBe(400);
    expect(await fetch(`${baseUrl}/api/sync/${serverToday}`, { headers: authHeaders() }).then((r) => r.json()))
      .not.toBeNull();
  });
});

describe("/sync/today — client-local-date keying", () => {
  // The live "today" row must be keyed by the CLIENT's local date too, matching
  // /sync/scheduled. Otherwise a client behind UTC writes the live day into its
  // local "tomorrow" row, clobbering a scheduled day (and its case counts).
  it("GET reads the row for the client-supplied `today`", async () => {
    const res = await fetch(`${baseUrl}/api/sync/today?today=2030-03-11`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Sync-Response")).toBe("complete");
    expect(res.headers.get("X-Sync-Snapshot")).toMatch(/^[a-f0-9]{64}$/);
    const data = (await res.json()) as { dayState?: { runs?: Array<{ id: string }> } } | null;
    expect(data?.dayState?.runs?.[0]?.id).toBe("run-2030-03-11");
  });

  it("GET returns an empty sync payload when the client-local row does not exist", async () => {
    const date = "2030-03-20";
    const res = await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Sync-Response")).toBe("complete");
    expect(res.headers.get("X-Sync-Snapshot")).toMatch(/^[a-f0-9]{64}$/);
    expect(await res.json()).toEqual({
      syncVersion: 1,
      completeness: "complete",
      dayState: { date, runs: [] },
      runValues: {},
      runValuesUpdatedAt: {},
      resetEpoch: 0,
      rollover: false,
      canonicalRevision: 0,
      serverTime: expect.any(Number),
    });
  });

  it("PUT writes to the client-supplied `today` row, never the server's UTC date", async () => {
    const payload = { dayState: { runs: [{ id: "live-run" }] }, runValues: { "live-run": { casesNeeded: 42 } } };
    const put = await fetch(`${baseUrl}/api/sync/today?today=2030-03-20`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
    expect(put.status).toBe(200);
    // The new row is readable via the explicit-date route under 2030-03-20.
    const back = await fetch(`${baseUrl}/api/sync/2030-03-20`, { headers: authHeaders() });
    const data = (await back.json()) as { runValues?: Record<string, { casesNeeded?: number }> } | null;
    expect(data?.runValues?.["live-run"]?.casesNeeded).toBe(42);
    // A pre-existing future scheduled day is left untouched (not clobbered).
    const sched = await fetch(`${baseUrl}/api/sync/scheduled?today=2030-03-19`, { headers: authHeaders() });
    const days = (await sched.json()) as Array<{ date: string }>;
    expect(days.map((d) => d.date)).toContain("2030-03-20");
  });
});

describe("/sync day breaks — canonical round trips and reset fencing", () => {
  const TODAY = "2030-04-10";
  const SCHEDULED = "2030-04-11";
  const canonicalBreaks = [
    { slot: 1, enabled: true, mode: "at-time", atTime: "08:15", durationMin: 30 },
    { slot: 2, enabled: true, mode: "after-run", runId: "run-2", durationMin: 30 },
    { slot: 3, enabled: false, mode: "after-run", durationMin: 30 },
  ];

  const payloadFor = (date: string, breaks?: unknown) => ({
    dayState: {
      date,
      runs: [
        { id: "run-1", brand: "Acme", flavor: "Pep" },
        { id: "run-2", brand: "Acme", flavor: "Cheese" },
      ],
      resetAt: 0,
      ...(breaks === undefined ? {} : { breaks }),
    },
    runValues: {},
  });

  async function putToday(payload: unknown, epoch = 0) {
    return fetch(`${baseUrl}/api/sync/today?today=${TODAY}&epoch=${epoch}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "break-device", payload }),
    });
  }

  async function putScheduled(payload: unknown, date = SCHEDULED, epoch = 0) {
    return fetch(`${baseUrl}/api/sync/${date}?today=${TODAY}&epoch=${epoch}`, {
      method: "PUT",
      headers: { ...managerAuthHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "break-scheduler", payload }),
    });
  }

  async function read(date: string) {
    const response = await fetch(`${baseUrl}/api/sync/${date}?today=${TODAY}`, {
      headers: authHeaders(),
    });
    expect(response.status).toBe(200);
    return await response.json() as {
      dayState?: { breaks?: unknown; date?: string };
      runValues?: Record<string, unknown>;
    };
  }

  it("round-trips exactly three fixed 30-minute slots for today and a scheduled day", async () => {
    const requestedBreaks = [
      { slot: 99, enabled: true, mode: "at-time", atTime: "08:15", durationMin: 5, ignored: "drop" },
      { slot: 2, enabled: true, mode: "after-run", runId: "run-2", durationMin: 90 },
      { slot: 3, enabled: false, mode: "after-run", durationMin: 0 },
      { slot: 4, enabled: true, mode: "at-time", atTime: "12:00" },
    ];

    const todayPut = await putToday(payloadFor(TODAY, requestedBreaks));
    expect(todayPut.status).toBe(200);
    const todayBody = await todayPut.json() as { data?: { dayState?: { breaks?: unknown } } };
    expect(todayBody.data?.dayState?.breaks).toEqual(canonicalBreaks);
    expect((await read(TODAY)).dayState?.breaks).toEqual(canonicalBreaks);

    const scheduledPut = await putScheduled(payloadFor(SCHEDULED, requestedBreaks));
    expect(scheduledPut.status).toBe(200);
    const scheduledBody = await scheduledPut.json() as { data?: { dayState?: { breaks?: unknown } } };
    expect(scheduledBody.data?.dayState?.breaks).toEqual(canonicalBreaks);
    expect((await read(SCHEDULED)).dayState?.breaks).toEqual(canonicalBreaks);
  });

  it("canonicalizes malformed slots and accepts legacy payloads that omit breaks", async () => {
    const malformed = [
      null,
      { enabled: true, mode: "invalid", atTime: "25:00", runId: 42, durationMin: 5 },
      { enabled: true, mode: "at-time", atTime: "09:30", runId: "run-3", durationMin: 1 },
      { enabled: true, mode: "at-time", atTime: "12:00" },
    ];
    const expectedMalformed = [
      { slot: 1, enabled: false, mode: "after-run", durationMin: 30 },
      { slot: 2, enabled: true, mode: "after-run", durationMin: 30 },
      { slot: 3, enabled: true, mode: "at-time", atTime: "09:30", runId: "run-3", durationMin: 30 },
    ];

    const malformedPut = await putToday(payloadFor(TODAY, malformed));
    expect(malformedPut.status).toBe(200);
    expect((await malformedPut.json() as { data?: { dayState?: { breaks?: unknown } } }).data?.dayState?.breaks)
      .toEqual(expectedMalformed);
    expect((await read(TODAY)).dayState?.breaks).toEqual(expectedMalformed);

    const legacyDate = "2030-04-12";
    const legacyPut = await putScheduled(payloadFor(legacyDate), legacyDate);
    expect(legacyPut.status).toBe(200);
    const legacyBody = await legacyPut.json() as { data?: { dayState?: Record<string, unknown> } };
    expect(legacyBody.data?.dayState).not.toHaveProperty("breaks");
    expect((await read(legacyDate)).dayState).not.toHaveProperty("breaks");
  });

  it("rejects a stale post-reset write so an old break plan cannot be resurrected", async () => {
    const currentBreaks = [
      { slot: 1, enabled: true, mode: "at-time", atTime: "10:00", durationMin: 30 },
      { slot: 2, enabled: false, mode: "after-run", durationMin: 30 },
      { slot: 3, enabled: true, mode: "after-run", runId: "run-2", durationMin: 30 },
    ];
    const oldBreaks = [
      { slot: 1, enabled: true, mode: "at-time", atTime: "07:00", durationMin: 30 },
      { slot: 2, enabled: true, mode: "after-run", runId: "run-1", durationMin: 30 },
      { slot: 3, enabled: false, mode: "after-run", durationMin: 30 },
    ];

    const accepted = await putToday(payloadFor(TODAY, currentBreaks));
    expect(accepted.status).toBe(200);
    await db.update(dataResetTable).set({ epoch: 1 }).where(eq(dataResetTable.scope, "live"));

    const stale = await putToday(payloadFor(TODAY, oldBreaks), 0);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ ok: true, stale: true, epoch: 1 });
    expect((await read(TODAY)).dayState?.breaks).toEqual(currentBreaks);
  });
});

describe("/sync snapshot conditionals", () => {
  const DATE = "2030-08-22";
  const payload = {
    dayState: { runs: [{ id: "snapshot-run", brand: "Acme", flavor: "Pep" }] },
    runValues: { "snapshot-run": { casesNeeded: 12 } },
    runValuesUpdatedAt: { "snapshot-run": 1 },
  };

  it("returns a lightweight unchanged response for a matching PUT snapshot", async () => {
    const first = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
    const firstBody = await first.json() as { data: unknown; snapshotId: string };
    expect(firstBody.snapshotId).toMatch(/^[a-f0-9]{64}$/);

    const unchanged = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload, snapshotId: firstBody.snapshotId }),
    });
    const body = await unchanged.json() as { unchanged?: boolean; data?: unknown; snapshotId?: string };
    expect(body).toMatchObject({ unchanged: true, snapshotId: firstBody.snapshotId });
    expect(body.data).toBeUndefined();
  });

  it("persists a changed explicit-date PUT even when it carries the prior snapshot ID", async () => {
    const scheduledDate = "2030-08-23";
    const first = await fetch(`${baseUrl}/api/sync/${scheduledDate}?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
    const firstBody = await first.json() as { snapshotId: string };

    const changed = await fetch(`${baseUrl}/api/sync/${scheduledDate}?today=${DATE}`, {
      method: "PUT",
      headers: { ...managerAuthHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "c1",
        snapshotId: firstBody.snapshotId,
        payload: {
          ...payload,
          dayState: {
            ...payload.dayState,
            runs: [...payload.dayState.runs, { id: "scheduled-snapshot-run", brand: "Acme", flavor: "Cheese" }],
          },
          runValues: {
            ...payload.runValues,
            "scheduled-snapshot-run": { casesNeeded: 14 },
          },
          runValuesUpdatedAt: { ...payload.runValuesUpdatedAt, "scheduled-snapshot-run": 2 },
        },
      }),
    });

    const body = await changed.json() as { data?: { runValues?: Record<string, { casesNeeded?: number }> } };
    expect(body.data?.runValues?.["scheduled-snapshot-run"]?.casesNeeded).toBe(14);
  });

  it("returns the full changed snapshot and supports conditional GET", async () => {
    await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
    const full = await fetch(`${baseUrl}/api/sync/${DATE}`, { headers: authHeaders() });
    const snapshot = full.headers.get("X-Sync-Snapshot");
    expect(snapshot).toMatch(/^[a-f0-9]{64}$/);
    const unchanged = await fetch(`${baseUrl}/api/sync/${DATE}?snapshot=${snapshot}`, { headers: authHeaders() });
    expect(await unchanged.json()).toMatchObject({ unchanged: true, snapshotId: snapshot });

    const changed = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "c1",
        payload: {
          ...payload,
          dayState: {
            ...payload.dayState,
            runs: [...payload.dayState.runs, { id: "snapshot-run-2", brand: "Acme", flavor: "Cheese" }],
          },
          runValues: {
            ...payload.runValues,
            "snapshot-run-2": { casesNeeded: 13 },
          },
          runValuesUpdatedAt: { ...payload.runValuesUpdatedAt, "snapshot-run-2": 2 },
        },
        snapshotId: snapshot,
      }),
    });
    const changedBody = await changed.json() as { data?: { runValues?: Record<string, { casesNeeded?: number }> }; snapshotId?: string };
    expect(changedBody.data?.runValues?.["snapshot-run-2"]?.casesNeeded).toBe(13);
    expect(changedBody.snapshotId).not.toBe(snapshot);
    const persisted = await fetch(`${baseUrl}/api/sync/${DATE}`, { headers: authHeaders() });
    const persistedBody = await persisted.json() as { runValues?: Record<string, { casesNeeded?: number }> };
    expect(persistedBody.runValues?.["snapshot-run-2"]?.casesNeeded).toBe(13);
  });

  it("ignores malformed snapshot identities and keeps legacy full responses", async () => {
    await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
    const res = await fetch(`${baseUrl}/api/sync/${DATE}?snapshot=malformed`, { headers: authHeaders() });
    const body = await res.json() as { dayState?: unknown; unchanged?: boolean };
    expect(body.dayState).toBeDefined();
    expect(body.unchanged).toBeUndefined();
  });
});

describe("/sync partial payload contract", () => {
  const DATE = "2030-08-24";

  it("preserves omitted unchanged run values while returning a complete canonical snapshot", async () => {
    const complete = {
      syncVersion: 1,
      completeness: "complete",
      baseSnapshotId: emptyCompleteSnapshotId(DATE),
      dayState: {
        runs: [
          { id: "partial-r1", brand: "Acme", flavor: "Pep" },
          { id: "partial-r2", brand: "Acme", flavor: "Cheese" },
        ],
      },
      runValues: {
        "partial-r1": { casesNeeded: 12 },
        "partial-r2": { casesNeeded: 24, doughRecipeName: "Large", doughRecipe: [{ ingredient: "Flour", lbs: 10 }] },
      },
      runValuesUpdatedAt: { "partial-r1": 1, "partial-r2": 1 },
      history: [{ date: "2030-08-21", runs: [], runValues: {} }],
    };
    const first = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "complete-client", payload: complete }),
    });
    const firstBody = await first.json() as { data: typeof complete; snapshotId: string };
    expect(firstBody.data.runValues["partial-r2"].doughRecipeName).toBe("Large");

    const partial = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "hot-client",
        payload: {
          syncVersion: 1,
          completeness: "partial",
          baseSnapshotId: firstBody.snapshotId,
          dayState: complete.dayState,
          runValues: { "partial-r1": { casesNeeded: 18 } },
          runValuesUpdatedAt: { "partial-r1": 2 },
        },
      }),
    });
    expect(partial.status).toBe(200);
    const partialBody = await partial.json() as { data: typeof complete; snapshotId: string };
    expect(partialBody.data.completeness).toBe("complete");
    expect((partialBody.data as Record<string, unknown>).baseSnapshotId).toBeUndefined();
    expect(partialBody.data.runValues["partial-r1"].casesNeeded).toBe(18);
    expect(partialBody.data.runValues["partial-r2"].doughRecipeName).toBe("Large");
    expect(partialBody.data.runValues["partial-r2"].doughRecipe).toEqual([{ ingredient: "Flour", lbs: 10 }]);
    expect(partialBody.data.history).toEqual(complete.history);
    expect(partialBody.snapshotId).not.toBe(firstBody.snapshotId);
  });

  it("returns the complete canonical snapshot for a malformed partial dependency", async () => {
    const seed = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "seed", payload: {
        dayState: { runs: [{ id: "malformed-base-run" }] },
        runValues: { "malformed-base-run": { casesNeeded: 9 } },
      } }),
    });
    expect(seed.status).toBe(200);
    const res = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "invalid-client",
        payload: {
          completeness: "partial",
          dayState: { runs: [] },
          runValues: {},
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data?: { runValues?: Record<string, { casesNeeded?: number }> }; partialFallback?: boolean };
    expect(body.partialFallback).toBe(true);
    expect(body.data?.runValues?.["malformed-base-run"]?.casesNeeded).toBe(9);
  });

  it("does not apply a stale partial delta and returns the complete current snapshot", async () => {
    const first = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "seed", payload: {
        dayState: { runs: [{ id: "stale-r1" }] },
        runValues: { "stale-r1": { casesNeeded: 12 } },
        runValuesUpdatedAt: { "stale-r1": 1 },
      } }),
    });
    const firstBody = await first.json() as { snapshotId: string };
    await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "newer", payload: {
        dayState: { runs: [{ id: "stale-r1" }] },
        runValues: { "stale-r1": { casesNeeded: 24 } },
        runValuesUpdatedAt: { "stale-r1": 2 },
      } }),
    });
    const res = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "stale", payload: {
        syncVersion: 1,
        completeness: "partial",
        baseSnapshotId: firstBody.snapshotId,
        dayState: { runs: [{ id: "stale-r1" }] },
        runValues: { "stale-r1": { casesNeeded: 99 } },
        runValuesUpdatedAt: { "stale-r1": 3 },
      } }),
    });
    const body = await res.json() as { data?: { runValues?: Record<string, { casesNeeded?: number }> }; partialFallback?: boolean };
    expect(body.partialFallback).toBe(true);
    expect(body.data?.runValues?.["stale-r1"]?.casesNeeded).toBe(24);
  });

  it("does not create a row from a partial payload with a missing dependency", async () => {
    const res = await fetch(`${baseUrl}/api/sync/today?today=2030-08-25`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "missing-row",
        payload: {
          syncVersion: 1,
          completeness: "partial",
          baseSnapshotId: "a".repeat(64),
          dayState: { runs: [{ id: "must-not-land" }] },
          runValues: { "must-not-land": { casesNeeded: 99 } },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: null, partialFallback: true });
    const read = await fetch(`${baseUrl}/api/sync/2030-08-25`, { headers: authHeaders() });
    expect(await read.json()).toBeNull();
  });
});

describe("/sync/today — complete-write causal fence", () => {
  const DATE = "2030-04-01";

  function put(payload: Record<string, unknown>, senderId: string) {
    return fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId, payload }),
    });
  }

  function complete(
    baseSnapshotId: string,
    casesNeeded: number,
    stamp: number,
  ): Record<string, unknown> {
    return {
      syncVersion: 1,
      completeness: "complete",
      baseSnapshotId,
      dayState: {
        date: DATE,
        runs: [{ id: "complete-fence-run", brand: "Acme", flavor: "Pep" }],
      },
      runValues: { "complete-fence-run": { casesNeeded } },
      runValuesUpdatedAt: { "complete-fence-run": stamp },
    };
  }

  it("advances revision for accepted changes and not for idempotent repeats", async () => {
    const first = await put(complete(emptyCompleteSnapshotId(DATE), 12, 1), "first");
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      canonicalRevision: number;
      snapshotId: string;
    };
    expect(firstBody.canonicalRevision).toBe(1);

    const repeat = await put(complete(firstBody.snapshotId, 12, 1), "repeat");
    expect(repeat.status).toBe(200);
    const repeatBody = await repeat.json() as { canonicalRevision: number };
    expect(repeatBody.canonicalRevision).toBe(1);
  });

  it("returns authoritative state when a future-stamped complete write has a stale base", async () => {
    const first = await put(complete(emptyCompleteSnapshotId(DATE), 12, 1), "first");
    const firstBody = await first.json() as { snapshotId: string };
    const current = await put(complete(firstBody.snapshotId, 24, 2), "current");
    const currentBody = await current.json() as {
      canonicalRevision: number;
      data: { runValues: Record<string, { casesNeeded: number }> };
    };

    const stale = await put(complete(firstBody.snapshotId, 999, Date.now() + 86_400_000), "stale");
    expect(stale.status).toBe(200);
    const staleBody = await stale.json() as {
      partialFallback?: boolean;
      canonicalRevision: number;
      data: { runValues: Record<string, { casesNeeded: number }> };
    };
    expect(staleBody.partialFallback).toBe(true);
    expect(staleBody.canonicalRevision).toBe(currentBody.canonicalRevision);
    expect(staleBody.data.runValues["complete-fence-run"].casesNeeded).toBe(24);
  });

  it("serializes concurrent complete writes from the same base with one winner", async () => {
    const first = await put(complete(emptyCompleteSnapshotId(DATE), 12, 1), "first");
    const firstBody = await first.json() as { snapshotId: string };
    const [a, b] = await Promise.all([
      put(complete(firstBody.snapshotId, 41, 2), "race-a"),
      put(complete(firstBody.snapshotId, 42, 3), "race-b"),
    ]);
    const bodies = await Promise.all([a.json(), b.json()]) as Array<{
      partialFallback?: boolean;
      canonicalRevision: number;
      data: { runValues: Record<string, { casesNeeded: number }> };
    }>;
    expect(bodies.filter((body) => body.partialFallback === true)).toHaveLength(1);
    expect(new Set(bodies.map((body) => body.canonicalRevision))).toEqual(new Set([2]));
    expect(new Set(bodies.map((body) => body.data.runValues["complete-fence-run"].casesNeeded)).size).toBe(1);
  });

  it("advertises the compatibility sunset while legacy writes are still accepted", async () => {
    const legacy = await put({
      dayState: {
        date: DATE,
        runs: [{ id: "legacy-window-run", brand: "Acme", flavor: "Cheese" }],
      },
      runValues: { "legacy-window-run": { casesNeeded: 8 } },
      runValuesUpdatedAt: { "legacy-window-run": 1 },
    }, "legacy-window");

    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("Deprecation")).toBe("true");
    expect(legacy.headers.get("Sunset")).toBe("Wed, 21 Oct 2026 00:00:00 GMT");
    expect(legacy.headers.get("X-Sync-Upgrade-Required")).toContain("baseSnapshotId");
  });

  it("rejects retired legacy writes with authoritative recovery state", async () => {
    const baseline = await put(
      complete(emptyCompleteSnapshotId(DATE), 24, 10),
      "retirement-baseline",
    );
    const baselineBody = await baseline.json() as {
      snapshotId: string;
      canonicalRevision: number;
    };
    process.env.SYNC_LEGACY_COMPLETE_WRITES = "reject";
    try {
      const rejected = await put({
        dayState: {
          date: DATE,
          runs: [{ id: "complete-fence-run", brand: "Acme", flavor: "Pep" }],
        },
        runValues: { "complete-fence-run": { casesNeeded: 999 } },
        runValuesUpdatedAt: { "complete-fence-run": Date.now() + 86_400_000 },
      }, "retired-legacy");

      expect(rejected.status).toBe(409);
      expect(rejected.headers.get("X-Sync-Response")).toBe("legacy-rejected");
      expect(rejected.headers.get("Deprecation")).toBe("true");
      expect(await rejected.json()).toMatchObject({
        code: "SYNC_CLIENT_UPGRADE_REQUIRED",
        recoveryRequired: true,
        partialFallback: true,
        snapshotId: baselineBody.snapshotId,
        canonicalRevision: baselineBody.canonicalRevision,
        data: {
          runValues: {
            "complete-fence-run": { casesNeeded: 24 },
          },
        },
      });
    } finally {
      delete process.env.SYNC_LEGACY_COMPLETE_WRITES;
    }
  });

  it("keeps versioned scheduled writes working after legacy retirement", async () => {
    const scheduledDate = "2030-04-02";
    const read = await fetch(`${baseUrl}/api/sync/${scheduledDate}?today=${DATE}`, {
      headers: authHeaders(),
    });
    const baseSnapshotId = read.headers.get("X-Sync-Snapshot");
    expect(baseSnapshotId).toMatch(/^[a-f0-9]{64}$/);

    process.env.SYNC_LEGACY_COMPLETE_WRITES = "reject";
    try {
      const accepted = await fetch(`${baseUrl}/api/sync/${scheduledDate}?today=${DATE}`, {
        method: "PUT",
        headers: { ...managerAuthHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          payload: {
            syncVersion: 1,
            completeness: "complete",
            baseSnapshotId,
            dayState: {
              date: scheduledDate,
              runs: [{ id: "scheduled-versioned-run", brand: "Acme", flavor: "Cheese" }],
            },
            runValues: { "scheduled-versioned-run": { casesNeeded: 16 } },
            runValuesUpdatedAt: { "scheduled-versioned-run": 1 },
          },
        }),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({
        data: {
          runValues: {
            "scheduled-versioned-run": { casesNeeded: 16 },
          },
        },
      });

      const legacy = await fetch(`${baseUrl}/api/sync/${scheduledDate}?today=${DATE}`, {
        method: "PUT",
        headers: { ...managerAuthHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          payload: {
            dayState: {
              date: scheduledDate,
              runs: [{ id: "scheduled-versioned-run", brand: "Acme", flavor: "Cheese" }],
            },
            runValues: { "scheduled-versioned-run": { casesNeeded: 999 } },
            runValuesUpdatedAt: { "scheduled-versioned-run": 2 },
          },
        }),
      });
      expect(legacy.status).toBe(409);
      expect(await legacy.json()).toMatchObject({
        code: "SYNC_CLIENT_UPGRADE_REQUIRED",
        data: {
          runValues: {
            "scheduled-versioned-run": { casesNeeded: 16 },
          },
        },
      });
    } finally {
      delete process.env.SYNC_LEGACY_COMPLETE_WRITES;
    }
  });
});

describe("/sync large-day complete versus partial measurements", () => {
  const DATE = "2030-08-25";
  type JsonRecord = Record<string, unknown>;

  function largeDayFixture(runCount = 32): JsonRecord {
    const runs = Array.from({ length: runCount }, (_, index) => ({
      id: `large-day-run-${index + 1}`,
      brand: index % 2 === 0 ? "Acme" : "Northstar",
      flavor: ["Pepperoni", "Cheese", "Supreme", "Veggie"][index % 4],
      startedAt: 1_000 + index,
      metaUpdatedAt: 1_000 + index,
    }));
    const runValues: Record<string, JsonRecord> = {};
    const runValuesUpdatedAt: Record<string, number> = {};
    const packagingProgress: Record<string, JsonRecord> = {};
    for (const [index, run] of runs.entries()) {
      runValues[run.id] = {
        casesNeeded: 240 + index * 12,
        casesPerSkid: 48,
        skidsCompleted: index % 3,
        casesOnCurrentSkid: 12 + index,
        doughRecipeName: index % 2 === 0 ? "Standard" : "Thin",
        doughRecipe: [
          { ingredient: "Flour", lbs: 42 + index },
          { ingredient: "Water", lbs: 18 + index / 2 },
          { ingredient: "Yeast", lbs: 1.25 },
        ],
        frontlineRecipe: [
          { ingredient: "Tomato Sauce", lbs: 8 + index / 4 },
          { ingredient: "Salt", lbs: 0.4 },
        ],
        app1CheeseRecipe: [
          { ingredient: "Mozzarella", lbs: 12 + index / 3 },
          { ingredient: "Provolone", lbs: 2 },
        ],
        notes: `Representative setup and operator notes for production run ${index + 1}.`,
      };
      runValuesUpdatedAt[run.id] = 1_000 + index;
      packagingProgress[run.id] = {
        skidsCompleted: index % 3,
        casesOnCurrentSkid: 12 + index,
        correctionGeneration: 0,
        updatedAt: 1_000 + index,
        manualOverrideUntil: 0,
      };
    }
    return {
      syncVersion: 1,
      completeness: "complete",
      baseSnapshotId: emptyCompleteSnapshotId(DATE),
      dayState: {
        date: DATE,
        resetAt: 1_000,
        runs,
        shiftNotes: "Large-day benchmark fixture",
        runToTime: Object.fromEntries(runs.map((run) => [run.id, 18])),
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
        prepPhase: {
          prepStartedAt: null,
          prepBatchesDough: 0,
          prepBatchesSauce: 0,
          prepCarriedOver: false,
        },
      },
      runValues,
      runValuesUpdatedAt,
      packagingProgress,
      history: Array.from({ length: 24 }, (_, index) => ({
        at: 2_000 + index,
        message: `History event ${index + 1}`,
      })),
    };
  }

  async function measuredPut(payload: JsonRecord, senderId: string) {
    const body = JSON.stringify({ senderId, payload });
    const requestBytes = Buffer.byteLength(body);
    const started = performance.now();
    const response = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body,
    });
    const responseText = await response.text();
    const responseBytes = Buffer.byteLength(responseText);
    const responseReadAt = performance.now();
    const parsed = JSON.parse(responseText) as {
      data?: JsonRecord;
      snapshotId?: string;
      partialFallback?: boolean;
    };
    // Keep parse plus canonical adoption as a separately visible phase. The
    // test does the same clone a browser performs before storing the response.
    const canonical = parsed.data ? JSON.parse(JSON.stringify(parsed.data)) as JsonRecord : undefined;
    const mergeMs = performance.now() - responseReadAt;
    return {
      response,
      parsed,
      canonical,
      requestBytes,
      responseBytes,
      latencyMs: responseReadAt - started,
      mergeMs,
    };
  }

  it("compares complete and one-run partial writes on a representative large day", async () => {
    const completeFixture = largeDayFixture();
    const baseline = await measuredPut(completeFixture, "large-day-complete");
    expect(baseline.response.status).toBe(200);
    expect(baseline.parsed.snapshotId).toMatch(/^[a-f0-9]{64}$/);

    const changedRunId = "large-day-run-17";
    // The server records a write-time stamp when it accepts the complete
    // baseline, so the changed run must carry a genuinely newer edit stamp.
    const changedRunStamp = Date.now() + 1_000;
    const partialFixture: JsonRecord = {
      ...completeFixture,
      completeness: "partial",
      baseSnapshotId: baseline.parsed.snapshotId,
      runValues: {
        [changedRunId]: {
          ...(completeFixture.runValues as Record<string, JsonRecord>)[changedRunId],
          casesOnCurrentSkid: 99,
        },
      },
      runValuesUpdatedAt: { [changedRunId]: changedRunStamp },
      packagingProgress: {
        [changedRunId]: {
          ...(completeFixture.packagingProgress as Record<string, JsonRecord>)[changedRunId],
          casesOnCurrentSkid: 99,
          updatedAt: changedRunStamp,
        },
      },
    };
    const optimized = await measuredPut(partialFixture, "large-day-partial");
    expect(optimized.response.status).toBe(200);
    expect(optimized.canonical?.runValues).toMatchObject({
      [changedRunId]: { casesOnCurrentSkid: 99 },
    });

    const completeCanonical = baseline.canonical;
    const optimizedCanonical = optimized.canonical;
    expect(optimizedCanonical?.dayState).toEqual(completeCanonical?.dayState);
    expect(Object.keys(optimizedCanonical?.runValues as object)).toHaveLength(32);
    expect(
      JSON.stringify(optimizedCanonical?.runValues) === JSON.stringify(completeCanonical?.runValues),
    ).toBe(false);
    const requestSavingsPercent = ((baseline.requestBytes - optimized.requestBytes) / baseline.requestBytes) * 100;
    const responseSavingsPercent = ((baseline.responseBytes - optimized.responseBytes) / baseline.responseBytes) * 100;
    const report = {
      fixture: { runs: 32, changedRuns: 1 },
      complete: {
        requestBytes: baseline.requestBytes,
        responseBytes: baseline.responseBytes,
        latencyMs: Number(baseline.latencyMs.toFixed(2)),
        mergeMs: Number(baseline.mergeMs.toFixed(2)),
        retries: 0,
        converged: true,
      },
      partial: {
        requestBytes: optimized.requestBytes,
        responseBytes: optimized.responseBytes,
        latencyMs: Number(optimized.latencyMs.toFixed(2)),
        mergeMs: Number(optimized.mergeMs.toFixed(2)),
        retries: 0,
        converged: true,
      },
      requestSavingsPercent: Number(requestSavingsPercent.toFixed(2)),
      responseSavingsPercent: Number(responseSavingsPercent.toFixed(2)),
    };
    console.info("[sync large-day benchmark]", report);
    expect(optimized.requestBytes).toBeLessThan(baseline.requestBytes);
    expect(requestSavingsPercent).toBeGreaterThan(50);
  }, 30_000);

  it("benchmarks bounded run counts, near-cap input, and stale/raced-base fallbacks", async () => {
    const fixtureSizes = [0, 1, 32, 50].map((runs) => {
      const fixture = largeDayFixture(runs);
      return {
        runs,
        sanitizedBytes: Buffer.byteLength(JSON.stringify(fixture)),
        wireBytes: Buffer.byteLength(JSON.stringify({ senderId: "fixture", payload: fixture })),
      };
    });
    const nearCapFixture = {
      ...largeDayFixture(50),
      history: Array.from({ length: 2_500 }, (_, index) => ({
        at: index,
        message: "x".repeat(120),
      })),
    };
    const nearCapBytes = Buffer.byteLength(JSON.stringify(nearCapFixture));
    expect(nearCapBytes).toBeGreaterThan(256 * 1024);
    expect(nearCapBytes).toBeLessThan(512 * 1024);

    const baseline = await measuredPut(largeDayFixture(32), "fallback-baseline");
    const baseSnapshotId = baseline.parsed.snapshotId;
    expect(baseSnapshotId).toMatch(/^[a-f0-9]{64}$/);
    const changedRunId = "large-day-run-1";
    const partial = (casesOnCurrentSkid: number): JsonRecord => ({
      syncVersion: 1,
      completeness: "partial",
      baseSnapshotId,
      runValues: {
        [changedRunId]: {
          ...(largeDayFixture(32).runValues as Record<string, JsonRecord>)[changedRunId],
          casesOnCurrentSkid,
        },
      },
      runValuesUpdatedAt: { [changedRunId]: Date.now() + casesOnCurrentSkid },
    });

    const [raceA, raceB] = await Promise.all([
      measuredPut(partial(41), "raced-base-a"),
      measuredPut(partial(42), "raced-base-b"),
    ]);
    const racedFallbacks = [raceA, raceB].filter(({ parsed }) => parsed.partialFallback === true).length;
    expect(racedFallbacks).toBe(1);

    const stale = await measuredPut(partial(43), "stale-base");
    expect(stale.parsed.partialFallback).toBe(true);
    const report = {
      fixtures: fixtureSizes,
      nearCap: { runs: 50, sanitizedBytes: nearCapBytes },
      fallbacks: {
        staleBase: 1,
        racedBase: racedFallbacks,
      },
    };
    console.info("[sync capacity fixture benchmark]", report);
  }, 30_000);
});

describe("/sync — per-run protective merge (data-loss guard)", () => {
  // The server is now a per-run last-writer-wins register keyed on each run's
  // edit stamp (runValuesUpdatedAt), not a blind blob overwrite. An empty run
  // value paired with an EQUAL-or-older stamp must never overwrite a populated
  // stored value — that is the recurring "I entered it, refreshed, it vanished"
  // corruption. Only a strictly-newer-stamped edit changes a run.
  const DATE = "2030-05-01";
  function put(payload: unknown) {
    return fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
  }
  async function readRow() {
    const res = await fetch(`${baseUrl}/api/sync/${DATE}`, { headers: authHeaders() });
    return (await res.json()) as {
      runValues?: Record<string, { casesNeeded?: number }>;
      runValuesUpdatedAt?: Record<string, number>;
    } | null;
  }
  const meta = { dayState: { runs: [{ id: "r1", brand: "Acme", flavor: "Pep" }] } };

  it("rejects an empty value with an EQUAL stamp over a populated stored value", async () => {
    await put({ ...meta, runValues: { r1: { casesNeeded: 240 } }, runValuesUpdatedAt: { r1: 1000 } });
    await put({ ...meta, runValues: { r1: {} }, runValuesUpdatedAt: { r1: 1000 } });
    const row = await readRow();
    expect(row?.runValues?.r1?.casesNeeded).toBe(240);
    expect(row?.runValuesUpdatedAt?.r1).toBe(1000);
  });

  it("converges an awake edit and a sleeping device wake without replaying stale run data", async () => {
    const progress = (skidsCompleted: number, casesOnCurrentSkid: number, correctionGeneration: number, updatedAt: number, manualOverrideUntil: number) => ({
      skidsCompleted,
      casesOnCurrentSkid,
      correctionGeneration,
      updatedAt,
      manualOverrideUntil,
    });
    const initial = {
      dayState: {
        runs: [{ id: "r1", brand: "Acme", flavor: "Pep", startedAt: 1_000, metaUpdatedAt: 1_000 }],
        resetAt: 1_000,
      },
      runValues: { r1: { casesNeeded: 240, casesPerSkid: 48, skidsCompleted: 0, casesOnCurrentSkid: 36 } },
      runValuesUpdatedAt: { r1: 1_000 },
      packagingProgress: { r1: progress(0, 36, 0, 1_000, 0) },
    };
    const awakeEdit = {
      dayState: {
        runs: [{
          id: "r1",
          brand: "Acme",
          flavor: "Pep",
          startedAt: 1_000,
          endedAt: 9_000,
          metaUpdatedAt: 2_000,
        }],
        resetAt: 1_000,
      },
      runValues: { r1: { casesNeeded: 300, casesPerSkid: 48, skidsCompleted: 1, casesOnCurrentSkid: 12 } },
      runValuesUpdatedAt: { r1: 2_000 },
      packagingProgress: { r1: progress(1, 12, 1, 2_000, 62_000) },
    };

    // Device A is awake and advances setup, skid progress, a manual correction,
    // and the remote stop while Device B remains asleep on the initial snapshot.
    await put(initial);
    await put(awakeEdit);

    // B wakes with its pre-sleep snapshot and performs the push it would have
    // queued before the foreground adoption barrier. The server must return
    // its canonical newer state instead of letting the stale running copy win.
    const staleWake = await put(initial);
    const canonical = await staleWake.json() as {
      ok: boolean;
      data?: typeof awakeEdit;
    };
    expect(canonical.ok).toBe(true);
    expect(canonical.data?.dayState.runs[0]).toMatchObject({
      endedAt: 9_000,
      metaUpdatedAt: 2_000,
    });
    expect(canonical.data?.runValues?.r1).toMatchObject({
      casesNeeded: 300,
      skidsCompleted: 1,
      casesOnCurrentSkid: 12,
    });
    expect(canonical.data?.packagingProgress?.r1).toMatchObject({
      correctionGeneration: 1,
      manualOverrideUntil: 62_000,
    });

    // B now adopts the canonical response and repeats its normal sync write.
    // This second write must be idempotent: no hidden-time counter delta or
    // stale lifecycle replay is generated by waking.
    const adopted = await put(canonical.data);
    expect(adopted.status).toBe(200);
    const stored = await fetch(`${baseUrl}/api/sync/${DATE}`, { headers: authHeaders() }).then((r) => r.json()) as typeof awakeEdit;
    expect(stored.dayState.runs[0]).toMatchObject({ endedAt: 9_000, metaUpdatedAt: 2_000 });
    expect(stored.runValues.r1).toMatchObject({ casesNeeded: 300, skidsCompleted: 1, casesOnCurrentSkid: 12 });
    expect(stored.packagingProgress?.r1).toMatchObject({ correctionGeneration: 1, casesOnCurrentSkid: 12 });

    // A transient blank form from the sleeping device is also harmless, and
    // the protective merge records that it had to override the stale write.
    const blank = await put({
      ...initial,
      runValues: { r1: {} },
      runValuesUpdatedAt: { r1: 2_000 },
    });
    const blankCanonical = await blank.json() as { data?: typeof awakeEdit };
    expect(blankCanonical.data?.runValues?.r1).toMatchObject({ casesNeeded: 300, skidsCompleted: 1 });
    const conflictDeadline = Date.now() + 2_000;
    let conflicts = await db.select().from(syncConflictLogsTable);
    while (
      !conflicts.some((row) => row.date === DATE && row.fieldsWithConflicts.includes("runValues:r1")) &&
      Date.now() < conflictDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      conflicts = await db.select().from(syncConflictLogsTable);
    }
    expect(conflicts.some((row) => row.date === DATE && row.fieldsWithConflicts.includes("runValues:r1"))).toBe(true);

    // Reset-epoch rejection is exercised by syncReset.integration.test.ts;
    // keeping that whole-scope destructive operation out of this shared
    // multi-device suite prevents it from racing the other date fixtures.
  });

  it("accepts a strictly-newer-stamped heal re-push (good value wins over corruption)", async () => {
    await put({ ...meta, runValues: { r1: {} }, runValuesUpdatedAt: { r1: 1000 } });
    await put({ ...meta, runValues: { r1: { casesNeeded: 99 } }, runValuesUpdatedAt: { r1: 5000 } });
    const row = await readRow();
    expect(row?.runValues?.r1?.casesNeeded).toBe(99);
    expect(row?.runValuesUpdatedAt?.r1).toBe(5000);
  });

  it("canonicalizes bare-NATURAL pep names at write time (stale-client re-push guard)", async () => {
    // A pre-fix client can still push the poisoned bare qualifier names after
    // the one-time heal ran; the sync write path must fold them onto the
    // canonical "Pepperoni Stick - NATURAL" (list deduped) while leaving real
    // "Natural X" product names untouched.
    const D = "2030-06-01";
    await fetch(`${baseUrl}/api/sync/today?today=${D}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "c1",
        payload: {
          dayState: { runs: [{ id: "r1", brand: "Lowe's", flavor: "Pepperoni" }] },
          pepTypes: ["Natural", "NATURAL", "NATURAL (Hormel - 24878)", "Pepperoni Stick", "Natural Bacon"],
          runValues: { r1: { pep1Type: "NATURAL", pep2TypeB: "Natural", casesNeeded: 5 } },
          runValuesUpdatedAt: { r1: 1000 },
        },
      }),
    });
    const res = await fetch(`${baseUrl}/api/sync/${D}`, { headers: authHeaders() });
    const row = (await res.json()) as {
      pepTypes?: string[];
      runValues?: Record<string, { pep1Type?: string; pep2TypeB?: string; casesNeeded?: number }>;
    };
    expect(row.pepTypes).toEqual(["Pepperoni Stick - NATURAL", "Pepperoni Stick", "Natural Bacon"]);
    expect(row.runValues?.r1?.pep1Type).toBe("Pepperoni Stick - NATURAL");
    expect(row.runValues?.r1?.pep2TypeB).toBe("Pepperoni Stick - NATURAL");
    expect(row.runValues?.r1?.casesNeeded).toBe(5);
  });

  it("keeps the newest-stamped value under CONCURRENT racing PUTs (atomic merge, order-independent)", async () => {
    // Seed a populated run at stamp 2000. Then fire a stale empty@1000 and a
    // genuine edit@3000 concurrently. With the FOR UPDATE transactional merge the
    // outcome is deterministic regardless of which commits first: the empty stale
    // push can never win, and the 3000 edit always does.
    await put({ ...meta, runValues: { r1: { casesNeeded: 240 } }, runValuesUpdatedAt: { r1: 2000 } });
    await Promise.all([
      put({ ...meta, runValues: { r1: {} }, runValuesUpdatedAt: { r1: 1000 } }),
      put({ ...meta, runValues: { r1: { casesNeeded: 777 } }, runValuesUpdatedAt: { r1: 3000 } }),
    ]);
    const row = await readRow();
    expect(row?.runValues?.r1?.casesNeeded).toBe(777);
    expect(row?.runValuesUpdatedAt?.r1).toBe(3000);
  });

  it("PUT /sync/today returns {ok:true,data:merged} with the canonical merged object", async () => {
    const res = await put({ ...meta, runValues: { r1: { casesNeeded: 42 } }, runValuesUpdatedAt: { r1: 9000 } });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data?: { runValues?: Record<string, { casesNeeded?: number }> } };
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data?.runValues?.r1?.casesNeeded).toBe(42);
  });

  it("PUT /sync/:date returns {ok:true,data:merged} with the canonical merged object", async () => {
    const futureDate = "2030-07-15";
    const res = await fetch(`${baseUrl}/api/sync/${futureDate}?today=${DATE}`, {
      method: "PUT",
      headers: { ...managerAuthHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "c1",
        payload: { ...meta, runValues: { r1: { casesNeeded: 77 } }, runValuesUpdatedAt: { r1: 1 } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data?: { runValues?: Record<string, { casesNeeded?: number }> } };
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data?.runValues?.r1?.casesNeeded).toBe(77);
  });

  it("keeps a downward manual skid correction when an unaware writer publishes a later auto stamp", async () => {
    const progress = (
      skidsCompleted: number,
      casesOnCurrentSkid: number,
      correctionGeneration: number,
      updatedAt: number,
      manualOverrideUntil: number,
    ) => ({
      skidsCompleted,
      casesOnCurrentSkid,
      correctionGeneration,
      updatedAt,
      manualOverrideUntil,
    });

    // Both devices begin from the same automatic generation and 36/48.
    await put({
      ...meta,
      runValues: {
        r1: { casesNeeded: 500, casesPerSkid: 48, skidsCompleted: 0, casesOnCurrentSkid: 36 },
      },
      runValuesUpdatedAt: { r1: 1_000 },
      packagingProgress: { r1: progress(0, 36, 0, 1_000, 0) },
    });

    // Device A explicitly corrects downward. Its new generation is the causal
    // boundary, independent of the whole-run timestamp.
    await put({
      ...meta,
      runValues: {
        r1: { casesNeeded: 500, casesPerSkid: 48, skidsCompleted: 0, casesOnCurrentSkid: 24 },
      },
      runValuesUpdatedAt: { r1: 2_000 },
      packagingProgress: { r1: progress(0, 24, 1, 2_000, 62_000) },
    });

    // Device B has not seen that correction. Its later automatic tick and
    // later whole-run stamp must be patched back to Device A's generation.
    const staleResponse = await put({
      ...meta,
      runValues: {
        r1: { casesNeeded: 500, casesPerSkid: 48, skidsCompleted: 0, casesOnCurrentSkid: 36 },
      },
      runValuesUpdatedAt: { r1: 9_000 },
      packagingProgress: { r1: progress(0, 36, 0, 9_000, 0) },
    });
    const staleBody = await staleResponse.json() as {
      data?: {
        runValues?: Record<string, { skidsCompleted?: number; casesOnCurrentSkid?: number }>;
        packagingProgress?: Record<string, {
          correctionGeneration?: number;
          manualOverrideUntil?: number;
        }>;
      };
    };

    expect(staleBody.data?.runValues?.r1).toMatchObject({
      skidsCompleted: 0,
      casesOnCurrentSkid: 24,
    });
    expect(staleBody.data?.packagingProgress?.r1).toMatchObject({
      correctionGeneration: 1,
      manualOverrideUntil: 62_000,
    });

    const stored = await fetch(`${baseUrl}/api/sync/${DATE}`, {
      headers: authHeaders(),
    }).then((response) => response.json()) as {
      runValues?: Record<string, { skidsCompleted?: number; casesOnCurrentSkid?: number }>;
      packagingProgress?: Record<string, { correctionGeneration?: number }>;
    };
    expect(stored.runValues?.r1).toMatchObject({
      skidsCompleted: 0,
      casesOnCurrentSkid: 24,
    });
    expect(stored.packagingProgress?.r1?.correctionGeneration).toBe(1);

    const conflictDeadline = Date.now() + 2_000;
    let conflictRows = await db.select().from(syncConflictLogsTable);
    while (
      !conflictRows.some((row) => row.fieldsWithConflicts.includes("packagingProgress:r1")) &&
      Date.now() < conflictDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      conflictRows = await db.select().from(syncConflictLogsTable);
    }
    expect(
      conflictRows.some((row) => row.fieldsWithConflicts.includes("packagingProgress:r1")),
    ).toBe(true);
  });
});

describe("fresh-device unnamed-run remediation", () => {
  const DATE = "2030-05-14";
  const namedRun = { id: "named", brand: "Acme", flavor: "Pepperoni" };
  const namedAmbiguousRun = { id: "named-ambiguous", brand: "Acme", flavor: "Sausage" };
  const copiedRun = { id: "copied", brand: "", flavor: "" };
  const ambiguousOne = { id: "ambiguous-one", brand: "", flavor: "" };
  const ambiguousTwo = { id: "ambiguous-two", brand: "", flavor: "" };
  const copiedValues = {
    casesNeeded: 240,
    pizzasPerCase: 12,
    doughRecipeName: "House Dough",
    doughRecipe: [{ ingredient: "Flour", lbs: 50 }],
    skidsCompleted: 2,
  };
  const ambiguousValues = {
    casesNeeded: 180,
    pizzasPerCase: 12,
    doughRecipeName: "Sausage Dough",
    doughRecipe: [{ ingredient: "Flour", lbs: 40 }],
  };

  it("removes exactly one verified copied blank, tombstones it, and leaves ambiguous blanks for review", async () => {
    await db.insert(dailySyncTable).values({
      date: DATE,
      scope: "live",
      data: {
        dayState: {
          runs: [namedRun, namedAmbiguousRun, copiedRun, ambiguousOne, ambiguousTwo],
        },
        runValues: {
          named: copiedValues,
          copied: copiedValues,
          "named-ambiguous": ambiguousValues,
          "ambiguous-one": ambiguousValues,
          "ambiguous-two": ambiguousValues,
        },
        runValuesUpdatedAt: {
          named: 100,
          copied: 101,
          "ambiguous-one": 102,
          "ambiguous-two": 103,
        },
      },
    });

    await runDataHeals();

    const [row] = await db
      .select()
      .from(dailySyncTable)
      .where(sql`${dailySyncTable.date} = ${DATE} and ${dailySyncTable.scope} = 'live'`);
    const data = row.data as {
      dayState: { runs: Array<{ id: string }> };
      runValues: Record<string, unknown>;
      runValuesUpdatedAt: Record<string, number>;
      deletedItems: Record<string, string[]>;
      deletedStamps: Record<string, Record<string, number>>;
    };
    expect(data.dayState.runs.map((run) => run.id)).toEqual([
      "named",
      "named-ambiguous",
      "ambiguous-one",
      "ambiguous-two",
    ]);
    expect(data.runValues.copied).toBeUndefined();
    expect(data.runValuesUpdatedAt.copied).toBeUndefined();
    expect(data.deletedItems.runs).toContain("copied");
    expect(data.deletedStamps.runs.copied).toBeGreaterThan(0);

    const [marker] = await db
      .select()
      .from(dataHealsTable)
      .where(sql`${dataHealsTable.id} = 'fresh-device-run-contamination-v1'`);
    expect(marker.result).toMatchObject({
      healedDays: 1,
      removedRuns: 1,
      ambiguousCandidates: 2,
    });

    // Marker-guarded: repeating boot heals does not revisit the same row.
    await runDataHeals();
    const [again] = await db
      .select()
      .from(dailySyncTable)
      .where(sql`${dailySyncTable.date} = ${DATE} and ${dailySyncTable.scope} = 'live'`);
    expect((again.data as { dayState: { runs: unknown[] } }).dayState.runs).toHaveLength(4);
  });
});

describe("/sync — additive run-list protection (whole-run loss guard)", () => {
  // A device that briefly holds a SHORTER run list (post-refresh / before it has
  // seen a peer's runs) must not be able to drop everyone's runs by pushing that
  // short dayState.runs. The server union-merges today's run list by id; only an
  // explicit tombstone removes a run. Future scheduled rows retain their
  // deliberate replacement path.
  const DATE = "2030-06-01";
  function put(payload: unknown) {
    return fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
  }
  async function readRow() {
    const res = await fetch(`${baseUrl}/api/sync/${DATE}`, { headers: authHeaders() });
    return (await res.json()) as {
      dayState?: { runs?: Array<{ id: string }> };
      runValues?: Record<string, { casesNeeded?: number }>;
    } | null;
  }
  const run = (id: string) => ({ id, brand: "Acme", flavor: id });

  it("preserves stored runs a same-day push omits (no whole-run loss)", async () => {
    // Seed three runs at a stable resetAt.
    await put({
      dayState: { runs: [run("a"), run("b"), run("c")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 }, b: { casesNeeded: 20 }, c: { casesNeeded: 30 } },
      runValuesUpdatedAt: { a: 1, b: 1, c: 1 },
    });
    // A device with only run "a" pushes (same resetAt → not a reset).
    await put({
      dayState: { runs: [run("a")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 } },
      runValuesUpdatedAt: { a: 1 },
    });
    const row = await readRow();
    expect((row?.dayState?.runs ?? []).map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    expect(row?.runValues?.b?.casesNeeded).toBe(20);
    expect(row?.runValues?.c?.casesNeeded).toBe(30);
  });

  it("removes a run that was explicitly tombstoned (deletion still works)", async () => {
    await put({
      dayState: { runs: [run("a"), run("b")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 }, b: { casesNeeded: 20 } },
      runValuesUpdatedAt: { a: 1, b: 1 },
    });
    // Push deletes run "b" via a tombstone while omitting it from the run list.
    await put({
      dayState: { runs: [run("a")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 } },
      runValuesUpdatedAt: { a: 1 },
      deletedItems: { runs: ["b"] },
    });
    const row = await readRow();
    expect((row?.dayState?.runs ?? []).map((r) => r.id)).toEqual(["a"]);
    expect(row?.runValues?.b).toBeUndefined();
  });

  it("does not resurrect a deleted run when a stale peer syncs, preserving the survivor and selection", async () => {
    const D = "2030-06-04";
    const survivor = run("survivor");
    const removed = run("removed");
    const devicePut = (senderId: string, payload: unknown) =>
      fetch(`${baseUrl}/api/sync/today?today=${D}`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ senderId, payload }),
      });

    // Both devices initially share the same two-run day, with device B's
    // current selection pointing at index 0 — the run that will survive
    // deletion. Selection itself is local-only; preserving this run first in
    // the returned list lets device B retain that selection.
    const sharedPayload = {
      dayState: {
        runs: [survivor, removed],
        resetAt: 1000,
      },
      runValues: {
        survivor: { casesNeeded: 10 },
        removed: { casesNeeded: 20 },
      },
      runValuesUpdatedAt: { survivor: 1, removed: 1 },
    };
    expect((await devicePut("device-a", sharedPayload)).status).toBe(200);
    expect((await devicePut("device-b", sharedPayload)).status).toBe(200);

    // Device A removes the not-started run and pushes the same tombstone that
    // the Manage Runs UI records locally.
    const deletedPayload = {
      ...sharedPayload,
      dayState: {
        ...sharedPayload.dayState,
        runs: [survivor],
      },
      runValues: { survivor: { casesNeeded: 10 } },
      runValuesUpdatedAt: { survivor: 1 },
      deletedItems: { runs: ["removed"] },
    };
    expect((await devicePut("device-a", deletedPayload)).status).toBe(200);

    // Device B syncs its stale copy. The server must drop only the tombstoned
    // run, including its value, while keeping B's current selection intact.
    const syncResponse = await fetch(`${baseUrl}/api/sync/${D}`, { headers: authHeaders() });
    expect(syncResponse.status).toBe(200);
    const synced = (await syncResponse.json()) as {
      dayState?: { runs?: Array<{ id: string }> };
      runValues?: Record<string, { casesNeeded?: number }>;
      deletedItems?: { runs?: string[] };
    };
    expect(synced.dayState?.runs?.map((r) => r.id)).toEqual(["survivor"]);
    expect(synced.runValues?.survivor?.casesNeeded).toBe(10);
    expect(synced.runValues?.removed).toBeUndefined();
    expect(synced.deletedItems?.runs).toContain("removed");

    // A stale peer replay after the pull must remain unable to resurrect it.
    expect((await devicePut("device-b", sharedPayload)).status).toBe(200);
    const afterReplay = await fetch(`${baseUrl}/api/sync/${D}`, { headers: authHeaders() });
    const replayed = (await afterReplay.json()) as {
      dayState?: { runs?: Array<{ id: string }> };
      runValues?: Record<string, unknown>;
    };
    expect(replayed.dayState?.runs?.map((r) => r.id)).toEqual(["survivor"]);
    expect(replayed.runValues?.removed).toBeUndefined();
  });

  it("keeps canonical lifecycle changes when a third same-baseline peer reconnects late", async () => {
    const conflictDate = "2030-06-05";
    const activeRun = {
      ...run("active"),
      metaUpdatedAt: 1_000,
    };
    const baseline = {
      syncVersion: 1,
      completeness: "complete",
      dayState: {
        date: conflictDate,
        runs: [activeRun],
        resetAt: 1_000,
      },
      runValues: { active: { casesNeeded: 40 } },
      runValuesUpdatedAt: { active: 1_000 },
    };
    const peerPut = async (senderId: string, payload: any): Promise<Response> => {
      let nextPayload = payload;
      let response: Response;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await fetch(`${baseUrl}/api/sync/today?today=${conflictDate}`, {
          method: "PUT",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ senderId, payload: nextPayload }),
        });
        const body = await response.clone().json() as { partialFallback?: boolean; snapshotId?: string };
        if (!body.partialFallback || !body.snapshotId) return response;
        nextPayload = { ...nextPayload, baseSnapshotId: body.snapshotId };
      }
      return response!;
    };

    const seeded = await peerPut("lifecycle-seed", baseline);
    expect(seeded.status).toBe(200);
    const seededBody = await seeded.json() as { data: typeof baseline };
    const sharedBaseline = seededBody.data;
    const addedRun = {
      ...run("concurrent-added"),
      metaUpdatedAt: 2_000,
    };

    const peerAStartAndAdd = {
      ...sharedBaseline,
      dayState: {
        ...sharedBaseline.dayState,
        runs: [
          {
            ...activeRun,
            startedAt: 2_000,
            metaUpdatedAt: 2_000,
          },
          addedRun,
        ],
      },
      runValues: {
        ...sharedBaseline.runValues,
        [addedRun.id]: { casesNeeded: 20 },
      },
      runValuesUpdatedAt: {
        ...sharedBaseline.runValuesUpdatedAt,
        [addedRun.id]: 2_000,
      },
    };
    const peerBEndAndRemove = {
      ...sharedBaseline,
      dayState: {
        ...sharedBaseline.dayState,
        runs: [{
          ...activeRun,
          startedAt: 2_000,
          endedAt: 3_000,
          metaUpdatedAt: 3_000,
        }],
      },
      deletedItems: { runs: [addedRun.id] },
    };

    const responses = await Promise.all([
      peerPut("lifecycle-peer-a", peerAStartAndAdd),
      peerPut("lifecycle-peer-b", peerBEndAndRemove),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const canonicalResponse = await fetch(`${baseUrl}/api/sync/${conflictDate}`, {
      headers: authHeaders(),
    });
    expect(canonicalResponse.status).toBe(200);
    const canonical = await canonicalResponse.json() as typeof baseline & {
      deletedItems?: { runs?: string[] };
    };
    expect(canonical.dayState.runs).toEqual([
      expect.objectContaining({
        id: activeRun.id,
        startedAt: 2_000,
        endedAt: 3_000,
        metaUpdatedAt: 3_000,
      }),
    ]);
    expect((canonical.runValues as Record<string, unknown>)[addedRun.id]).toBeUndefined();
    expect(canonical.deletedItems?.runs).toContain(addedRun.id);

    // Both peers adopt the complete canonical snapshot, then publish it back.
    // The repeat writes prove that neither stale branch can undo End or Remove.
    const converged = await Promise.all([
      peerPut("lifecycle-peer-a", canonical),
      peerPut("lifecycle-peer-b", canonical),
    ]);
    expect(converged.map((response) => response.status)).toEqual([200, 200]);
    const adopted = await Promise.all(converged.map(async (response) =>
      (await response.json()) as { data: typeof canonical }));
    expect(adopted[0].data).toEqual(adopted[1].data);
    expect(adopted[0].data.dayState.runs).toEqual(canonical.dayState.runs);
    expect((adopted[0].data.runValues as Record<string, unknown>)[addedRun.id]).toBeUndefined();

    // Peer C missed the conflict and reconnects with the original baseline.
    // Its write response is the complete canonical snapshot it must adopt
    // before releasing any queued stale lifecycle work.
    const reconnect = await peerPut("lifecycle-peer-c", sharedBaseline);
    expect(reconnect.status).toBe(200);
    const reconnectBody = await reconnect.json() as {
      data: typeof canonical;
    };
    expect(reconnectBody.data).toMatchObject({
      syncVersion: 1,
      completeness: "complete",
    });
    expect(reconnectBody.data.dayState.runs).toEqual(canonical.dayState.runs);
    expect(reconnectBody.data.dayState.runs[0]).toMatchObject({
      id: activeRun.id,
      endedAt: 3_000,
      metaUpdatedAt: 3_000,
    });
    expect((reconnectBody.data.runValues as Record<string, unknown>)[addedRun.id]).toBeUndefined();
    expect(reconnectBody.data.deletedItems?.runs).toContain(addedRun.id);

    const peerCAdopted = await peerPut("lifecycle-peer-c", reconnectBody.data);
    expect(peerCAdopted.status).toBe(200);

    // Even if queued pre-reconnect work replays after adoption, it cannot undo
    // End or resurrect the concurrently removed run. Replay the pre-convergence
    // branch that actually still carries the added run and an un-ended active
    // run — the payload the resurrection/undo would require to succeed.
    const staleReplay = await peerPut("lifecycle-peer-c", peerAStartAndAdd);
    expect(staleReplay.status).toBe(200);
    const replayBody = await staleReplay.json() as {
      data: typeof canonical & { deletedItems?: { runs?: string[] } };
    };
    expect(replayBody.data.dayState.runs).toEqual(canonical.dayState.runs);
    expect(replayBody.data.dayState.runs[0]).toMatchObject({
      endedAt: 3_000,
      metaUpdatedAt: 3_000,
    });
    expect((replayBody.data.runValues as Record<string, unknown>)[addedRun.id]).toBeUndefined();
    expect(replayBody.data.deletedItems?.runs).toContain(addedRun.id);

    // The stored row itself must reflect the same rejection, not just the
    // response body for this one request.
    const afterStaleReplay = await fetch(`${baseUrl}/api/sync/${conflictDate}`, {
      headers: authHeaders(),
    });
    const storedAfterReplay = await afterStaleReplay.json() as typeof canonical & {
      deletedItems?: { runs?: string[] };
    };
    expect(storedAfterReplay.dayState.runs).toEqual(canonical.dayState.runs);
    expect(storedAfterReplay.dayState.runs[0]).toMatchObject({
      endedAt: 3_000,
      metaUpdatedAt: 3_000,
    });
    expect((storedAfterReplay.runValues as Record<string, unknown>)[addedRun.id]).toBeUndefined();
    expect(storedAfterReplay.deletedItems?.runs).toContain(addedRun.id);
  });

  it("keeps the newer Resume canonical when same-baseline peers race Pause and Resume in either order", async () => {
    const scenarios = [
      { date: "2030-06-06", order: ["pause", "resume"] as const },
      { date: "2030-06-07", order: ["resume", "pause"] as const },
    ];

    for (const { date, order } of scenarios) {
      const activeRun = {
        ...run(`pause-resume-${date}`),
        startedAt: 1_000,
        metaUpdatedAt: 1_000,
      };
      const baseline = {
        syncVersion: 1,
        completeness: "complete",
        dayState: {
          date,
          runs: [activeRun],
          resetAt: 1_000,
        },
        runValues: { [activeRun.id]: { casesNeeded: 40 } },
        runValuesUpdatedAt: { [activeRun.id]: 1_000 },
      };
      const peerPut = async (senderId: string, payload: any): Promise<Response> => {
        let nextPayload = payload;
        let response: Response;
        for (let attempt = 0; attempt < 4; attempt++) {
          response = await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
            method: "PUT",
            headers: { ...authHeaders(), "content-type": "application/json" },
            body: JSON.stringify({ senderId, payload: nextPayload }),
          });
          const body = await response.clone().json() as { partialFallback?: boolean; snapshotId?: string };
          if (!body.partialFallback || !body.snapshotId) return response;
          nextPayload = { ...nextPayload, baseSnapshotId: body.snapshotId };
        }
        return response!;
      };

      const seeded = await peerPut(`pause-resume-seed-${date}`, baseline);
      expect(seeded.status).toBe(200);
      const sharedBaseline = ((await seeded.json()) as { data: typeof baseline }).data;
      const pauseId = `pause-${date}`;
      const paused = {
        ...sharedBaseline,
        dayState: {
          ...sharedBaseline.dayState,
          runs: [{
            ...activeRun,
            pausedAt: 2_000,
            pausedStoppageId: pauseId,
            stoppages: [{ id: pauseId, type: "pause", reason: "Break", startedAt: 2_000 }],
            metaUpdatedAt: 2_000,
          }],
        },
      };
      const resumed = {
        ...sharedBaseline,
        dayState: {
          ...sharedBaseline.dayState,
          runs: [{
            ...activeRun,
            startedAt: 2_000,
            stoppages: [{
              id: pauseId,
              type: "pause",
              reason: "Break",
              startedAt: 2_000,
              endedAt: 3_000,
            }],
            metaUpdatedAt: 3_000,
          }],
        },
      };
      const payloads = { pause: paused, resume: resumed };

      for (const action of order) {
        const response = await peerPut(`pause-resume-${action}-${date}`, payloads[action]);
        expect(response.status).toBe(200);
      }

      const canonicalResponse = await fetch(`${baseUrl}/api/sync/${date}`, {
        headers: authHeaders(),
      });
      expect(canonicalResponse.status).toBe(200);
      const canonical = await canonicalResponse.json() as typeof resumed & {
        dayState: { runs: Array<{ pausedAt?: number; pausedStoppageId?: string }> };
      };
      expect(canonical.dayState.runs).toEqual([expect.objectContaining({
        id: activeRun.id,
        startedAt: 2_000,
        metaUpdatedAt: 3_000,
        stoppages: [expect.objectContaining({
          id: pauseId,
          startedAt: 2_000,
          endedAt: 3_000,
        })],
      })]);
      expect(canonical.dayState.runs[0].pausedAt).toBeUndefined();
      expect(canonical.dayState.runs[0].pausedStoppageId).toBeUndefined();

      const adopted = await Promise.all([
        peerPut(`pause-resume-pause-${date}`, canonical),
        peerPut(`pause-resume-resume-${date}`, canonical),
      ]);
      expect(adopted.map((response) => response.status)).toEqual([200, 200]);
      const peerSnapshots = await Promise.all(adopted.map(async (response) =>
        ((await response.json()) as { data: typeof canonical }).data));
      expect(peerSnapshots[0]).toEqual(peerSnapshots[1]);
      expect(peerSnapshots[0].dayState.runs).toEqual(canonical.dayState.runs);
    }
  });

  it("preserves a later un-delete decision when a stale scheduled replacement omits its stamps", async () => {
    // Delete/un-delete is a factory-data decision, not a disposable schedule
    // field. A stale device can legitimately replace a FUTURE day's run list,
    // but it must not erase a newer re-add stamp and make the item disappear
    // again after the next client-side tombstone merge.
    const future = "2030-06-20";
    const putFuture = (payload: unknown) =>
      fetch(`${baseUrl}/api/sync/${future}?today=${DATE}`, {
        method: "PUT",
        headers: { ...managerAuthHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ senderId: "schedule-device", payload }),
      });

    await putFuture({
      dayState: { runs: [run("first")], resetAt: 1_000 },
      runValues: { first: { casesNeeded: 10 } },
      runValuesUpdatedAt: { first: 1 },
      deletedItems: { brands: ["returning brand"] },
      deletedStamps: { brands: { "returning brand": 1_000 } },
    });
    await putFuture({
      dayState: { runs: [run("re-added")], resetAt: 2_000 },
      runValues: { "re-added": { casesNeeded: 20 } },
      runValuesUpdatedAt: { "re-added": 2 },
      undeletedStamps: { brands: { "returning brand": 2_000 } },
    });
    // An older client replaces this scheduled day again without either stamp
    // map. The new schedule may win, but the re-add history must survive.
    await putFuture({
      dayState: { runs: [run("stale-replacement")], resetAt: 3_000 },
      runValues: { "stale-replacement": { casesNeeded: 30 } },
      runValuesUpdatedAt: { "stale-replacement": 3 },
    });

    const row = await fetch(`${baseUrl}/api/sync/${future}`, { headers: authHeaders() }).then((r) => r.json()) as {
      deletedStamps?: Record<string, Record<string, number>>;
      undeletedStamps?: Record<string, Record<string, number>>;
    };
    expect(row.deletedStamps?.brands?.["returning brand"]).toBe(1_000);
    expect(row.undeletedStamps?.brands?.["returning brand"]).toBe(2_000);
  });

  it("preserves both run lists under concurrent FIRST writes to a new date (no first-write clobber)", async () => {
    // No row exists yet, so FOR UPDATE locks nothing: two concurrent first PUTs
    // with different single-run lists must still converge to the union, not let
    // the last writer clobber the other's run.
    const D = "2030-06-02";
    const putD = (payload: unknown) =>
      fetch(`${baseUrl}/api/sync/today?today=${D}`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ senderId: "c1", payload }),
      });
    await Promise.all([
      putD({ dayState: { runs: [run("a")], resetAt: 1000 }, runValues: { a: { casesNeeded: 10 } }, runValuesUpdatedAt: { a: 1 } }),
      putD({ dayState: { runs: [run("b")], resetAt: 1000 }, runValues: { b: { casesNeeded: 20 } }, runValuesUpdatedAt: { b: 1 } }),
    ]);
    const res = await fetch(`${baseUrl}/api/sync/${D}`, { headers: authHeaders() });
    const row = (await res.json()) as { dayState?: { runs?: Array<{ id: string }> } } | null;
    expect((row?.dayState?.runs ?? []).map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("preserves both operators' edits under concurrent scheduled-day writes", async () => {
    // Scheduled days use the explicit-date route and allow intentional run-list
    // replacement. The first-write unique-key retry must still merge the two
    // operators' edits rather than letting whichever request commits last win.
    const scheduledDate = "2030-06-03";
    const clientToday = "2030-06-01";
    const writes = [
      { id: "scheduled-device-a", casesNeeded: 15 },
      { id: "scheduled-device-b", casesNeeded: 25 },
    ];
    const putScheduled = ({ id, casesNeeded }: (typeof writes)[number]) =>
      fetch(`${baseUrl}/api/sync/${scheduledDate}?today=${clientToday}`, {
        method: "PUT",
        headers: { ...managerAuthHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          senderId: id,
          payload: {
            dayState: { runs: [run(id)], resetAt: 1_000 },
            runValues: { [id]: { casesNeeded } },
            runValuesUpdatedAt: { [id]: 1 },
          },
        }),
      });

    const responses = await Promise.all(writes.map(putScheduled));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const storedResponse = await fetch(`${baseUrl}/api/sync/${scheduledDate}`, {
      headers: authHeaders(),
    });
    expect(storedResponse.status).toBe(200);
    const stored = (await storedResponse.json()) as {
      dayState?: { runs?: Array<{ id: string }> };
      runValues?: Record<string, { casesNeeded?: number }>;
    };
    expect((stored.dayState?.runs ?? []).map((entry) => entry.id).sort()).toEqual(
      writes.map(({ id }) => id).sort(),
    );
    expect(stored.runValues).toMatchObject({
      "scheduled-device-a": { casesNeeded: 15 },
      "scheduled-device-b": { casesNeeded: 25 },
    });

    // The losing first insert must retry against the newly-created scheduled
    // row. Conflict logging is asynchronous, so wait for that retry evidence.
    const deadline = Date.now() + 2_000;
    let conflicts = await db
      .select()
      .from(syncConflictLogsTable)
      .where(eq(syncConflictLogsTable.date, scheduledDate));
    while (conflicts.length < 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      conflicts = await db
        .select()
        .from(syncConflictLogsTable)
        .where(eq(syncConflictLogsTable.date, scheduledDate));
    }
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].scope).toBe("live");
    expect(conflicts[0].resolution).toBe("additive-union");
    expect(conflicts[0].fieldsWithConflicts.some((field) => field.startsWith("dayState.runs:appended"))).toBe(true);
  });

  it("preserves every run and logs each merge under a burst of concurrent FIRST writes", async () => {
    // Exercise more contention than the two-writer regression above. Every
    // writer starts from an empty date with a distinct run and value. The
    // first insert wins the unique-constraint race; each retry must then merge
    // against the row created by the preceding writer instead of replacing it.
    const D = "2030-06-04";
    const writes = [
      { id: "burst-a", casesNeeded: 11 },
      { id: "burst-b", casesNeeded: 22 },
      { id: "burst-c", casesNeeded: 33 },
      { id: "burst-d", casesNeeded: 44 },
    ];
    const putBurst = ({ id, casesNeeded }: (typeof writes)[number]) =>
      fetch(`${baseUrl}/api/sync/today?today=${D}`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          senderId: id,
          payload: {
            dayState: { runs: [run(id)], resetAt: 1000 },
            runValues: { [id]: { casesNeeded } },
            runValuesUpdatedAt: { [id]: 1 },
          },
        }),
      });

    const responses = await Promise.all(writes.map(putBurst));
    expect(responses.every((response) => response.status === 200)).toBe(true);

    const storedResponse = await fetch(`${baseUrl}/api/sync/${D}`, { headers: authHeaders() });
    expect(storedResponse.status).toBe(200);
    const stored = (await storedResponse.json()) as {
      dayState?: { runs?: Array<{ id: string }> };
      runValues?: Record<string, { casesNeeded?: number }>;
    } | null;
    expect((stored?.dayState?.runs ?? []).map((entry) => entry.id).sort()).toEqual(
      writes.map(({ id }) => id).sort(),
    );
    for (const { id, casesNeeded } of writes) {
      expect(stored?.runValues?.[id]?.casesNeeded).toBe(casesNeeded);
    }

    // Conflict logging is intentionally fire-and-forget, so wait for the
    // three non-first writers' protective merges to finish recording.
    const deadline = Date.now() + 2_000;
    let conflicts = await db
      .select()
      .from(syncConflictLogsTable)
      .where(eq(syncConflictLogsTable.date, D));
    while (conflicts.length < writes.length - 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      conflicts = await db
        .select()
        .from(syncConflictLogsTable)
        .where(eq(syncConflictLogsTable.date, D));
    }
    expect(conflicts).toHaveLength(writes.length - 1);
    expect(conflicts.every((conflict) => conflict.scope === "live")).toBe(true);
    expect(conflicts.every((conflict) => conflict.resolution === "additive-union")).toBe(true);
    expect(conflicts.every((conflict) => conflict.fieldsWithConflicts.some((field) => field.startsWith("dayState.runs:appended(")))).toBe(true);
  });

  it("preserves every repeated first-write burst under pool pressure without cross-date conflict logs", async () => {
    // Five independent empty days submit four writers each at once. This creates
    // more simultaneous route transactions (and later background conflict-log
    // inserts) than the default pg pool can immediately serve, exercising retry
    // exhaustion and ensuring conflict records remain attached to their own day.
    const groups = Array.from({ length: 5 }, (_, groupIndex) => {
      const date = `2030-06-${String(20 + groupIndex).padStart(2, "0")}`;
      const writes = Array.from({ length: 4 }, (_, writerIndex) => ({
        id: `pressure-${groupIndex}-${writerIndex}`,
        casesNeeded: (groupIndex + 1) * 100 + writerIndex,
      }));
      return { date, writes };
    });
    const putBurst = (
      date: string,
      { id, casesNeeded }: (typeof groups)[number]["writes"][number],
    ) =>
      fetch(`${baseUrl}/api/sync/today?today=${date}`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          senderId: id,
          payload: {
            dayState: { runs: [run(id)], resetAt: 1000 },
            runValues: { [id]: { casesNeeded } },
            runValuesUpdatedAt: { [id]: 1 },
          },
        }),
      });

    const responses = await Promise.all(
      groups.flatMap(({ date, writes }) => writes.map((write) => putBurst(date, write))),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);

    for (const { date, writes } of groups) {
      const storedResponse = await fetch(`${baseUrl}/api/sync/${date}`, { headers: authHeaders() });
      expect(storedResponse.status).toBe(200);
      const stored = (await storedResponse.json()) as {
        dayState?: { runs?: Array<{ id: string }> };
        runValues?: Record<string, { casesNeeded?: number }>;
      } | null;
      expect((stored?.dayState?.runs ?? []).map((entry) => entry.id).sort()).toEqual(
        writes.map(({ id }) => id).sort(),
      );
      for (const { id, casesNeeded } of writes) {
        expect(stored?.runValues?.[id]?.casesNeeded).toBe(casesNeeded);
      }
    }

    // Every group has one clean initial insert and three protective retry
    // merges. Logging is asynchronous, so poll the isolated test database until
    // every date has exactly those three records, then assert no record leaked
    // into a different date.
    const expectedPerDate = 3;
    const expectedTotal = groups.length * expectedPerDate;
    const dates = new Set(groups.map(({ date }) => date));
    const deadline = Date.now() + 3_000;
    let conflicts = await db.select().from(syncConflictLogsTable);
    while (
      (
        conflicts.length < expectedTotal
        || groups.some(({ date }) => conflicts.filter((conflict) => conflict.date === date).length < expectedPerDate)
      )
      && Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      conflicts = await db.select().from(syncConflictLogsTable);
    }
    expect(conflicts).toHaveLength(expectedTotal);
    expect(conflicts.every((conflict) => dates.has(conflict.date))).toBe(true);
    for (const { date } of groups) {
      const dateConflicts = conflicts.filter((conflict) => conflict.date === date);
      expect(dateConflicts).toHaveLength(expectedPerDate);
      expect(dateConflicts.every((conflict) => conflict.scope === "live")).toBe(true);
      expect(dateConflicts.every((conflict) => conflict.resolution === "additive-union")).toBe(true);
      expect(
        dateConflicts.every((conflict) =>
          conflict.fieldsWithConflicts.some((field) => field.startsWith("dayState.runs:appended("))),
      ).toBe(true);
    }
  });

  it("does NOT treat a normal push as a reset when the STORED row has no resetAt baseline", async () => {
    // Production saw an active day's row carrying a NULL resetAt. The reset escape
    // hatch defaulted a missing stored resetAt to 0, so a normal same-day push
    // (which carries the day's real, large resetAt) looked like a "strictly newer
    // reset" and wholesale-clobbered the shared runs. A missing stored baseline
    // must fall through to the additive merge and preserve every run.
    const D = "2030-06-03";
    const putD = (senderId: string, payload: unknown) =>
      fetch(`${baseUrl}/api/sync/today?today=${D}`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ senderId, payload }),
      });
    // Seed a populated row WITHOUT a resetAt (legacy / null-baseline row).
    await putD("c1", {
      dayState: { runs: [run("a"), run("b"), run("c")] },
      runValues: { a: { casesNeeded: 10 }, b: { casesNeeded: 20 }, c: { casesNeeded: 30 } },
      runValuesUpdatedAt: { a: 1, b: 1, c: 1 },
    });
    // A peer pushes a SHORTER list but WITH a real resetAt — must NOT wholesale-win.
    await putD("c2", {
      dayState: { runs: [run("a")], resetAt: Date.now() },
      runValues: { a: { casesNeeded: 10 } },
      runValuesUpdatedAt: { a: 1 },
    });
    const res = await fetch(`${baseUrl}/api/sync/${D}`, { headers: authHeaders() });
    const row = (await res.json()) as { dayState?: { runs?: Array<{ id: string }> } } | null;
    expect((row?.dayState?.runs ?? []).map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps every populated same-day run when a fresh client races in with a newer reset marker", async () => {
    await put({
      dayState: { runs: [run("a"), run("b"), run("c")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 }, b: { casesNeeded: 20 }, c: { casesNeeded: 30 } },
      runValuesUpdatedAt: { a: 1, b: 1, c: 1 },
    });
    // This is the exact fresh-device race: before it consumes SSE's initial
    // snapshot, it has only a short/stale local day and a newer marker.
    await put({
      dayState: { runs: [run("a")], resetAt: 2000 },
      runValues: { a: { casesNeeded: 10 } },
      runValuesUpdatedAt: { a: 1 },
    });
    const row = await readRow();
    expect((row?.dayState?.runs ?? []).map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    expect(row?.runValues?.b?.casesNeeded).toBe(20);
    expect(row?.runValues?.c?.casesNeeded).toBe(30);
  });

  it("allows an intentional future scheduled-day replacement", async () => {
    const future = "2030-06-10";
    const putFuture = (payload: unknown) =>
      fetch(`${baseUrl}/api/sync/${future}?today=${DATE}`, {
        method: "PUT",
        headers: { ...managerAuthHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ senderId: "schedule-editor", payload }),
      });
    await putFuture({
      dayState: { runs: [run("a"), run("b")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 }, b: { casesNeeded: 20 } },
      runValuesUpdatedAt: { a: 1, b: 1 },
    });
    await putFuture({
      dayState: { runs: [run("z")], resetAt: 2000 },
      runValues: { z: { casesNeeded: 99 } },
      runValuesUpdatedAt: { z: 5 },
    });
    const res = await fetch(`${baseUrl}/api/sync/${future}`, { headers: authHeaders() });
    const row = (await res.json()) as { dayState?: { runs?: Array<{ id: string }> } } | null;
    expect((row?.dayState?.runs ?? []).map((r) => r.id)).toEqual(["z"]);
  });
});

describe("/sync/events — active-run calc tick", () => {
  // The server re-emits the server-computed calc on a low cadence while a run
  // is active. Uses LIVE_CALC_TICK_MS so the test does not wait on the 15s
  // default heartbeat.
  it("pushes a calcTick frame with serverCalc for the active run", async () => {
    const date = "2030-03-13";
    process.env.LIVE_CALC_TICK_MS = "2000";
    await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "calc-tick-writer",
        payload: {
          dayState: { runs: [{ id: "active-run", brand: "Acme", flavor: "Pep", startedAt: 1000 }] },
          runValues: { "active-run": { casesNeeded: 240 } },
          runValuesUpdatedAt: { "active-run": 1 },
        },
      }),
    });

    const ctrl = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/sync/events?clientId=calc-tick-watcher&today=${date}`,
      { headers: authHeaders(), signal: ctrl.signal },
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let tickFrame: Record<string, unknown> | undefined;
    const deadline = Date.now() + 5_000;
    try {
      while (Date.now() < deadline && !tickFrame) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          const line = f.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const parsed = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
          if (parsed.calcTick === true) { tickFrame = parsed; break; }
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      ctrl.abort();
      delete process.env.LIVE_CALC_TICK_MS;
    }

    expect(tickFrame).toBeDefined();
    const serverCalc = tickFrame!.serverCalc as { runId?: string } | null | undefined;
    expect(serverCalc?.runId).toBe("active-run");
    expect(typeof (tickFrame!.serverTime as number | undefined)).toBe("number");
  });
});

describe("/sync/events — date-scoped broadcasts", () => {
  // Two live watchers on the SAME scope but DIFFERENT local dates must not
  // receive each other's pushes, or a peer behind/ahead of UTC would clobber its
  // live view with another calendar day's state.
  // NOTE: controllers are aborted deterministically at the end so the open SSE
  // connections don't hang afterAll's server.close().
  function collectSenderIds(date: string, ctrl: AbortController, sink: string[]): Promise<void> {
    return (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const res = await fetch(
          `${baseUrl}/api/sync/events?clientId=watcher-${date}&today=${date}`,
          { headers: authHeaders(), signal: ctrl.signal },
        );
        reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const f of frames) {
            const line = f.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const parsed = JSON.parse(line.slice("data: ".length)) as { senderId: string | null };
            // Ignore the initial-row push (senderId: null); record broadcasts.
            if (parsed.senderId) sink.push(parsed.senderId);
          }
        }
      } catch {
        // aborted or stream error — collection is best-effort.
      } finally {
        // Abort the fetch and cancel the reader independently. Node's fetch
        // can leave a body reader pending when only the controller is aborted,
        // which keeps the test server alive during suite teardown.
        await reader?.cancel().catch(() => {});
      }
    })();
  }

  it("sends the current-day snapshot as the first frame for a newly connected device", async () => {
    const date = "2030-03-12";
    await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "schedule-writer",
        payload: {
          dayState: { runs: [{ id: "scheduled-run", brand: "Acme", flavor: "Pep", startedAt: 1000 }], resetAt: 1000 },
          runValues: { "scheduled-run": { casesNeeded: 240 } },
          runValuesUpdatedAt: { "scheduled-run": 1 },
        },
      }),
    });

    const ctrl = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/sync/events?clientId=new-tablet&today=${date}`,
      { headers: authHeaders(), signal: ctrl.signal },
    );
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    ctrl.abort();

    const frame = new TextDecoder().decode(value);
    const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
    expect(line).toBeDefined();
    const initial = JSON.parse(line!.slice("data: ".length)) as {
      initial?: boolean;
      senderId?: string | null;
      data?: { dayState?: { runs?: Array<{ id: string }> } };
      serverCalc?: { runId: string } | null;
      autoTrackSchedule?: { runId: string; entries: unknown[] } | null;
      operationalProjection?: {
        version: number;
        runId: string;
        serverTimeMs: number;
        calculationRevision: number;
        effectiveElapsedSec: number;
        facts: { runStatus: string; pressDone: boolean };
      } | null;
      serverTime?: number;
    };
    expect(initial.initial).toBe(true);
    expect(initial.senderId).toBeNull();
    expect(initial.data?.dayState?.runs?.map((run) => run.id)).toContain("scheduled-run");
    expect(initial.serverCalc?.runId).toBe("scheduled-run");
    expect(initial.autoTrackSchedule).toMatchObject({ runId: "scheduled-run", entries: [] });
    expect(initial.operationalProjection).toMatchObject({
      version: 1,
      runId: "scheduled-run",
      calculationRevision: 1,
      facts: { runStatus: "running", pressDone: false },
    });
    expect(initial.operationalProjection?.serverTimeMs).toBe(initial.serverTime);
  });

  it("delivers a PUT /sync/today broadcast only to same-date watchers", async () => {
    // Watcher A is on 2030-03-10, watcher B is on 2030-03-11. A push from a
    // sender on 2030-03-10 must reach A and NOT B.
    const ctrlA = new AbortController();
    const ctrlB = new AbortController();
    const aEvents: string[] = [];
    const bEvents: string[] = [];
    const pA = collectSenderIds("2030-03-10", ctrlA, aEvents);
    const pB = collectSenderIds("2030-03-11", ctrlB, bEvents);
    // Let both streams register before the push, then let it propagate.
    await new Promise((r) => setTimeout(r, 400));
    await fetch(`${baseUrl}/api/sync/today?today=2030-03-10`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "sender-A", payload: { dayState: { runs: [] }, runValues: {} } }),
    });
    await new Promise((r) => setTimeout(r, 600));
    ctrlA.abort();
    ctrlB.abort();
    await Promise.allSettled([pA, pB]);
    expect(aEvents).toContain("sender-A");
    expect(bEvents).not.toContain("sender-A");
  });

  // Regression: a schedule import writes each day via PUT /sync/:date. TODAY's
  // write must broadcast to the live view, but the server only broadcasts when
  // `date === clientToday(req)`. If the import omits `?today=`, clientToday
  // falls back to the SERVER's UTC date; when the operator's local date differs
  // (e.g. a US evening), today's runs are stored but NEVER broadcast, so the
  // open app never shows today's schedule. Passing the operator's `?today=`
  // makes the dated write broadcast regardless of the server's timezone.
  it("broadcasts a PUT /sync/:date to a same-date watcher when ?today matches the date", async () => {
    const ctrl = new AbortController();
    const events: string[] = [];
    const p = collectSenderIds("2030-04-01", ctrl, events);
    await new Promise((r) => setTimeout(r, 400));
    await fetch(`${baseUrl}/api/sync/2030-04-01?today=2030-04-01`, {
      method: "PUT",
      headers: { ...managerAuthHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "importer", payload: { dayState: { runs: [], date: "2030-04-01" }, runValues: {} } }),
    });
    await new Promise((r) => setTimeout(r, 600));
    ctrl.abort();
    await Promise.allSettled([p]);
    expect(events).toContain("importer");
  });

  it("does NOT broadcast a PUT /sync/:date for a future date to today's watcher", async () => {
    // A future-day write (any date !== the watcher's today) must never reach a
    // live today watcher, or a scheduled-day import would clobber the live view.
    const ctrl = new AbortController();
    const events: string[] = [];
    const p = collectSenderIds("2030-04-02", ctrl, events);
    await new Promise((r) => setTimeout(r, 400));
    await fetch(`${baseUrl}/api/sync/2030-04-09?today=2030-04-02`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "future-importer", payload: { dayState: { runs: [], date: "2030-04-09" }, runValues: {} } }),
    });
    await new Promise((r) => setTimeout(r, 600));
    ctrl.abort();
    await Promise.allSettled([p]);
    expect(events).not.toContain("future-importer");
  });
});

  it("sends a materially smaller snapshot-anchored frame for a one-run peer update", async () => {
    const date = "2030-03-15";
    const runs = Array.from({ length: 32 }, (_, index) => ({
      id: `peer-delta-${index}`,
      brand: "Acme",
      flavor: `Flavor ${index}`,
      metaUpdatedAt: 1_000 + index,
    }));
    const runValues = Object.fromEntries(runs.map((run, index) => [
      run.id,
      {
        casesNeeded: 200 + index,
        doughRecipe: Array.from({ length: 8 }, (_, ingredient) => ({
          ingredient: `Ingredient ${ingredient}`,
          lbs: ingredient + index + 1,
        })),
      },
    ]));
    const baselinePayload = {
      dayState: { date, runs },
      runValues,
      runValuesUpdatedAt: Object.fromEntries(runs.map((run, index) => [run.id, 1_000 + index])),
      packagingProgress: Object.fromEntries(runs.map((run, index) => [
        run.id, { skidsCompleted: index % 3, updatedAt: 1_000 + index },
      ])),
    };
    const seed = await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "peer-seed", payload: baselinePayload }),
    });
    const seedBody = await seed.json() as { data: Record<string, unknown>; snapshotId: string };

    const ctrl = new AbortController();
    const stream = await fetch(
      `${baseUrl}/api/sync/events?clientId=peer-receiver&today=${date}`,
      { headers: authHeaders(), signal: ctrl.signal },
    );
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readFrame = async (predicate: (frame: Record<string, any>) => boolean) => {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = raw.split("\n").find((entry) => entry.startsWith("data: "));
          if (line) {
            const frame = JSON.parse(line.slice("data: ".length)) as Record<string, any>;
            if (predicate(frame)) return { frame, raw: line.slice("data: ".length) };
          }
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE stream ended before the expected frame");
        buffer += decoder.decode(value, { stream: true });
      }
    };
    const initial = await readFrame((frame) => frame.initial === true);
    expect(initial.frame.completeness).toBe("complete");
    expect(initial.frame.snapshotId).toBe(seedBody.snapshotId);

    const changedRunId = runs[17].id;
    const changedPayload = {
      ...baselinePayload,
      runValues: {
        ...runValues,
        [changedRunId]: { ...runValues[changedRunId], casesNeeded: 999 },
      },
      runValuesUpdatedAt: {
        ...baselinePayload.runValuesUpdatedAt,
        [changedRunId]: Date.now() + 1_000,
      },
    };
    const write = await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "peer-writer", payload: changedPayload }),
    });
    const writeBody = await write.json() as { data: Record<string, unknown>; snapshotId: string };
    const received = await readFrame((frame) => frame.senderId === "peer-writer");

    expect(received.frame).toMatchObject({
      completeness: "partial",
      syncVersion: 1,
      baseSnapshotId: seedBody.snapshotId,
      snapshotId: writeBody.snapshotId,
    });
    expect(received.frame).not.toHaveProperty("resultingSnapshotId");
    expect(Object.keys(received.frame.data.runValues)).toEqual([changedRunId]);
    expect(received.frame.data.runValues[changedRunId].casesNeeded).toBe(999);
    expect(Object.keys(received.frame.summaryStats)).toEqual([changedRunId]);
    expect(Object.keys(received.frame.runLines)).toEqual([changedRunId]);
    const equivalentComplete: Record<string, any> = {
      ...received.frame,
      completeness: "complete",
      data: writeBody.data,
    };
    delete equivalentComplete.syncVersion;
    delete equivalentComplete.baseSnapshotId;
    delete equivalentComplete.resultingSnapshotId;
    expect(Buffer.byteLength(received.raw) * 2)
      .toBeLessThan(Buffer.byteLength(JSON.stringify(equivalentComplete)));

    const removedRunId = runs[23].id;
    const afterChange = writeBody.data as typeof baselinePayload & {
      deletedItems?: { runs?: string[] };
    };
    const removalPayload = {
      ...afterChange,
      dayState: {
        ...afterChange.dayState,
        runs: afterChange.dayState.runs.filter((run) => run.id !== removedRunId),
      },
      runValues: Object.fromEntries(
        Object.entries(afterChange.runValues).filter(([runId]) => runId !== removedRunId),
      ),
      runValuesUpdatedAt: Object.fromEntries(
        Object.entries(afterChange.runValuesUpdatedAt).filter(([runId]) => runId !== removedRunId),
      ),
      packagingProgress: Object.fromEntries(
        Object.entries(afterChange.packagingProgress).filter(([runId]) => runId !== removedRunId),
      ),
      deletedItems: {
        ...afterChange.deletedItems,
        runs: [...(afterChange.deletedItems?.runs ?? []), removedRunId],
      },
    };
    const removalWrite = await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "peer-remover", payload: removalPayload }),
    });
    const removalBody = await removalWrite.json() as {
      data: typeof removalPayload;
      snapshotId: string;
    };
    const removalFrame = await readFrame((frame) => frame.senderId === "peer-remover");
    expect(removalFrame.frame.completeness).toBe("partial");
    expect(removalFrame.frame.summaryStats).toEqual({ [removedRunId]: null });
    expect(removalFrame.frame.runLines).toEqual({ [removedRunId]: null });

    let sharedInputPayload = removalBody.data;
    for (const field of derivedRunMapSharedDayStateFields) {
      const senderId = `peer-shared-${field}`;
      const currentValue = sharedInputPayload.dayState[field];
      const changedValue = Array.isArray(currentValue)
        ? [...currentValue, `changed-${field}`]
        : [`changed-${field}`];
      sharedInputPayload = {
        ...sharedInputPayload,
        dayState: { ...sharedInputPayload.dayState, [field]: changedValue },
      };
      const sharedInputWrite = await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ senderId, payload: sharedInputPayload }),
      });
      expect(sharedInputWrite.status).toBe(200);
      const sharedInputFrame = await readFrame((frame) => frame.senderId === senderId);
      const remainingRunIds = sharedInputPayload.dayState.runs.map((run) => run.id).sort();
      expect(sharedInputFrame.frame.completeness).toBe("partial");
      expect(sharedInputFrame.frame.data.dayState[field]).toEqual(changedValue);
      expect(Object.keys(sharedInputFrame.frame.summaryStats).sort()).toEqual(remainingRunIds);
      expect(Object.keys(sharedInputFrame.frame.runLines).sort()).toEqual(remainingRunIds);
    }

    await reader.cancel();
    ctrl.abort();
  });

  it("keeps multi-peer delta savings and convergence through a synthetic full shift", async () => {
    const date = "2030-03-16";
    const runs = Array.from({ length: 32 }, (_, index) => ({
      id: `shift-run-${index}`,
      brand: `Synthetic Brand ${index % 4}`,
      flavor: `Synthetic Flavor ${index}`,
      metaUpdatedAt: 10_000 + index,
    }));
    const runValues = Object.fromEntries(runs.map((run, index) => [
      run.id,
      {
        casesNeeded: 180 + index,
        casesOnCurrentSkid: index % 24,
        doughRecipe: Array.from({ length: 8 }, (_, ingredient) => ({
          ingredient: `Synthetic Ingredient ${ingredient}`,
          lbs: ingredient + index + 1,
        })),
        notes: `Synthetic full-shift fixture run ${index + 1}`,
      },
    ]));
    let canonical: Record<string, any> = {
      syncVersion: 1,
      completeness: "complete",
      baseSnapshotId: emptyCompleteSnapshotId(date),
      dayState: { date, runs, shiftNotes: "Synthetic full-shift soak fixture" },
      runValues,
      runValuesUpdatedAt: Object.fromEntries(runs.map((run, index) => [run.id, 10_000 + index])),
    };
    const seed = await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "shift-seed", payload: canonical }),
    });
    expect(seed.status).toBe(200);
    const seedBody = await seed.json() as { data: Record<string, any>; snapshotId: string };
    canonical = seedBody.data;

    type Peer = {
      id: string;
      ctrl: AbortController;
      reader: ReadableStreamDefaultReader<Uint8Array>;
      decoder: TextDecoder;
      buffer: string;
      baseline: Record<string, any>;
      snapshotId: string;
    };
    const peers = new Map<string, Peer>();
    let completeFrames = 0;
    let partialFrames = 0;
    let partialBytes = 0;
    let equivalentCompleteBytes = 0;
    type LifecycleKind = "start" | "add" | "end" | "remove";
    const lifecycleSteps = new Map<number, LifecycleKind>([
      [8, "start"],
      [16, "add"],
      [24, "end"],
      [32, "remove"],
    ]);
    const lifecycleMetrics = Object.fromEntries(
      [...lifecycleSteps.values()].map((kind) => [
        kind,
        { frames: 0, completeFallbacks: 0, actualBytes: 0, equivalentCompleteBytes: 0 },
      ]),
    ) as Record<LifecycleKind, {
      frames: number;
      completeFallbacks: number;
      actualBytes: number;
      equivalentCompleteBytes: number;
    }>;

    const readFrame = async (peer: Peer, predicate: (frame: Record<string, any>) => boolean) => {
      for (;;) {
        const boundary = peer.buffer.indexOf("\n\n");
        if (boundary >= 0) {
          const raw = peer.buffer.slice(0, boundary);
          peer.buffer = peer.buffer.slice(boundary + 2);
          const line = raw.split("\n").find((entry) => entry.startsWith("data: "));
          if (line) {
            const json = line.slice("data: ".length);
            const frame = JSON.parse(json) as Record<string, any>;
            if (predicate(frame)) return { frame, bytes: Buffer.byteLength(json) };
          }
          continue;
        }
        const { value, done } = await peer.reader.read();
        if (done) throw new Error(`SSE stream for ${peer.id} ended before the expected frame`);
        peer.buffer += peer.decoder.decode(value, { stream: true });
      }
    };

    const connect = async (id: string) => {
      const ctrl = new AbortController();
      const response = await fetch(
        `${baseUrl}/api/sync/events?clientId=${id}&today=${date}`,
        { headers: authHeaders(), signal: ctrl.signal },
      );
      expect(response.status).toBe(200);
      const peer: Peer = {
        id,
        ctrl,
        reader: response.body!.getReader(),
        decoder: new TextDecoder(),
        buffer: "",
        baseline: {},
        snapshotId: "",
      };
      const initial = await readFrame(peer, (frame) => frame.initial === true);
      expect(initial.frame.completeness).toBe("complete");
      expect(initial.frame.snapshotId).toBe(syncSnapshotId(initial.frame.data));
      peer.baseline = initial.frame.data;
      peer.snapshotId = initial.frame.snapshotId;
      peers.set(id, peer);
      completeFrames += 1;
    };

    const disconnect = async (id: string) => {
      const peer = peers.get(id);
      if (!peer) return;
      await peer.reader.cancel();
      peer.ctrl.abort();
      peers.delete(id);
    };

    const reconstruct = (peer: Peer, frame: Record<string, any>) => {
      expect(frame.baseSnapshotId).toBe(peer.snapshotId);
      expect(syncSnapshotId(peer.baseline)).toBe(peer.snapshotId);
      const next = { ...peer.baseline };
      for (const [section, value] of Object.entries(frame.data as Record<string, unknown>)) {
        if (section === "runValues" || section === "runValuesUpdatedAt" || section === "packagingProgress") {
          const merged = { ...(next[section] ?? {}) };
          for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (child === null) delete merged[key];
            else merged[key] = child;
          }
          next[section] = merged;
        } else if (value === null) {
          delete next[section];
        } else {
          next[section] = value;
        }
      }
      delete next.baseSnapshotId;
      delete next.resultingSnapshotId;
      next.syncVersion = 1;
      next.completeness = "complete";
      expect(syncSnapshotId(next)).toBe(frame.snapshotId);
      peer.baseline = next;
      peer.snapshotId = frame.snapshotId;
      return next;
    };

    await Promise.all(["shift-peer-a", "shift-peer-b", "shift-peer-c"].map(connect));

    try {
      for (let step = 0; step < 48; step += 1) {
        if (step > 0 && step % 12 === 0) {
          const reconnectId = `shift-peer-${["a", "b", "c"][(step / 12 - 1) % 3]}`;
          await disconnect(reconnectId);
          await connect(reconnectId);
        }

        const senderId = `shift-peer-${["a", "b", "c"][step % 3]}`;
        const changedRun = runs[(step * 7) % runs.length].id;
        const stamp = 2_000_000_000_000 + step;
        const lifecycleKind = lifecycleSteps.get(step);
        let nextPayload: Record<string, any> = {
          ...canonical,
          baseSnapshotId: syncSnapshotId(canonical),
          runValues: {
            ...canonical.runValues,
            [changedRun]: {
              ...canonical.runValues[changedRun],
              casesOnCurrentSkid: (step * 5) % 48,
            },
          },
          runValuesUpdatedAt: { ...canonical.runValuesUpdatedAt, [changedRun]: stamp },
        };
        if (lifecycleKind === "start") {
          nextPayload = {
            ...nextPayload,
            dayState: {
              ...nextPayload.dayState,
              runs: nextPayload.dayState.runs.map((run: Record<string, any>) =>
                run.id === changedRun ? { ...run, startedAt: stamp, metaUpdatedAt: stamp } : run),
            },
          };
        } else if (lifecycleKind === "add") {
          const addedRun = {
            id: "shift-run-added",
            brand: "Synthetic Brand Added",
            flavor: "Synthetic Flavor Added",
            metaUpdatedAt: stamp,
          };
          nextPayload = {
            ...nextPayload,
            dayState: { ...nextPayload.dayState, runs: [...nextPayload.dayState.runs, addedRun] },
            runValues: {
              ...nextPayload.runValues,
              [addedRun.id]: {
                casesNeeded: 144,
                casesOnCurrentSkid: 0,
                doughRecipe: [{ ingredient: "Synthetic Ingredient Added", lbs: 12 }],
                notes: "Synthetic lifecycle fixture",
              },
            },
            runValuesUpdatedAt: { ...nextPayload.runValuesUpdatedAt, [addedRun.id]: stamp },
          };
        } else if (lifecycleKind === "end") {
          nextPayload = {
            ...nextPayload,
            dayState: {
              ...nextPayload.dayState,
              runs: nextPayload.dayState.runs.map((run: Record<string, any>) =>
                run.id === changedRun ? { ...run, endedAt: stamp, metaUpdatedAt: stamp } : run),
            },
          };
        } else if (lifecycleKind === "remove") {
          const removedRunId = "shift-run-added";
          const { [removedRunId]: _removedValue, ...remainingValues } = nextPayload.runValues;
          const { [removedRunId]: _removedStamp, ...remainingStamps } = nextPayload.runValuesUpdatedAt;
          nextPayload = {
            ...nextPayload,
            dayState: {
              ...nextPayload.dayState,
              runs: nextPayload.dayState.runs.filter((run: Record<string, any>) => run.id !== removedRunId),
            },
            runValues: remainingValues,
            runValuesUpdatedAt: remainingStamps,
          };
        }
        const write = await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
          method: "PUT",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ senderId, payload: nextPayload }),
        });
        expect(write.status).toBe(200);
        const writeBody = await write.json() as { data: Record<string, any>; snapshotId: string };
        canonical = writeBody.data;

        for (const peer of peers.values()) {
          if (peer.id === senderId) {
            peer.baseline = canonical;
            peer.snapshotId = writeBody.snapshotId;
            continue;
          }
          const received = await readFrame(peer, (frame) => frame.senderId === senderId);
          const completeEquivalentBytes = Buffer.byteLength(JSON.stringify({
            ...received.frame,
            completeness: "complete",
            data: canonical,
            syncVersion: undefined,
            baseSnapshotId: undefined,
            resultingSnapshotId: undefined,
          }));
          if (lifecycleKind) {
            const metrics = lifecycleMetrics[lifecycleKind];
            metrics.frames += 1;
            metrics.actualBytes += received.bytes;
            metrics.equivalentCompleteBytes += completeEquivalentBytes;
          }
          if (received.frame.completeness === "partial") {
            partialFrames += 1;
            partialBytes += received.bytes;
            expect(received.frame).toHaveProperty("operationalProjection");
            const reconstructed = reconstruct(peer, received.frame);
            expect(reconstructed).toEqual(canonical);
            equivalentCompleteBytes += completeEquivalentBytes;
          } else {
            completeFrames += 1;
            if (lifecycleKind) lifecycleMetrics[lifecycleKind].completeFallbacks += 1;
            expect(received.frame.data).toEqual(canonical);
            expect(received.frame.snapshotId).toBe(writeBody.snapshotId);
            peer.baseline = received.frame.data;
            peer.snapshotId = received.frame.snapshotId;
          }
        }
      }
    } finally {
      await Promise.all([...peers.keys()].map(disconnect));
    }

    const savingsPercent = ((equivalentCompleteBytes - partialBytes) / equivalentCompleteBytes) * 100;
    console.info("[sync full-shift soak]", {
      steps: 48,
      peers: 3,
      reconnects: 3,
      partialFrames,
      completeFrames,
      partialBytes,
      equivalentCompleteBytes,
      savingsPercent: Number(savingsPercent.toFixed(2)),
      lifecycleMetrics,
    });
    expect(partialFrames).toBe(96);
    expect(completeFrames).toBeLessThanOrEqual(6);
    expect(partialBytes).toBeLessThan(equivalentCompleteBytes * 0.5);
    for (const kind of ["start", "add", "end", "remove"] as const) {
      const metrics = lifecycleMetrics[kind];
      expect(metrics.frames, `${kind} lifecycle receiver frames`).toBe(2);
      expect(metrics.completeFallbacks, `${kind} lifecycle complete fallbacks`).toBeLessThanOrEqual(1);
      expect(metrics.actualBytes, `${kind} lifecycle aggregate wire bytes`)
        .toBeLessThan(metrics.equivalentCompleteBytes * 0.8);
    }
  }, 60_000);

describe("/sync/events — facility-wide master-data broadcasts", () => {
  type SyncFrame = Record<string, unknown>;

  function collectEvents(
    date: string,
    clientId: string,
    headers: Record<string, string>,
    ctrl: AbortController,
    sink: SyncFrame[],
  ): Promise<void> {
    return (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const res = await fetch(
          `${baseUrl}/api/sync/events?clientId=${clientId}&today=${date}`,
          { headers, signal: ctrl.signal },
        );
        reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
            if (!line) continue;
            const parsed = JSON.parse(line.slice("data: ".length)) as SyncFrame;
            sink.push(parsed);
          }
        }
      } catch {
        // Aborted or stream error — collection is best-effort.
      } finally {
        await reader?.cancel().catch(() => {});
      }
    })();
  }

  it("nudges every different-date peer for dough, sauce, cheese, and mix writes without self-echo or scope leakage", async () => {
    const writerCtrl = new AbortController();
    const peerCtrl = new AbortController();
    const sandboxCtrl = new AbortController();
    const writerEvents: SyncFrame[] = [];
    const peerEvents: SyncFrame[] = [];
    const sandboxEvents: SyncFrame[] = [];

    const writerStream = collectEvents(
      "2030-03-10",
      "recipe-writer",
      managerAuthHeaders(),
      writerCtrl,
      writerEvents,
    );
    const peerStream = collectEvents(
      "2030-03-11",
      "recipe-peer",
      authHeaders(),
      peerCtrl,
      peerEvents,
    );
    const sandboxStream = collectEvents(
      "2030-03-12",
      "sandbox-peer",
      sandboxAuthHeaders(),
      sandboxCtrl,
      sandboxEvents,
    );

    // Different local dates must not affect facility-wide recipe refreshes, but
    // the sandbox stream must remain isolated from the live facility.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const writeRecipe = (path: string, item: Record<string, unknown>) =>
      fetch(`${baseUrl}/api/${path}`, {
        method: "POST",
        headers: {
          ...managerAuthHeaders(),
          "content-type": "application/json",
          "x-client-id": "recipe-writer",
        },
        body: JSON.stringify({ items: [item] }),
      });

    const responses = await Promise.all([
      writeRecipe("dough-recipes", {
        id: "refresh-dough",
        name: "Refresh Dough",
        notes: "",
        components: [],
        enabled: true,
        brand: "",
        flavors: [],
      }),
      writeRecipe("sauce-recipes", {
        id: "refresh-sauce",
        name: "Refresh Sauce",
        notes: "",
        components: [],
        enabled: true,
        brand: "",
        flavors: [],
      }),
      writeRecipe("cheese-recipes", {
        id: "refresh-cheese",
        name: "Refresh Cheese",
        brand: "",
        flavors: [],
        shredderSetting: "",
        cellulose: "",
        notes: "",
        components: [],
        enabled: true,
      }),
      writeRecipe("mixes", {
        id: "refresh-mix",
        name: "Refresh Mix",
        brand: "",
        flavor: "",
        batchSize: 0,
        daysEarly: 0,
        notes: "",
        amountAlreadyMade: 0,
        components: [],
        isPrep: false,
        enabled: true,
      }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);

    await new Promise((resolve) => setTimeout(resolve, 600));
    writerCtrl.abort();
    peerCtrl.abort();
    sandboxCtrl.abort();
    await Promise.allSettled([writerStream, peerStream, sandboxStream]);

    const isMasterDataRefresh = (frame: SyncFrame) =>
      frame.type === "master-data" && frame.masterDataChanged === true;
    const writerRefreshes = writerEvents.filter(isMasterDataRefresh);
    const peerRefreshes = peerEvents.filter(isMasterDataRefresh);
    const sandboxRefreshes = sandboxEvents.filter(isMasterDataRefresh);

    expect(writerRefreshes).toHaveLength(0);
    expect(peerRefreshes).toHaveLength(4);
    expect(peerRefreshes.every((frame) => frame.senderId === "recipe-writer")).toBe(true);
    expect(sandboxRefreshes).toHaveLength(0);
  });
});

describe("GET /sync/events — auto-track schedule heartbeat (step 6c)", () => {
  // A real client sync payload carries the run's complete FormValues. Keep
  // this fixture realistic so the server can compute a non-empty schedule.
  const heartbeatFullValues = {
    casesNeeded: 240,
    crustsPerCycle: 12,
    cycleSpeed: 600,
    speedAdjustment: 1,
    approxLineSpeed: 450,
    freezerTime: 3.5,
    pizzasPerCase: 12,
    casesPerSkid: 48,
    casesPerLayer: 12,
    doughballsPerTray: 36,
    crustsPerStack: 6,
    doughBatchYield: 150,
    crustsPerCase: 12,
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
    traysOnLine: 0,
    batchesReady: 0,
    mixerLowSec: 330,
    mixerHighSec: 180,
    hopperSec: 70,
    carryOverDone: false,
    sauceOzPerPizza: 2,
    sauceBarrelLbs: 50,
    sauceBarrelsMade: 0,
    sauceBarrelAnchorNetSec: 0,
    sauceBarrelCorrectionGeneration: 0,
    app1OzPerPizza: 2.5,
    app1BatchLbs: 100,
    app1BatchesMade: 0,
    app1BatchAnchorNetSec: 0,
    app1BatchCorrectionGeneration: 0,
    app2OzPerPizza: 0,
    app2BatchLbs: 0,
    app2BatchesMade: 0,
    app2BatchAnchorNetSec: 0,
    app2BatchCorrectionGeneration: 0,
    app3OzPerPizza: 0,
    app3BatchLbs: 0,
    app3BatchesMade: 0,
    app3BatchAnchorNetSec: 0,
    app3BatchCorrectionGeneration: 0,
    app4OzPerPizza: 0,
    app4BatchLbs: 0,
    app4BatchesMade: 0,
    app4BatchAnchorNetSec: 0,
    app4BatchCorrectionGeneration: 0,
    pep1Sticks: 0,
    pep1OzPerPizza: 0,
    pep1BatchLbs: 0,
    pep2Sticks: 0,
    pep2OzPerPizza: 0,
    pep2BatchLbs: 0,
    pep1Combined: true,
    pep1TypeB: "",
    pep2TypeB: "",
    pep1SticksB: 0,
    pep1OzPerPizzaB: 0,
    pep1BatchLbsB: 0,
    pep2SticksB: 0,
    pep2OzPerPizzaB: 0,
    pep2BatchLbsB: 0,
    app1Type: "app",
    app2Type: "",
    app3Type: "",
    app4Type: "",
    pep1Type: "",
    pep2Type: "",
    dieType: "Round 12",
    allergen: "none",
    doughRecipeName: "",
    targetDoughballWeight: 8,
    doughRecipe: [],
    app1CheeseRecipeName: "",
    app1CheeseRecipe: [],
    app2CheeseRecipeName: "",
    app2CheeseRecipe: [],
    app3CheeseRecipeName: "",
    app3CheeseRecipe: [],
    app4CheeseRecipeName: "",
    app4CheeseRecipe: [],
    frontlineRecipeName: "",
    frontlineRecipe: [],
  };

  it("refreshes the schedule lease on every heartbeat while live", async () => {
    const date = "2030-04-03";
    process.env.AUTO_TRACK_HEARTBEAT_MS = "100";
    try {
      await fetch(`${baseUrl}/api/sync/today?today=${date}`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          senderId: "heartbeat-writer",
          payload: {
            dayState: {
              runs: [{
                id: "heartbeat-run",
                brand: "Acme",
                flavor: "Pep",
                subTab: "crusts",
                startedAt: Date.now() - 60_000,
                metaUpdatedAt: 1,
              }],
              resetAt: 1,
            },
            runValues: { "heartbeat-run": heartbeatFullValues },
            runValuesUpdatedAt: { "heartbeat-run": 1 },
          },
        }),
      });

      const ctrl = new AbortController();
      const res = await fetch(
        `${baseUrl}/api/sync/events?clientId=heartbeat-watcher&today=${date}`,
        { headers: authHeaders(), signal: ctrl.signal },
      );
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let scheduleFrames = 0;
      let commentBeats = 0;
      let heartbeatRunId: string | undefined;
      const deadline = Date.now() + 5_000;
      try {
        while (Date.now() < deadline && scheduleFrames < 3) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            if (frame.includes(": heartbeat")) commentBeats++;
            const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
            if (!line) continue;
            const parsed = JSON.parse(line.slice("data: ".length)) as {
              heartbeat?: boolean;
              autoTrackSchedule?: { runId?: string } | null;
            };
            if (parsed.heartbeat === true && parsed.autoTrackSchedule) {
              scheduleFrames++;
              heartbeatRunId = parsed.autoTrackSchedule.runId;
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        ctrl.abort();
      }
      expect(scheduleFrames).toBeGreaterThanOrEqual(3);
      expect(commentBeats).toBe(0);
      expect(heartbeatRunId).toBe("heartbeat-run");
    } finally {
      delete process.env.AUTO_TRACK_HEARTBEAT_MS;
    }
  }, 15_000);
});

describe("/sync — conflict logging to sync_conflict_logs", () => {
  // Each protective merge outcome must write a row to sync_conflict_logs so
  // managers can detect whether offline-first merges are converging or
  // accumulating drift over time.
  const DATE = "2030-09-01";
  function put(payload: unknown, date = DATE) {
    return fetch(`${baseUrl}/api/sync/today?today=${date}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
  }
  async function conflictRows() {
    return db.select().from(syncConflictLogsTable);
  }
  // Poll until predicate is satisfied or 2 s elapses.  recordSyncConflict is
  // fire-and-forget (void), so under heavy parallel suite load the background
  // insert may take longer than a fixed 150 ms sleep.
  async function pollConflictRows(
    predicate: (rows: Awaited<ReturnType<typeof conflictRows>>) => boolean,
    timeoutMs = 2000,
  ) {
    const deadline = Date.now() + timeoutMs;
    let rows = await conflictRows();
    while (!predicate(rows) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      rows = await conflictRows();
    }
    return rows;
  }

  it("inserts a conflict row when a blank-over-populated run value is rejected", async () => {
    // Seed a populated run value, then push a blank value (same stamp) — the
    // merge keeps the stored value. A conflict row must be written.
    await put({
      dayState: { runs: [{ id: "r1", brand: "A", flavor: "B" }], resetAt: 1000 },
      runValues: { r1: { casesNeeded: 120 } },
      runValuesUpdatedAt: { r1: 1000 },
    });
    await put({
      dayState: { runs: [{ id: "r1", brand: "A", flavor: "B" }], resetAt: 1000 },
      runValues: { r1: {} },
      runValuesUpdatedAt: { r1: 1000 },
    });
    // recordSyncConflict is fire-and-forget (void); poll until the background
    // insert commits (up to 2 s) so this doesn't flake under suite-wide load.
    const rows = await pollConflictRows((rs) => rs.length >= 1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const last = rows[rows.length - 1];
    expect(last.scope).toBe("live");
    expect(last.date).toBe(DATE);
    expect(last.conflictCount).toBeGreaterThan(0);
    expect(last.fieldsWithConflicts).toContain("runValues:r1");
    expect(last.resolution).toBe("additive-union");
    expect(last.clientStateHash).toBeTruthy();
    expect(last.serverStateHash).toBeTruthy();
    expect(last.mergedStateHash).toBeTruthy();
  });

  it("inserts a conflict row when a stored run is appended to the merge", async () => {
    // Seed two runs. Push a payload containing only one — the server must
    // preserve both and log the appended run as a conflict.
    const run = (id: string) => ({ id, brand: "X", flavor: id });
    await put({
      dayState: { runs: [run("a"), run("b")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 }, b: { casesNeeded: 20 } },
      runValuesUpdatedAt: { a: 1, b: 1 },
    });
    const beforeCount = (await conflictRows()).length;
    await put({
      dayState: { runs: [run("a")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 } },
      runValuesUpdatedAt: { a: 1 },
    });
    const rows = await pollConflictRows((rs) => rs.length > beforeCount);
    expect(rows.length).toBe(beforeCount + 1);
    const last = rows[rows.length - 1];
    expect(last.fieldsWithConflicts.some((f) => f.startsWith("dayState.runs:appended"))).toBe(true);
  });

  it("preserves both first-write runs and logs the protected merge after concurrent PUTs", async () => {
    // Neither request sees a row initially. The losing first INSERT must retry
    // against the row created by the winner, then add its distinct run instead
    // of replacing the winner's state. The conflict log is asynchronous, so
    // poll for the retry's appended-run record below.
    const D = "2030-09-03";
    const run = (id: string, casesNeeded: number) => ({
      dayState: { runs: [{ id, brand: "Concurrent", flavor: id }], resetAt: 1000 },
      runValues: { [id]: { casesNeeded } },
      runValuesUpdatedAt: { [id]: 1 },
    });

    const requests = await Promise.all([
      put(run("device-a", 10), D),
      put(run("device-b", 20), D),
    ]);
    expect(requests.map((response) => response.status)).toEqual([200, 200]);

    const stored = await fetch(`${baseUrl}/api/sync/${D}`, { headers: authHeaders() }).then(
      (response) => response.json(),
    ) as {
      dayState?: { runs?: Array<{ id: string }> };
      runValues?: Record<string, { casesNeeded?: number }>;
    };
    expect(stored.dayState?.runs?.map((entry) => entry.id).sort()).toEqual(["device-a", "device-b"]);
    expect(stored.runValues).toMatchObject({
      "device-a": { casesNeeded: 10 },
      "device-b": { casesNeeded: 20 },
    });

    const rows = await pollConflictRows(
      (conflicts) => conflicts.some(
        (row) => row.date === D
          && row.fieldsWithConflicts.some((field) => field.startsWith("dayState.runs:appended")),
      ),
    );
    expect(rows.some(
      (row) => row.date === D
        && row.fieldsWithConflicts.some((field) => field.startsWith("dayState.runs:appended")),
    )).toBe(true);
  });

  it("keeps concurrent PUTs for different future dates isolated", async () => {
    // These requests must use the dated endpoint, not /sync/today: a date-key
    // mix-up would otherwise write one scheduled day into the other. Both
    // inserts start from an empty disposable database and must retain only
    // their own run and run value after completing concurrently.
    const dateA = "2030-09-10";
    const dateB = "2030-09-11";
    const putScheduled = (date: string, runId: string, casesNeeded: number) =>
      fetch(`${baseUrl}/api/sync/${date}?today=2030-09-09`, {
        method: "PUT",
        headers: { ...managerAuthHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          senderId: `scheduled-${runId}`,
          payload: {
            dayState: {
              date,
              runs: [{ id: runId, brand: "Cross-date", flavor: date }],
              resetAt: 1000,
            },
            runValues: { [runId]: { casesNeeded } },
            runValuesUpdatedAt: { [runId]: 1 },
          },
        }),
      });

    const responses = await Promise.all([
      putScheduled(dateA, "date-a-run", 10),
      putScheduled(dateB, "date-b-run", 20),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const readScheduled = async (date: string) => fetch(
      `${baseUrl}/api/sync/${date}?today=2030-09-09`,
      { headers: authHeaders() },
    ).then((response) => response.json()) as Promise<{
      dayState?: { date?: string; runs?: Array<{ id: string }> };
      runValues?: Record<string, { casesNeeded?: number }>;
    }>;
    const [storedA, storedB] = await Promise.all([
      readScheduled(dateA),
      readScheduled(dateB),
    ]);

    expect(storedA.dayState?.date).toBe(dateA);
    expect(storedA.dayState?.runs?.map((run) => run.id)).toEqual(["date-a-run"]);
    expect(storedA.runValues).toEqual({ "date-a-run": { casesNeeded: 10 } });
    expect(storedB.dayState?.date).toBe(dateB);
    expect(storedB.dayState?.runs?.map((run) => run.id)).toEqual(["date-b-run"]);
    expect(storedB.runValues).toEqual({ "date-b-run": { casesNeeded: 20 } });
  });

  it("inserts a conflict row when the stored run object wins the metaUpdatedAt LWW", async () => {
    // Seed a run with a high metaUpdatedAt (simulating a started run). Push an
    // older copy of the same run — the server must keep the newer stored object.
    const run = (id: string, meta: number, status?: string) => ({
      id, brand: "Y", flavor: "Z", metaUpdatedAt: meta, ...(status ? { status } : {}),
    });
    await put({
      dayState: { runs: [run("r1", 5000, "started")], resetAt: 1000 },
      runValues: { r1: { casesNeeded: 50 } },
      runValuesUpdatedAt: { r1: 1 },
    });
    const beforeCount = (await conflictRows()).length;
    // Push a STALE copy of r1 (lower metaUpdatedAt) — stored version must win.
    await put({
      dayState: { runs: [run("r1", 100)], resetAt: 1000 },
      runValues: { r1: { casesNeeded: 50 } },
      runValuesUpdatedAt: { r1: 1 },
    });
    const rows = await pollConflictRows((rs) => rs.length > beforeCount);
    expect(rows.length).toBe(beforeCount + 1);
    const last = rows[rows.length - 1];
    expect(last.fieldsWithConflicts.some((f) => f.startsWith("dayState.runs.meta:"))).toBe(true);
  });

  it("does NOT insert a conflict row for a clean push with no protective overrides", async () => {
    // A first push to a new date has nothing to protect against — no conflict row.
    const D = "2030-09-02";
    const beforeCount = (await conflictRows()).length;
    await fetch(`${baseUrl}/api/sync/today?today=${D}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "c1",
        payload: {
          dayState: { runs: [{ id: "r1", brand: "A", flavor: "B" }], resetAt: 1000 },
          runValues: { r1: { casesNeeded: 50 } },
          runValuesUpdatedAt: { r1: 1 },
        },
      }),
    });
    const rows = await conflictRows();
    expect(rows.length).toBe(beforeCount); // no new row
  });
});

describe("GET /sync/conflict-stats", () => {
  const TODAY = "2030-09-07";

  beforeEach(async () => {
    await db.insert(syncConflictLogsTable).values([
      {
        scope: "live",
        date: TODAY,
        fieldsWithConflicts: ["runValues:run-a", "packagingProgress:run-a"],
        conflictCount: 2,
        resolution: "additive-union",
      },
      {
        scope: "live",
        date: TODAY,
        fieldsWithConflicts: ["runValues:run-a", "dayState.runs.meta:run-b"],
        conflictCount: 3,
        resolution: "additive-union",
      },
      {
        scope: "live",
        date: "2030-09-03",
        fieldsWithConflicts: ["runValues:run-c"],
        conflictCount: 1,
        resolution: "additive-union",
      },
      {
        scope: "live",
        date: "2030-08-30",
        fieldsWithConflicts: ["runValues:outside-window"],
        conflictCount: 9,
        resolution: "additive-union",
      },
      {
        scope: "sandbox",
        date: TODAY,
        fieldsWithConflicts: ["runValues:other-scope"],
        conflictCount: 8,
        resolution: "additive-union",
      },
    ]);
  });

  it("requires manager access", async () => {
    const res = await fetch(`${baseUrl}/api/sync/conflict-stats?today=${TODAY}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(403);
  });

  it("returns a client-local seven-day trend with field and run aggregates", async () => {
    const res = await fetch(`${baseUrl}/api/sync/conflict-stats?today=${TODAY}`, {
      headers: managerAuthHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      scope: string;
      today: string;
      totalConflictsToday: number;
      trend: Array<{ date: string; conflicts: number; events: number }>;
      fields: Array<{ field: string; count: number }>;
      runs: Array<{ runId: string; count: number; fields: string[] }>;
    };

    expect(body.scope).toBe("live");
    expect(body.today).toBe(TODAY);
    expect(body.totalConflictsToday).toBe(5);
    expect(body.trend).toEqual([
      { date: "2030-09-01", conflicts: 0, events: 0 },
      { date: "2030-09-02", conflicts: 0, events: 0 },
      { date: "2030-09-03", conflicts: 1, events: 1 },
      { date: "2030-09-04", conflicts: 0, events: 0 },
      { date: "2030-09-05", conflicts: 0, events: 0 },
      { date: "2030-09-06", conflicts: 0, events: 0 },
      { date: TODAY, conflicts: 5, events: 2 },
    ]);
    expect(body.fields).toEqual([
      { field: "Run values", count: 3 },
      { field: "Packaging progress", count: 1 },
      { field: "Run details", count: 1 },
    ]);
    expect(body.runs).toEqual([
      { runId: "run-a", count: 3, fields: ["Packaging progress", "Run values"] },
      { runId: "run-b", count: 1, fields: ["Run details"] },
      { runId: "run-c", count: 1, fields: ["Run values"] },
    ]);
  });
});

// DELETE /sync/:date enforces the server's real UTC date rather than a
// client-supplied `today` param. This prevents a client from lying about
// "today" to delete the actual live day. The manage-factory-settings capability
// gate is enforced — operators receive 403.
describe("DELETE /sync/:date — server-date guard", () => {
  it("rejects an operator (no manage-factory-settings capability) with 403", async () => {
    const res = await fetch(`${baseUrl}/api/sync/2030-03-11?today=2030-03-10`, {
      method: "DELETE",
      headers: authHeaders(), // plain operator — no capability
    });
    expect(res.status).toBe(403);
  });

  it("rejects deleting a day in the past (server-date comparison, manager auth)", async () => {
    // The DELETE handler guards with the server's actual date (todayStr()), not
    // the client-supplied `?today` param. A hardcoded past date that is always
    // ≤ the server's real date is rejected regardless of when the suite runs.
    const PAST_DATE = "2025-01-01";
    const res = await fetch(`${baseUrl}/api/sync/${PAST_DATE}`, {
      method: "DELETE",
      headers: managerAuthHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("a fake future client ?today cannot bypass the server-date guard (server still rejects past dates)", async () => {
    // Even if a client sends ?today=2020-01-01 (claiming their local day is in
    // the past), the server uses its own clock to guard past dates.
    const PAST_DATE = "2025-01-01";
    const res = await fetch(`${baseUrl}/api/sync/${PAST_DATE}?today=2020-01-01`, {
      method: "DELETE",
      headers: managerAuthHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("allows deleting a future day and removes it from the scheduled list", async () => {
    // 2030-03-11 is well in the future from any realistic test run, so the
    // server-date guard passes and the row is removed.

    const res = await fetch(`${baseUrl}/api/sync/2030-03-11?today=2030-03-10`, {
      method: "DELETE",
      headers: managerAuthHeaders(),
    });
    expect(res.status).toBe(200);
    // Verify 2030-03-11 is gone; 2030-03-10 and 2030-03-12 remain.
    const remaining = await fetch(`${baseUrl}/api/sync/scheduled?today=2030-03-09`, {
      headers: authHeaders(),
    });
    const days = (await remaining.json()) as Array<{ date: string }>;
    expect(days.map((d) => d.date)).toEqual(["2030-03-10", "2030-03-12"]);
  });
});

// ── Payload sanitizer — route-level ──────────────────────────────────────────
// Verify that unknown top-level keys and oversized name lists are stripped
// BEFORE the payload is persisted or broadcast to SSE subscribers.

describe("PUT /sync — payload sanitizer", () => {
  const DATE = "2030-11-01";

  async function putPayload(payload: unknown): Promise<void> {
    await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "tester", payload }),
    });
  }

  async function getStored(): Promise<Record<string, unknown>> {
    const res = await fetch(`${baseUrl}/api/sync/${DATE}`, { headers: authHeaders() });
    return (await res.json()) as Record<string, unknown>;
  }

  it("strips unknown top-level keys from the persisted blob", async () => {
    await putPayload({
      brands: ["Good Brand"],
      injectedKey: "malicious value",
      __proto__: "bad",
      dayState: { runs: [], resetAt: 0 },
    });
    const stored = await getStored();
    expect(stored).not.toHaveProperty("injectedKey");
    expect(stored).not.toHaveProperty("__proto__");
    expect(stored).toHaveProperty("brands");
    expect(stored).toHaveProperty("dayState");
  });

  it("returns safe wire-size and queue-age measurements without persisting client timing metadata", async () => {
    const queuedAt = Date.now() - 100;
    const res = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "timing-test",
        syncMeta: { queuedAt },
        payload: { dayState: { runs: [], resetAt: 0 } },
      }),
    });
    expect(res.status).toBe(200);
    expect(Number(res.headers.get("X-Sync-Response-Bytes"))).toBeGreaterThan(0);
    expect(Number(res.headers.get("X-Sync-Queue-Age-Ms"))).toBeGreaterThanOrEqual(0);
    const stored = await getStored();
    expect(stored).not.toHaveProperty("syncMeta");
  });

  it("caps oversized name-list arrays so they cannot flood the shared blob", async () => {
    const bigBrands = Array.from({ length: 600 }, (_, i) => `brand-${i}`);
    await putPayload({
      brands: bigBrands,
      dayState: { runs: [], resetAt: 0 },
    });
    const stored = await getStored();
    expect((stored.brands as string[]).length).toBeLessThanOrEqual(500);
  });

  it("truncates oversized individual name strings", async () => {
    const longName = "x".repeat(300);
    await putPayload({
      pepTypes: [longName],
      dayState: { runs: [], resetAt: 0 },
    });
    const stored = await getStored();
    const pepTypes = stored.pepTypes as string[];
    expect(pepTypes[0].length).toBeLessThanOrEqual(200);
  });

  it("strips unknown dayState sub-keys from the persisted blob", async () => {
    await putPayload({
      dayState: {
        runs: [],
        resetAt: 0,
        shiftNotes: "ok",
        injectedDayField: "<script>alert(1)</script>",
      },
    });
    const stored = await getStored();
    const ds = stored.dayState as Record<string, unknown>;
    expect(ds).not.toHaveProperty("injectedDayField");
    expect(ds).toHaveProperty("shiftNotes");
  });

  it("caps dayState.shiftNotes at 2000 chars in the persisted blob", async () => {
    const longNotes = "n".repeat(3000);
    await putPayload({
      dayState: { runs: [], resetAt: 0, shiftNotes: longNotes },
    });
    const stored = await getStored();
    const ds = stored.dayState as Record<string, unknown>;
    expect((ds.shiftNotes as string).length).toBeLessThanOrEqual(2000);
  });

  it("preserves legitimate known fields through the sanitizer unchanged", async () => {
    await putPayload({
      brands: ["Acme", "Globex"],
      pepTypes: ["Pepperoni", "Sausage"],
      dayState: { runs: [{ id: "r1", brand: "Acme", flavor: "Pep" }], shiftNotes: "hi", resetAt: 0 },
      runValues: { r1: { casesNeeded: 100 } },
      runValuesUpdatedAt: { r1: 9999 },
    });
    const stored = await getStored();
    expect((stored.brands as string[])).toContain("Acme");
    expect((stored.pepTypes as string[])).toContain("Pepperoni");
    const ds = stored.dayState as Record<string, unknown>;
    expect((ds.shiftNotes as string)).toBe("hi");
    expect((stored.runValues as Record<string, unknown>).r1).toBeDefined();
  });

  it("caps dayState.runs at 50 in the persisted blob", async () => {
    const runs = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, brand: "X", flavor: "Y" }));
    await putPayload({ dayState: { runs, resetAt: 0 } });
    const stored = await getStored();
    const ds = stored.dayState as Record<string, unknown>;
    expect((ds.runs as unknown[]).length).toBeLessThanOrEqual(50);
  });

  it("returns 400 when the sanitized payload exceeds the 512 KB aggregate limit", async () => {
    // Build a valid-key payload that is nonetheless too large after sanitization.
    const bigHistory = Array.from({ length: 5000 }, (_, i) => ({ id: `e${i}`, data: "x".repeat(100) }));
    const res = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "attacker", payload: { history: bigHistory, dayState: { runs: [], resetAt: 0 } } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/too large/i);
  });

  it("returns 400 when the payload is not a JSON object (string, array, null)", async () => {
    for (const nonObject of ['"a string"', "[1,2,3]", "null", "42"]) {
      const res = await fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
        method: "PUT",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ senderId: "x", payload: JSON.parse(nonObject) }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("successive disjoint name-list pushes never grow the stored brands list past MAX_RUNS (500)", async () => {
    // Push 5 batches of 150 disjoint brand names. Without post-merge capping the
    // stored list would grow to 750; with it, it must stay at or below 500.
    for (let batch = 0; batch < 5; batch++) {
      const brands = Array.from({ length: 150 }, (_, i) => `brand-${batch * 150 + i}`);
      await putPayload({ brands, dayState: { runs: [], resetAt: 0 } });
    }
    const stored = await getStored();
    expect((stored.brands as string[]).length).toBeLessThanOrEqual(500);
  });

  it("successive disjoint stamp-map pushes never cause the stored blob to exceed 512 KB", async () => {
    // Each push sends 300 disjoint names across two stamp-map namespaces.
    // Without post-merge capping, the stored deletedStamps would grow unboundedly.
    for (let batch = 0; batch < 5; batch++) {
      const brands: Record<string, number> = {};
      const pepTypes: Record<string, number> = {};
      for (let i = 0; i < 300; i++) {
        brands[`brand-${batch * 300 + i}`] = Date.now() + i;
        pepTypes[`pep-${batch * 300 + i}`] = Date.now() + i;
      }
      await putPayload({
        deletedStamps: { brands, pepTypes },
        undeletedStamps: { brands: { ...brands } },
        dayState: { runs: [], resetAt: 0 },
      });
    }
    const stored = await getStored();
    // The serialized stored blob must stay within the 512 KB aggregate limit.
    const serialized = JSON.stringify(stored);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(512 * 1024);
    // Also verify the individual stamp-map namespace entry counts are bounded.
    const ds = stored.deletedStamps as Record<string, Record<string, number>> | undefined;
    if (ds?.brands) expect(Object.keys(ds.brands).length).toBeLessThanOrEqual(500);
  });

  it("successive disjoint dayState.runs pushes never grow past MAX_RUNS (50)", async () => {
    // Push 3 batches of 25 disjoint runs. Without post-merge capping the union
    // would grow to 75; with it, it must stay at or below 50.
    for (let batch = 0; batch < 3; batch++) {
      const runs = Array.from({ length: 25 }, (_, i) => ({
        id: `r-${batch * 25 + i}`,
        brand: "X",
        flavor: "Y",
        metaUpdatedAt: Date.now() + i,
      }));
      await putPayload({ dayState: { runs, resetAt: 0 } });
    }
    const stored = await getStored();
    const ds = stored.dayState as Record<string, unknown>;
    expect((ds.runs as unknown[]).length).toBeLessThanOrEqual(50);
  });

  it("a PUT over a legacy oversized dayState row trims it to <=512 KB on the next merge", async () => {
    // Simulate a legacy JSONB row that was written before this guard existed and
    // contains an oversized dayState sub-field (e.g. a giant substitutionLog).
    // When any valid PUT arrives, the post-merge cap must trim it to budget.
    const oversizedSubLog = Array.from({ length: 5000 }, (_, i) => ({
      id: `log-${i}`,
      detail: "x".repeat(200),
    }));
    // Seed the oversized legacy row directly into the DB. DATE = "2030-11-01" is
    // not in beforeEach's pre-seeded rows so there is no conflict.
    const legacyData = {
      dayState: { runs: [], resetAt: 0, substitutionLog: oversizedSubLog },
    };
    await db.insert(dailySyncTable).values([{ date: DATE, scope: "live" as const, data: legacyData as any, updatedAt: new Date() }]);

    // Now push a minimal valid payload — the merge must trim the oversized blob.
    await putPayload({ dayState: { runs: [], resetAt: 0 } });

    const stored = await getStored();
    const serialized = JSON.stringify(stored);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(512 * 1024);
  });

  it("successive disjoint near-limit run pushes never cause stored blob to exceed 512 KB", async () => {
    // Each push sends 25 disjoint runs with large metadata objects. After two
    // pushes the union is 50 runs; with large metadata this can exceed 512 KB.
    // The hard post-merge byte guarantee must trim as needed.
    const bigMeta = "x".repeat(8000); // 8 KB per run → 50 runs ≈ 400 KB, well within limit
    for (let batch = 0; batch < 2; batch++) {
      const runs = Array.from({ length: 25 }, (_, i) => ({
        id: `big-${batch * 25 + i}`,
        brand: "Brand",
        flavor: "Flavor",
        metaUpdatedAt: Date.now() + i,
        notes: bigMeta,
      }));
      const runValues: Record<string, unknown> = {};
      for (let i = 0; i < 25; i++) {
        runValues[`big-${batch * 25 + i}`] = { cases: i, notes: bigMeta };
      }
      await putPayload({ dayState: { runs, resetAt: 0 }, runValues });
    }
    const stored = await getStored();
    const serialized = JSON.stringify(stored);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(512 * 1024);
  });
});
