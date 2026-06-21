// Integration tests that lock in the no-store cache headers on shared,
// frequently-edited JSON GET endpoints.
//
// Task #128 added `Cache-Control: no-store` to every shared list endpoint via
// the `noStore(res)` helper (src/lib/cacheControl.ts) so that one user's edit
// propagates to other clients within seconds instead of being masked by browser
// heuristic freshness (the original "stale list" bug). Nothing guarded that:
// a future refactor could quietly drop the header from one endpoint and
// silently reintroduce the bug. These tests assert the header is present on
// every at-risk GET, and — just as importantly — that the SSE streams and the
// public health probe are intentionally left WITHOUT it (see
// `.agents/memory/no-store-cache-headers.md` for the sync-vs-inventory
// exclusion rationale).
//
// These tests stand up the *real* router against a *disposable* Postgres
// database (created from the dev DATABASE_URL's server, schema pushed via
// drizzle-kit, dropped on teardown) so nothing here ever touches real data.
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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let userRolesTable: DbModule["userRolesTable"];
let usersTable: DbModule["usersTable"];

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

// A manager so every endpoint (including the manager-only ones) passes authz —
// we only care about the cache header, not the authz behavior here.
const MANAGER = "manager-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  // Create a uniquely named throwaway database on the same Postgres server.
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  testDbName = `helium_cache_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  db = dbMod.db;
  pool = dbMod.pool;
  userRolesTable = dbMod.userRolesTable;
  usersTable = dbMod.usersTable;

  // Seed a single manager so authenticated requests succeed everywhere.
  await db.insert(usersTable).values([{ id: MANAGER, username: "manager", passwordHash: "x" }]);
  await db.insert(userRolesTable).values([{ userId: MANAGER, role: "manager" }]);

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

// A signed-in (manager) GET. SSE endpoints stream forever, so callers can pass
// an AbortController and cancel once the response headers have arrived.
async function get(pathname: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers: { authorization: `Bearer ${signToken(MANAGER)}` },
    signal,
  });
}

function expectNoStore(res: Response): void {
  expect(res.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
  expect(res.headers.get("pragma")).toBe("no-cache");
  expect(res.headers.get("expires")).toBe("0");
}

// Every shared, frequently-edited JSON GET that must never be cached. We assert
// the header regardless of the response body — `noStore(res)` runs at the top of
// each handler, so even a 404 (e.g. an absent incident) still carries it.
const NO_STORE_GETS: string[] = [
  "/api/production-rules",
  "/api/inventory",
  "/api/inventory/ledger",
  "/api/inventory/settings",
  "/api/me",
  "/api/users",
  "/api/password-reset-requests",
  "/api/incidents",
  "/api/incidents/unreviewed-count",
  "/api/incidents/1",
  "/api/runs",
  "/api/photo-aliases",
  "/api/import-aliases",
  "/api/merge-aliases",
  "/api/spec-import-aliases",
  "/api/ai-corrections",
  "/api/fill-missing-values",
  "/api/denied-merges",
];

describe("no-store cache headers on at-risk GET endpoints", () => {
  for (const pathname of NO_STORE_GETS) {
    it(`GET ${pathname} sends no-store`, async () => {
      const res = await get(pathname);
      expectNoStore(res);
      // Drain the body so the connection is released for the next test.
      await res.arrayBuffer();
    });
  }
});

describe("intentional no-store exclusions", () => {
  // The health probe is public and must stay freely cacheable.
  it("GET /api/healthz is NOT no-store", async () => {
    const res = await fetch(`${baseUrl}/api/healthz`);
    expect(res.headers.get("cache-control")).not.toBe("no-store, no-cache, must-revalidate");
    await res.arrayBuffer();
  });

  // SSE streams set their own streaming headers (Cache-Control: no-cache, not
  // the full no-store triplet) and push payloads/nudges to clients, so they are
  // deliberately excluded — applying noStore here would be wrong.
  const SSE_GETS: string[] = ["/api/sync/events", "/api/inventory/events"];
  for (const pathname of SSE_GETS) {
    it(`GET ${pathname} (SSE) is NOT no-store`, async () => {
      const controller = new AbortController();
      const res = await get(pathname, controller.signal);
      // It's a streaming response: assert it isn't the no-store triplet, then
      // abort so the never-ending stream doesn't hang the test.
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("cache-control")).not.toBe("no-store, no-cache, must-revalidate");
      expect(res.headers.get("pragma")).not.toBe("no-cache");
      controller.abort();
    });
  }
});
