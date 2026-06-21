// Integration tests guaranteeing that a production rule's exception fields —
// `bypass` (waive-when conditions) and `checklist` (ordered required steps) —
// survive a save (POST /production-rules) and a reload (GET /production-rules).
//
// These exceptions are stored as JSONB columns on the production_rules table and
// round-tripped through the save/list endpoints. The schema, route, and DB have
// silently drifted in the past, dropping these fields with only a typecheck (not
// a behavior test) to catch it. This file asserts the round-trip explicitly.
//
// As with roles.integration.test.ts, this stands up the *real* router against a
// *disposable* Postgres database (created from the dev DATABASE_URL's server,
// schema pushed via drizzle-kit, dropped on teardown) so nothing here ever
// touches real data. Auth uses the self-contained username + password system: a
// manager carries a real HMAC-signed session token in the Authorization header.
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
let productionRulesTable: DbModule["productionRulesTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];

let clearUserValidityCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const MANAGER = "manager-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  testDbName = `helium_rules_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  productionRulesTable = dbMod.productionRulesTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;

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
  await db.execute(
    sql`TRUNCATE ${productionRulesTable}, ${userRolesTable}, ${usersTable} RESTART IDENTITY CASCADE`,
  );
  // A single manager so POST /production-rules (manager-gated) is allowed.
  await db.insert(usersTable).values([{ id: MANAGER, username: "manager", passwordHash: "x" }]);
  await db.insert(userRolesTable).values([{ userId: MANAGER, role: "manager" }]);
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

type ApiRule = {
  id: string;
  name: string;
  type: string;
  enforcement: string;
  enabled: boolean;
  field?: string;
  bypass?: { field: string; value: string }[];
  checklist?: string[];
};

async function listRules(): Promise<ApiRule[]> {
  const res = await req(MANAGER, "GET", "/api/production-rules");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rules: ApiRule[] };
  return body.rules;
}

describe("production rule exceptions survive save + reload", () => {
  it("round-trips both bypass conditions and checklist steps intact and in order", async () => {
    const rule: ApiRule = {
      id: "rule-with-exceptions",
      name: "Doughball weight in range",
      type: "numeric-range",
      enforcement: "strict",
      enabled: true,
      field: "targetDoughballWeight",
      // numeric-range needs at least one bound to be a valid rule.
      // (min/max omitted here would be rejected, so include a bound.)
      bypass: [
        { field: "brand", value: "House Brand" },
        { field: "dieType", value: "14-inch" },
      ],
      checklist: ["Calibrate scale", "Verify first 5 doughballs", "Log the lot number"],
    };

    // Save the rule (with the numeric bound the type requires).
    const saveRes = await req(MANAGER, "POST", "/api/production-rules", {
      rules: [{ ...rule, min: 8, max: 12 }],
    });
    expect(saveRes.status).toBe(200);

    // Re-read via GET and assert the exception fields came back intact, in order.
    const rules = await listRules();
    const reloaded = rules.find((r) => r.id === rule.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.bypass).toEqual([
      { field: "brand", value: "House Brand" },
      { field: "dieType", value: "14-inch" },
    ]);
    expect(reloaded!.checklist).toEqual([
      "Calibrate scale",
      "Verify first 5 doughballs",
      "Log the lot number",
    ]);

    // The underlying DB row holds the same JSONB, not just the response shape.
    const [row] = await db
      .select()
      .from(productionRulesTable)
      .where(sql`${productionRulesTable.id} = ${rule.id}`);
    expect(row.bypass).toEqual([
      { field: "brand", value: "House Brand" },
      { field: "dieType", value: "14-inch" },
    ]);
    expect(row.checklist).toEqual([
      "Calibrate scale",
      "Verify first 5 doughballs",
      "Log the lot number",
    ]);
  });

  it("does not return empty/garbage exception arrays for a rule saved without exceptions", async () => {
    const saveRes = await req(MANAGER, "POST", "/api/production-rules", {
      rules: [
        {
          id: "plain-rule",
          name: "Brand is required",
          type: "required-field",
          enforcement: "flexible",
          enabled: true,
          field: "brand",
        },
      ],
    });
    expect(saveRes.status).toBe(200);

    const rules = await listRules();
    const reloaded = rules.find((r) => r.id === "plain-rule");
    expect(reloaded).toBeDefined();
    // Absent exceptions must be omitted entirely, not surfaced as [] or null.
    expect(reloaded!.bypass).toBeUndefined();
    expect(reloaded!.checklist).toBeUndefined();

    // The DB stores null (no JSONB) rather than an empty array.
    const [row] = await db
      .select()
      .from(productionRulesTable)
      .where(sql`${productionRulesTable.id} = ${"plain-rule"}`);
    expect(row.bypass).toBeNull();
    expect(row.checklist).toBeNull();
  });

  it("preserves exceptions across a re-save round-trip (update path keeps them)", async () => {
    const base = {
      id: "resave-rule",
      name: "Line speed range",
      type: "numeric-range" as const,
      enforcement: "strict" as const,
      enabled: true,
      field: "lineSpeed",
      min: 50,
      max: null,
      bypass: [{ field: "flavor", value: "Cheese" }],
      checklist: ["Check belt tension"],
    };

    // First save.
    expect((await req(MANAGER, "POST", "/api/production-rules", { rules: [base] })).status).toBe(
      200,
    );
    // Second save (onConflictDoUpdate path) with edited name but same exceptions.
    expect(
      (
        await req(MANAGER, "POST", "/api/production-rules", {
          rules: [{ ...base, name: "Line speed range (updated)" }],
        })
      ).status,
    ).toBe(200);

    const rules = await listRules();
    const reloaded = rules.find((r) => r.id === "resave-rule");
    expect(reloaded).toBeDefined();
    expect(reloaded!.name).toBe("Line speed range (updated)");
    expect(reloaded!.bypass).toEqual([{ field: "flavor", value: "Cheese" }]);
    expect(reloaded!.checklist).toEqual(["Check belt tension"]);
  });
});
