// Integration tests for the saved-spec-sheet endpoints.
//
// A "saved spec sheet" is a snapshot of an imported spec sheet, kept so it can
// later be cross-referenced against the current recipe library (see
// /operations-insights/spec-reconciliation). These tests guard the route
// contract against a real
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
let savedSpecSheetsTable: DbModule["savedSpecSheetsTable"];

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
  testDbName = `helium_specsheets_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const routerMod = await import("./savedSpecSheets");
  db = dbMod.db;
  pool = dbMod.pool;
  savedSpecSheetsTable = dbMod.savedSpecSheetsTable;

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
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${savedSpecSheetsTable} RESTART IDENTITY CASCADE`);
});

type ApiSpecSheet = {
  id: number;
  label: string;
  sourceKey?: string | null;
  sourceHash?: string | null;
  createdAt: number;
  data: unknown;
};
type TestScope = "live" | "sandbox";

function headers(scope: TestScope): Record<string, string> {
  return { "Content-Type": "application/json", "x-test-scope": scope };
}

async function list(scope: TestScope = "live"): Promise<ApiSpecSheet[]> {
  const res = await fetch(`${baseUrl}/api/spec-sheets`, { headers: headers(scope) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { specSheets: ApiSpecSheet[] }).specSheets;
}

async function save(
  label: string,
  data: unknown,
  scope: TestScope = "live",
  sourceKey?: string,
  sourceHash?: string,
): Promise<ApiSpecSheet[]> {
  const res = await fetch(`${baseUrl}/api/spec-sheets`, {
    method: "POST",
    headers: headers(scope),
    body: JSON.stringify({
      label,
      data,
      ...(sourceKey ? { sourceKey } : {}),
      ...(sourceHash ? { sourceHash } : {}),
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { specSheets: ApiSpecSheet[] }).specSheets;
}

function specData(name: string): unknown {
  return { recipes: [{ kind: "dough", name, rows: [] }] };
}

describe("saved-spec-sheets routes", () => {
  it("starts empty", async () => {
    expect(await list()).toEqual([]);
  });

  it("POST saves a snapshot and GET lists it", async () => {
    await save("Tony's Pepperoni", specData("12in dough"));
    const sheets = await list();
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.label).toBe("Tony's Pepperoni");
    expect(sheets[0]?.data).toEqual(specData("12in dough"));
  });

  it("preserves rich recipe fields (doughballOz, variantLabel, targets) on save — never strips to kind/name/rows", async () => {
    // Regression: the generated Zod for a typed recipe object stripped every
    // field except kind/name/rows, so snapshots lost doughball weights and
    // variant labels — and exact-file parse reuse silently dropped dough
    // variants on re-import. The save schema is free-form by contract.
    const rich = {
      note: "variants",
      recipes: [
        {
          kind: "dough",
          name: "CRB Dough",
          rows: [{ ingredient: "FLOUR", lbs: 200 }],
          doughballOz: 13,
          doughballsPerTray: 12,
          variantLabel: '11" CRB Recipe',
          targets: [{ brand: "CRB", flavor: "Pepperoni" }],
        },
      ],
    };
    await save("rich sheet", rich);
    const sheets = await list();
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.data).toEqual(rich);
  });

  it("keeps only the two most recent snapshots (newest first), pruning older ones", async () => {
    await save("first", specData("a"));
    await save("second", specData("b"));
    await save("third", specData("c"));
    const sheets = await list();
    expect(sheets.map((s) => s.label)).toEqual(["third", "second"]);
  });

  it("keeps the two most recent versions PER distinct sourceKey", async () => {
    // Two distinct files, three uploads each — each file keeps its newest two.
    await save("dough v1", specData("a"), "live", "dough-sheet");
    await save("dough v2", specData("b"), "live", "dough-sheet");
    await save("dough v3", specData("c"), "live", "dough-sheet");
    await save("sauce v1", specData("d"), "live", "sauce-sheet");
    await save("sauce v2", specData("e"), "live", "sauce-sheet");
    await save("sauce v3", specData("f"), "live", "sauce-sheet");
    const labels = (await list()).map((s) => s.label);
    // Both files retained (not pruned to two overall), each down to its newest two.
    expect(labels).toContain("dough v3");
    expect(labels).toContain("dough v2");
    expect(labels).toContain("sauce v3");
    expect(labels).toContain("sauce v2");
    expect(labels).not.toContain("dough v1");
    expect(labels).not.toContain("sauce v1");
    expect(labels).toHaveLength(4);
  });

  it("round-trips sourceHash (null when omitted)", async () => {
    const hash = "a".repeat(64);
    const saved = await save("hashed", specData("a"), "live", "my-file", hash);
    expect(saved.find((s) => s.label === "hashed")?.sourceHash).toBe(hash);
    await save("no-hash", specData("b"), "live", "other-file");
    // Malformed hashes (wrong length / non-hex) are stored as null, never trusted.
    await save("bad-hash", specData("c"), "live", "third-file", "not-a-sha256!");
    const sheets = await list();
    expect(sheets.find((s) => s.label === "hashed")?.sourceHash).toBe(hash);
    expect(sheets.find((s) => s.label === "no-hash")?.sourceHash).toBeNull();
    expect(sheets.find((s) => s.label === "bad-hash")?.sourceHash).toBeNull();
  });

  it("round-trips sourceKey and buckets keyless snapshots separately", async () => {
    const saved = await save("keyed", specData("a"), "live", "my-file");
    expect(saved.find((s) => s.label === "keyed")?.sourceKey).toBe("my-file");
    // A keyless (legacy) upload is its own bucket, independent of keyed ones.
    await save("legacy", specData("b"));
    const labels = (await list()).map((s) => s.label);
    expect(labels).toContain("keyed");
    expect(labels).toContain("legacy");
  });

  it("DELETE removes a snapshot by id", async () => {
    await save("first", specData("a"));
    const afterSecond = await save("second", specData("b"));
    const toDelete = afterSecond.find((s) => s.label === "first");
    expect(toDelete).toBeDefined();
    const res = await fetch(`${baseUrl}/api/spec-sheets/${toDelete!.id}`, {
      method: "DELETE",
      headers: headers("live"),
    });
    expect(res.status).toBe(200);
    const sheets = await list();
    expect(sheets.map((s) => s.label)).toEqual(["second"]);
  });

  it("isolates snapshots by scope", async () => {
    await save("live-sheet", specData("a"), "live");
    await save("sandbox-sheet", specData("b"), "sandbox");
    expect((await list("live")).map((s) => s.label)).toEqual(["live-sheet"]);
    expect((await list("sandbox")).map((s) => s.label)).toEqual(["sandbox-sheet"]);
  });

  it("cannot delete another scope's snapshot", async () => {
    const liveSheets = await save("live-sheet", specData("a"), "live");
    const liveId = liveSheets[0]!.id;
    // sandbox tries to delete the live row by id — should be a no-op for live.
    const res = await fetch(`${baseUrl}/api/spec-sheets/${liveId}`, {
      method: "DELETE",
      headers: headers("sandbox"),
    });
    expect(res.status).toBe(200);
    expect((await list("live")).map((s) => s.label)).toEqual(["live-sheet"]);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/spec-sheets`, {
      method: "POST",
      headers: headers("live"),
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/spec-sheets/not-a-number`, {
      method: "DELETE",
      headers: headers("live"),
    });
    expect(res.status).toBe(400);
  });
});
