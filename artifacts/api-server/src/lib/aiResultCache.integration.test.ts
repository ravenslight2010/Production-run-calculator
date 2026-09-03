// Real-Postgres coverage for the AI result cache boundary.
//
// The cache is deliberately persisted outside the API process. These tests
// prove that a validated result survives clearing the process-local in-flight
// state, while the request scope still partitions otherwise identical keys.
// Expired and malformed rows are also treated as misses and replaced. Writes
// additionally prune expired rows and retain only the newest bounded set.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so
// the throwaway database is created and DATABASE_URL is redirected before the
// dynamic imports below.

import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import express from "express";
import pg from "pg";
import { runWithScope, type Scope } from "./requestScope";
import type { AiCacheResult } from "./aiResultCache";

type DbModule = typeof import("@workspace/db");
type CacheModule = typeof import("./aiResultCache");
type ObservabilityModule = typeof import("./observability");
type CacheLog = {
  info: (fields: unknown, message?: string) => void;
  warn?: (fields: unknown, message?: string) => void;
};

let db: DbModule["db"];
let pool: DbModule["pool"];
let aiResultCacheTable: DbModule["aiResultCacheTable"];
let cacheMaintenanceEventsTable: DbModule["cacheMaintenanceEventsTable"];
let cache: CacheModule;
let observability: ObservabilityModule;
let healthServer: Server;
let healthBaseUrl: string;
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

function cacheKey(
  cacheModule: CacheModule = cache,
  request = "same grounded request",
): string {
  return cacheModule.fingerprintAiOperation({
    operation,
    model: "integration-model",
    system: "integration-system",
    user: request,
  });
}

function readOrCreate(
  scope: Scope,
  load: () => Promise<{ answer: string }>,
  cacheModule: CacheModule = cache,
  request = "same grounded request",
  log?: CacheLog,
): Promise<AiCacheResult<{ answer: string }>> {
  return runWithScope(scope, () =>
    cacheModule.getOrCreateAiResult({
      operation,
      key: cacheKey(cacheModule, request),
      validate: valid,
      load: async () => ({ value: await load() }),
      log,
    }),
  );
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set");

  // Intentional exception: this out-of-band admin pool only creates and drops
  // the throwaway database used by this suite. It is not an API request pool,
  // so its longer setup deadline must not be used as the checkout-safety
  // contract for @workspace/db's active shared pool.
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
  cacheMaintenanceEventsTable = dbMod.cacheMaintenanceEventsTable;
  cache = await import("./aiResultCache");
  observability = await import("./observability");
  const healthRouter = (await import("../routes/health")).default;
  const healthApp = express();
  healthApp.use(healthRouter);
  await new Promise<void>((resolve) => {
    healthServer = healthApp.listen(0, () => resolve());
  });
  healthBaseUrl = `http://127.0.0.1:${(healthServer.address() as AddressInfo).port}`;
  pool.on("error", () => {});
}, 60_000);

