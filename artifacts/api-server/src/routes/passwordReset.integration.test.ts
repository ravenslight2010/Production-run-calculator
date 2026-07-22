// Integration tests for the manager-approved password reset flow.
//
// Recovery is manager-mediated (there is no email/SMS channel): a signed-out
// user requests a reset, a manager approves it to mint a short-lived single-use
// relay code, and the user completes the reset with that code. These tests guard
// the security-sensitive parts:
//   - enumeration safety: forgot-password always responds 200 whether or not the
//     account exists, and only creates a request when it does;
//   - one-time codes: a code works exactly once, then is rejected on replay;
//   - expiry: an expired code is rejected;
//   - wrong codes: a bad code is rejected;
//   - normalization: the code is accepted in any case and with/without the dash;
//   - manager-only gating on the list/approve/decline endpoints.
//
// They stand up the *real* router against a *disposable* Postgres database
// (created from the dev DATABASE_URL's server, schema pushed via drizzle-kit,
// dropped on teardown) so nothing here ever touches real data. Auth is the
// self-contained username + password system: each request carries a real
// HMAC-signed session token in the Authorization header.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so we
// must create the throwaway DB and point DATABASE_URL at it BEFORE importing the
// router — hence the dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import {
  hashPassword,
  hashResetCode,
  newResetCode,
  newUserId,
  signToken,
  verifyPassword,
} from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let passwordResetRequestsTable: DbModule["passwordResetRequestsTable"];

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

  // Create a uniquely named throwaway database on the same Postgres server.
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_pwreset_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();

  // Build the real schema in the throwaway DB via drizzle-kit (no hand-written
  // DDL to drift out of sync with lib/db/src/schema).
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  // Point the app's db at the throwaway DB, THEN load the modules so the
  // singleton pool binds to it.
  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const userValidityMod = await import("../lib/userValidity");
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  db = dbMod.db;
  pool = dbMod.pool;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  passwordResetRequestsTable = dbMod.passwordResetRequestsTable;

  // Minimal app: the real router, behind a no-op req.log so handlers that log
  // don't crash without pino-http. Mounted at /api to match production paths.
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // fetch (undici) holds keep-alive sockets open, so server.close() would
      // otherwise block until they idle out (~seconds) and can exceed the hook
      // timeout. Force the lingering connections shut so close() resolves now.
      server.closeAllConnections?.();
    });
  }
  // Close the app pool so the database has no open connections, then drop it.
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

// A narrowly-scoped role holding ONLY approve-password-resets (mirrors a
// real "help desk" style role a manager might create), used to prove an
// approver can never leverage a reset to reach a peer's higher privileges.
const APPROVER_ROLE = "reset-approver";
const APPROVER = "approver-1";

