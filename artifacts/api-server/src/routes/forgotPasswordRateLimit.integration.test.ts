// Integration test: POST /api/auth/forgot-password is blocked when authRateLimit fires.
//
// POST /auth/forgot-password uses authRateLimit (20 requests / 60 s per IP).
// If that middleware were accidentally removed or misconfigured the endpoint
// would be silently open to spam and enumeration attempts. The unit-level tests
// in rateLimit.test.ts prove the middleware itself works; THIS test proves the
// middleware is actually wired onto the forgot-password route in routes/auth.ts
// so a future accidental removal cannot go undetected.
//
// Strategy: exhaust the limit by sending AUTH_RATE_MAX requests for an unknown
// username. The endpoint is intentionally enumeration-safe — it always responds
// 200 with { ok: true } whether or not the account exists — so every within-cap
// request returns 200 with no meaningful side-effects. The next request must
// return 429 regardless of its body.
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
  testDbName = `helium_forgot_ratelimit_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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

// Helper: POST /api/auth/forgot-password with an unknown username. Returns the
// raw Response so the caller can inspect the status. The endpoint always returns
// 200 with { ok: true } regardless of whether the account exists — this is a
// deliberate enumeration-safety guarantee. Each call increments the rate-limit
// counter once without creating any persistent DB state.
function forgotPasswordUnknownUser(): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: `nouser_${Math.random().toString(36).slice(2)}`,
    }),
  });
}

describe("POST /api/auth/forgot-password — authRateLimit fires after AUTH_RATE_MAX requests", () => {
  it(
    "returns 429 on the request that exceeds the cap and 200 for all requests within it",
    async () => {
      // Send AUTH_RATE_MAX requests for non-existent usernames. The endpoint is
      // enumeration-safe so every within-cap request returns 200 regardless of
      // whether the user exists. The rate-limit counter still increments each
      // time — this is the intended behaviour so spam and abuse attempts exhaust
      // the budget even when the responses look benign.
      for (let i = 1; i <= AUTH_RATE_MAX; i++) {
        const res = await forgotPasswordUnknownUser();
        // Every request within the cap must be processed by the route handler
        // (always 200 for enumeration safety), not intercepted by the rate limiter.
        expect(
          res.status,
          `request ${i} of ${AUTH_RATE_MAX} should reach the handler (200), got ${res.status}`,
        ).toBe(200);
      }

      // The very next request exceeds the cap. The rate-limit middleware must
      // intercept it BEFORE the route handler runs and return 429.
      const blocked = await forgotPasswordUnknownUser();
      expect(blocked.status, "request over the cap should be rate-limited (429)").toBe(429);

      const body = (await blocked.json()) as { error: string };
      expect(body.error).toBe("Too many requests. Please wait a moment and try again.");
    },
    // The test makes AUTH_RATE_MAX + 1 sequential HTTP round-trips to a local
    // server; a generous timeout prevents spurious failures in slow environments.
    30_000,
  );
});
