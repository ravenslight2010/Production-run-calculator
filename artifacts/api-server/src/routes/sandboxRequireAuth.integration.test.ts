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
//   - promoted-DB scenario: seedSandboxUser() row survives into production → 401
//   - after promoted sandbox row is deleted + cache evicted → isSandboxUser returns false
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
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql, eq } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { signToken, verifyToken } from "../lib/auth";

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
let seedSandboxUser: () => Promise<void>;
let sandboxUsername: string;
let clearUserValidityCache: () => void;
let clearSessionBoundaryCache: () => void;
// Kept at module level so the cross-environment-replay test can spy on it.
let sandboxMod: typeof import("../lib/sandbox");

// Compile-time guard: if 'isSandboxUser' is renamed in sandbox.ts, TypeScript
// will error here ("Property 'isSandboxUser' does not exist on type ...").
// This turns a silent spy-wiring break — where vi.spyOn(sandboxMod, "isSandboxUser")
// silently targets a missing key and all call-count assertions pass vacuously —
// into a visible build error caught at typecheck time.
type _AssertIsSandboxUserExported = (typeof sandboxMod)["isSandboxUser"];

// Kept at module level so the DB-query-call-count test can spy on getUserById.
let usersMod: typeof import("../lib/users");

// Compile-time guard: if 'getUserById' is renamed in users.ts, TypeScript
// will error here ("Property 'getUserById' does not exist on type ...").
// This turns a silent spy-wiring break — where vi.spyOn(usersMod, "getUserById")
// silently targets a missing key and all call-count assertions pass vacuously —
// into a visible build error caught at typecheck time.
type _AssertGetUserByIdExported = (typeof usersMod)["getUserById"];

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
  sandboxMod = await import("../lib/sandbox");
  usersMod = await import("../lib/users");
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
  seedSandboxUser = sandboxMod.seedSandboxUser;
  sandboxUsername = sandboxMod.SANDBOX_USERNAME;
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

// ---------------------------------------------------------------------------
// Cold in-process cache after a simulated server restart
//
// The TTL cache is in-process memory. When the server process restarts the Map
// is brand-new and empty — no prior requests have warmed it. The promoted-DB
// tests (and the TTL-eviction tests above) simulate that cold state via
// clearSandboxCache(), but they all do so against an express app that has
// already served many requests in the same process lifetime.
//
// This describe block spins up a **second** express app + router (mirroring
// what happens after a real restart) and validates that GET /api/me returns 401
// on the very first request to that new instance when the DB still holds a
// sandbox-flagged row. A regression that seeds the cache from a hard-coded
// default instead of a DB read would survive the TTL-eviction tests (which
// re-warm via clearSandboxCache + a subsequent DB call) but would be caught
// here because the fresh server makes exactly one DB round-trip before
// deciding — and the test inspects the outcome of that single round-trip.
// ---------------------------------------------------------------------------
describe("cold in-process cache after a simulated server restart", () => {
  let restartServer: Server;
  let restartBaseUrl: string;

  // Spin up the second server after the outer beforeAll has completed (so the
  // DB is set up and all module-level bindings are resolved).
  beforeAll(async () => {
    const routerMod = await import("./index");
    const restartApp: Express = express();
    restartApp.use(express.json({ limit: "10mb" }));
    restartApp.use((req, _res, next) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
      next();
    });
    restartApp.use("/api", routerMod.default);
    await new Promise<void>((resolve) => {
      restartServer = restartApp.listen(0, () => resolve());
    });
    const addr = restartServer.address() as AddressInfo;
    restartBaseUrl = `http://127.0.0.1:${addr.port}`;
  }, 30_000);

  afterAll(async () => {
    if (restartServer) {
      restartServer.closeAllConnections?.();
      await new Promise<void>((resolve) => restartServer.close(() => resolve()));
    }
  }, 30_000);

  it("GET /api/me returns 401 on the very first request when the cache is cold and the DB row is sandbox-flagged", async () => {
    // The outer beforeEach has already inserted the sandbox user row in the DB.
    // Clear the shared TTL cache to replicate the cold in-process state that
    // exists after a real server restart (the Map is empty, no entries).
    clearSandboxCache();
    process.env.NODE_ENV = "production";

    // This is the very first request to the fresh server instance. There is no
    // cached entry for SANDBOX_USER_ID, so isSandboxUser() must hit the DB.
    // If the code initialised the cache from a default (e.g. false) instead of
    // reading the DB, this would incorrectly return 200.
    const res = await fetch(`${restartBaseUrl}/api/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${signToken(SANDBOX_USER_ID)}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("non-sandbox user passes on the very first request to the freshly started server (cold cache + live DB row)", async () => {
    clearSandboxCache();
    process.env.NODE_ENV = "production";

    // The regular user has sandbox=false in the DB. Cold-cache DB query must
    // return false and let the request through.
    const res = await fetch(`${restartBaseUrl}/api/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${signToken(REGULAR_USER_ID)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe(REGULAR_USER_ID);
  });

  it("second request to the restarted server also returns 401 (gate is not one-shot after cache warms)", async () => {
    clearSandboxCache();
    process.env.NODE_ENV = "production";

    // First request warms the cache entry (sandbox=true from DB).
    const res1 = await fetch(`${restartBaseUrl}/api/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${signToken(SANDBOX_USER_ID)}` },
    });
    expect(res1.status).toBe(401);

    // Second request hits the now-warm cache entry; must still be 401.
    const res2 = await fetch(`${restartBaseUrl}/api/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${signToken(SANDBOX_USER_ID)}` },
    });
    expect(res2.status).toBe(401);
    const body2 = (await res2.json()) as { error: string };
    expect(body2.error).toBe("Unauthorized");
  });
});

