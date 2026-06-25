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
let usersTable: DbModule["usersTable"];

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
  usersTable = dbMod.usersTable;

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
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 30_000);

function dayRow(date: string) {
  const runId = `run-${date}`;
  return {
    date,
    scope: "live" as const,
    data: { dayState: { runs: [{ id: runId, brand: "Acme", flavor: "Pep" }] }, runValues: {} },
  };
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${dailySyncTable}, ${usersTable} RESTART IDENTITY CASCADE`);
  await db.insert(usersTable).values([{ id: USER, username: "user", passwordHash: "x" }]);
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

describe("DELETE /sync/:date — client-local-date guard", () => {
  it("rejects deleting a day at or before the client-supplied `today`", async () => {
    const res = await fetch(`${baseUrl}/api/sync/2030-03-11?today=2030-03-11`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("allows deleting the client's future day even if the server (UTC) considers it today", async () => {
    // Client local 'today' is 2030-03-10, so 2030-03-11 is a deletable future day
    // from their perspective regardless of the server's UTC clock.
    const res = await fetch(`${baseUrl}/api/sync/2030-03-11?today=2030-03-10`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const remaining = await fetch(`${baseUrl}/api/sync/scheduled?today=2030-03-10`, {
      headers: authHeaders(),
    });
    const days = (await remaining.json()) as Array<{ date: string }>;
    expect(days.map((d) => d.date)).toEqual(["2030-03-12"]);
  });
});