afterAll(async () => {
  if (healthServer) {
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  }
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
  await observability.clearCacheMaintenanceDiagnosticsForTests();
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

  it("lets a second cache owner retry a failed provider request without persisting the failure", async () => {
    const firstOwner = await import("./aiResultCache" + "?owner=failure-first");
    const secondOwner = await import("./aiResultCache" + "?owner=failure-second");
    await db.insert(aiResultCacheTable).values({
      scope: "live",
      namespace: firstOwner.AI_RESULT_CACHE_NAMESPACE,
      operationKey: cacheKey(firstOwner),
      result: { answer: 42 },
      expiresAt: new Date(Date.now() + 60_000),
    });

    let providerCalls = 0;
    let signalFirstProviderStarted!: () => void;
    let releaseFirstProvider!: () => void;
    const firstProviderStarted = new Promise<void>((resolve) => {
      signalFirstProviderStarted = resolve;
    });
    const firstProviderMayFail = new Promise<void>((resolve) => {
      releaseFirstProvider = resolve;
    });
    let signalSecondProviderStarted!: () => void;
    let releaseSecondProvider!: () => void;
    const secondProviderStarted = new Promise<void>((resolve) => {
      signalSecondProviderStarted = resolve;
    });
    const secondProviderMayFinish = new Promise<void>((resolve) => {
      releaseSecondProvider = resolve;
    });
    const providerError = new Error("provider unavailable");
    const load = async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        signalFirstProviderStarted();
        await firstProviderMayFail;
        throw providerError;
      }
      signalSecondProviderStarted();
      await secondProviderMayFinish;
      return { answer: "provider recovered" };
    };

    const first = readOrCreate("live", load, firstOwner);
    await firstProviderStarted;
    const second = readOrCreate("live", load, secondOwner);

    // The second owner is waiting on the advisory lock while the first owner
    // fails. Releasing it makes the retry acquire the lock and re-read the DB.
    releaseFirstProvider();
    await expect(first).rejects.toBe(providerError);
    await secondProviderStarted;

    // The failed owner must leave neither the seeded malformed row nor an
    // encoded provider error behind for the retrying owner to consume.
    expect(await db.select().from(aiResultCacheTable)).toHaveLength(0);

    releaseSecondProvider();
    await expect(second).resolves.toEqual({
      value: { answer: "provider recovered" },
      hit: false,
    });
    expect(providerCalls).toBe(2);

    const rows = await db.select().from(aiResultCacheTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toEqual({ answer: "provider recovered" });
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Persistence is shared by both isolated owners after recovery.
    await expect(
      readOrCreate("live", async () => ({ answer: "provider should not run" }), firstOwner),
    ).resolves.toEqual({
      value: { answer: "provider recovered" },
      hit: true,
    });
    expect(providerCalls).toBe(2);
  });

  it("keeps a recovered result when pruning reaches the row limit", async () => {
    const targetKey = cacheKey();
    const seededUpdatedAt = new Date(Date.now() - 60_000);
    const seededRows = Array.from(
      { length: cache.AI_RESULT_CACHE_MAX_ROWS },
      (_, index) => ({
        scope: "live",
        namespace: cache.AI_RESULT_CACHE_NAMESPACE,
        operationKey: `row-limit-seed-${index}`,
        result: { answer: `seed-${index}` },
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: seededUpdatedAt,
        updatedAt: seededUpdatedAt,
      }),
    );
    await db.insert(aiResultCacheTable).values([
      ...seededRows,
      {
        scope: "live",
        namespace: cache.AI_RESULT_CACHE_NAMESPACE,
        operationKey: targetKey,
        result: { answer: 42 },
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: seededUpdatedAt,
        updatedAt: seededUpdatedAt,
      },
    ]);

    await expect(
      readOrCreate("live", async () => ({ answer: "recovered at row limit" })),
    ).resolves.toEqual({
      value: { answer: "recovered at row limit" },
      hit: false,
    });

    const rows = await db.select().from(aiResultCacheTable);
    expect(rows).toHaveLength(cache.AI_RESULT_CACHE_MAX_ROWS);
    expect(rows.find((row) => row.operationKey === targetKey)?.result).toEqual({
      answer: "recovered at row limit",
    });
    expect(rows.some((row) => row.operationKey === "row-limit-seed-0")).toBe(false);
  });

  it("keeps the row cap deterministic when different cache owners recover concurrently", async () => {
    const owners = await Promise.all([
      import("./aiResultCache" + "?contention-owner-0"),
      import("./aiResultCache" + "?contention-owner-1"),
      import("./aiResultCache" + "?contention-owner-2"),
      import("./aiResultCache" + "?contention-owner-3"),
    ]);
    const now = Date.now();
    const seededUpdatedAt = new Date(now - 60_000);
    const expiredAt = new Date(now - 30_000);
    const freshAt = new Date(now + 60_000);
    await db.insert(aiResultCacheTable).values(
      [
        ...Array.from({ length: cache.AI_RESULT_CACHE_MAX_ROWS }, (_, index) => ({
          scope: "live",
          namespace: cache.AI_RESULT_CACHE_NAMESPACE,
          operationKey: `contention-seed-${index}`,
          result: { answer: `seed-${index}` },
          expiresAt: freshAt,
          createdAt: seededUpdatedAt,
          updatedAt: seededUpdatedAt,
        })),
        ...Array.from({ length: 2 }, (_, index) => ({
          scope: "live",
          namespace: cache.AI_RESULT_CACHE_NAMESPACE,
          operationKey: `contention-expired-${index}`,
          result: { answer: `expired-${index}` },
          expiresAt: expiredAt,
          createdAt: seededUpdatedAt,
          updatedAt: seededUpdatedAt,
        })),
      ],
    );

    let providersStarted = 0;
    let signalAllProvidersStarted!: () => void;
    let releaseProviders!: () => void;
    const allProvidersStarted = new Promise<void>((resolve) => {
      signalAllProvidersStarted = resolve;
    });
    const providersMayFinish = new Promise<void>((resolve) => {
      releaseProviders = resolve;
    });
    const requests = owners.map((owner, index) =>
      readOrCreate(
        "live",
        async () => {
          providersStarted += 1;
          if (providersStarted === owners.length) signalAllProvidersStarted();
          await providersMayFinish;
          return { answer: `fresh-${index}` };
        },
        owner,
        `contention request ${index}`,
      ),
    );

    await allProvidersStarted;
    releaseProviders();
    await expect(Promise.all(requests)).resolves.toHaveLength(owners.length);

    const rows = await db.select().from(aiResultCacheTable);
    expect(rows).toHaveLength(cache.AI_RESULT_CACHE_MAX_ROWS);
    expect(rows.every((row) => row.expiresAt.getTime() > Date.now())).toBe(true);
    for (const [index, owner] of owners.entries()) {
      const freshKey = cacheKey(owner, `contention request ${index}`);
      expect(rows.find((row) => row.operationKey === freshKey)?.result).toEqual({
        answer: `fresh-${index}`,
      });
    }
    expect(
      rows.some((row) => row.operationKey.startsWith("contention-expired-")),
    ).toBe(false);
    expect(rows.some((row) => row.operationKey === "contention-seed-0")).toBe(false);
  });

  it("keeps live and sandbox recovery independent while live pruning is contended", async () => {
    const [liveOwner, sandboxOwner] = await Promise.all([
      import("./aiResultCache" + "?scope-contention-live"),
      import("./aiResultCache" + "?scope-contention-sandbox"),
    ]);
    const now = Date.now();
    const seededUpdatedAt = new Date(now - 60_000);
    const expiredAt = new Date(now - 30_000);
    const freshAt = new Date(now + 60_000);
    const seedRows = (scope: Scope, prefix: string) => [
      ...Array.from({ length: cache.AI_RESULT_CACHE_MAX_ROWS }, (_, index) => ({
        scope,
        namespace: cache.AI_RESULT_CACHE_NAMESPACE,
        operationKey: `${prefix}-old-${index}`,
        result: { answer: `${prefix} old ${index}` },
        expiresAt: freshAt,
        createdAt: seededUpdatedAt,
        updatedAt: seededUpdatedAt,
      })),
      {
        scope,
        namespace: cache.AI_RESULT_CACHE_NAMESPACE,
        operationKey: `${prefix}-expired`,
        result: { answer: `${prefix} expired` },
        expiresAt: expiredAt,
        createdAt: seededUpdatedAt,
        updatedAt: seededUpdatedAt,
      },
    ];

    await db.insert(aiResultCacheTable).values([
      ...seedRows("live", "live"),
      ...seedRows("sandbox", "sandbox"),
    ]);

    const livePruneLock = await pool.connect();
    await livePruneLock.query("BEGIN");
    await livePruneLock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${liveOwner.AI_RESULT_CACHE_NAMESPACE}:live:prune`],
    );

    let signalLiveProviderStarted!: () => void;
    let releaseLiveProvider!: () => void;
    const liveProviderStarted = new Promise<void>((resolve) => {
      signalLiveProviderStarted = resolve;
    });
    const liveProviderMayFinish = new Promise<void>((resolve) => {
      releaseLiveProvider = resolve;
    });
    const liveRecovery = readOrCreate(
      "live",
      async () => {
        signalLiveProviderStarted();
        await liveProviderMayFinish;
        return { answer: "live fresh result" };
      },
      liveOwner,
    );
    await liveProviderStarted;
    releaseLiveProvider();

    let signalSandboxProviderStarted!: () => void;
    const sandboxProviderStarted = new Promise<void>((resolve) => {
      signalSandboxProviderStarted = resolve;
    });
    const sandboxRecovery = readOrCreate(
      "sandbox",
      async () => {
        signalSandboxProviderStarted();
        return { answer: "sandbox fresh result" };
      },
      sandboxOwner,
    );

    try {
      // The live recovery is blocked on its held prune lock. A scope-qualified
      // lock must still let sandbox acquire its own key and prune locks.
      await expect(
        Promise.race([
          sandboxRecovery,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("sandbox recovery waited on live pruning")),
              5_000,
            ),
          ),
        ]),
      ).resolves.toEqual({
        value: { answer: "sandbox fresh result" },
        hit: false,
      });
      await sandboxProviderStarted;

      const rowsWhileLiveIsBlocked = await db.select().from(aiResultCacheTable);
      const liveRowsWhileBlocked = rowsWhileLiveIsBlocked.filter(
        (row) => row.scope === "live",
      );
      expect(liveRowsWhileBlocked).toHaveLength(cache.AI_RESULT_CACHE_MAX_ROWS + 1);
      expect(
        liveRowsWhileBlocked.some((row) => row.operationKey === "live-expired"),
      ).toBe(true);
      expect(
        liveRowsWhileBlocked.some((row) => row.operationKey === "live-old-0"),
      ).toBe(true);

      const sandboxRows = rowsWhileLiveIsBlocked.filter(
        (row) => row.scope === "sandbox",
      );
      expect(
        sandboxRows,
      ).toHaveLength(cache.AI_RESULT_CACHE_MAX_ROWS);
      expect(
        sandboxRows.some((row) => row.operationKey === "sandbox-old-0"),
      ).toBe(false);
      expect(
        sandboxRows.some((row) => row.operationKey === "sandbox-expired"),
      ).toBe(false);
    } finally {
      await livePruneLock.query("ROLLBACK");
      livePruneLock.release();
    }

    await expect(liveRecovery).resolves.toEqual({
      value: { answer: "live fresh result" },
      hit: false,
    });

    const rows = await db.select().from(aiResultCacheTable);
    const targetKey = cacheKey(liveOwner);
    for (const [scope, prefix, expectedAnswer] of [
      ["live", "live", "live fresh result"],
      ["sandbox", "sandbox", "sandbox fresh result"],
    ] as const) {
      const scopedRows = rows.filter((row) => row.scope === scope);
      expect(scopedRows).toHaveLength(cache.AI_RESULT_CACHE_MAX_ROWS);
      expect(scopedRows.every((row) => row.scope === scope)).toBe(true);
      expect(scopedRows.some((row) => row.operationKey === `${prefix}-expired`)).toBe(
        false,
      );
      expect(scopedRows.some((row) => row.operationKey === `${prefix}-old-0`)).toBe(
        false,
      );
      expect(scopedRows.find((row) => row.operationKey === targetKey)?.result).toEqual({
        answer: expectedAnswer,
      });
    }
  });

  it("records scoped, bounded telemetry for concurrent cache maintenance", async () => {
    const [liveOwner, sandboxOwner] = await Promise.all([
      import("./aiResultCache" + "?telemetry-contention-live"),
      import("./aiResultCache" + "?telemetry-contention-sandbox"),
    ]);
    const liveLog = { info: vi.fn() };
    const sandboxLog = { info: vi.fn() };
    const livePruneLock = await pool.connect();
    await livePruneLock.query("BEGIN");
    await livePruneLock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${liveOwner.AI_RESULT_CACHE_NAMESPACE}:live:prune`],
    );

    let signalLiveProviderStarted!: () => void;
    const liveProviderStarted = new Promise<void>((resolve) => {
      signalLiveProviderStarted = resolve;
    });
    const liveMaintenance = readOrCreate(
      "live",
      async () => {
        signalLiveProviderStarted();
        return { answer: "live telemetry result" };
      },
      liveOwner,
      "telemetry live request",
      liveLog,
    );

    try {
      await liveProviderStarted;
      await expect(
        readOrCreate(
          "sandbox",
          async () => ({ answer: "sandbox telemetry result" }),
          sandboxOwner,
          "telemetry sandbox request",
          sandboxLog,
        ),
      ).resolves.toEqual({
        value: { answer: "sandbox telemetry result" },
        hit: false,
      });
    } finally {
      await livePruneLock.query("ROLLBACK");
      livePruneLock.release();
    }

    await expect(liveMaintenance).resolves.toEqual({
      value: { answer: "live telemetry result" },
      hit: false,
    });

    const expectedFields = [
      "event",
      "operation",
      "outcome",
      "scope",
      "waitDurationMs",
    ];
    for (const [scope, log] of [
      ["live", liveLog],
      ["sandbox", sandboxLog],
    ] as const) {
      expect(log.info).toHaveBeenCalledTimes(1);
      const [fields, message] = log.info.mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
      expect(Object.keys(fields).sort()).toEqual(expectedFields);
      expect(fields).toMatchObject({
        event: "cache_maintenance",
        scope,
        operation: "prune",
        outcome: "success",
      });
      expect(fields.waitDurationMs).toEqual(expect.any(Number));
      expect(fields.waitDurationMs).toBeGreaterThanOrEqual(0);
      expect(fields.waitDurationMs).toBeLessThanOrEqual(
        7 * 24 * 60 * 60 * 1000,
      );
      expect(Number.isInteger(fields.waitDurationMs)).toBe(true);
      expect(fields).not.toHaveProperty("prompt");
      expect(fields).not.toHaveProperty("result");
      expect(message).toBe("cache maintenance completed");
    }
  });

  it("records a bounded error event when real pruning fails without failing the request", async () => {
    const log = { info: vi.fn() };
    const expiredKey = "prune-failure-expired";
    const triggerName = "ai_result_cache_prune_failure_trigger";
    const functionName = "ai_result_cache_prune_failure";

    await db.insert(aiResultCacheTable).values({
      scope: "live",
      namespace: cache.AI_RESULT_CACHE_NAMESPACE,
      operationKey: expiredKey,
      result: { answer: "expired result" },
      expiresAt: new Date(Date.now() - 60_000),
    });
    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'controlled cache prune failure';
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE DELETE ON ai_result_cache
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `);

    try {
      await expect(
        readOrCreate(
          "live",
          async () => ({ answer: "provider result survives prune failure" }),
          cache,
          "prompt contains request data that must not be logged",
          log,
        ),
      ).resolves.toEqual({
        value: { answer: "provider result survives prune failure" },
        hit: false,
      });
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ai_result_cache`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    expect(log.info).toHaveBeenCalledTimes(1);
    const [fields, message] = log.info.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(Object.keys(fields).sort()).toEqual([
      "event",
      "operation",
      "outcome",
      "scope",
      "waitDurationMs",
    ]);
    expect(fields).toMatchObject({
      event: "cache_maintenance",
      scope: "live",
      operation: "prune",
      outcome: "error",
    });
    expect(fields.waitDurationMs).toEqual(expect.any(Number));
    expect(fields.waitDurationMs).toBeGreaterThanOrEqual(0);
    expect(fields.waitDurationMs).toBeLessThanOrEqual(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(Number.isInteger(fields.waitDurationMs)).toBe(true);
    expect(fields).not.toHaveProperty("prompt");
    expect(fields).not.toHaveProperty("result");
    expect(message).toBe("cache maintenance completed");
  });

  it("keeps cache requests available and local recurrence visible when shared diagnostics reject", async () => {
    const owner = await import("./aiResultCache" + "?diagnostics-outage");
    const log = { info: vi.fn(), warn: vi.fn() };
    const expiredKey = "diagnostics-outage-expired";
    const pruneTriggerName = "ai_result_cache_diagnostics_outage_prune_trigger";
    const pruneFunctionName = "ai_result_cache_diagnostics_outage_prune";
    const diagnosticsTriggerName = "cache_maintenance_diagnostics_outage_trigger";
    const diagnosticsFunctionName = "cache_maintenance_diagnostics_outage";
    const requestPayloads = Array.from(
      { length: observability.CACHE_MAINTENANCE_FAILURE_THRESHOLD },
      (_, index) => `private request payload ${index}`,
    );
    const resultPayloads = requestPayloads.map((_, index) => ({
      answer: `private result payload ${index}`,
    }));

    await db.insert(aiResultCacheTable).values({
      scope: "live",
      namespace: owner.AI_RESULT_CACHE_NAMESPACE,
      operationKey: expiredKey,
      result: { answer: "expired private result" },
      expiresAt: new Date(Date.now() - 60_000),
    });
    await pool.query(`
      CREATE FUNCTION ${pruneFunctionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'controlled cache prune failure';
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER ${pruneTriggerName}
      BEFORE DELETE ON ai_result_cache
      FOR EACH ROW EXECUTE FUNCTION ${pruneFunctionName}();
    `);
    await pool.query(`
      CREATE FUNCTION ${diagnosticsFunctionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'controlled shared diagnostics outage';
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER ${diagnosticsTriggerName}
      BEFORE INSERT OR DELETE ON cache_maintenance_events
      FOR EACH ROW EXECUTE FUNCTION ${diagnosticsFunctionName}();
    `);

    try {
      for (const [index, requestPayload] of requestPayloads.entries()) {
        await expect(
          readOrCreate(
            "live",
            async () => resultPayloads[index]!,
            owner,
            requestPayload,
            log,
          ),
        ).resolves.toEqual({
          value: resultPayloads[index],
          hit: false,
        });
      }

      await vi.waitFor(() => {
        expect(log.warn).toHaveBeenCalledOnce();
      });
      expect(log.warn).toHaveBeenCalledWith(
        {
          event: "cache_maintenance_recurrence",
          scope: "live",
          operation: "prune",
          recentErrorCount: observability.CACHE_MAINTENANCE_FAILURE_THRESHOLD,
          threshold: observability.CACHE_MAINTENANCE_FAILURE_THRESHOLD,
          windowMs: observability.CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
        },
        "cache maintenance failures recurring",
      );

      expect(log.info).toHaveBeenCalledTimes(
        observability.CACHE_MAINTENANCE_FAILURE_THRESHOLD,
      );
      for (const [fields] of log.info.mock.calls) {
        expect(Object.keys(fields as Record<string, unknown>).sort()).toEqual([
          "event",
          "operation",
          "outcome",
          "scope",
          "waitDurationMs",
        ]);
      }
      const diagnosticsOutput = JSON.stringify({
        info: log.info.mock.calls,
        warn: log.warn.mock.calls,
      });
      for (const requestPayload of requestPayloads) {
        expect(diagnosticsOutput).not.toContain(requestPayload);
        expect(diagnosticsOutput).not.toContain(cacheKey(owner, requestPayload));
      }
      for (const resultPayload of resultPayloads) {
        expect(diagnosticsOutput).not.toContain(resultPayload.answer);
      }
      expect(diagnosticsOutput).not.toContain("expired private result");
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS ${diagnosticsTriggerName} ON cache_maintenance_events`,
      );
      await pool.query(`DROP FUNCTION IF EXISTS ${diagnosticsFunctionName}()`);
      await pool.query(`DROP TRIGGER IF EXISTS ${pruneTriggerName} ON ai_result_cache`);
      await pool.query(`DROP FUNCTION IF EXISTS ${pruneFunctionName}()`);
    }

    await expect(db.select().from(cacheMaintenanceEventsTable)).resolves.toHaveLength(0);
  });

  it("keeps cache requests available and local recurrence visible when shared diagnostics stall", async () => {
    const owner = await import("./aiResultCache" + "?diagnostics-stall");
    const log = { info: vi.fn(), warn: vi.fn() };
    const expiredKey = "diagnostics-stall-expired";
    const pruneTriggerName = "ai_result_cache_diagnostics_stall_prune_trigger";
    const pruneFunctionName = "ai_result_cache_diagnostics_stall_prune";
    const requestPayloads = Array.from(
      { length: 12 },
      (_, index) => `private stalled request payload ${index}`,
    );
    const resultPayloads = requestPayloads.map((_, index) => ({
      answer: `private stalled result payload ${index}`,
    }));
    const diagnosticsLock = await pool.connect();

    await db.insert(aiResultCacheTable).values({
      scope: "live",
      namespace: owner.AI_RESULT_CACHE_NAMESPACE,
      operationKey: expiredKey,
      result: { answer: "expired stalled private result" },
      expiresAt: new Date(Date.now() - 60_000),
    });
    await pool.query(`
      CREATE FUNCTION ${pruneFunctionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'controlled cache prune failure during diagnostics stall';
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER ${pruneTriggerName}
      BEFORE DELETE ON ai_result_cache
      FOR EACH ROW EXECUTE FUNCTION ${pruneFunctionName}();
    `);
    await diagnosticsLock.query("BEGIN");
    await diagnosticsLock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["cache-maintenance:live:prune"],
    );

    let poolAvailabilityCheck: Promise<unknown> | undefined;
    try {
      const requests = requestPayloads.map((requestPayload, index) =>
        readOrCreate(
          "live",
          async () => resultPayloads[index]!,
          owner,
          requestPayload,
          log,
        ),
      );
      await expect(
        Promise.race([
          Promise.all(requests),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("cache requests waited for stalled diagnostics")),
              4_000,
            ),
          ),
        ]),
      ).resolves.toEqual(
        resultPayloads.map((value) => ({ value, hit: false })),
      );

      await vi.waitFor(
        () => {
          expect(log.warn).toHaveBeenCalledOnce();
        },
        { timeout: 2_500 },
      );
      expect(log.warn).toHaveBeenCalledWith(
        {
          event: "cache_maintenance_recurrence",
          scope: "live",
          operation: "prune",
          recentErrorCount: observability.CACHE_MAINTENANCE_FAILURE_THRESHOLD,
          threshold: observability.CACHE_MAINTENANCE_FAILURE_THRESHOLD,
          windowMs: observability.CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
        },
        "cache maintenance failures recurring",
      );

      const diagnosticsOutput = JSON.stringify({
        info: log.info.mock.calls,
        warn: log.warn.mock.calls,
      });
      for (const requestPayload of requestPayloads) {
        expect(diagnosticsOutput).not.toContain(requestPayload);
        expect(diagnosticsOutput).not.toContain(cacheKey(owner, requestPayload));
      }
      for (const resultPayload of resultPayloads) {
        expect(diagnosticsOutput).not.toContain(resultPayload.answer);
      }
      expect(diagnosticsOutput).not.toContain("expired stalled private result");

      // The caller has already fallen back locally. Wait while the blocking
      // lock remains held, then prove timed-out diagnostic transactions have
      // released their pool connections rather than leaving later work queued.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      poolAvailabilityCheck = pool.query("SELECT 1");
      await expect(
        Promise.race([
          poolAvailabilityCheck,
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error("stalled diagnostics kept a pool connection queued"),
                ),
              500,
            ),
          ),
        ]),
      ).resolves.toBeDefined();
    } finally {
      await diagnosticsLock.query("ROLLBACK");
      diagnosticsLock.release();
      if (poolAvailabilityCheck) await poolAvailabilityCheck;
      await pool.query(`DROP TRIGGER IF EXISTS ${pruneTriggerName} ON ai_result_cache`);
      await pool.query(`DROP FUNCTION IF EXISTS ${pruneFunctionName}()`);
    }

    const storedRows = await db.select().from(cacheMaintenanceEventsTable);
    // Every shared write was blocked long enough to hit its database deadline,
    // so no late transaction should insert an event after the lock is released.
    expect(storedRows).toHaveLength(0);
  });

  it("keeps /healthz responsive when every pool client is checked out", async () => {
    const heldClients: pg.PoolClient[] = [];
    try {
      for (let index = 0; index < pool.options.max; index += 1) {
        heldClients.push(await pool.connect());
      }
      const startedAt = Date.now();

      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBeGreaterThanOrEqual(pool.options.max);

      const response = await fetch(`${healthBaseUrl}/healthz`);
      const body = await response.json() as {
        checks: { database: string };
        diagnostics: {
          cacheMaintenance: {
            live: { status: string; recentErrorCount: number };
            sandbox: { status: string; recentErrorCount: number };
          };
        };
      };

      // The pool's acquisition timeout must win before the route can wait
      // indefinitely behind the held clients. The database probe and the two
      // diagnostics scopes may each time out, so allow both bounded rounds.
      expect(Date.now() - startedAt).toBeLessThan(3_000);
      expect(pool.waitingCount).toBe(0);
      expect(response.status).toBe(503);
      expect(body.checks.database).toBe("error");
      expect(body.diagnostics.cacheMaintenance.live).toMatchObject({
        status: "ok",
        recentErrorCount: 0,
      });
      expect(body.diagnostics.cacheMaintenance.sandbox).toMatchObject({
        status: "ok",
        recentErrorCount: 0,
      });
    } finally {
      for (const client of heldClients) client.release();
    }
  });

  it("rejects a queued checkout after the pool deadline and recovers afterward", async () => {
    const heldClients: pg.PoolClient[] = [];
    let queuedCheckout: Promise<pg.PoolClient> | undefined;
    try {
      for (let index = 0; index < pool.options.max; index += 1) {
        heldClients.push(await pool.connect());
      }

      expect(pool.idleCount).toBe(0);
      expect(pool.waitingCount).toBe(0);

      const startedAt = Date.now();
      queuedCheckout = pool.connect();
      await vi.waitFor(() => {
        expect(pool.waitingCount).toBe(1);
      });

      await expect(queuedCheckout).rejects.toThrow(/timeout/i);
      // connectionTimeoutMillis must remove the waiter, not merely stop the
      // caller from awaiting it while node-postgres keeps it queued.
      expect(pool.waitingCount).toBe(0);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700);
    } finally {
      for (const client of heldClients) client.release();
      if (queuedCheckout) await queuedCheckout.catch(() => undefined);
    }

    await expect(pool.query("SELECT 1")).resolves.toMatchObject({
      rows: [{ "?column?": 1 }],
    });
  });

  it("allows an acquired client to finish a legitimately slow API request", async () => {
    const slowApp = express();
    slowApp.get("/slow-db-request", async (_req, res, next) => {
      try {
        const result = await pool.query(
          "SELECT pg_sleep(1.2), 42 AS value",
        );
        res.json({ value: result.rows[0]?.value });
      } catch (error) {
        next(error);
      }
    });
    slowApp.use(
      (
        _error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).json({ error: "slow request failed" });
      },
    );

    let slowServer: Server | undefined;
    try {
      slowServer = await new Promise<Server>((resolve) => {
        const server = slowApp.listen(0, () => resolve(server));
      });
      const port = (slowServer.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/slow-db-request`);
      const body = await response.json() as { value?: number; error?: string };

      expect(response.status).toBe(200);
      expect(body).toEqual({ value: 42 });
    } finally {
      if (slowServer) {
        await new Promise<void>((resolve) => slowServer!.close(() => resolve()));
      }
    }
  });

  it("aggregates maintenance failures across isolated API owners and scopes", async () => {
    const [liveOwner, sandboxOwner] = await Promise.all([
      import("./observability" + "?aggregate-owner-live"),
      import("./observability" + "?aggregate-owner-sandbox"),
    ]);
    const liveLog = { info: vi.fn(), warn: vi.fn() };
    const sandboxLog = { info: vi.fn(), warn: vi.fn() };
    const failure = {
      operation: "prune" as const,
      waitDurationMs: 8,
      outcome: "error" as const,
    };

    await liveOwner.recordCacheMaintenance({ ...failure, scope: "live" }, liveLog);
    await sandboxOwner.recordCacheMaintenance({ ...failure, scope: "sandbox" }, sandboxLog);
    await liveOwner.recordCacheMaintenance({ ...failure, scope: "live" }, liveLog);
    expect(liveLog.warn).not.toHaveBeenCalled();
    expect(sandboxLog.warn).not.toHaveBeenCalled();

    // The third failure is on a different module instance, modeling a second
    // API process. It must cross the same shared threshold and emit one warning.
    await sandboxOwner.recordCacheMaintenance({ ...failure, scope: "live" }, sandboxLog);
    expect(liveLog.warn).not.toHaveBeenCalled();
    expect(sandboxLog.warn).toHaveBeenCalledOnce();
    expect(sandboxLog.warn).toHaveBeenCalledWith(
      {
        event: "cache_maintenance_recurrence",
        scope: "live",
        operation: "prune",
        recentErrorCount: 3,
        threshold: liveOwner.CACHE_MAINTENANCE_FAILURE_THRESHOLD,
        windowMs: liveOwner.CACHE_MAINTENANCE_FAILURE_WINDOW_MS,
      },
      "cache maintenance failures recurring",
    );

    const diagnostics = await liveOwner.getCacheMaintenanceDiagnostics(Date.now());
    expect(diagnostics.live).toMatchObject({
      status: "warning",
      recentErrorCount: 3,
    });
    expect(diagnostics.sandbox).toMatchObject({
      status: "ok",
      recentErrorCount: 1,
    });

    for (let index = 0; index < liveOwner.CACHE_MAINTENANCE_FAILURE_MAX_EVENTS + 7; index += 1) {
      await liveOwner.recordCacheMaintenance({ ...failure, scope: "live" }, liveLog);
    }
    const retained = (await db.select().from(cacheMaintenanceEventsTable)).filter(
      (row) => row.scope === "live" && row.operation === "prune",
    );
    expect(retained).toHaveLength(liveOwner.CACHE_MAINTENANCE_FAILURE_MAX_EVENTS);
    expect(
      retained.every(
        (row) => row.scope === "live" && row.operation === "prune",
      ),
    ).toBe(true);
  });

  it("removes expired rows before pruning the recovered result", async () => {
    const targetKey = cacheKey();
    const now = Date.now();
    const expiredAt = new Date(now - 60_000);
    const freshAt = new Date(now + 60_000);
    await db.insert(aiResultCacheTable).values([
      {
        scope: "live",
        namespace: cache.AI_RESULT_CACHE_NAMESPACE,
        operationKey: "expiry-seed-0",
        result: { answer: "expired" },
        expiresAt: expiredAt,
      },
      {
        scope: "live",
        namespace: cache.AI_RESULT_CACHE_NAMESPACE,
        operationKey: "expiry-seed-1",
        result: { answer: "expired too" },
        expiresAt: expiredAt,
      },
      {
        scope: "live",
        namespace: cache.AI_RESULT_CACHE_NAMESPACE,
        operationKey: "expiry-fresh",
        result: { answer: "keep this" },
        expiresAt: freshAt,
      },
      {
        scope: "live",
        namespace: cache.AI_RESULT_CACHE_NAMESPACE,
        operationKey: targetKey,
        result: { answer: 42 },
        expiresAt: expiredAt,
      },
    ]);

    await expect(
      readOrCreate("live", async () => ({ answer: "recovered after expiry pruning" })),
    ).resolves.toEqual({
      value: { answer: "recovered after expiry pruning" },
      hit: false,
    });

    const rows = await db.select().from(aiResultCacheTable);
    expect(rows.map((row) => row.operationKey).sort()).toEqual(
      ["expiry-fresh", targetKey].sort(),
    );
    expect(rows.every((row) => row.expiresAt.getTime() > Date.now())).toBe(true);
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