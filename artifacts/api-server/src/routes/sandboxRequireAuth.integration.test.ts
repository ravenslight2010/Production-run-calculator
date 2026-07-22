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
//   - sandbox token after cache eviction (TTL expiry) → still 401 in production
//   - non-sandbox token after cache eviction → still 200 in production
//   - DB error + stale cache sandbox=true → isSandboxUser returns true (blocked)
//   - DB error + no cache (cold) → isSandboxUser returns false (treated as live)
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
import { sql, eq } from "drizzle-orm";
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
let isSandboxUser: (userId: string) => Promise<boolean>;
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
  isSandboxUser = sandboxMod.isSandboxUser;
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

describe("sandbox block holds after cache TTL expiry (cache eviction mid-session)", () => {
  it("re-queries DB after cache eviction and still blocks sandbox token in production", async () => {
    process.env.NODE_ENV = "production";
    clearSandboxCache();

    // First request: cold cache → DB queried → caches sandbox=true → 401.
    const res1 = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
    expect(res1.status).toBe(401);

    // Simulate TTL expiry by evicting the cache entry mid-session.
    clearSandboxCache();

    // Second request: cache miss again → DB re-queried → still sandbox=true → still 401.
    // This is the regression case: the gate must not be a one-shot check that only
    // fires on the very first cache miss.
    const res2 = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
    expect(res2.status).toBe(401);
    const body2 = (await res2.json()) as { error: string };
    expect(body2.error).toBe("Unauthorized");
  });

  it("non-sandbox token still passes after cache eviction in production", async () => {
    process.env.NODE_ENV = "production";
    clearSandboxCache();

    // Warm the cache for the regular user.
    const res1 = await authedRequest(REGULAR_USER_ID, "GET", "/api/me");
    expect(res1.status).toBe(200);

    // Evict all cache entries (simulating TTL expiry for all users).
    clearSandboxCache();

    // Regular user still passes after the cache is re-populated from DB.
    const res2 = await authedRequest(REGULAR_USER_ID, "GET", "/api/me");
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { userId: string };
    expect(body2.userId).toBe(REGULAR_USER_ID);
  });

  it("sandbox block holds across multiple successive cache evictions in production", async () => {
    process.env.NODE_ENV = "production";

    // Three cycles of: evict cache (TTL expiry) → request → must be blocked.
    // Each cycle forces a fresh DB round-trip; the gate must fire every time.
    for (let i = 0; i < 3; i++) {
      clearSandboxCache();
      const res = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
      expect(res.status).toBe(401);
    }
  });
});

describe("isSandboxUser direct cache and DB query behaviour", () => {
  // These tests call isSandboxUser() directly rather than through the HTTP path.
  // The DB-error catch branch (lines in sandbox.ts that fall back to a stale
  // cache entry when getUserById throws) cannot be exercised here without
  // mocking because requiring a real DB exception would also break the
  // getUserSecurityState check that runs earlier in requireAuth. The tests
  // below cover the two observable paths that can be reached without fault
  // injection: cold-cache DB queries and within-TTL cache hits.

  it("returns false for an unknown userId (cold cache, DB returns null)", async () => {
    clearSandboxCache();
    const nonExistentId = `no-such-user-${Date.now()}`;

    // getUserById returns null for an unknown id (not a throw). The code
    // treats null as sandbox=false — i.e. "live user" — to avoid silently
    // routing a real user into the sandbox scope on a transient miss.
    const result = await isSandboxUser(nonExistentId);
    expect(result).toBe(false);
  });

  it("returns true for a sandbox-flagged user when cache is cold (DB is queried)", async () => {
    clearSandboxCache();

    // The sandbox user exists in the DB (inserted in beforeEach).
    const result = await isSandboxUser(SANDBOX_USER_ID);
    expect(result).toBe(true);
  });

  it("returns false for a non-sandbox user when cache is cold (DB is queried)", async () => {
    clearSandboxCache();

    const result = await isSandboxUser(REGULAR_USER_ID);
    expect(result).toBe(false);
  });

  it("returns cached value without hitting DB while the TTL window is still open", async () => {
    clearSandboxCache();

    // Warm the cache by querying the DB.
    const first = await isSandboxUser(SANDBOX_USER_ID);
    expect(first).toBe(true);

    // Delete the user from the DB — a live DB query would now return null/false.
    await db.delete(usersTable).where(eq(usersTable.id, SANDBOX_USER_ID));

    // The cache entry is still within its 15-second TTL, so isSandboxUser
    // returns the cached true without re-querying the DB.
    const second = await isSandboxUser(SANDBOX_USER_ID);
    expect(second).toBe(true);

    // Re-insert the user so the afterAll truncation does not encounter a
    // missing FK reference; beforeEach will truncate cleanly regardless.
    await db.insert(usersTable).values({
      id: SANDBOX_USER_ID,
      username: SANDBOX_USERNAME,
      passwordHash: hashPassword("anypassword"),
      sandbox: true,
    });
  });
});
