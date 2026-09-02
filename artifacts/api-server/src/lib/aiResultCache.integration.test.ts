// Real-Postgres coverage for the AI result cache boundary.
//
// The cache is deliberately persisted outside the API process. These tests
// prove that a validated result survives clearing the process-local in-flight
// state, while the request scope still partitions otherwise identical keys.
// Expired and malformed rows are also treated as misses and replaced.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so
// the throwaway database is created and DATABASE_URL is redirected before the
// dynamic imports below.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { runWithScope, type Scope } from "./requestScope";
import type { AiCacheResult } from "./aiResultCache";

type DbModule = typeof import("@workspace/db");
type CacheModule = typeof import("./aiResultCache");

let db: DbModule["db"];
let pool: DbModule["pool"];
let aiResultCacheTable: DbModule["aiResultCacheTable"];
let cache: CacheModule;
let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const operation = "integration-summary";
const valid = (value: unknown): value is { answer: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { answer?: unknown }).answer === "string";

function cacheKey(cacheModule: CacheModule = cache): string {
  return cacheModule.fingerprintAiOperation({
    operation,
    model: "integration-model",
    system: "integration-system",
    user: "same grounded request",
  });
}

function readOrCreate(
  scope: Scope,
  load: () => Promise<{ answer: string }>,
  cacheModule: CacheModule = cache,
): Promise<AiCacheResult<{ answer: string }>> {
  return runWithScope(scope, () =>
    cacheModule.getOrCreateAiResult({
      operation,
      key: cacheKey(cacheModule),
      validate: valid,
      load: async () => ({ value: await load() }),
    }),
  );
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set");

  adminPool = new pg.Pool({
    connectionString: originalDatabaseUrl,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 90_000,
  });
  adminPool.on("error", () => {});
  testDbName = `helium_ai_cache_int_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  const push = spawnSync(
    "pnpm",
    ["--filter", "@workspace/db", "run", "push-force"],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: testUrlStr },
      encoding: "utf8",
      timeout: 90_000,
      killSignal: "SIGTERM",
    },
  );
  if (push.status !== 0) {
    const reason =
      (push.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ||
      push.signal
        ? "timed out after 90 seconds"
        : `exited with status ${push.status}`;
    throw new Error(
      `drizzle push-force ${reason}:\n${push.stdout}\n${push.stderr}`,
    );
  }

  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  db = dbMod.db;
  pool = dbMod.pool;
  aiResultCacheTable = dbMod.aiResultCacheTable;
  cache = await import("./aiResultCache");
  pool.on("error", () => {});
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(
        `DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`,
      );
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  cache.clearAiResultInFlightForTests();
  await db.delete(aiResultCacheTable);
});

describe("AI result cache persistence and scope isolation", () => {
  it("serves a validated persisted result after process-local state is cleared", async () => {
    const firstLoad = async () => ({ answer: "persisted result" });
    const first = await readOrCreate("live", firstLoad);
    expect(first).toEqual({ value: { answer: "persisted result" }, hit: false });

    // A restart loses in-flight coalescing state but must retain the DB row.
    cache.clearAiResultInFlightForTests();
    const providerAfterRestart = async () => ({ answer: "provider should not run" });
    const afterRestart = await readOrCreate("live", providerAfterRestart);

    expect(afterRestart).toEqual({
      value: { answer: "persisted result" },
      hit: true,
    });
  });

  it("coalesces a concurrent miss across isolated cache modules and keeps the row scoped", async () => {
    // Vite query imports create isolated module instances while sharing the
    // same database module/pool, which models separate API process owners.
    const firstOwner = await import("./aiResultCache" + "?owner=first");
    const secondOwner = await import("./aiResultCache" + "?owner=second");
    let providerCalls = 0;
    let signalProviderStarted!: () => void;
    let releaseProvider!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      signalProviderStarted = resolve;
    });
    const providerMayFinish = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const load = async () => {
      providerCalls += 1;
      signalProviderStarted();
      await providerMayFinish;
      return { answer: "one provider result" };
    };

    // Separate module instances represent separate API processes: their
    // process-local in-flight maps cannot coalesce this request.
    const first = readOrCreate("live", load, firstOwner);
    await providerStarted;
    const second = readOrCreate("live", load, secondOwner);
    releaseProvider();
    await Promise.all([first, second]);

    expect(providerCalls).toBe(1);
    await expect(first).resolves.toEqual({
      value: { answer: "one provider result" },
      hit: false,
    });
    await expect(second).resolves.toEqual({
      value: { answer: "one provider result" },
      hit: true,
    });

    const rows = await db.select().from(aiResultCacheTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scope).toBe("live");
    expect(rows[0]?.namespace).toBe(firstOwner.AI_RESULT_CACHE_NAMESPACE);
    expect(rows[0]?.operationKey).toBe(cacheKey(firstOwner));
    expect(rows[0]?.result).toEqual({ answer: "one provider result" });
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not share a same-key result between request scopes", async () => {
    const liveLoad = async () => ({ answer: "live result" });
    const sandboxLoad = async () => ({ answer: "sandbox result" });

    await expect(readOrCreate("live", liveLoad)).resolves.toEqual({
      value: { answer: "live result" },
      hit: false,
    });
    const sandbox = await readOrCreate("sandbox", sandboxLoad);

    expect(sandbox).toEqual({
      value: { answer: "sandbox result" },
      hit: false,
    });
    cache.clearAiResultInFlightForTests();
    await expect(readOrCreate("live", async () => ({ answer: "not used" }))).resolves.toEqual({
      value: { answer: "live result" },
      hit: true,
    });
  });

  it.each([
    {
      label: "expired",
      value: { answer: "expired result" },
      expiresAt: new Date(0),
      replacement: "fresh after expiry",
    },
    {
      label: "malformed",
      value: { answer: 42 },
      expiresAt: new Date(Date.now() + 60_000),
      replacement: "fresh after validation",
    },
  ])("replaces a $label persisted entry with a fresh provider result", async (entry) => {
    await db.insert(aiResultCacheTable).values({
      scope: "live",
      namespace: cache.AI_RESULT_CACHE_NAMESPACE,
      operationKey: cacheKey(),
      result: entry.value,
      expiresAt: entry.expiresAt,
    });

    const load = async () => ({ answer: entry.replacement });
    await expect(readOrCreate("live", load)).resolves.toEqual({
      value: { answer: entry.replacement },
      hit: false,
    });

    cache.clearAiResultInFlightForTests();
    const rows = await db.select().from(aiResultCacheTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scope).toBe("live");
    expect(rows[0]?.operationKey).toBe(cacheKey());
    expect(rows[0]?.result).toEqual({ answer: entry.replacement });
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});