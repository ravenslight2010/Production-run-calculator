import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { sql } from "drizzle-orm";
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
let syncConflictLogsTable: DbModule["syncConflictLogsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const USER = "user-1";
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
  syncConflictLogsTable = dbMod.syncConflictLogsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;

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
  await db.execute(
    sql`TRUNCATE ${dailySyncTable}, ${syncConflictLogsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  await db.insert(usersTable).values([{ id: USER, username: "user", passwordHash: "x" }]);
  // Give the test user the manager role so DELETE /sync/:date (which requires
  // manage-factory-settings, a manager capability) can be exercised.
  await db.insert(userRolesTable).values({ userId: USER, role: "manager" });
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
});

describe("/sync — additive run-list protection (whole-run loss guard)", () => {
  // A device that briefly holds a SHORTER run list (post-refresh / before it has
  // seen a peer's runs) must not be able to drop everyone's runs by pushing that
  // short dayState.runs. The server union-merges the run list by id; only an
  // explicit tombstone (or a true daily reset) removes a run.
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

  it("a true daily reset (strictly-newer resetAt) adopts the incoming runs wholesale", async () => {
    await put({
      dayState: { runs: [run("a"), run("b"), run("c")], resetAt: 1000 },
      runValues: { a: { casesNeeded: 10 }, b: { casesNeeded: 20 }, c: { casesNeeded: 30 } },
      runValuesUpdatedAt: { a: 1, b: 1, c: 1 },
    });
    // New shift: resetAt jumps forward and the day starts fresh with one run.
    await put({
      dayState: { runs: [run("z")], resetAt: 2000 },
      runValues: { z: { casesNeeded: 99 } },
      runValuesUpdatedAt: { z: 5 },
    });
    const row = await readRow();
    expect((row?.dayState?.runs ?? []).map((r) => r.id)).toEqual(["z"]);
    expect(row?.runValues?.a).toBeUndefined();
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
  function put(payload: unknown) {
    return fetch(`${baseUrl}/api/sync/today?today=${DATE}`, {
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

// DELETE /sync/:date enforces the server's real UTC date rather than a
// client-supplied `today` param. This prevents a client from lying about
// "today" to delete the actual live day (which would nuke a running shift).
// The capability gate (manage-factory-settings) is tested implicitly: the
// beforeEach seeds the test user as a manager.
describe("DELETE /sync/:date — server-date guard", () => {
  it("rejects deleting a day in the past (server-date comparison)", async () => {
    // 2020-01-01 is always in the past; the server blocks it regardless of any
    // client `?today=` param because the guard uses the real server clock.
    const res = await fetch(`${baseUrl}/api/sync/2020-01-01`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("allows deleting a future day and removes it from the scheduled list", async () => {
    // 2030-03-11 is well in the future from any realistic test run, so the
    // server-date guard passes and the row is removed.
    const res = await fetch(`${baseUrl}/api/sync/2030-03-11`, {
      method: "DELETE",
      headers: authHeaders(),
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
