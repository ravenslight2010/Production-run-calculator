// Integration tests for the cycle-count mark-counted endpoint, asserting two
// behaviors that only a behavior test (not a typecheck) can catch:
//
//   1. POST /cycle-count-schedules/:id/mark-counted stamps `lastCountedAt` to
//      the client-supplied local factory day (and persists it to the row), so
//      the reminder clock resets on the same date basis the clients use to
//      compute the "Time to Count" due list — avoiding timezone off-by-one.
//   2. Editing a schedule via POST /cycle-count-schedules (the upsert/update
//      path) does NOT clobber an existing `lastCountedAt`; only mark-counted
//      changes it.
//
// As with roles.integration.test.ts / productionRules.integration.test.ts, this
// stands up the *real* router against a *disposable* Postgres database (created
// from the dev DATABASE_URL's server, schema pushed via drizzle-kit, dropped on
// teardown) so nothing here ever touches real data. Auth uses the self-contained
// username + password system: a manager carries a real HMAC-signed session token
// in the Authorization header.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so we
// create the throwaway DB and point DATABASE_URL at it BEFORE importing anything
// that pulls in @workspace/db — hence the dynamic imports inside beforeAll (see
// .agents/memory/integration-test-db-binding.md). Only db-free helpers
// (lib/auth's signToken) are safe as static imports.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let cycleCountSchedulesTable: DbModule["cycleCountSchedulesTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;

let clearUserValidityCache: () => void;

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
  testDbName = `helium_cyclecount_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const userValidityMod = await import("../lib/userValidity");
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  db = dbMod.db;
  pool = dbMod.pool;
  cycleCountSchedulesTable = dbMod.cycleCountSchedulesTable;
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

beforeEach(async () => {
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${cycleCountSchedulesTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  // Seed the role catalog so requireCapability can resolve roles to capabilities.
  await seedRoles();
  // A manager (can edit schedules) and a plain operator (signed-in floor staff
  // who can read + mark counted, but not edit schedules).
  await db.insert(usersTable).values([
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: OPERATOR, username: "operator", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
  ]);
});

async function req(
  userId: string | null,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (userId) headers["authorization"] = `Bearer ${signToken(userId)}`;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

type ApiSchedule = {
  id: string;
  section: string;
  cadenceDays: number;
  lastCountedAt: string | null;
  enabled: boolean;
};

async function listSchedules(): Promise<ApiSchedule[]> {
  const res = await req(MANAGER, "GET", "/api/cycle-count-schedules");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { schedules: ApiSchedule[] };
  return body.schedules;
}

describe("cycle-count mark-counted stamps last-counted date", () => {
  it("stamps the client's local day and persists it to the row", async () => {
    // Manager creates a never-counted schedule.
    const saveRes = await req(MANAGER, "POST", "/api/cycle-count-schedules", {
      schedules: [
        {
          id: "sched-freezer",
          section: "Freezer",
          cadenceDays: 7,
          lastCountedAt: null,
          enabled: true,
        },
      ],
    });
    expect(saveRes.status).toBe(200);

    // A signed-in operator marks it counted with their local factory day.
    const counted = await req(
      OPERATOR,
      "POST",
      "/api/cycle-count-schedules/sched-freezer/mark-counted",
      { today: "2026-06-24" },
    );
    expect(counted.status).toBe(200);
    const body = (await counted.json()) as { schedules: ApiSchedule[] };
    const stamped = body.schedules.find((s) => s.id === "sched-freezer");
    expect(stamped).toBeDefined();
    expect(stamped!.lastCountedAt).toBe("2026-06-24");

    // The underlying DB row holds the same date, not just the response shape.
    const [row] = await db
      .select()
      .from(cycleCountSchedulesTable)
      .where(sql`${cycleCountSchedulesTable.id} = ${"sched-freezer"}`);
    expect(row.lastCountedAt).toBe("2026-06-24");
  });

  it("falls back to the server date when the client sends a malformed day", async () => {
    await req(MANAGER, "POST", "/api/cycle-count-schedules", {
      schedules: [
        {
          id: "sched-cooler",
          section: "Cooler",
          cadenceDays: 14,
          lastCountedAt: null,
          enabled: true,
        },
      ],
    });

    // Garbage date string must not be persisted verbatim; server stamps its own
    // current date instead (a valid YYYY-MM-DD).
    const counted = await req(
      OPERATOR,
      "POST",
      "/api/cycle-count-schedules/sched-cooler/mark-counted",
      { today: "not-a-date" },
    );
    expect(counted.status).toBe(200);

    const schedules = await listSchedules();
    const stamped = schedules.find((s) => s.id === "sched-cooler");
    expect(stamped).toBeDefined();
    expect(stamped!.lastCountedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stamped!.lastCountedAt).not.toBe("not-a-date");
  });

  it("returns 404 when marking a non-existent schedule counted", async () => {
    const res = await req(
      OPERATOR,
      "POST",
      "/api/cycle-count-schedules/does-not-exist/mark-counted",
      { today: "2026-06-24" },
    );
    expect(res.status).toBe(404);
  });
});

describe("cycle-count schedule edits preserve last-counted date", () => {
  it("editing section/cadence does not clobber an existing lastCountedAt", async () => {
    // Create + mark counted so the row has a real lastCountedAt.
    await req(MANAGER, "POST", "/api/cycle-count-schedules", {
      schedules: [
        {
          id: "sched-dry",
          section: "Dry Storage",
          cadenceDays: 30,
          lastCountedAt: null,
          enabled: true,
        },
      ],
    });
    await req(OPERATOR, "POST", "/api/cycle-count-schedules/sched-dry/mark-counted", {
      today: "2026-06-20",
    });

    // Manager edits the section + cadence (update path) WITHOUT a lastCountedAt.
    const editRes = await req(MANAGER, "POST", "/api/cycle-count-schedules", {
      schedules: [
        {
          id: "sched-dry",
          section: "Dry Storage (Aisle 3)",
          cadenceDays: 21,
          lastCountedAt: null,
          enabled: true,
        },
      ],
    });
    expect(editRes.status).toBe(200);

    const schedules = await listSchedules();
    const reloaded = schedules.find((s) => s.id === "sched-dry");
    expect(reloaded).toBeDefined();
    // The edited fields took effect...
    expect(reloaded!.section).toBe("Dry Storage (Aisle 3)");
    expect(reloaded!.cadenceDays).toBe(21);
    // ...but the prior count date survived the update (only mark-counted moves it).
    expect(reloaded!.lastCountedAt).toBe("2026-06-20");
  });
});
