// Focused HTTP coverage for the private, facility-scoped audit boundary.
// This suite uses the same disposable-Postgres fixture pattern as the route
// isolation suites; it never connects to the developer database.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import pg from "pg";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { signToken } from "../lib/auth";
import { runWithScope } from "../lib/requestScope";
import { writeAuditEvent } from "./auditLogs";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } } },
  AI_MODELS: { full: "gpt-5.4", cheap: "gpt-5-mini" },
  pickModel: (kind: "full" | "cheap" = "full") => kind === "cheap" ? "gpt-5-mini" : "gpt-5.4",
}));

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let auditLogsTable: DbModule["auditLogsTable"];
let productionRulesTable: DbModule["productionRulesTable"];
let seedRoles: () => Promise<void>;
let seedSandboxUser: () => Promise<void>;
let findUserByUsername: (username: string) => Promise<{ id: string } | undefined>;
let clearUserValidityCache: () => void;
let adminPool: pg.Pool;
let testDbName = "";
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl = "";
let sandboxUserId = "";

const LIVE_MANAGER = "audit-live-manager";
const LIVE_OPERATOR = "audit-live-operator";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_audit_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);
  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlString = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot, env: { ...process.env, DATABASE_URL: testUrlString }, encoding: "utf8",
  });
  if (push.status !== 0) throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  process.env.DATABASE_URL = testUrlString;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const rolesMod = await import("../lib/roles");
  const sandboxMod = await import("../lib/sandbox");
  const usersMod = await import("../lib/users");
  const validityMod = await import("../lib/userValidity");
  db = dbMod.db;
  pool = dbMod.pool;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  auditLogsTable = dbMod.auditLogsTable;
  productionRulesTable = dbMod.productionRulesTable;
  seedRoles = rolesMod.seedRoles;
  seedSandboxUser = sandboxMod.seedSandboxUser;
  findUserByUsername = usersMod.findUserByUsername;
  clearUserValidityCache = validityMod.clearUserValidityCache;

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", routerMod.default);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await seedRoles();
  await seedSandboxUser();
  const sandbox = await findUserByUsername("test");
  if (!sandbox) throw new Error("sandbox user was not seeded");
  sandboxUserId = sandbox.id;
  await db.insert(usersTable).values([
    { id: LIVE_MANAGER, username: "audit-live-manager", passwordHash: "x" },
    { id: LIVE_OPERATOR, username: "audit-live-operator", passwordHash: "x" },
  ]).onConflictDoNothing();
  await db.insert(userRolesTable).values([
    { userId: LIVE_MANAGER, role: "manager" },
    { userId: LIVE_OPERATOR, role: "operator" },
  ]).onConflictDoNothing();
}, 90_000);

afterAll(async () => {
  clearUserValidityCache?.();
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
}, 90_000);

beforeEach(async () => {
  clearUserValidityCache();
  await db.execute(sql`TRUNCATE ${auditLogsTable}, ${productionRulesTable} RESTART IDENTITY CASCADE`);
});

