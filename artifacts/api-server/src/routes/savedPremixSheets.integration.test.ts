// Integration tests for the saved-premix-sheet endpoints.
//
// A "saved premix sheet" is a snapshot of an imported premix workbook (its
// Mix[]), kept so the current mixes can later be reconciled against it (see
// /ai/mix-reconcile). These tests guard the route contract against a real
// Postgres database:
//   - GET lists snapshots newest-first;
//   - POST inserts a snapshot and prunes to the two most recent (MAX_SAVED=2);
//   - DELETE removes a snapshot by id;
//   - snapshots are scope-isolated (one scope never sees another's rows);
//   - bad bodies / ids 400.
//
// The router has no auth of its own (auth is applied at the index mount), so we
// mount just the router with a stub req.log — auth gating is covered elsewhere.
// In production the data scope ("live" | "sandbox") is carried per-request via
// AsyncLocalStorage and derived from the signed-in user; here we wrap each
// request in runWithScope based on an x-test-scope header to exercise scope
// isolation.
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
let savedPremixSheetsTable: DbModule["savedPremixSheetsTable"];

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_premixsheets_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const requestScopeMod = await import("../lib/requestScope");
  const routerMod = await import("./savedPremixSheets");
  db = dbMod.db;
  pool = dbMod.pool;
  savedPremixSheetsTable = dbMod.savedPremixSheetsTable;

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  // Run each request inside the scope named by the x-test-scope header so
  // currentScope() inside the router resolves to the caller's scope.
  app.use((req, _res, next) => {
    const raw = req.header("x-test-scope");
    const scope = raw === "sandbox" ? "sandbox" : "live";
    requestScopeMod.runWithScope(scope, () => next());
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
}, 30_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${savedPremixSheetsTable} RESTART IDENTITY CASCADE`);
});

type ApiPremixSheet = { id: number; label: string; createdAt: number; data: unknown };
type TestScope = "live" | "sandbox";

function headers(scope: TestScope): Record<string, string> {
  return { "Content-Type": "application/json", "x-test-scope": scope };
}

async function list(scope: TestScope = "live"): Promise<ApiPremixSheet[]> {
  const res = await fetch(`${baseUrl}/api/premix-sheets`, { headers: headers(scope) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { premixSheets: ApiPremixSheet[] }).premixSheets;
}

async function save(
  label: string,
  data: unknown,
  scope: TestScope = "live",
): Promise<ApiPremixSheet[]> {
  const res = await fetch(`${baseUrl}/api/premix-sheets`, {
    method: "POST",
    headers: headers(scope),
    body: JSON.stringify({ label, data }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { premixSheets: ApiPremixSheet[] }).premixSheets;
}

function premixData(name: string): unknown {
  return [
    {
      id: `mix-${name}`,
      name,
      brand: "Tony's",
      flavor: "Pepperoni",
      batchSize: 10,
      daysEarly: 1,
      amountAlreadyMade: 0,
      components: [{ ingredient: "Mozzarella", perPizza: 0.5 }],
      enabled: true,
    },
  ];
}

describe("saved-premix-sheets routes", () => {
  it("starts empty", async () => {
    expect(await list()).toEqual([]);
  });

  it("POST saves a snapshot and GET lists it", async () => {
    await save("Tony's Pepperoni", premixData("Cheese blend"));
    const sheets = await list();
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.label).toBe("Tony's Pepperoni");
    expect(sheets[0]?.data).toEqual(premixData("Cheese blend"));
  });

  it("keeps only the two most recent snapshots (newest first), pruning older ones", async () => {
    await save("first", premixData("a"));
    await save("second", premixData("b"));
    await save("third", premixData("c"));
    const sheets = await list();
    expect(sheets.map((s) => s.label)).toEqual(["third", "second"]);
  });

  it("DELETE removes a snapshot by id", async () => {
    await save("first", premixData("a"));
    const afterSecond = await save("second", premixData("b"));
    const toDelete = afterSecond.find((s) => s.label === "first");
    expect(toDelete).toBeDefined();
    const res = await fetch(`${baseUrl}/api/premix-sheets/${toDelete!.id}`, {
      method: "DELETE",
      headers: headers("live"),
    });
    expect(res.status).toBe(200);
    const sheets = await list();
    expect(sheets.map((s) => s.label)).toEqual(["second"]);
  });

  it("isolates snapshots by scope", async () => {
    await save("live-sheet", premixData("a"), "live");
    await save("sandbox-sheet", premixData("b"), "sandbox");
    expect((await list("live")).map((s) => s.label)).toEqual(["live-sheet"]);
    expect((await list("sandbox")).map((s) => s.label)).toEqual(["sandbox-sheet"]);
  });

  it("cannot delete another scope's snapshot", async () => {
    const liveSheets = await save("live-sheet", premixData("a"), "live");
    const liveId = liveSheets[0]!.id;
    const res = await fetch(`${baseUrl}/api/premix-sheets/${liveId}`, {
      method: "DELETE",
      headers: headers("sandbox"),
    });
    expect(res.status).toBe(200);
    expect((await list("live")).map((s) => s.label)).toEqual(["live-sheet"]);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/premix-sheets`, {
      method: "POST",
      headers: headers("live"),
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/premix-sheets/not-a-number`, {
      method: "DELETE",
      headers: headers("live"),
    });
    expect(res.status).toBe(400);
  });
});