// ---------------------------------------------------------------------------
// Promoted-production-DB scenario
//
// A dev environment called seedSandboxUser() to create the well-known "test"
// account. The database was then promoted to production without cleaning up
// that row. This describe block confirms that:
//   1. The sandbox gate fires in production even though the row was seeded via
//      the normal server-boot path (not a hand-crafted test fixture).
//   2. Once the orphaned row is deleted and the in-process TTL cache is
//      evicted, isSandboxUser() immediately returns false — proving the gate
//      is driven by the live DB, not by a one-time boot check.
// ---------------------------------------------------------------------------
describe("promoted-DB scenario: stale sandbox row from a dev seed", () => {
  // sandboxUsername is assigned in beforeAll from sandboxMod.SANDBOX_USERNAME,
  // so this describe block stays in sync if the constant is ever renamed.

  it("blocks a token for the seeded sandbox account when NODE_ENV is 'production'", async () => {
    // Simulate: a dev server called seedSandboxUser() on boot, creating the
    // well-known "test" account with sandbox=true. The database was then
    // promoted to production without cleaning up that row.
    await seedSandboxUser();

    // Retrieve the DB-assigned id so we can mint a token without going through
    // the sign-in flow (matching the threat model: attacker replays a dev-env
    // token against the promoted instance).
    const [seededRow] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, sandboxUsername))
      .limit(1);
    expect(seededRow).toBeDefined();
    const seededUserId = seededRow.id;

    process.env.NODE_ENV = "production";
    clearSandboxCache();

    // The token was minted in the dev environment and is now replayed against
    // the promoted production instance. requireAuth must reject it.
    const res = await authedRequest(seededUserId, "GET", "/api/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("isSandboxUser returns false after the promoted sandbox row is deleted and cache is evicted", async () => {
    // Seed the row (same as above — represents the promoted-DB state).
    await seedSandboxUser();

    const [seededRow] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, sandboxUsername))
      .limit(1);
    expect(seededRow).toBeDefined();
    const seededUserId = seededRow.id;

    // Confirm the gate sees the row as sandbox while it still exists.
    clearSandboxCache();
    const beforeDelete = await isSandboxUser(seededUserId);
    expect(beforeDelete).toBe(true);

    // A production operator deletes the orphaned sandbox row (or it is cleaned
    // up by a post-promotion migration). After deletion the gate must stop
    // blocking requests for this userId.
    //
    // The userRoles FK cascades on delete, so we only need to remove the user.
    await db.delete(usersTable).where(eq(usersTable.username, sandboxUsername));

    // Evict the TTL cache to force a fresh DB query — this is what happens in
    // a long-running server once the 15-second TTL window expires.
    clearSandboxCache();

    // After the row is gone the DB query returns null, which isSandboxUser
    // maps to sandbox=false. The userId is no longer treated as sandbox-flagged.
    const afterDelete = await isSandboxUser(seededUserId);
    expect(afterDelete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-environment token replay: wrong signing secret
//
// A token minted in a dev environment (with its own AUTH_TOKEN_SECRET) is
// replayed against a production instance that uses a DIFFERENT secret. This
// describe block confirms that:
//   1. verifyToken() itself returns null for the bogus-signed token, so the
//      rejection happens at the signature-verification layer — not at the
//      sandbox gate.
//   2. isSandboxUser is never called: the requireAuth early-return at the
//      verifyToken check fires before the sandbox check is ever reached.
//
// Knowing the rejection layer matters for future refactors: if verifyToken
// were accidentally short-circuited, a cross-environment token could silently
// reach isSandboxUser. The spy counter makes that regression visible.
// ---------------------------------------------------------------------------
describe("cross-environment token replay: verifyToken rejects before sandbox gate", () => {
  // Helper: build a token whose payload is valid (correct userId, non-expired)
  // but whose HMAC signature was computed with a completely different secret.
  // This simulates a dev-environment token presented to a prod instance that
  // was configured with a different AUTH_TOKEN_SECRET.
  function mintBogusToken(userId: string): string {
    const bogusSecret = "completely-different-secret-not-used-in-prod";
    const now = Math.floor(Date.now() / 1000);
    const payloadRaw = JSON.stringify({
      sub: userId,
      iat: now,
      exp: now + 60 * 60 * 24 * 30,
    });
    const payloadB64 = Buffer.from(payloadRaw)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const sig = createHmac("sha256", bogusSecret)
      .update(payloadB64)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `${payloadB64}.${sig}`;
  }

  it("verifyToken returns null for a token signed with a different secret", () => {
    // Direct unit assertion: proves the rejection layer is the signature check,
    // not the sandbox gate. A future refactor that accidentally skips verifyToken
    // would break this test before any protected route could be reached.
    const bogusToken = mintBogusToken(SANDBOX_USER_ID);
    expect(verifyToken(bogusToken)).toBeNull();
  });

  it("requireAuth returns 401 and isSandboxUser is never called for a cross-env token", async () => {
    const bogusToken = mintBogusToken(SANDBOX_USER_ID);

    // Spy on the sandbox module to count isSandboxUser invocations.
    // vitest rewires ESM live bindings on the module namespace, so calls from
    // requireAuth (which imports isSandboxUser from the same module) are
    // intercepted. A call count of 0 after the request proves requireAuth
    // short-circuited at verifyToken before reaching the sandbox check.
    let isSandboxUserCallCount = 0;
    const origIsSandboxUser = isSandboxUser; // captured reference from beforeAll
    const spy = vi
      .spyOn(sandboxMod, "isSandboxUser")
      .mockImplementation(async (userId: string) => {
        isSandboxUserCallCount++;
        return origIsSandboxUser(userId);
      });

    try {
      process.env.NODE_ENV = "production";
      clearSandboxCache();

      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${bogusToken}` },
      });

      // The request must be rejected.
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");

      // The sandbox gate must never have been consulted: verifyToken returned
      // null first, which triggers the early return in requireAuth before
      // isSandboxUser (at line 99 of requireAuth.ts) is ever reached.
      expect(isSandboxUserCallCount).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("spy counter reaches exactly 1 for a valid sandbox token — proving spy interception works (counter-proof)", async () => {
    // This test is a counter-proof for the two zero-count assertions above.
    //
    // If the vi.spyOn() call silently stopped intercepting isSandboxUser
    // (e.g. because the module system changed from ESM live-bindings to CJS
    // copies, or vitest config changed), every spy-based test in this file
    // would pass vacuously: the real function would still run, the request
    // would still 401, but the call count would read 0 even on a valid token
    // — making the zero-count assertions in the bogus-token tests meaningless.
    //
    // By sending a correctly-signed sandbox token (one that passes verifyToken)
    // and asserting the spy count is EXACTLY 1, we guarantee that the spy is
    // genuinely intercepting calls that originate from within requireAuth.
    // Any spy wiring regression will flip this assertion from 1 to 0 and
    // immediately surface the broken setup.
    let isSandboxUserCallCount = 0;
    const origIsSandboxUser = isSandboxUser;
    const spy = vi
      .spyOn(sandboxMod, "isSandboxUser")
      .mockImplementation(async (userId: string) => {
        isSandboxUserCallCount++;
        return origIsSandboxUser(userId);
      });

    try {
      process.env.NODE_ENV = "production";
      clearSandboxCache();

      // A correctly-signed token for the sandbox user. verifyToken will accept
      // it, so requireAuth proceeds past the signature check and MUST call
      // isSandboxUser before deciding to block the request.
      const validSandboxToken = signToken(SANDBOX_USER_ID);
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${validSandboxToken}` },
      });

      // The sandbox gate must still block the request in production.
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");

      // The spy must have been called exactly once — the sandbox check that
      // runs after verifyToken succeeds in requireAuth. Exactly 1 confirms
      // both that the spy is wired (not 0) and that there's no double-call
      // regression (not 2+).
      expect(isSandboxUserCallCount).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("a cross-env token for a non-sandbox userId is also rejected at verifyToken, not the sandbox gate", async () => {
    // Confirm the ordering holds for regular users too: a token signed with
    // the wrong secret is always rejected at verifyToken regardless of whether
    // the userId maps to a sandbox or live account.
    const bogusToken = mintBogusToken(REGULAR_USER_ID);

    let isSandboxUserCallCount = 0;
    const origIsSandboxUser = isSandboxUser;
    const spy = vi
      .spyOn(sandboxMod, "isSandboxUser")
      .mockImplementation(async (userId: string) => {
        isSandboxUserCallCount++;
        return origIsSandboxUser(userId);
      });

    try {
      process.env.NODE_ENV = "production";
      clearSandboxCache();

      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${bogusToken}` },
      });

      expect(res.status).toBe(401);
      expect(isSandboxUserCallCount).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Spy-wiring guard: isSandboxUser export must remain a callable function
//
// vi.spyOn(sandboxMod, "isSandboxUser") targets the export by string key. If
// isSandboxUser is renamed in sandbox.ts the spyOn silently targets a missing
// key, the spy never fires, and all call-count assertions in the
// cross-environment-replay tests pass vacuously (0 === 0 is always true).
//
// The compile-time type assertion above this file's module-level declarations
// (type _AssertIsSandboxUserExported) catches the rename at typecheck time.
// This runtime test is the belt-and-suspenders second layer: it runs after
// beforeAll populates sandboxMod, so any gap between the static type and the
// actual runtime binding is also caught with a clear failure message.
// ---------------------------------------------------------------------------
describe("spy-wiring guard: isSandboxUser export must remain a callable function", () => {
  it("sandboxMod.isSandboxUser is a function — a rename in sandbox.ts would break vi.spyOn wiring", () => {
    // If isSandboxUser is renamed, typeof sandboxMod.isSandboxUser is
    // "undefined", this assertion fails immediately with a clear message, and
    // the call-count tests in the cross-environment suite become obviously
    // broken rather than silently passing with vacuous zero counts.
    expect(typeof sandboxMod.isSandboxUser).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Spy-wiring guard: getUserById export must remain a callable function
//
// vi.spyOn(usersMod, "getUserById") targets the export by string key. If
// getUserById is renamed in users.ts the spyOn silently targets a missing
// key, the spy never fires, and all call-count assertions in the
// DB-query-call-count tests pass vacuously (0 === 0 / 2 === 2 by coincidence).
//
// The compile-time type assertion above (type _AssertGetUserByIdExported)
// catches the rename at typecheck time. This runtime test is the
// belt-and-suspenders second layer: it runs after beforeAll populates
// usersMod, so any gap between the static type and the actual runtime
// binding is also caught with a clear failure message.
// ---------------------------------------------------------------------------
describe("spy-wiring guard: getUserById export must remain a callable function", () => {
  it("usersMod.getUserById is a function — a rename in users.ts would break vi.spyOn wiring", () => {
    // If getUserById is renamed, typeof usersMod.getUserById is "undefined",
    // this assertion fails immediately with a clear message, and the
    // call-count tests in the DB-query suite become obviously broken rather
    // than silently passing with vacuous counts.
    expect(typeof usersMod.getUserById).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// DB-query call-count guard: cold-cache path must hit the DB exactly once
//
// The existing cold-start tests confirm that the *outcome* of a cold-cache
// request is correct (401 for sandbox, 200 for live). However, they cannot
// distinguish "DB was queried and returned true" from "cache was pre-seeded
// with sandbox=true from a hard-coded default". A future initialisation that
// sets the cache entry to sandbox=false before the first request would make
// every cold-cache test pass (default=false → no gate fired → same 401-path
// reasoning is moot) while silently skipping the DB entirely.
//
// These tests spy on getUserById — the function isSandboxUser() calls when
// the cache is empty — and assert the exact call count. A regression that
// pre-seeds the cache (or short-circuits via a default) would produce a call
// count of 0, which fails immediately and visibly.
// ---------------------------------------------------------------------------
describe("DB is actually queried on cold cache — guards against default-value bypass", () => {
  // Both requireAuth paths (userValidity + sandbox gate) call getUserById when
  // their respective in-process caches are cold. On the first request of each
  // test case BOTH caches are cold (beforeEach clears them), so the total
  // getUserById call count per cold-cache request is 2:
  //   1. getUserSecurityState() in userValidity.ts (checks user still exists)
  //   2. isSandboxUser() in sandbox.ts (checks the sandbox flag)
  //
  // If a future change pre-seeds the sandbox cache with a default value
  // (bypassing the DB read for the sandbox flag), the count drops to 1 — only
  // userValidity's call remains. The exact-count assertions below catch that
  // regression even when the HTTP outcome (401/200) happens to look correct.

  it("getUserById is called exactly twice on the first cold-cache request for a sandbox user (one from each requireAuth path)", async () => {
    clearSandboxCache();
    process.env.NODE_ENV = "production";

    let getUserByIdCallCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi
      .spyOn(usersMod, "getUserById")
      .mockImplementation(async (id: string) => {
        getUserByIdCallCount++;
        return origGetUserById(id);
      });

    try {
      const res = await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
      expect(res.status).toBe(401);
      // Both the userValidity check and the sandbox gate must have hit the DB:
      // count === 2 proves both cold-cache paths ran. If the sandbox cache were
      // pre-seeded with a default, sandbox.ts would skip its DB call and the
      // count would drop to 1 — the regression is caught here.
      expect(getUserByIdCallCount).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("getUserById is called exactly twice on the first cold-cache request for a non-sandbox user", async () => {
    clearSandboxCache();
    process.env.NODE_ENV = "production";

    let getUserByIdCallCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi
      .spyOn(usersMod, "getUserById")
      .mockImplementation(async (id: string) => {
        getUserByIdCallCount++;
        return origGetUserById(id);
      });

    try {
      const res = await authedRequest(REGULAR_USER_ID, "GET", "/api/me");
      expect(res.status).toBe(200);
      // Same two-path guarantee for a non-sandbox user. A default of false
      // would still let the request through (200), masking that the sandbox
      // gate never consulted the DB — the count drops to 1 and this fails.
      expect(getUserByIdCallCount).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("getUserById is NOT called again on a second request within the TTL window (both caches hit)", async () => {
    clearSandboxCache();
    process.env.NODE_ENV = "production";

    let getUserByIdCallCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi
      .spyOn(usersMod, "getUserById")
      .mockImplementation(async (id: string) => {
        getUserByIdCallCount++;
        return origGetUserById(id);
      });

    try {
      // First request: both caches cold → 2 DB calls.
      await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
      expect(getUserByIdCallCount).toBe(2);

      // Second request within the TTL window: both caches are still valid,
      // so neither path touches the DB — count stays at 2.
      await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
      expect(getUserByIdCallCount).toBe(2); // count unchanged — both caches hit
    } finally {
      spy.mockRestore();
    }
  });

  it("getUserById is called once more after sandbox cache eviction (only the sandbox path re-queries)", async () => {
    clearSandboxCache();
    process.env.NODE_ENV = "production";

    let getUserByIdCallCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi
      .spyOn(usersMod, "getUserById")
      .mockImplementation(async (id: string) => {
        getUserByIdCallCount++;
        return origGetUserById(id);
      });

    try {
      // First cold-cache request: 2 DB calls (userValidity + sandbox).
      await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
      expect(getUserByIdCallCount).toBe(2);

      // Evict only the sandbox cache (simulating TTL expiry for that entry).
      // userValidity's cache entry remains warm.
      clearSandboxCache();

      // Post-eviction request: userValidity hits its cache (no call), but
      // sandbox.ts must re-query the DB because its cache was evicted → +1.
      await authedRequest(SANDBOX_USER_ID, "GET", "/api/me");
      expect(getUserByIdCallCount).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });
});
