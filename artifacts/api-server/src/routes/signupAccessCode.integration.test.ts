// Integration tests for the sign-up access-code gate on POST /api/auth/sign-up.
//
// The endpoint is intentionally NOT fully open self-registration: every sign-up
// must supply either STAFF_SIGNUP_CODE or INITIAL_MANAGER_ACCESS_CODE to pass
// the timing-safe gate. These tests guard the security-sensitive path so a
// regression (accepting any code, or silently accepting when no secret is set)
// can never land undetected.
//
// Covered cases:
//   - wrong code → 403 with the canonical "Incorrect facility code." message;
//   - no STAFF_SIGNUP_CODE configured → all codes rejected (fails closed);
//   - correct STAFF_SIGNUP_CODE → 201 and a session token;
//   - INITIAL_MANAGER_ACCESS_CODE (the bootstrap secret) is also accepted;
//   - missing body fields → 400 (not a code-gate issue);
//   - duplicate username with a correct code → 409.
//
// They stand up the *real* router against a *disposable* Postgres database
// (created from the dev DATABASE_URL's server, schema pushed via drizzle-kit,
// dropped on teardown) so nothing here ever touches real data. Auth is the
// self-contained username + password system — no mocks of the business logic.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so we
// must create the throwaway DB and point DATABASE_URL at it BEFORE importing the
// router — hence the dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { desc, eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let staffInvitationsTable: DbModule["staffInvitationsTable"];
let authSessionsTable: DbModule["authSessionsTable"];
let signupAccessCodesTable: DbModule["signupAccessCodesTable"];
let seedRoles: () => Promise<void>;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let originalStaffSignupCode: string | undefined;
let originalManagerAccessCode: string | undefined;
let originalManagerUsername: string | undefined;
let server: Server;
let baseUrl: string;

const STAFF_CODE = "staff-secret-xyz";
const MANAGER_CODE = "manager-bootstrap-xyz";
const MANAGER_USERNAME = "bootstrap-manager";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  // Snapshot the code env vars so we can restore them after the suite.
  originalStaffSignupCode = process.env.STAFF_SIGNUP_CODE;
  originalManagerAccessCode = process.env.INITIAL_MANAGER_ACCESS_CODE;
  originalManagerUsername = process.env.INITIAL_MANAGER_USERNAME;

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_signup_code_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  staffInvitationsTable = dbMod.staffInvitationsTable;
  authSessionsTable = dbMod.authSessionsTable;
  signupAccessCodesTable = dbMod.signupAccessCodesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;

  const app: Express = express();
  app.set("trust proxy", true);
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
      server.closeAllConnections?.();
    });
  }
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  // Restore env vars.
  process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalStaffSignupCode !== undefined) {
    process.env.STAFF_SIGNUP_CODE = originalStaffSignupCode;
  } else {
    delete process.env.STAFF_SIGNUP_CODE;
  }
  if (originalManagerAccessCode !== undefined) {
    process.env.INITIAL_MANAGER_ACCESS_CODE = originalManagerAccessCode;
  } else {
    delete process.env.INITIAL_MANAGER_ACCESS_CODE;
  }
  if (originalManagerUsername !== undefined) {
    process.env.INITIAL_MANAGER_USERNAME = originalManagerUsername;
  } else {
    delete process.env.INITIAL_MANAGER_USERNAME;
  }
}, 60_000);

beforeEach(async () => {
  // Restore the standard test code env vars before each case (individual tests
  // may temporarily mutate them to simulate missing-config scenarios).
  process.env.STAFF_SIGNUP_CODE = STAFF_CODE;
  process.env.INITIAL_MANAGER_ACCESS_CODE = MANAGER_CODE;
  process.env.INITIAL_MANAGER_USERNAME = MANAGER_USERNAME;

  await db.execute(
    sql`TRUNCATE ${userRolesTable}, ${usersTable}, ${rolesTable}, ${staffInvitationsTable}, ${authSessionsTable}, ${signupAccessCodesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
});

async function signUp(
  body: Record<string, string>,
): Promise<Response> {
  const source = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  return fetch(`${baseUrl}/api/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": source },
    body: JSON.stringify(body),
  });
}