beforeEach(async () => {
  // The user-existence cache is module-level and outlives a single test.
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${passwordResetRequestsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  // Seed the role catalog so requireCapability can resolve each user's role to a
  // capability set (a manager with no seeded roles would resolve to zero caps).
  await seedRoles();
  await db
    .insert(rolesTable)
    .values({ name: APPROVER_ROLE, capabilities: ["approve-password-resets"], builtin: false });
  // A manager (issues codes), an operator (forgets their password), and a
  // narrowly-scoped approver used by the privilege-boundary tests below.
  // Seeding rows directly bypasses the first-user bootstrap so each test
  // starts from a known roster.
  await db.insert(usersTable).values([
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: OPERATOR, username: "operator", passwordHash: "x" },
    { id: APPROVER, username: "approver", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
    { userId: APPROVER, role: APPROVER_ROLE },
  ]);
});

// Issue a request as the given user (or signed out when userId is null). A real
// signed session token is attached as a bearer header for signed-in callers.
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

// Count the operator's reset requests, optionally filtered by status.
async function countRequests(userId: string, status?: string): Promise<number> {
  const where = status
    ? and(
        eq(passwordResetRequestsTable.userId, userId),
        eq(passwordResetRequestsTable.status, status),
      )
    : eq(passwordResetRequestsTable.userId, userId);
  const rows = await db.select().from(passwordResetRequestsTable).where(where);
  return rows.length;
}

// Insert an approved, unused request for the operator with a known code. Lets
// the reset-completion tests run without going through approve, and lets the
// expiry test backdate the code's expiry directly.
async function seedApprovedRequest(code: string, expiresAt: Date): Promise<string> {
  const id = newUserId();
  await db.insert(passwordResetRequestsTable).values({
    id,
    userId: OPERATOR,
    status: "approved",
    codeHash: hashResetCode(code),
    codeExpiresAt: expiresAt,
    approvedAt: new Date(),
  });
  return id;
}

const FUTURE = () => new Date(Date.now() + 30 * 60 * 1000);
const PAST = () => new Date(Date.now() - 1000);

describe("forgot-password is enumeration-safe", () => {
  it("returns 200 { ok: true } for an existing account and records a request", async () => {
    const res = await req(null, "POST", "/api/auth/forgot-password", { username: "operator" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await countRequests(OPERATOR, "pending")).toBe(1);
  });

  it("returns the same 200 { ok: true } for an unknown account but records nothing", async () => {
    const res = await req(null, "POST", "/api/auth/forgot-password", { username: "ghost" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // No row exists for a user that doesn't exist.
    const all = await db.select().from(passwordResetRequestsTable);
    expect(all.length).toBe(0);
  });

  it("matches the account case-insensitively", async () => {
    const res = await req(null, "POST", "/api/auth/forgot-password", { username: "OPERATOR" });
    expect(res.status).toBe(200);
    expect(await countRequests(OPERATOR, "pending")).toBe(1);
  });

  it("keeps a single active request per user (a new ask replaces the old)", async () => {
    await req(null, "POST", "/api/auth/forgot-password", { username: "operator" });
    await req(null, "POST", "/api/auth/forgot-password", { username: "operator" });
    expect(await countRequests(OPERATOR, "pending")).toBe(1);
  });
});

describe("manager approval issues a one-time code", () => {
  it("approves a pending request and returns a code, username and expiry", async () => {
    await req(null, "POST", "/api/auth/forgot-password", { username: "operator" });
    const [pending] = await db
      .select()
      .from(passwordResetRequestsTable)
      .where(eq(passwordResetRequestsTable.userId, OPERATOR));

    const res = await req(MANAGER, "POST", `/api/password-reset-requests/${pending.id}/approve`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; code: string; expiresAt: string };
    expect(body.username).toBe("operator");
    expect(body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());

    // Only the hash is stored — never the plaintext.
    const [row] = await db
      .select()
      .from(passwordResetRequestsTable)
      .where(eq(passwordResetRequestsTable.id, pending.id));
    expect(row.status).toBe("approved");
    expect(row.codeHash).toBe(hashResetCode(body.code));
    expect(row.codeHash).not.toBe(body.code);
  });

  it("returns 404 when approving a non-existent request id", async () => {
    const res = await req(MANAGER, "POST", `/api/password-reset-requests/does-not-exist/approve`);
    expect(res.status).toBe(404);
  });

  it("lists pending requests for the manager, excluding declined/approved ones", async () => {
    await req(null, "POST", "/api/auth/forgot-password", { username: "operator" });
    const res = await req(MANAGER, "GET", "/api/password-reset-requests");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ userId: string; username: string }>;
    expect(list.length).toBe(1);
    expect(list[0].userId).toBe(OPERATOR);
    expect(list[0].username).toBe("operator");
  });

  it("declines a pending request without issuing a code, dropping it off the list", async () => {
    await req(null, "POST", "/api/auth/forgot-password", { username: "operator" });
    const [pending] = await db
      .select()
      .from(passwordResetRequestsTable)
      .where(eq(passwordResetRequestsTable.userId, OPERATOR));

    const res = await req(MANAGER, "POST", `/api/password-reset-requests/${pending.id}/decline`);
    expect(res.status).toBe(204);

    const [row] = await db
      .select()
      .from(passwordResetRequestsTable)
      .where(eq(passwordResetRequestsTable.id, pending.id));
    expect(row.status).toBe("declined");
    expect(row.codeHash).toBeNull();

    const list = (await req(MANAGER, "GET", "/api/password-reset-requests").then((r) => r.json())) as unknown[];
    expect(list.length).toBe(0);
  });
});

describe("completing a reset with a code", () => {
  it("succeeds with a valid code and lets the user sign in with the new password", async () => {
    const code = newResetCode();
    await seedApprovedRequest(code, FUTURE());

    const res = await req(null, "POST", "/api/auth/reset-password", {
      username: "operator",
      code,
      newPassword: "brand-new-secret",
    });
    expect(res.status).toBe(204);

    // The new password verifies against the stored hash; the request is spent.
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, OPERATOR));
    expect(verifyPassword("brand-new-secret", user.passwordHash)).toBe(true);
    expect(await countRequests(OPERATOR, "used")).toBe(1);
  });

  it("accepts the code in any case and without the dash (normalization)", async () => {
    const code = newResetCode();
    await seedApprovedRequest(code, FUTURE());

    const messy = code.replace("-", "").toLowerCase();
    const res = await req(null, "POST", "/api/auth/reset-password", {
      username: "operator",
      code: messy,
      newPassword: "brand-new-secret",
    });
    expect(res.status).toBe(204);
  });

  it("rejects a wrong code with 401 and leaves the password unchanged", async () => {
    await seedApprovedRequest(newResetCode(), FUTURE());

    const res = await req(null, "POST", "/api/auth/reset-password", {
      username: "operator",
      code: "WRNG-CODE",
      newPassword: "brand-new-secret",
    });
    expect(res.status).toBe(401);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, OPERATOR));
    expect(user.passwordHash).toBe("x");
    expect(await countRequests(OPERATOR, "approved")).toBe(1);
  });

  it("rejects an expired code with 401", async () => {
    const code = newResetCode();
    await seedApprovedRequest(code, PAST());

    const res = await req(null, "POST", "/api/auth/reset-password", {
      username: "operator",
      code,
      newPassword: "brand-new-secret",
    });
    expect(res.status).toBe(401);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, OPERATOR));
    expect(user.passwordHash).toBe("x");
  });

  it("rejects a reused (already-used) code with 401 — single use", async () => {
    const code = newResetCode();
    await seedApprovedRequest(code, FUTURE());

    const first = await req(null, "POST", "/api/auth/reset-password", {
      username: "operator",
      code,
      newPassword: "first-secret",
    });
    expect(first.status).toBe(204);

    const second = await req(null, "POST", "/api/auth/reset-password", {
      username: "operator",
      code,
      newPassword: "second-secret",
    });
    expect(second.status).toBe(401);

    // The password from the first (only valid) reset stands.
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, OPERATOR));
    expect(verifyPassword("first-secret", user.passwordHash)).toBe(true);
    expect(verifyPassword("second-secret", user.passwordHash)).toBe(false);
  });

  it("rejects a code for an unknown username with 401", async () => {
    const code = newResetCode();
    await seedApprovedRequest(code, FUTURE());

    const res = await req(null, "POST", "/api/auth/reset-password", {
      username: "ghost",
      code,
      newPassword: "brand-new-secret",
    });
    expect(res.status).toBe(401);
  });
});

