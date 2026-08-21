import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { signToken } from "../lib/auth";

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
let seedRoles: () => Promise<void>;
let runDataHeals: () => Promise<void>;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const USER = "user-1";
const MANAGER = "manager-1";
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
  db = dbMod.db;
  pool = dbMod.pool;
  dailySyncTable = dbMod.dailySyncTable;
  dataHealsTable = dbMod.dataHealsTable;
  syncConflictLogsTable = dbMod.syncConflictLogsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  runDataHeals = (await import("../lib/dataHeals")).runDataHeals;

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
  await db.execute(sql`TRUNCATE ${dailySyncTable}, ${dataHealsTable}, ${syncConflictLogsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: USER, username: "user", passwordHash: "x" },
    { id: MANAGER, username: "manager", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([{ userId: MANAGER, role: "manager" }]);
  // Three consecutive dates well clear of any real "today" so the assertions
  // don't depend on when the suite runs.
  await db.insert(dailySyncTable).values([
    dayRow("2030-03-10"),
    dayRow("2030-03-11"),
    dayRow("2030-03-12"),
  ]);
});

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signToken(USER)}` };
}

function managerAuthHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signToken(MANAGER)}` };
}

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

describe("/sync/today — client-local-date keying", () => {
  // The live "today" row must be keyed by the CLIENT's local date too, matching
  // /sync/scheduled. Otherwise a client behind UTC writes the live day into its
  // local "tomorrow" row, clobbering a scheduled day (and its case counts).
  it("GET reads the row for the client-supplied `today`", async () => {
    const res = await fetch(`${baseUrl}/api/sync/today?today=2030-03-11`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { dayState?: { runs?: Array<{ id: string }> } } | null;
    expect(data?.dayState?.runs?.[0]?.id).toBe("run-2030-03-11");
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
      headers: { ...authHeaders(), "content-type": "application/json" },
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
        headers: { ...authHeaders(), "content-type": "application/json" },
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

describe("/sync/events — date-scoped broadcasts", () => {
  // Two live watchers on the SAME scope but DIFFERENT local dates must not
  // receive each other's pushes, or a peer behind/ahead of UTC would clobber its
  // live view with another calendar day's state.
  // NOTE: controllers are aborted deterministically at the end so the open SSE
  // connections don't hang afterAll's server.close().
  function collectSenderIds(date: string, ctrl: AbortController, sink: string[]): Promise<void> {
    return (async () => {
      try {
        const res = await fetch(
          `${baseUrl}/api/sync/events?clientId=watcher-${date}&today=${date}`,
          { headers: authHeaders(), signal: ctrl.signal },
        );
        const reader = res.body!.getReader();
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
          dayState: { runs: [{ id: "scheduled-run", brand: "Acme", flavor: "Pep" }], resetAt: 1000 },
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
    };
    expect(initial.initial).toBe(true);
    expect(initial.senderId).toBeNull();
    expect(initial.data?.dayState?.runs?.map((run) => run.id)).toContain("scheduled-run");
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
      headers: { ...authHeaders(), "content-type": "application/json" },
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
