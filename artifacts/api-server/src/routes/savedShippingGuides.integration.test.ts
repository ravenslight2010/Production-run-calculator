// Integration tests for the saved shipping & palletizing-guide endpoints.
//
// A "saved shipping guide" is a snapshot of an imported palletizing guide (the
// reviewed brand+flavor packaging rows), kept so the Setup Profiles auto-fill
// panel can later reach back into what the guide stated and cross-reference it
// against the spec sheet. These tests guard the route contract against a real
// Postgres database:
//   - GET lists snapshots newest-first;
//   - POST inserts a snapshot and prunes to the two most recent per file;
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
let savedShippingGuidesTable: DbModule["savedShippingGuidesTable"];

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
  testDbName = `helium_shippingguides_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const routerMod = await import("./savedShippingGuides");
  db = dbMod.db;
  pool = dbMod.pool;
  savedShippingGuidesTable = dbMod.savedShippingGuidesTable;

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
  await db.execute(sql`TRUNCATE ${savedShippingGuidesTable} RESTART IDENTITY CASCADE`);
});

type ApiShippingGuide = {
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

async function list(scope: TestScope = "live"): Promise<ApiShippingGuide[]> {
  const res = await fetch(`${baseUrl}/api/shipping-guides`, { headers: headers(scope) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { shippingGuides: ApiShippingGuide[] }).shippingGuides;
}

async function save(
  label: string,
  data: unknown,
  scope: TestScope = "live",
  sourceKey?: string,
  sourceHash?: string,
): Promise<ApiShippingGuide[]> {
  const res = await fetch(`${baseUrl}/api/shipping-guides`, {
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
  return ((await res.json()) as { shippingGuides: ApiShippingGuide[] }).shippingGuides;
}

function guideData(brand: string): unknown {
  return { rows: [{ brand, flavors: [], patch: { pizzasPerCase: 16, casesPerSkid: 40 } }] };
}

describe("saved-shipping-guides routes", () => {
  it("starts empty", async () => {
    expect(await list()).toEqual([]);
  });

  it("POST saves a snapshot and GET lists it", async () => {
    await save("Tony's Guide", guideData("Tony's"));
    const guides = await list();
    expect(guides).toHaveLength(1);
    expect(guides[0]?.label).toBe("Tony's Guide");
    expect(guides[0]?.data).toEqual(guideData("Tony's"));
  });

  it("keeps only the two most recent snapshots (newest first), pruning older ones", async () => {
    await save("first", guideData("a"));
    await save("second", guideData("b"));
    await save("third", guideData("c"));
    const guides = await list();
    expect(guides.map((s) => s.label)).toEqual(["third", "second"]);
  });

  it("keeps the two most recent versions PER distinct sourceKey", async () => {
    await save("guide v1", guideData("a"), "live", "palletizing-sheet");
    await save("guide v2", guideData("b"), "live", "palletizing-sheet");
    await save("guide v3", guideData("c"), "live", "palletizing-sheet");
    await save("other v1", guideData("d"), "live", "other-sheet");
    await save("other v2", guideData("e"), "live", "other-sheet");
    await save("other v3", guideData("f"), "live", "other-sheet");
    const labels = (await list()).map((s) => s.label);
    expect(labels).toContain("guide v3");
    expect(labels).toContain("guide v2");
    expect(labels).toContain("other v3");
    expect(labels).toContain("other v2");
    expect(labels).not.toContain("guide v1");
    expect(labels).not.toContain("other v1");
    expect(labels).toHaveLength(4);
  });

  it("round-trips sourceKey and buckets keyless snapshots separately", async () => {
    const saved = await save("keyed", guideData("a"), "live", "my-file");
    expect(saved.find((s) => s.label === "keyed")?.sourceKey).toBe("my-file");
    await save("legacy", guideData("b"));
    const labels = (await list()).map((s) => s.label);
    expect(labels).toContain("keyed");
    expect(labels).toContain("legacy");
  });

  it("DELETE removes a snapshot by id", async () => {
    await save("first", guideData("a"));
    const afterSecond = await save("second", guideData("b"));
    const toDelete = afterSecond.find((s) => s.label === "first");
    expect(toDelete).toBeDefined();
    const res = await fetch(`${baseUrl}/api/shipping-guides/${toDelete!.id}`, {
      method: "DELETE",
      headers: headers("live"),
    });
    expect(res.status).toBe(200);
    const guides = await list();
    expect(guides.map((s) => s.label)).toEqual(["second"]);
  });

  it("isolates snapshots by scope", async () => {
    await save("live-guide", guideData("a"), "live");
    await save("sandbox-guide", guideData("b"), "sandbox");
    expect((await list("live")).map((s) => s.label)).toEqual(["live-guide"]);
    expect((await list("sandbox")).map((s) => s.label)).toEqual(["sandbox-guide"]);
  });

  it("cannot delete another scope's snapshot", async () => {
    const liveGuides = await save("live-guide", guideData("a"), "live");
    const liveId = liveGuides[0]!.id;
    const res = await fetch(`${baseUrl}/api/shipping-guides/${liveId}`, {
      method: "DELETE",
      headers: headers("sandbox"),
    });
    expect(res.status).toBe(200);
    expect((await list("live")).map((s) => s.label)).toEqual(["live-guide"]);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await fetch(`${baseUrl}/api/shipping-guides`, {
      method: "POST",
      headers: headers("live"),
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/shipping-guides/not-a-number`, {
      method: "DELETE",
      headers: headers("live"),
    });
    expect(res.status).toBe(400);
  });
});
