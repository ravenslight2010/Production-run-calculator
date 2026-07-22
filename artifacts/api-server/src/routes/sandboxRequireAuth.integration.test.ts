// Integration tests confirming that the requireAuth middleware rejects sandbox-
// flagged users from ALL authenticated routes in production — not just at sign-in.
//
// The sign-in gate is already covered by sandboxSignIn.integration.test.ts. This
// file guards the separate path: a valid token minted for a sandbox-flagged user
// (e.g. from a dev environment that was later promoted) must be rejected by
// requireAuth before it reaches any protected handler when NODE_ENV === "production".
//
// Covered cases:
//   - sandbox token + NODE_ENV=production → GET /api/me returns 401
//   - sandbox token + NODE_ENV=production → GET /api/sync returns 401
//   - sandbox token + NODE_ENV=test (non-production) → GET /api/me returns 200
//   - regular (non-sandbox) token + NODE_ENV=production → GET /api/me returns 200
//   - no token → GET /api/me returns 401 (baseline requireAuth check)
//
// Pattern mirrors sandboxSignIn.integration.test.ts and sandboxIsolation.integration.test.ts:
// a throwaway Postgres DB is created, drizzle pushes the schema, and the real
// router is mounted in-process. The sandbox cache is cleared between cases so
// NODE_ENV flips are visible to isSandboxUser.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so
// we must create the throwaway DB and repoint DATABASE_URL BEFORE any dynamic
// import that touches @workspace/db. signToken has no DB dependency and is a
// safe static import.
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
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let newUserId: () => string;
let hashPassword: (pw: string) => string;
let clearSandboxCache: () => void;
let clearUserValidityCache: () => void;
let clearSessionBoundaryCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let originalNodeEnv: string | undefined;
let server: Server;
let baseUrl: string;

const SANDBOX_USER_ID = "sandbox-test-user-1";
const REGULAR_USER_ID = "regular-test-user-1";
const SANDBOX_USERNAME = "sandboxauthuser";
const REGULAR_USERNAME = "regularauthuser";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");
  originalNodeEnv = process.env.NODE_ENV;

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_sandbox_requireauth_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const rolesMod = await import("../lib/roles");
  const authMod = await import("../lib/auth");
  const sandboxMod = await import("../lib/sandbox");
  const userValidityMod = await import("../lib/userValidity");
  const sessionBoundaryMod = await import("../lib/sessionBoundary");

  db = dbMod.db;
  pool = dbMod.pool;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = rolesMod.seedRoles;
  newUserId = authMod.newUserId;
  hashPassword = authMod.hashPassword;
  clearSandboxCache = sandboxMod.clearSandboxCache;
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  clearSessionBoundaryCache = sessionBoundaryMod.clearSessionBoundaryCache;

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
  if (originalNodeEnv !== undefined) {
    process.env.NODE_ENV = originalNodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }
}, 60_000);

beforeEach(async () => {
  // Restore NODE_ENV to non-production before each test; individual tests set
  // it to "production" as needed.
  process.env.NODE_ENV = "test";

  // Clear all in-process caches so NODE_ENV changes take effect immediately.
  clearSandboxCache();
  clearUserValidityCache();
  clearSessionBoundaryCache();

  await db.execute(
    sql`TRUNCATE ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();

  // A sandbox-flagged user. We use a fixed string id so signToken (which needs
  // only the userId) can mint a token before the DB row exists, and we can
  // verify the middleware rejects that token without a round-trip to sign in.
  await db.insert(usersTable).values({
    id: SANDBOX_USER_ID,
    username: SANDBOX_USERNAME,
    passwordHash: hashPassword("anypassword"),
    sandbox: true,
  });
  await db.insert(userRolesTable).values({ userId: SANDBOX_USER_ID, role: "manager" });

  // A regular non-sandbox user for the success-path and baseline comparisons.
  await db.insert(usersTable).values({
    id: REGULAR_USER_ID,
    username: REGULAR_USERNAME,
    passwordHash: hashPassword("anypassword"),
    sandbox: false,
  });
  await db.insert(userRolesTable).values({ userId: REGULAR_USER_ID, role: "manager" });
});

function authedRequest(userId: string, method: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${signToken(userId)}` },
  });
}

describe("sandbox token is rejected on authenticated routes in production", () => {
  it("GET /api/me returns 401 for a sandbox token when NODE_ENV is 'production'", async () => {
    process.env.NODE_ENV = "production";
    clearSandboxCache();
    const res = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("GET /api/sync returns 401 for a sandbox token when NODE_ENV is 'production'", async () => {
    process.env.NODE_ENV = "production";
    clearSandboxCache();
    const today = new Date().toISOString().slice(0, 10);
    const res = await authedRequest(SANDBOX_USER_ID, "GET", `/api/sync?today=${today}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 consistently on repeated requests (gate is not one-shot)", async () => {
    process.env.NODE_ENV = "production";
    clearSandboxCache();
    const res1 = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
    const res2 = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
    expect(res1.status).toBe(401);
    expect(res2.status).toBe(401);
  });
});

describe("sandbox token is accepted on authenticated routes outside production", () => {
  it("GET /api/me returns 200 for a sandbox token when NODE_ENV is 'test'", async () => {
    process.env.NODE_ENV = "test";
    clearSandboxCache();
    const res = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
    expect(res.status).toBe(200);
  });

  it("GET /api/me returns 200 for a sandbox token when NODE_ENV is 'development'", async () => {
    process.env.NODE_ENV = "development";
    clearSandboxCache();
    const res = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
    expect(res.status).toBe(200);
  });
});

describe("non-sandbox token always passes the sandbox gate", () => {
  it("GET /api/me returns 200 for a regular user token when NODE_ENV is 'production'", async () => {
    process.env.NODE_ENV = "production";
    clearSandboxCache();
    const res = await authedRequest(REGULAR_USER_ID, "GET", "/api/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe(REGULAR_USER_ID);
  });

  it("GET /api/me returns 200 for a regular user token when NODE_ENV is 'test'", async () => {
    process.env.NODE_ENV = "test";
    clearSandboxCache();
    const res = await authedRequest(REGULAR_USER_ID, "GET", "/api/me");
    expect(res.status).toBe(200);
  });
});

describe("missing token is always rejected (baseline requireAuth check)", () => {
  it("GET /api/me returns 401 with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/me`);
    expect(res.status).toBe(401);
  });
});