describe("manager-only gating on reset administration", () => {
  type GatedRoute = { name: string; method: string; path: string };
  const ROUTES: GatedRoute[] = [
    { name: "GET /password-reset-requests", method: "GET", path: "/api/password-reset-requests" },
    {
      name: "POST /password-reset-requests/:id/approve",
      method: "POST",
      path: "/api/password-reset-requests/some-id/approve",
    },
    {
      name: "POST /password-reset-requests/:id/decline",
      method: "POST",
      path: "/api/password-reset-requests/some-id/decline",
    },
  ];

  for (const route of ROUTES) {
    it(`rejects ${route.name} signed out with 401`, async () => {
      const res = await req(null, route.method, route.path);
      expect(res.status).toBe(401);
    });

    it(`forbids ${route.name} for an operator with 403`, async () => {
      const res = await req(OPERATOR, route.method, route.path);
      expect(res.status).toBe(403);
    });
  }

  it("allows the manager to list pending requests (200)", async () => {
    const res = await req(MANAGER, "GET", "/api/password-reset-requests");
    expect(res.status).toBe(200);
  });
});

describe("an approver can never use a reset to reach a higher-privileged account", () => {
  // A narrowly-scoped approver (only approve-password-resets) must not be able
  // to approve, decline, or even see a pending reset for a manager — doing so
  // would let them mint a code that fully hands over the manager's account,
  // which is strictly more powerful than the approver's own role.
  it("excludes a manager's pending request from the approver's list", async () => {
    await req(null, "POST", "/api/auth/forgot-password", { username: "manager" });
    const res = await req(APPROVER, "GET", "/api/password-reset-requests");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ userId: string }>;
    expect(list.find((r) => r.userId === MANAGER)).toBeUndefined();
  });

  it("still includes an operator's pending request (peer/lesser privilege) in the approver's list", async () => {
    await req(null, "POST", "/api/auth/forgot-password", { username: "operator" });
    const res = await req(APPROVER, "GET", "/api/password-reset-requests");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ userId: string }>;
    expect(list.find((r) => r.userId === OPERATOR)).toBeDefined();
  });

  it("rejects the approver both approving and declining a manager's reset with 403 and issues no code", async () => {
    // Seeded directly (not via forgot-password) to keep this file's shared
    // authRateLimit budget headroom for the other tests below.
    const pendingId = newUserId();
    await db.insert(passwordResetRequestsTable).values({
      id: pendingId,
      userId: MANAGER,
      status: "pending",
    });

    const approveRes = await req(
      APPROVER,
      "POST",
      `/api/password-reset-requests/${pendingId}/approve`,
    );
    expect(approveRes.status).toBe(403);

    const [afterApprove] = await db
      .select()
      .from(passwordResetRequestsTable)
      .where(eq(passwordResetRequestsTable.id, pendingId));
    expect(afterApprove.status).toBe("pending");
    expect(afterApprove.codeHash).toBeNull();

    const declineRes = await req(
      APPROVER,
      "POST",
      `/api/password-reset-requests/${pendingId}/decline`,
    );
    expect(declineRes.status).toBe(403);

    const [afterDecline] = await db
      .select()
      .from(passwordResetRequestsTable)
      .where(eq(passwordResetRequestsTable.id, pendingId));
    expect(afterDecline.status).toBe("pending");
  });

  it("still allows the approver to approve an operator's (peer) reset", async () => {
    const pendingId = newUserId();
    await db.insert(passwordResetRequestsTable).values({
      id: pendingId,
      userId: OPERATOR,
      status: "pending",
    });

    const res = await req(APPROVER, "POST", `/api/password-reset-requests/${pendingId}/approve`);
    expect(res.status).toBe(200);
  });
});

