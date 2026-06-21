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
import type { Express } from "express";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";
import { CACHE_CONTROL_EXCLUSIONS } from "../lib/cacheControl";
import { collectGetRoutePathsFromRouter } from "../lib/routeScan";

// Boot the REAL, fully-assembled app (app.ts: pino-http, cors, cookie-parser,
// body parsers, the dev token-in-URL promotion, then the router mounted at
// /api) instead of a hand-rebuilt minimal copy, so a caching/middleware
// regression introduced in app.ts itself — e.g. a future cache layer mounted
// ahead of the router, or a change to how the router is mounted — is caught
// here. We only swap the pino logger for a silent one so the suite doesn't spam
// stdout or spin up the pino-pretty transport worker; everything else is the
// production middleware stack.
vi.mock("../lib/logger", async () => {
  const pino = (await import("pino")).default;
  return { logger: pino({ enabled: false }) };
});

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

// Every non-excluded GET pattern the *live, assembled* router actually serves.
// Derived from the router stack (not source text) in beforeAll, so a GET added
// via a sub-router, a computed path, or `router.all(...)` is still checked.
let noStorePatterns: string[] = [];

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
  // singleton pool binds to it. We import the real app.ts (which transitively
  // imports the router) AND the router directly: app.ts mounts the same router
  // module instance at /api, and the direct import is what we introspect for
  // route discovery below.
  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const appMod = await import("../app");
  db = dbMod.db;
  pool = dbMod.pool;
  userRolesTable = dbMod.userRolesTable;
  usersTable = dbMod.usersTable;

  // Derive the at-risk GET set from the live router stack (the same router
  // mounted below), minus the intentional exclusions. This is what makes a
  // sub-router / computed-path / router.all GET get checked automatically.
  noStorePatterns = collectGetRoutePathsFromRouter(routerMod.default)
    .filter((pattern) => !excludedPatterns.has(pattern))
    .sort();

  // Seed a single manager so authenticated requests succeed everywhere.
  await db.insert(usersTable).values([{ id: MANAGER, username: "manager", passwordHash: "x" }]);
  await db.insert(userRolesTable).values([{ userId: MANAGER, role: "manager" }]);

  // The real, fully-assembled production app (router mounted at /api), with only
  // the logger stubbed (see vi.mock above). This exercises the entire app.ts
  // middleware stack so a cache regression there — not just in the router — is
  // caught.
  const app: Express = appMod.default;

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

// The runtime no-store check is DERIVED, not hand-maintained: we introspect the
// live, assembled router stack (see beforeAll) for every GET it actually serves
// and subtract the exclusion list. Because this reads what Express registered —
// not literal `router.get("…")` source text — a brand-new shared-list GET is
// verified end-to-end automatically even if it's added via a sub-router, a
// computed/variable path, or `router.all(...)`. We assert the header regardless
// of the response body: noStoreMiddleware runs before the handler, so even a 404
// (e.g. an absent incident) still carries it.

// SSE streams stream forever and set their own streaming headers, so they need
// special request handling (abort once headers arrive) in the exclusion suite.
// Keyed by route pattern, matching CACHE_CONTROL_EXCLUSIONS keys.
const SSE_EXCLUSIONS = new Set<string>(["/sync/events", "/inventory/events"]);

// Representative concrete values for routes with required path params, so the
// derived pattern can be hit at runtime. ":date" only ever appears on excluded
// sync routes, but we cover it for completeness.
function concretePath(pattern: string): string {
  return pattern
    .split("/")
    .map((seg) => {
      if (!seg.startsWith(":")) return seg;
      return seg === ":date" ? "2026-06-21" : "1";
    })
    .join("/");
}

const excludedPatterns = new Set(Object.keys(CACHE_CONTROL_EXCLUSIONS));

describe("no-store cache headers on at-risk GET endpoints", () => {
  // If discovery ever finds nothing, the suite would be silently vacuous.
  it("derived at least one at-risk GET to check", () => {
    expect(noStorePatterns.length).toBeGreaterThan(0);
  });

  // One end-to-end pass over every non-excluded GET the live router serves.
  // Because the set is derived from the assembled router stack (in beforeAll),
  // a GET added via a sub-router / computed path / router.all is checked here
  // automatically — no per-route test has to be hand-written. Failures are
  // aggregated so one missing header doesn't hide the rest.
  it("every at-risk GET sends the no-store triplet", async () => {
    const failures: string[] = [];
    for (const pattern of noStorePatterns) {
      const pathname = `/api${concretePath(pattern)}`;
      const res = await get(pathname);
      const cacheControl = res.headers.get("cache-control");
      const pragma = res.headers.get("pragma");
      const expires = res.headers.get("expires");
      // Drain the body so the connection is released for the next request.
      await res.arrayBuffer();
      if (
        cacheControl !== "no-store, no-cache, must-revalidate" ||
        pragma !== "no-cache" ||
        expires !== "0"
      ) {
        failures.push(
          `${pathname} → cache-control: ${cacheControl ?? "(none)"}, ` +
            `pragma: ${pragma ?? "(none)"}, expires: ${expires ?? "(none)"}`,
        );
      }
    }
    expect(
      failures,
      `These at-risk GET routes did not send the no-store triplet (a shared-data ` +
        `page that ships cacheable reintroduces the stale-data bug):\n${failures.join("\n")}`,
    ).toEqual([]);
  });
});

describe("intentional no-store exclusions", () => {
  // Non-streaming exclusions (health probe, username lookup, full-payload sync
  // GETs) must stay freely cacheable — derived from CACHE_CONTROL_EXCLUSIONS so
  // a newly-added exclusion is verified automatically.
  const PLAIN_EXCLUSIONS = Object.keys(CACHE_CONTROL_EXCLUSIONS).filter(
    (pattern) => !SSE_EXCLUSIONS.has(pattern),
  );
  for (const pattern of PLAIN_EXCLUSIONS) {
    // username-available requires a query param; everything else ignores it.
    const concrete = concretePath(pattern);
    const pathname =
      pattern === "/auth/username-available" ? `/api${concrete}?username=probe` : `/api${concrete}`;
    it(`GET ${pathname} is NOT no-store`, async () => {
      const res = await get(pathname);
      expect(res.headers.get("cache-control")).not.toBe("no-store, no-cache, must-revalidate");
      await res.arrayBuffer();
    });
  }

  // SSE streams set their own streaming headers (Cache-Control: no-cache, not
  // the full no-store triplet) and push payloads/nudges to clients, so they are
  // deliberately excluded — applying noStore here would be wrong.
  for (const pattern of SSE_EXCLUSIONS) {
    const pathname = `/api${pattern}`;
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
