import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";

vi.mock("../middlewares/requireCapability", () => ({
  requireCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let savedCheeseSheetsTable: DbModule["savedCheeseSheetsTable"];
let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

type Scope = "live" | "sandbox";
type Sheet = { id: number; label: string; sourceKey: string | null; createdAt: number; data: unknown };
const headers = (scope: Scope) => ({ "Content-Type": "application/json", "x-test-scope": scope });
const data = (name: string) => [{
  id: `cheese-${name}`, name, brand: "Acme", flavors: ["Pepperoni"],
  shredderSetting: "3", cellulose: "1%", notes: "", enabled: true,
  components: [{ ingredient: "Mozzarella", lbs: 100 }],
}];

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  testDbName = `helium_cheese_sheets_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);
  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot, env: { ...process.env, DATABASE_URL: testUrlStr }, encoding: "utf8",
  });
  if (push.status !== 0) throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const scopeMod = await import("../lib/requestScope");
  const routerMod = await import("./savedCheeseSheets");
  db = dbMod.db;
  pool = dbMod.pool;
  savedCheeseSheetsTable = dbMod.savedCheeseSheetsTable;
  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use((req, _res, next) => {
    scopeMod.runWithScope(req.header("x-test-scope") === "sandbox" ? "sandbox" : "live", () => next());
  });
  app.use("/api", routerMod.default);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${savedCheeseSheetsTable} RESTART IDENTITY CASCADE`);
});

async function list(scope: Scope = "live"): Promise<Sheet[]> {
  const res = await fetch(`${baseUrl}/api/cheese-sheets`, { headers: headers(scope) });
  expect(res.status).toBe(200);
  return (await res.json() as { cheeseSheets: Sheet[] }).cheeseSheets;
}

async function save(name: string, scope: Scope = "live", sourceKey = "cheese.xlsx") {
  const res = await fetch(`${baseUrl}/api/cheese-sheets`, {
    method: "POST", headers: headers(scope),
    body: JSON.stringify({ label: name, sourceKey, data: data(name) }),
  });
  expect(res.status).toBe(200);
  return await res.json() as { snapshotId: number; cheeseSheets: Sheet[] };
}

describe("saved-cheese-sheets routes", () => {
  it("returns the inserted id, retains parsed data, and keeps two versions per filename", async () => {
    const first = await save("first");
    const second = await save("second");
    const third = await save("third");
    expect(third.snapshotId).toBe(3);
    expect(third.cheeseSheets.map((s) => s.label)).toEqual(["third", "second"]);
    expect(third.cheeseSheets[0]?.data).toEqual(data("third"));
    expect(first.snapshotId).toBe(1);
  });

  it("isolates scopes and rejects malformed data", async () => {
    await save("live", "live");
    await save("sandbox", "sandbox");
    expect((await list("live")).map((s) => s.label)).toEqual(["live"]);
    expect((await list("sandbox")).map((s) => s.label)).toEqual(["sandbox"]);
    const bad = await fetch(`${baseUrl}/api/cheese-sheets`, {
      method: "POST", headers: headers("live"), body: JSON.stringify({ label: "bad", data: [{ nope: true }] }),
    });
    expect(bad.status).toBe(400);
  });
});