describe("password changes and resets invalidate existing sessions", () => {
  // Any path that replaces a password must fence off tokens minted before the
  // change — otherwise a stolen token keeps working forever, defeating the
  // point of changing the password.
  it("self-service change-password revokes the old token but returns a fresh working one", async () => {
    await db
      .update(usersTable)
      .set({ passwordHash: hashPassword("old-password") })
      .where(eq(usersTable.id, OPERATOR));
    const oldToken = signToken(OPERATOR);

    // Confirm the old token works before the change.
    const before = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(before.status).toBe(200);

    // The revocation fence compares whole-second `iat` against the change
    // timestamp with a deliberate +1s grace (see requireAuth), so a token
    // minted in the very same wall-clock second as the change is tolerated —
    // wait past that second so this test exercises the realistic "old,
    // already-in-use session" case rather than that same-second edge.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { authorization: `Bearer ${oldToken}`, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }),
    });
    expect(changeRes.status).toBe(200);
    const body = (await changeRes.json()) as { token: string };
    expect(typeof body.token).toBe("string");
    expect(body.token).not.toBe(oldToken);

    // The pre-change token is now rejected...
    const afterOld = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(afterOld.status).toBe(401);

    // ...but the freshly issued token works.
    const afterNew = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(afterNew.status).toBe(200);
  });

  it("a manager-issued password reset (PUT /users/:id/password) revokes the target's existing session", async () => {
    const oldToken = signToken(OPERATOR);
    const before = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(before.status).toBe(200);

    // See the same-second grace note above.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const resetRes = await req(MANAGER, "PUT", `/api/users/${OPERATOR}/password`, {
      newPassword: "manager-set-password",
    });
    expect(resetRes.status).toBe(204);

    const after = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(after.status).toBe(401);
  });

  it("completing a self-serve reset with a code revokes the account's existing session", async () => {
    const code = newResetCode();
    await seedApprovedRequest(code, FUTURE());
    const oldToken = signToken(OPERATOR);
    const before = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(before.status).toBe(200);

    // See the same-second grace note above.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await req(null, "POST", "/api/auth/reset-password", {
      username: "operator",
      code,
      newPassword: "brand-new-secret",
    });
    expect(res.status).toBe(204);

    const after = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(after.status).toBe(401);
  });
});