async function req(userId: string | null, method: string, pathname: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (userId) headers.authorization = `Bearer ${signToken(userId)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedAudit(count: number, scope = "live"): Promise<void> {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(auditLogsTable).values(Array.from({ length: count }, (_, index) => ({
    scope,
    actor: scope === "live" ? LIVE_MANAGER : sandboxUserId,
    action: "factory_reset",
    resource: `audit-test:${index}`,
    changes: { outcome: "success", count: index, privatePayload: "do-not-export" },
    createdAt,
  })));
}

describe("operational audit HTTP boundary", () => {
  it("rejects anonymous and insufficient-capability reads", async () => {
    expect((await req(null, "GET", "/api/audit-logs")).status).toBe(401);
    expect((await req(LIVE_OPERATOR, "GET", "/api/audit-logs")).status).toBe(403);
    expect((await req(null, "GET", "/api/audit-logs/export.csv")).status).toBe(401);
    expect((await req(LIVE_OPERATOR, "GET", "/api/audit-logs/export.csv")).status).toBe(403);
    expect((await req(null, "GET", "/api/audit-logs/export.pdf")).status).toBe(401);
    expect((await req(LIVE_OPERATOR, "GET", "/api/audit-logs/export.pdf")).status).toBe(403);
  });

  it("derives actor and scope, ignores a scope query, and hides private columns", async () => {
    await seedAudit(1);
    await db.insert(auditLogsTable).values({
      scope: "sandbox", actor: sandboxUserId, action: "factory_reset", resource: "sandbox",
      changes: { outcome: "success" }, ipAddress: "192.0.2.1", userAgent: "private-agent",
    });
    const response = await req(LIVE_MANAGER, "GET", "/api/audit-logs?scope=sandbox");
    expect(response.status).toBe(200);
    const body = await response.json() as { logs: Array<Record<string, unknown>> };
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0]).toMatchObject({ actor: LIVE_MANAGER, action: "factory_reset" });
    expect(body.logs[0]).not.toHaveProperty("scope");
    expect(body.logs[0]).not.toHaveProperty("ipAddress");
    expect(body.logs[0]).not.toHaveProperty("userAgent");
    expect(JSON.stringify(body)).not.toContain("sandbox");
    const sandboxResponse = await req(sandboxUserId, "GET", "/api/audit-logs");
    expect(sandboxResponse.status).toBe(403);
  });

  it("paginates stably when records share one timestamp", async () => {
    await seedAudit(3);
    const first = await req(LIVE_MANAGER, "GET", "/api/audit-logs?limit=2");
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { logs: Array<{ id: number }>; nextCursor: string | null };
    expect(firstBody.logs).toHaveLength(2);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    const second = await req(LIVE_MANAGER, "GET", `/api/audit-logs?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`);
    const secondBody = await second.json() as { logs: Array<{ id: number }>; nextCursor: string | null };
    expect(second.status).toBe(200);
    expect(secondBody.logs).toHaveLength(1);
    expect(secondBody.logs[0].id).not.toBe(firstBody.logs[0].id);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("bounds CSV exports and omits private columns", async () => {
    await seedAudit(3);
    const tooLarge = await req(LIVE_MANAGER, "GET", "/api/audit-logs/export.csv?limit=5001");
    expect(tooLarge.status).toBe(400);
    const response = await req(LIVE_MANAGER, "GET", "/api/audit-logs/export.csv?limit=2");
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("id,actor,action,resource,changes,createdAt");
    expect(csv).not.toContain("scope");
    expect(csv).not.toContain("ip_address");
    expect(csv).not.toContain("user_agent");
    expect(csv).not.toContain("do-not-export");
  });

  it("returns a paginated PDF with stable public audit ordering and date bounds", async () => {
    await seedAudit(70);
    await db.insert(auditLogsTable).values({
      scope: "live", actor: LIVE_MANAGER, action: "factory_reset", resource: "outside-date",
      changes: { outcome: "success" }, createdAt: new Date("2025-12-31T23:59:00.000Z"),
    });

    const tooLarge = await req(LIVE_MANAGER, "GET", "/api/audit-logs/export.pdf?limit=5001");
    expect(tooLarge.status).toBe(400);
    const response = await req(
      LIVE_MANAGER,
      "GET",
      "/api/audit-logs/export.pdf?limit=70&startDate=2026-01-01T00:00:00.000Z&endDate=2026-01-01T23:59:59.000Z",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("audit-logs.pdf");
    const pdf = Buffer.from(await response.arrayBuffer()).toString("ascii");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(pdf).toContain("Operational audit export");
    expect(pdf.indexOf("audit-test:1")).toBeGreaterThan(-1);
    expect(pdf.indexOf("audit-test:0")).toBeGreaterThan(pdf.indexOf("audit-test:1"));
    expect(pdf).not.toContain("outside-date");
    expect(pdf).not.toContain("scope");
    expect(pdf).not.toContain("private-agent");
    expect(pdf).not.toContain("do-not-export");
  });

  it("rejects sandbox PDF exports even when the sandbox user is seeded as a manager", async () => {
    const response = await req(sandboxUserId, "GET", "/api/audit-logs/export.pdf");
    expect(response.status).toBe(403);
  });

  it("keeps audit rows outside reset/purge deletion sets", async () => {
    await seedAudit(1);
    expect((await req(LIVE_MANAGER, "POST", "/api/sync/reset")).status).toBe(200);
    expect((await db.select().from(auditLogsTable)).some((row) => row.resource === "audit-test:0")).toBe(true);
    expect((await req(LIVE_MANAGER, "POST", "/api/sync/purge-all", { confirm: true })).status).toBe(200);
    expect((await db.select().from(auditLogsTable)).some((row) => row.resource === "audit-test:0")).toBe(true);
  });

  it("rolls back a business write when the required audit insert fails", async () => {
    await expect(db.transaction(async (tx) => {
      await tx.insert(productionRulesTable).values({
        id: "rollback-audit-rule", scope: "live", name: "must rollback",
        type: "required-field", enforcement: "flexible", enabled: true,
      });
      await runWithScope("live", () => writeAuditEvent({
        insert: () => { throw new Error("injected audit failure"); },
      } as never, {
        action: "production_rules_updated", resource: "production_rules",
        changes: { outcome: "success", count: 1 },
      }));
    })).rejects.toThrow("injected audit failure");
    expect(await db.select().from(productionRulesTable)).toHaveLength(0);
  });
});