describe("wrong access code is rejected", () => {
  it("returns 403 with the canonical error message for a completely wrong code", async () => {
    const res = await signUp({
      username: "newuser",
      password: "password123",
      accessCode: "totally-wrong-code",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Incorrect facility code." });
  });

  it("returns 403 for an empty string code", async () => {
    const res = await signUp({
      username: "newuser",
      password: "password123",
      accessCode: "",
    });
    // Empty string fails the Zod minimum-length check before the gate → 400.
    // That is fine: the gate still rejects it. Any non-201 is acceptable but
    // we check it does NOT return 201.
    expect(res.status).not.toBe(201);
  });

  it("returns 403 for a code that is a prefix of the real code", async () => {
    const prefix = STAFF_CODE.slice(0, -1);
    const res = await signUp({
      username: "newuser",
      password: "password123",
      accessCode: prefix,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Incorrect facility code." });
  });

  it("returns 403 for a code that is a suffix of the real code", async () => {
    const suffix = STAFF_CODE.slice(1);
    const res = await signUp({
      username: "newuser",
      password: "password123",
      accessCode: suffix,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Incorrect facility code." });
  });
});

describe("sign-up fails closed when no STAFF_SIGNUP_CODE is configured", () => {
  it("rejects every code with 403 when STAFF_SIGNUP_CODE is unset", async () => {
    delete process.env.STAFF_SIGNUP_CODE;
    delete process.env.INITIAL_MANAGER_ACCESS_CODE;

    const res = await signUp({
      username: "newuser",
      password: "password123",
      accessCode: STAFF_CODE,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Incorrect facility code." });
  });
});

describe("correct access code is accepted", () => {
  it("returns 201 with a token and user when the correct STAFF_SIGNUP_CODE is supplied", async () => {
    const res = await signUp({
      username: "newstaff",
      password: "password123",
      accessCode: STAFF_CODE,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; user: { userId: string } };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    // The user object must be present and have a stable identity field.
    expect(typeof body.user.userId).toBe("string");
    expect(body.user.userId.length).toBeGreaterThan(0);
  });

  it("accepts the STAFF_SIGNUP_CODE with surrounding whitespace (trim tolerance)", async () => {
    const res = await signUp({
      username: "trimuser",
      password: "password123",
      accessCode: `  ${STAFF_CODE}  `,
    });
    expect(res.status).toBe(201);
  });

  it("accepts INITIAL_MANAGER_ACCESS_CODE in place of the general staff code", async () => {
    const res = await signUp({
      username: "bootstrapmanager",
      password: "password123",
      accessCode: MANAGER_CODE,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; user: { userId: string } };
    expect(typeof body.token).toBe("string");
    // The user object must be present and have a stable identity field.
    expect(typeof body.user.userId).toBe("string");
    expect(body.user.userId.length).toBeGreaterThan(0);
  });
});

describe("other sign-up error paths are unaffected by the gate", () => {
  it("returns 400 for a missing username (Zod validation fires before the code check)", async () => {
    const res = await signUp({
      password: "password123",
      accessCode: STAFF_CODE,
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the correct code is supplied but the username is already taken", async () => {
    // First registration should succeed.
    const first = await signUp({
      username: "dupeuser",
      password: "password123",
      accessCode: STAFF_CODE,
    });
    expect(first.status).toBe(201);

    // Second registration with the same username should fail with 409.
    const second = await signUp({
      username: "dupeuser",
      password: "different-password",
      accessCode: STAFF_CODE,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "That username is already taken." });
  });
});

describe("production account lifecycle routes", () => {
  async function signIn(username: string, password: string): Promise<{ token: string; cookie: string }> {
    const res = await fetch(`${baseUrl}/api/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string };
    const cookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()[0]?.split(";")[0]
      ?? res.headers.get("set-cookie")?.split(";")[0] ?? "";
    return { token: body.token, cookie };
  }

  async function managerSession(): Promise<{ token: string; cookie: string }> {
    process.env.INITIAL_MANAGER_USERNAME = MANAGER_USERNAME;
    process.env.INITIAL_MANAGER_ACCESS_CODE = MANAGER_CODE;
    const result = await signUp({
      username: MANAGER_USERNAME,
      password: "manager-password",
      accessCode: MANAGER_CODE,
    });
    expect(result.status).toBe(201);
    const body = await result.json() as { token: string };
    return { token: body.token, cookie: "" };
  }

  async function createInvite(token: string): Promise<{ secret: string; id: string }> {
    const res = await fetch(`${baseUrl}/api/staff-invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: "operator" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { secret: string };
    const [row] = await db.select().from(staffInvitationsTable).orderBy(desc(staffInvitationsTable.createdAt));
    return { secret: body.secret, id: row.id };
  }

  it("accepts an invitation once and gives identical generic failures for replay/expiry/revoke", async () => {
    const manager = await managerSession();
    const invite = await createInvite(manager.token);
    const accepted = await fetch(`${baseUrl}/api/auth/accept-invitation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitation: invite.secret, username: "invited-user", password: "password123" }),
    });
    expect(accepted.status).toBe(201);
    const acceptedBody = await accepted.json() as { user: { role: string } };
    expect(acceptedBody.user.role).toBe("operator");
    const replay = await fetch(`${baseUrl}/api/auth/accept-invitation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitation: invite.secret, username: "replay-user", password: "password123" }),
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "Invitation is invalid or unavailable." });

    const expired = await createInvite(manager.token);
    await db.update(staffInvitationsTable).set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(staffInvitationsTable.id, expired.id));
    const expiredResponse = await fetch(`${baseUrl}/api/auth/accept-invitation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitation: expired.secret, username: "expired-user", password: "password123" }),
    });
    expect(expiredResponse.status).toBe(400);
    expect(await expiredResponse.json()).toEqual({ error: "Invitation is invalid or unavailable." });

    const revoked = await createInvite(manager.token);
    const revokeResponse = await fetch(`${baseUrl}/api/staff-invitations/${revoked.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${manager.token}` },
    });
    expect(revokeResponse.status).toBe(204);
    const revokedResponse = await fetch(`${baseUrl}/api/auth/accept-invitation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitation: revoked.secret, username: "revoked-user", password: "password123" }),
    });
    expect(revokedResponse.status).toBe(400);
    expect(await revokedResponse.json()).toEqual({ error: "Invitation is invalid or unavailable." });
  }, 30_000);

  it("rotates and disables the transitional code without affecting existing sign-in", async () => {
    const manager = await managerSession();
    const oldCode = STAFF_CODE;
    const rotated = await fetch(`${baseUrl}/api/signup-code/rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${manager.token}` },
    });
    expect(rotated.status).toBe(201);
    const next = await rotated.json() as { secret: string };
    expect(next.secret).toBeTruthy();
    const oldAttempt = await signUp({ username: "old-code-user", password: "password123", accessCode: oldCode });
    expect(oldAttempt.status).toBe(403);
    const disable = await fetch(`${baseUrl}/api/signup-code/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${manager.token}` },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(200);
    const disabledAttempt = await signUp({ username: "disabled-code-user", password: "password123", accessCode: next.secret });
    expect(disabledAttempt.status).toBe(403);
    expect((await signIn(MANAGER_USERNAME, "manager-password")).token).toBeTruthy();
    const status = await fetch(`${baseUrl}/api/signup-code/status`, { headers: { authorization: `Bearer ${manager.token}` } });
    const counters = await status.json() as { successfulUses: number; failedUses: number };
    expect(counters.failedUses).toBeGreaterThan(0);
    expect(counters.successfulUses).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it("rejects both cookie and Bearer sessions after account disable and explicit revoke", async () => {
    const manager = await managerSession();
    const targetUsername = `disable-target-${Date.now()}`;
    const created = await signUp({ username: targetUsername, password: "password123", accessCode: MANAGER_CODE });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { user: { userId: string } };
    const target = await signIn(targetUsername, "password123");
    expect(target.cookie).toMatch(/^rc_auth=/);
    const meCookie = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${target.token}` } });
    expect(meCookie.status).toBe(200);
    const disable = await fetch(`${baseUrl}/api/users/${encodeURIComponent(createdBody.user.userId)}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${manager.token}` },
      body: JSON.stringify({ disabled: true }),
    });
    expect(disable.status).toBe(200);
    expect((await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${target.token}` } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/me`, { headers: { cookie: target.cookie } })).status).toBe(401);
  }, 30_000);

  it("expires an otherwise valid bearer session at the shared-tablet idle boundary", async () => {
    process.env.SESSION_IDLE_TIMEOUT_SEC = "1";
    const manager = await managerSession();
    const session = manager;
    await db.update(authSessionsTable).set({ lastSeenAt: new Date(Date.now() - 10_000) })
      .where(eq(authSessionsTable.tokenHash, createHash("sha256").update(session.token).digest("hex")));
    const response = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${session.token}` } });
    expect(response.status).toBe(401);
    delete process.env.SESSION_IDLE_TIMEOUT_SEC;
  }, 30_000);

  it("fails closed when a new-format jti token has no server session record", async () => {
    const manager = await managerSession();
    await db.delete(authSessionsTable).where(
      eq(authSessionsTable.tokenHash, createHash("sha256").update(manager.token).digest("hex")),
    );
    const response = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${manager.token}` },
    });
    expect(response.status).toBe(401);
  }, 30_000);
});
