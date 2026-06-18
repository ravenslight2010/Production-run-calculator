// Integration tests for the daily-reset session fence, end to end through the
// real router and a disposable Postgres database.
//
// The contract being protected:
//  - A token issued BEFORE today's reset boundary is rejected (401), so the new
//    production day starts from a re-authenticated state on every device.
//  - A token issued AFTER the boundary is accepted (200).
//  - When today has no reset recorded, no one is fenced out (200).
//  - The boundary is read from TODAY's row only: scheduling a FUTURE day (which
//    writes resetAt on a future daily_sync row) must NOT invalidate today's
//    sessions.
//  - Legacy tokens (no `iat`) fall back to the process start time, so they are
//    subject to the fence rather than slipping past it or being purged spuriously.
//
// Mirrors roles.integration.test.ts: throwaway DB created from the dev
// DATABASE_URL's server, schema pushed via drizzle-kit, dropped on teardown, so
// nothing here touches real data. The session cache is module-level, so we clear
// it before each case to read each case's freshly written boundary.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

// NOTE: do NOT statically import anything that pulls in @workspace/db (e.g.
// ../lib/sessionBoundary) here — the db pool binds to process.env.DATABASE_URL
// at import time, and beforeAll repoints it at the throwaway DB. clearSession-
// BoundaryCache is therefore loaded dynamically below, after the repoint.
type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let userRolesTable: DbModule["userRolesTable"];
let usersTable: DbModule["usersTable"];

let clearUserValidityCache: () => void;
let clearSessionBoundaryCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const USER = "user-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  testDbName = `helium_boundary_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const sessionBoundaryMod = await import("../lib/sessionBoundary");
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  clearSessionBoundaryCache = sessionBoundaryMod.clearSessionBoundaryCache;
  db = dbMod.db;
  pool = dbMod.pool;
  dailySyncTable = dbMod.dailySyncTable;
  userRolesTable = dbMod.userRolesTable;
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
});

beforeEach(async () => {
  clearUserValidityCache();
  clearSessionBoundaryCache();
  await db.execute(
    sql`TRUNCATE ${dailySyncTable}, ${userRolesTable}, ${usersTable} RESTART IDENTITY CASCADE`,
  );
  await db.insert(usersTable).values({ id: USER, username: "user", passwordHash: "x" });
  await db.insert(userRolesTable).values({ userId: USER, role: "operator" });
});

// Write a daily_sync row for `date` carrying a dayState.resetAt boundary.
async function writeReset(date: string, resetAtMs: number): Promise<void> {
  await db
    .insert(dailySyncTable)
    .values({ date, data: { dayState: { resetAt: resetAtMs } }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: dailySyncTable.date,
      set: { data: { dayState: { resetAt: resetAtMs } } },
    });
}

// A request to /api/me carrying the given Authorization token (or none).
async function meWith(token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return fetch(`${baseUrl}/api/me`, { headers });
}

// Forge a legacy token (valid signature, no `iat`) signed with the live secret.
function legacyToken(sub: string): string {
  const secret = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("missing token secret");
  const b64url = (s: Buffer | string) =>
    Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = b64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 100_000 }));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

describe("daily-reset session fence", () => {
  it("rejects a token issued before today's reset (401)", async () => {
    // Reset boundary sits in the future relative to the token we are about to
    // mint, i.e. the token was issued before the reset → fenced out.
    await writeReset(todayStr(), Date.now() + 60_000);
    const res = await meWith(signToken(USER));
    expect(res.status).toBe(401);
  });

  it("accepts a token issued after today's reset (200)", async () => {
    // Reset already happened in the past; the freshly minted token is newer.
    await writeReset(todayStr(), Date.now() - 60_000);
    const res = await meWith(signToken(USER));
    expect(res.status).toBe(200);
  });

  it("accepts every session when today has no reset recorded (200)", async () => {
    // No daily_sync row for today → boundary 0 → nobody is fenced.
    const res = await meWith(signToken(USER));
    expect(res.status).toBe(200);
  });

  it("uses today's row only: a future scheduled reset does not invalidate today (200)", async () => {
    // Scheduling a future production day writes resetAt on a FUTURE row. If the
    // boundary read leaked across days, this far-future reset would log everyone
    // out right now. It must be ignored entirely.
    await writeReset(tomorrowStr(), Date.now() + 1_000_000_000);
    const res = await meWith(signToken(USER));
    expect(res.status).toBe(200);
  });

  it("fences out a legacy token (no iat) when the reset is in the future (401)", async () => {
    // Legacy tokens fall back to the process start time, which predates a reset
    // recorded far in the future → they are correctly fenced out.
    await writeReset(todayStr(), Date.now() + 1_000_000_000);
    const res = await meWith(legacyToken(USER));
    expect(res.status).toBe(401);
  });

  it("accepts a legacy token (no iat) when the reset is in the past (200)", async () => {
    // The process-start fallback is newer than a past reset, so a legacy session
    // is not spuriously logged out.
    await writeReset(todayStr(), Date.now() - 60_000);
    const res = await meWith(legacyToken(USER));
    expect(res.status).toBe(200);
  });
});
