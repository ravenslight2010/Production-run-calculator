// Integration tests for the sandbox sign-in rejection gate on POST /api/auth/sign-in.
//
// The sign-in handler refuses to authenticate a sandbox-flagged user when
// sandboxAllowed() returns false (i.e., NODE_ENV === "production"). This test
// suite guards that path so a regression can never silently re-open the well-known
// sandbox credentials as a backdoor on a real deployment.
//
// Covered cases:
//   - sandbox user + NODE_ENV=production → 401 (same message as bad password);
//   - sandbox user + NODE_ENV=test (non-production) → 200 with token;
//   - regular non-sandbox user with correct credentials → 200 with token;
//   - regular non-sandbox user with wrong password → 401;
//   - unknown username → 401.
//
// Pattern mirrors signupAccessCode.integration.test.ts: a throwaway Postgres DB is
// created from the dev DATABASE_URL server, drizzle pushes the schema, and the real
// router is mounted against it. Nothing here touches real data.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so we
// must create the throwaway DB and point DATABASE_URL at it BEFORE importing the
// router — hence the dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let hashPassword: (pw: string) => string;
let newUserId: () => string;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let originalNodeEnv: string | undefined;
let server: Server;
let baseUrl: string;

// Keep a separate valid-length sandbox user too. It verifies that the
// production gate applies to every sandbox account, not only the public
// development shortcut.
const SANDBOX_GATE_USERNAME = "sandboxflaggeduser";
const SANDBOX_GATE_PASSWORD = "sandboxpw123"; // >= 6 chars, passes Zod
const SANDBOX_SHORTCUT_USERNAME = "test";
const SANDBOX_SHORTCUT_PASSWORD = "test";
const REGULAR_USERNAME = "regularstaff";
const REGULAR_PASSWORD = "securepassword99";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  originalNodeEnv = process.env.NODE_ENV;

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_sandbox_signin_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  seedRoles = (await import("../lib/roles")).seedRoles;
  const authMod = await import("../lib/auth");
  hashPassword = authMod.hashPassword;
  newUserId = authMod.newUserId;

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
  if (originalNodeEnv !== undefined) {
    process.env.NODE_ENV = originalNodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }
}, 60_000);

beforeEach(async () => {
  // Restore NODE_ENV to non-production before each test so sandboxAllowed()
  // returns true by default; individual tests set it to "production" when needed.
  process.env.NODE_ENV = "test";

  await db.execute(
    sql`TRUNCATE ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();

  // Insert sandbox users for both the exact public shortcut and the ordinary
  // valid-length path so the suite covers their shared production gate.
  await db.insert(usersTable).values({
    id: newUserId(),
    username: SANDBOX_SHORTCUT_USERNAME,
    passwordHash: hashPassword(SANDBOX_SHORTCUT_PASSWORD),
    sandbox: true,
  });
  await db.insert(usersTable).values({
    id: newUserId(),
    username: SANDBOX_GATE_USERNAME,
    passwordHash: hashPassword(SANDBOX_GATE_PASSWORD),
    sandbox: true,
  });

  // Seed a regular non-sandbox staff user.
  await db.insert(usersTable).values({
    id: newUserId(),
    username: REGULAR_USERNAME,
    passwordHash: hashPassword(REGULAR_PASSWORD),
    sandbox: false,
  });
});

async function signIn(body: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("sandbox account is blocked in production", () => {
  it("rejects the public test/test shortcut with 401 in production", async () => {
    process.env.NODE_ENV = "production";
    const res = await signIn({
      username: SANDBOX_SHORTCUT_USERNAME,
      password: SANDBOX_SHORTCUT_PASSWORD,
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({
      error: "Invalid username or password.",
    });
  });

  it("rejects the sandbox-flagged user with 401 when NODE_ENV is 'production'", async () => {
    process.env.NODE_ENV = "production";
    const res = await signIn({ username: SANDBOX_GATE_USERNAME, password: SANDBOX_GATE_PASSWORD });
    expect(res.status).toBe(401);
    // The rejection must be indistinguishable from a bad-password error — no
    // information about the sandbox flag should leak to the caller.
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid username or password.");
  });

  it("returns the same 401 for a second attempt, confirming the gate is not one-shot", async () => {
    process.env.NODE_ENV = "production";
    const res1 = await signIn({ username: SANDBOX_GATE_USERNAME, password: SANDBOX_GATE_PASSWORD });
    expect(res1.status).toBe(401);
    const res2 = await signIn({ username: SANDBOX_GATE_USERNAME, password: SANDBOX_GATE_PASSWORD });
    expect(res2.status).toBe(401);
  });
});

describe("sandbox account is accepted outside production", () => {
  it("allows the public test/test shortcut in a non-production environment", async () => {
    process.env.NODE_ENV = "test";
    const res = await signIn({
      username: SANDBOX_SHORTCUT_USERNAME,
      password: SANDBOX_SHORTCUT_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { token: string }).toMatchObject({
      token: expect.any(String),
    });
  });

  it("allows the sandbox-flagged user to sign in when NODE_ENV is 'test' (non-production)", async () => {
    process.env.NODE_ENV = "test";
    const res = await signIn({ username: SANDBOX_GATE_USERNAME, password: SANDBOX_GATE_PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { userId: string } };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
  });

  it("allows the sandbox-flagged user to sign in when NODE_ENV is 'development'", async () => {
    process.env.NODE_ENV = "development";
    const res = await signIn({ username: SANDBOX_GATE_USERNAME, password: SANDBOX_GATE_PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(typeof body.token).toBe("string");
  });
});

describe("non-sandbox user sign-in success path", () => {
  it("returns 200 with a token and user for correct credentials", async () => {
    const res = await signIn({ username: REGULAR_USERNAME, password: REGULAR_PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { userId: string } };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(typeof body.user.userId).toBe("string");
    expect(body.user.userId.length).toBeGreaterThan(0);
  });

  it("non-sandbox user sign-in still succeeds in production mode", async () => {
    process.env.NODE_ENV = "production";
    const res = await signIn({ username: REGULAR_USERNAME, password: REGULAR_PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
  });
});

describe("bad credentials are always rejected", () => {
  it("returns 401 for a wrong password on a regular user", async () => {
    const res = await signIn({ username: REGULAR_USERNAME, password: "wrong-password" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid username or password.");
  });

  it("returns 401 for an unknown username", async () => {
    const res = await signIn({ username: "nobody", password: "anything" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid username or password.");
  });

  it("returns 400 for a missing body field", async () => {
    const res = await signIn({ username: REGULAR_USERNAME });
    expect(res.status).toBe(400);
  });
});
