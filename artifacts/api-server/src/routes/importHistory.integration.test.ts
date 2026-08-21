// Integration coverage for the manager import-history audit trail.
//
// These tests use a disposable Postgres database and the real auth/capability
// middleware. Import history is intentionally separate from the import commit:
// a history-storage failure must not change the result that was already
// committed by the importer.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let importHistoryTable: DbModule["importHistoryTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let server: Server;
let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let baseUrl: string;
let signToken: typeof import("../lib/auth")["signToken"];
let clearUserValidityCache: typeof import("../lib/userValidity")["clearUserValidityCache"];
let seedRoles: typeof import("../lib/roles")["seedRoles"];

const MANAGER = "import-history-manager";
const OPERATOR = "import-history-operator";
const SANDBOX = "import-history-sandbox";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_import_history_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  process.env.DATABASE_URL = testUrlStr;

  const dbMod = await import("@workspace/db");
  const authMod = await import("../lib/auth");
  const validityMod = await import("../lib/userValidity");
  const rolesMod = await import("../lib/roles");
  const requireAuthMod = await import("../middlewares/requireAuth");
  const routerMod = await import("./importHistory");

  db = dbMod.db;
  pool = dbMod.pool;
  importHistoryTable = dbMod.importHistoryTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  signToken = authMod.signToken;
  clearUserValidityCache = validityMod.clearUserValidityCache;
  seedRoles = rolesMod.seedRoles;

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  // Mount the real auth boundary, then the route under test. The route's
  // currentScope() is populated by requireAuth for live vs sandbox users.
  app.use(requireAuthMod.requireAuth);
  app.use("/api", routerMod.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 120_000);

beforeEach(async () => {
  clearUserValidityCache();
  await db.execute(sql`TRUNCATE ${importHistoryTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: "import-manager", passwordHash: "x" },
    { id: OPERATOR, username: "import-operator", passwordHash: "x" },
    { id: SANDBOX, username: "import-sandbox", passwordHash: "x", sandbox: true },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
    { userId: SANDBOX, role: "manager" },
  ]);
});

type User = "manager" | "operator" | "sandbox";
const userIds: Record<User, string> = { manager: MANAGER, operator: OPERATOR, sandbox: SANDBOX };

function headers(user: User): Record<string, string> {
  return {
    authorization: `Bearer ${signToken(userIds[user])}`,
    "content-type": "application/json",
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    importType: "spec",
    sourceKey: "weekly-spec.xlsx",
    sourceLabel: "weekly-spec.xlsx",
    customerScope: "Acme",
    status: "complete",
    summary: { phases: { commit: "committed" }, counts: { updated: 2 } },
    ...overrides,
  };
}

async function post(user: User, body: unknown = record()): Promise<Response> {
  return fetch(`${baseUrl}/api/import-history`, {
    method: "POST",
    headers: headers(user),
    body: JSON.stringify(body),
  });
}

async function list(user: User): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${baseUrl}/api/import-history`, { headers: headers(user) });
  expect(response.status).toBe(200);
  return ((await response.json()) as { imports: Array<Record<string, unknown>> }).imports;
}

describe("import-history authorization and scope", () => {
  it("requires authentication and the manager capability", async () => {
    const anonymous = await fetch(`${baseUrl}/api/import-history`);
    expect(anonymous.status).toBe(401);

    const operatorPost = await post("operator");
    expect(operatorPost.status).toBe(403);
    const operatorGet = await fetch(`${baseUrl}/api/import-history`, { headers: headers("operator") });
    expect(operatorGet.status).toBe(403);

    expect((await post("manager")).status).toBe(201);
  });

  it("keeps live and sandbox history isolated", async () => {
    expect((await post("manager", record({ sourceLabel: "live.xlsx" }))).status).toBe(201);
    expect((await post("sandbox", record({ sourceLabel: "sandbox.xlsx" }))).status).toBe(201);
    expect((await list("manager")).map((row) => row.sourceLabel)).toEqual(["live.xlsx"]);
    expect((await list("sandbox")).map((row) => row.sourceLabel)).toEqual(["sandbox.xlsx"]);
  });
});

describe("import-history records", () => {
  it("round-trips complete, partial, and failed outcomes", async () => {
    for (const status of ["complete", "partial", "failed"] as const) {
      const response = await post("manager", record({ status }));
      expect(response.status).toBe(201);
    }
    expect((await list("manager")).map((row) => row.status)).toEqual(["failed", "partial", "complete"]);
  });

  it("sanitizes summary values and bounds every collection", async () => {
    const long = "x".repeat(1000);
    const response = await post("manager", record({
      sourceLabel: long,
      summary: {
        phases: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`phase-${i}`, long])),
        counts: { valid: 2.9, negative: -1, huge: 999999999, invalid: "nope" },
        warnings: Array.from({ length: 40 }, () => long),
        unresolved: Array.from({ length: 40 }, () => long),
        skipped: Array.from({ length: 40 }, () => long),
        followUp: Array.from({ length: 40 }, () => long),
        snapshotId: 42,
        secret: "must not survive",
      },
    }));
    expect(response.status).toBe(201);
    const saved = (await list("manager"))[0]!;
    expect(saved.sourceLabel).toHaveLength(300);
    expect(saved.summary).toEqual({
      phases: expect.objectContaining({ "phase-0": "x".repeat(40) }),
      counts: { valid: 2, huge: 1_000_000 },
      warnings: expect.arrayContaining(["x".repeat(300)]),
      unresolved: expect.arrayContaining(["x".repeat(300)]),
      skipped: expect.arrayContaining(["x".repeat(300)]),
      followUp: expect.arrayContaining(["x".repeat(300)]),
      snapshotId: 42,
    });
    expect(Object.keys(saved.summary as object)).not.toContain("secret");
    expect(Object.keys((saved.summary as { phases: object }).phases)).toHaveLength(20);
    expect((saved.summary as { warnings: string[] }).warnings).toHaveLength(30);
  });

  it("retains at most 100 records per scope", async () => {
    for (let i = 0; i < 101; i++) {
      const response = await post("manager", record({ sourceLabel: `import-${i}.xlsx` }));
      expect(response.status).toBe(201);
    }
    const rows = await list("manager");
    expect(rows).toHaveLength(100);
    expect(rows[0]?.sourceLabel).toBe("import-100.xlsx");
    expect(rows.at(-1)?.sourceLabel).toBe("import-1.xlsx");
  });
});