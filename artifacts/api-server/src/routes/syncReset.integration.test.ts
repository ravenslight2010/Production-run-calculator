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

// Covers the single, reliable data-reset action (POST /api/sync/reset) that
// replaced the fragile "bump a one-time wipe-marker constant + take the API down"
// purge dance. The reset must: (1) be manager-only, (2) clear every daily_sync
// row for the scope and bump the scope's reset epoch, and (3) make the epoch-guard
// on PUT reject a populated client's stale re-push — which is what stops the
// cleared state from being re-adopted through the additive live-sync union.

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let dataResetTable: DbModule["dataResetTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const MANAGER = "manager-1";
const OPERATOR = "operator-1";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_syncreset_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  dataResetTable = dbMod.dataResetTable;
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
  return {
    date,
    scope: "live" as const,
    data: { dayState: { runs: [{ id: `run-${date}`, brand: "Acme", flavor: "Pep" }] }, runValues: {} },
  };
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE ${dailySyncTable}, ${dataResetTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: "boss", passwordHash: "x" },
    { id: OPERATOR, username: "worker", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
  ]);
  await db.insert(dailySyncTable).values([
    dayRow("2030-03-10"),
    dayRow("2030-03-11"),
    dayRow("2030-03-12"),
  ]);
});

function authHeaders(user: string): Record<string, string> {
  return { authorization: `Bearer ${signToken(user)}` };
}

describe("GET /sync/reset-epoch", () => {
  it("starts at 0 before any reset", async () => {
    const res = await fetch(`${baseUrl}/api/sync/reset-epoch`, { headers: authHeaders(OPERATOR) });
    expect(res.status).toBe(200);
    expect((await res.json()) as { epoch: number }).toEqual({ epoch: 0 });
  });
});

describe("POST /sync/reset", () => {
  it("is manager-only (operator is forbidden)", async () => {
    const res = await fetch(`${baseUrl}/api/sync/reset`, {
      method: "POST",
      headers: authHeaders(OPERATOR),
    });
    expect(res.status).toBe(403);
    // Nothing was cleared.
    const rows = await db.select().from(dailySyncTable);
    expect(rows).toHaveLength(3);
  });

  it("clears every daily_sync row for the scope and bumps the epoch", async () => {
    const res = await fetch(`${baseUrl}/api/sync/reset`, {
      method: "POST",
      headers: authHeaders(MANAGER),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean; epoch: number }).toEqual({ ok: true, epoch: 1 });

    const rows = await db.select().from(dailySyncTable);
    expect(rows).toHaveLength(0);

    const epochRes = await fetch(`${baseUrl}/api/sync/reset-epoch`, { headers: authHeaders(OPERATOR) });
    expect((await epochRes.json()) as { epoch: number }).toEqual({ epoch: 1 });
  });

  it("increments the epoch on each reset", async () => {
    for (const expected of [1, 2, 3]) {
      const res = await fetch(`${baseUrl}/api/sync/reset`, {
        method: "POST",
        headers: authHeaders(MANAGER),
      });
      expect((await res.json()) as { epoch: number }).toEqual({ ok: true, epoch: expected });
    }
  });
});

describe("PUT epoch guard — the re-adoption race closer", () => {
  const DATE = "2030-07-01";
  function put(payload: unknown, epoch?: number) {
    const qs = epoch === undefined ? "" : `&epoch=${epoch}`;
    return fetch(`${baseUrl}/api/sync/today?today=${DATE}${qs}`, {
      method: "PUT",
      headers: { ...authHeaders(OPERATOR), "content-type": "application/json" },
      body: JSON.stringify({ senderId: "c1", payload }),
    });
  }
  const populated = {
    dayState: { runs: [{ id: "r1", brand: "Acme", flavor: "Pep" }], resetAt: 1000 },
    runValues: { r1: { casesNeeded: 240 } },
    runValuesUpdatedAt: { r1: 1 },
  };
  async function readRow() {
    const res = await fetch(`${baseUrl}/api/sync/${DATE}`, { headers: authHeaders(OPERATOR) });
    return (await res.json()) as { dayState?: { runs?: Array<{ id: string }> } } | null;
  }

  it("rejects a push carrying an epoch older than the current server epoch", async () => {
    await fetch(`${baseUrl}/api/sync/reset`, { method: "POST", headers: authHeaders(MANAGER) });
    // Populated client still thinks epoch is 0 and tries to re-upload its old data.
    const res = await put(populated, 0);
    expect(res.status).toBe(200);
    expect((await res.json()) as { stale?: boolean; epoch?: number }).toMatchObject({ stale: true, epoch: 1 });
    // The cleared state held — the stale push was dropped, not merged back in.
    expect(await readRow()).toBeNull();
  });

  it("accepts a push once the client has caught up to the current epoch", async () => {
    await fetch(`${baseUrl}/api/sync/reset`, { method: "POST", headers: authHeaders(MANAGER) });
    const res = await put(populated, 1);
    expect(res.status).toBe(200);
    expect((await res.json()) as { stale?: boolean }).not.toMatchObject({ stale: true });
    const row = await readRow();
    expect((row?.dayState?.runs ?? []).map((r) => r.id)).toEqual(["r1"]);
  });

  it("accepts a push with no epoch param (older clients are not blocked)", async () => {
    await fetch(`${baseUrl}/api/sync/reset`, { method: "POST", headers: authHeaders(MANAGER) });
    const res = await put(populated);
    expect(res.status).toBe(200);
    const row = await readRow();
    expect((row?.dayState?.runs ?? []).map((r) => r.id)).toEqual(["r1"]);
  });
});
