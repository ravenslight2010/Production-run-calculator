// Integration test: POST /api/auth/reset-password is blocked when authRateLimit fires.
//
// POST /auth/reset-password uses authRateLimit (20 requests / 60 s per IP). If
// that middleware were accidentally removed or misconfigured the endpoint would
// be silently open to brute-force code guessing against approved reset requests.
// The unit-level tests in rateLimit.test.ts prove the middleware itself works;
// THIS test proves the middleware is actually wired onto the reset-password route
// in routes/auth.ts so a future accidental removal cannot go undetected.
//
// Strategy: exhaust the limit by sending AUTH_RATE_MAX requests with a valid-
// schema body but a wrong/expired reset code (all return 401 — the route handler
// fires but finds no matching, unexpired reset row in the empty test DB). The
// rate-limit counter increments on every request, including rejected ones — that
// is the intended behaviour so brute-force code guessing still exhausts the
// budget. The next request must return 429 regardless of its body.
//
// Like the other *.integration.test.ts files in this directory, this stands up
// a disposable Postgres database so the real router can import @workspace/db.
// @workspace/db binds its pool at import time, so the throwaway DB and
// DATABASE_URL must be in place BEFORE the dynamic import of the router.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let pool: DbModule["pool"];

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

// The production cap defined in routes/auth.ts. Keeping this in sync with the
// source constant is intentional — the test would need to be updated if the cap
// changes, which is exactly the right behaviour (it documents what the limit is).
const AUTH_RATE_MAX = 20;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_resetpw_ratelimit_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  pool = dbMod.pool;
  pool.on("error", () => {});

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // The real router expects req.log to be set by a logging middleware.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  // All fetch() calls from the test process originate from the local loopback
  // address (127.0.0.1), so every request naturally lands in the same
  // rate-limit bucket without any IP override.
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
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

// Helper: POST /api/auth/reset-password with a valid-schema body but a wrong
// reset code for a user that does not exist in the (empty) test DB. Returns the
// raw Response so the caller can inspect the status. The handler fires,
// finds no matching user/reset-row, and responds 401, so each call increments
// the rate-limit counter exactly once without creating any DB state.
function resetPasswordWrongCode(): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: `nouser_${Math.random().toString(36).slice(2)}`,
      code: "definitely-wrong-code",
      newPassword: "newpassword99",
    }),
  });
}

describe("POST /api/auth/reset-password — authRateLimit fires after AUTH_RATE_MAX requests", () => {
  it(
    "returns 429 on the request that exceeds the cap and 401 for all requests within it",
    async () => {
      // Send AUTH_RATE_MAX requests with a wrong/expired reset code. Each uses
      // a non-existent username so the server returns 401 (the reset code look-up
      // finds no matching row). The rate-limit counter increments on every
      // request, including rejected ones — that is the intended behaviour so
      // brute-force code guessing still exhausts the budget.
      for (let i = 1; i <= AUTH_RATE_MAX; i++) {
        const res = await resetPasswordWrongCode();
        // Every request within the cap must be processed by the route handler
        // (invalid/expired code → 401), not intercepted by the rate limiter.
        expect(
          res.status,
          `request ${i} of ${AUTH_RATE_MAX} should reach the handler (401), got ${res.status}`,
        ).toBe(401);
      }

      // The very next request exceeds the cap. The rate-limit middleware must
      // intercept it BEFORE the route handler runs and return 429.
      const blocked = await resetPasswordWrongCode();
      expect(blocked.status, "request over the cap should be rate-limited (429)").toBe(429);

      const body = (await blocked.json()) as { error: string };
      expect(body.error).toBe("Too many requests. Please wait a moment and try again.");
    },
    // The test makes AUTH_RATE_MAX + 1 sequential HTTP round-trips to a local
    // server; a generous timeout prevents spurious failures in slow environments.
    30_000,
  );
});
