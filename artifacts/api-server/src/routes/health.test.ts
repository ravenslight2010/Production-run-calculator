import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  CACHE_MAINTENANCE_FAILURE_THRESHOLD,
  clearCacheMaintenanceDiagnosticsForTests,
  recordCacheMaintenance,
} from "../lib/observability";
import * as observability from "../lib/observability";
import {
  beginStartup,
  markStartupFailed,
  resetStartupHealthForTests,
} from "../lib/startupHealth";
import {
  BACKGROUND_OPERATION_FAILURE_THRESHOLD,
  clearBackgroundOperationDiagnosticsForTests,
  runBackgroundOperation,
} from "../lib/backgroundOperations";
import * as backgroundOperations from "../lib/backgroundOperations";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(async () => ({
    rows: [{
      has_trigger: true,
      has_guard_function: true,
      has_redact_function: true,
      has_delete_function: true,
    }],
  })),
  pool: {
    connect: vi.fn(),
  },
  info: vi.fn(),
  buildInfo: vi.fn(),
  scheduledQueueDiagnostics: vi.fn(),
  syncOutboxLagDiagnostics: vi.fn(),
}));

vi.mock("../lib/buildInfo", () => ({ getBuildInfo: mocks.buildInfo }));

vi.mock("@workspace/db", () => ({
  db: { execute: mocks.execute },
  pool: mocks.pool,
}));

vi.mock("../lib/logger", () => ({
  logger: { info: mocks.info },
}));

vi.mock("../lib/serverJobs", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/serverJobs")>(),
  getScheduledEvaluationQueueDiagnostics: mocks.scheduledQueueDiagnostics,
}));

vi.mock("../lib/syncOutbox", () => ({
  getSyncOutboxLagDiagnostics: mocks.syncOutboxLagDiagnostics,
}));

let server: Server;
let baseUrl: string;
const providerEnvKeys = [
  "AI_INTEGRATIONS_GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "LOCAL_AI_BASE_URL",
] as const;
const previousProviderEnv = Object.fromEntries(
  providerEnvKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof providerEnvKeys)[number], string | undefined>;

function setProviderEnv(
  configured: Partial<Record<(typeof providerEnvKeys)[number], string>>,
): void {
  for (const key of providerEnvKeys) delete process.env[key];
  Object.assign(process.env, configured);
}

beforeAll(async () => {
  const routerModule = await import("./health");
  const app: Express = express();
  app.use(routerModule.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const key of providerEnvKeys) {
    const previous = previousProviderEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

beforeEach(async () => {
  await clearCacheMaintenanceDiagnosticsForTests();
  await clearBackgroundOperationDiagnosticsForTests();
  resetStartupHealthForTests();
  mocks.execute.mockClear();
  mocks.info.mockClear();
  mocks.buildInfo.mockReturnValue(null);
  mocks.scheduledQueueDiagnostics.mockReturnValue({
    status: "pending",
    queued: 0,
    running: 0,
    terminalLastWindow: { succeeded: 0, failed: 0, cancelled: 0 },
    duplicateTimeBucketGroups: 0,
    duplicateGroupsTruncated: false,
    warningCodes: [],
    sampleCount: 0,
    windowMs: 300_000,
  });
  mocks.syncOutboxLagDiagnostics.mockReturnValue({
    status: "ok",
    lagging: false,
    pendingEvents: 0,
    lagMs: 0,
    warningThresholdMs: 30_000,
  });
  setProviderEnv({ AI_INTEGRATIONS_GEMINI_API_KEY: "test-replit-gemini-key" });
});

describe("public GET /build-info", () => {
  it("reports unavailable without database access or authentication", async () => {
    const response = await fetch(`${baseUrl}/build-info`);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Build version is unavailable.", status: "unavailable" });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns the sealed version while startup is incomplete, without querying the database", async () => {
    beginStartup();
    const info = {
      schemaVersion: 1, kind: "app-build-info",
      appBuildId: "app-build:00000000-0000-0000-0000-000000000000",
      sourcePolicy: "production-source-v4", sourceFingerprintSha256: "a".repeat(64),
      gitRevision: null, gitBinding: "unavailable", buildMode: "release",
      completedAt: new Date().toISOString(), platformDeploymentId: null,
      platformBuildId: null, platformIdentitySource: "unavailable",
    };
    mocks.buildInfo.mockReturnValue(info);
    const response = await fetch(`${baseUrl}/build-info`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(info);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe("GET /readyz optional AI capability", () => {
  it.each([
    {
      name: "Replit Gemini credentials",
      env: { AI_INTEGRATIONS_GEMINI_API_KEY: "test-replit-gemini-key" },
      expectedStatus: 200,
      expectedDependency: "ok",
      expectedAiStatus: "configured",
    },
    {
      name: "a direct Gemini credential",
      env: { GOOGLE_API_KEY: "test-direct-gemini-key" },
      expectedStatus: 200,
      expectedDependency: "ok",
      expectedAiStatus: "configured",
    },
    {
      name: "only an unused OpenAI credential",
      env: { OPENAI_API_KEY: "test-unused-openai-key" },
      expectedStatus: 200,
      expectedDependency: "warning",
      expectedAiStatus: "not_configured",
    },
    {
      name: "a local AI endpoint",
      env: { LOCAL_AI_BASE_URL: "http://127.0.0.1:11434/v1" },
      expectedStatus: 200,
      expectedDependency: "ok",
      expectedAiStatus: "configured",
    },
    {
      name: "no AI credential",
      env: {},
      expectedStatus: 200,
      expectedDependency: "warning",
      expectedAiStatus: "not_configured",
    },
  ])("classifies $name", async ({
    env,
    expectedStatus,
    expectedDependency,
    expectedAiStatus,
  }) => {
    setProviderEnv(env);

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      checks: Record<string, string>;
      capabilities: { ai: { status: string; detail?: string } };
    };

    expect(response.status).toBe(expectedStatus);
    expect(body.checks.dependencies).toBe(expectedDependency);
    expect(body.capabilities.ai.status).toBe(expectedAiStatus);
    if (expectedAiStatus === "not_configured") {
      expect(body.capabilities.ai.detail).toBe("ai_provider_not_configured");
      expect(body.checks.dependencies).toBe("warning");
    }
    expect(JSON.stringify(body)).not.toContain("test-");
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("test-");
  });

  it("keeps core readiness healthy when the optional import-gold evaluator is enabled but unavailable", async () => {
    const previousEnabled = process.env.IMPORT_GOLD_LOCAL_ENABLED;
    const previousBaseUrl = process.env.IMPORT_GOLD_LOCAL_BASE_URL;
    try {
      setProviderEnv({});
      process.env.IMPORT_GOLD_LOCAL_ENABLED = "true";
      process.env.IMPORT_GOLD_LOCAL_BASE_URL = "http://127.0.0.1:1/v1";
      const response = await fetch(`${baseUrl}/readyz`);
      const body = await response.json() as {
        status: string;
        checks: { database: string; dependencies: string };
        capabilities: { ai: { status: string } };
      };
      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.checks.database).toBe("ok");
      expect(body.checks.dependencies).toBe("warning");
      expect(body.capabilities.ai.status).toBe("not_configured");
    } finally {
      if (previousEnabled === undefined) delete process.env.IMPORT_GOLD_LOCAL_ENABLED;
      else process.env.IMPORT_GOLD_LOCAL_ENABLED = previousEnabled;
      if (previousBaseUrl === undefined) delete process.env.IMPORT_GOLD_LOCAL_BASE_URL;
      else process.env.IMPORT_GOLD_LOCAL_BASE_URL = previousBaseUrl;
    }
  });
});

describe("GET /readyz contention behavior", () => {
  it.each([
    { nodeEnv: "production", enabled: "1" },
    { nodeEnv: "development", enabled: "1" },
    { nodeEnv: "test", enabled: "0" },
  ])("keeps disposable instrumentation disabled for $nodeEnv with flag $enabled", async ({
    nodeEnv,
    enabled,
  }) => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousInstrumentation = process.env.API_LOAD_READINESS_INSTRUMENTATION;
    try {
      process.env.NODE_ENV = nodeEnv;
      process.env.API_LOAD_READINESS_INSTRUMENTATION = enabled;
      const response = await fetch(`${baseUrl}/readyz`);
      expect(response.status).toBe(200);
      expect([...response.headers.keys()].some((key) => key.startsWith("x-test-readiness-")))
        .toBe(false);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousInstrumentation === undefined) delete process.env.API_LOAD_READINESS_INSTRUMENTATION;
      else process.env.API_LOAD_READINESS_INSTRUMENTATION = previousInstrumentation;
    }
  });

  it("coalesces shared reads while keeping core checks independent and surviving client cancellation", async () => {
    let releaseDiagnostics!: () => void;
    const diagnosticsGate = new Promise<void>((resolve) => {
      releaseDiagnostics = resolve;
    });
    const readCacheDiagnostics = observability.getCacheMaintenanceDiagnostics;
    const readBackgroundDiagnostics = backgroundOperations.getBackgroundOperationDiagnostics;
    const cacheDiagnosticsSpy = vi
      .spyOn(observability, "getCacheMaintenanceDiagnostics")
      .mockImplementation(async (...args) => {
        await diagnosticsGate;
        return readCacheDiagnostics(...args);
      });
    const backgroundDiagnosticsSpy = vi
      .spyOn(backgroundOperations, "getBackgroundOperationDiagnostics")
      .mockImplementation(async (...args) => {
        await diagnosticsGate;
        return readBackgroundDiagnostics(...args);
      });

    try {
      const cancelledProbe = new AbortController();
      const responses = [
        fetch(`${baseUrl}/readyz`, { signal: cancelledProbe.signal }),
        ...Array.from({ length: 7 }, () => fetch(`${baseUrl}/readyz`)),
      ];
      await vi.waitFor(() => {
        expect(mocks.execute).toHaveBeenCalledTimes(16);
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(cacheDiagnosticsSpy).toHaveBeenCalledTimes(1);
      expect(backgroundDiagnosticsSpy).toHaveBeenCalledTimes(1);
      cancelledProbe.abort();
      await expect(responses[0]).rejects.toHaveProperty("name", "AbortError");
      releaseDiagnostics();

      const settled = await Promise.all(responses.slice(1));
      expect(settled.map((response) => response.status)).toEqual(Array(7).fill(200));
      expect(cacheDiagnosticsSpy).toHaveBeenCalledTimes(1);
      expect(backgroundDiagnosticsSpy).toHaveBeenCalledTimes(1);
      expect(mocks.execute).toHaveBeenCalledTimes(16);
    } finally {
      releaseDiagnostics();
      cacheDiagnosticsSpy.mockRestore();
      backgroundDiagnosticsSpy.mockRestore();
    }
  });

  it("clears a rejected shared diagnostic read so the next probe can recover", async () => {
    let releaseDiagnostics!: () => void;
    const diagnosticsGate = new Promise<void>((resolve) => {
      releaseDiagnostics = resolve;
    });
    const backgroundDiagnosticsSpy = vi
      .spyOn(backgroundOperations, "getBackgroundOperationDiagnostics")
      .mockImplementationOnce(async () => {
        await diagnosticsGate;
        throw new Error("synthetic diagnostic failure");
      });

    try {
      const responses = Array.from({ length: 4 }, () => fetch(`${baseUrl}/readyz`));
      await vi.waitFor(() => {
        expect(mocks.execute).toHaveBeenCalledTimes(8);
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(backgroundDiagnosticsSpy).toHaveBeenCalledTimes(1);
      releaseDiagnostics();

      const failedResponses = await Promise.all(responses);
      expect(failedResponses.map((response) => response.status)).toEqual(Array(4).fill(500));
      expect(backgroundDiagnosticsSpy).toHaveBeenCalledTimes(1);

      backgroundDiagnosticsSpy.mockRestore();
      const recoveredResponse = await fetch(`${baseUrl}/readyz`);
      expect(recoveredResponse.status).toBe(200);
      expect(mocks.execute).toHaveBeenCalledTimes(10);
    } finally {
      releaseDiagnostics();
      backgroundDiagnosticsSpy.mockRestore();
    }
  });

  it("logs bounded timings for database and optional diagnostic stages", async () => {
    const response = await fetch(`${baseUrl}/readyz`);

    expect(response.status).toBe(200);
    const healthLog = [...mocks.info.mock.calls]
      .reverse()
      .map(([fields]) => fields as Record<string, unknown>)
      .find((fields) => fields.event === "health_check");
    expect(healthLog).toMatchObject({
      durationMs: expect.any(Number),
      stageDurationsMs: {
        databaseCheck: expect.any(Number),
        optionalDiagnostics: expect.any(Number),
      },
    });
    expect(JSON.stringify(healthLog)).not.toMatch(/password|secret|payload|sql|query/i);
  });
});

describe("GET /healthz cache maintenance diagnostics", () => {
  it("surfaces recurring failures without changing healthy probe behavior", async () => {
    const maintenanceLog = { info: vi.fn(), warn: vi.fn() };
    for (let i = 0; i < CACHE_MAINTENANCE_FAILURE_THRESHOLD; i += 1) {
      await recordCacheMaintenance(
        {
          scope: "live",
          operation: "prune",
          waitDurationMs: 10,
          outcome: "error",
        },
        maintenanceLog,
      );
    }

    const response = await fetch(`${baseUrl}/healthz`);
    const body = (await response.json()) as {
      status: string;
      diagnostics: {
        cacheMaintenance: {
          live: { status: string; recentErrorCount: number };
          sandbox: { status: string; recentErrorCount: number };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.diagnostics.cacheMaintenance.live).toMatchObject({
      status: "warning",
      recentErrorCount: CACHE_MAINTENANCE_FAILURE_THRESHOLD,
    });
    expect(body.diagnostics.cacheMaintenance.sandbox).toMatchObject({
      status: "ok",
      recentErrorCount: 0,
    });
    expect(JSON.stringify(body.diagnostics)).not.toMatch(
      /prompt|result|cache.?key/i,
    );
  });
});

describe("GET /healthz background operation diagnostics", () => {
  it("surfaces sustained sync delivery lag without blocking core readiness or exposing scope data", async () => {
    mocks.syncOutboxLagDiagnostics.mockReturnValue({
      status: "warning",
      lagging: true,
      pendingEvents: 12,
      lagMs: 45_000,
      warningThresholdMs: 30_000,
      lastObservedAt: "2031-06-15T12:00:00.000Z",
    });

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
      diagnostics: { syncOutboxLag: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.backgroundWorkers).toBe("warning");
    expect(body.diagnostics.syncOutboxLag).toMatchObject({
      status: "warning",
      lagging: true,
      pendingEvents: 12,
      lagMs: 45_000,
    });
    expect(JSON.stringify(body.diagnostics.syncOutboxLag)).not.toContain("scope");
    expect(JSON.stringify(body.diagnostics.syncOutboxLag)).not.toContain("payload");
  });

  it("reports sustained failures without blocking core readiness and recovers after success", async () => {
    for (let i = 0; i < BACKGROUND_OPERATION_FAILURE_THRESHOLD; i += 1) {
      await expect(runBackgroundOperation("daily-rollover", async () => {
        throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      }, { delay: async () => {} })).rejects.toBeTruthy();
    }

    let response = await fetch(`${baseUrl}/readyz`);
    let body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
      diagnostics: { backgroundOperations: Record<string, { status: string; recentFailureCount: number }> };
    };
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.backgroundWorkers).toBe("warning");
    expect(body.diagnostics.backgroundOperations["daily-rollover"]).toMatchObject({
      status: "warning",
      recentFailureCount: BACKGROUND_OPERATION_FAILURE_THRESHOLD,
    });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
    await runBackgroundOperation("daily-rollover", async () => "ok");
    response = await fetch(`${baseUrl}/readyz`);
    body = await response.json() as typeof body;
    expect(response.status).toBe(200);
    expect(body.checks.backgroundWorkers).toBe("ok");
    vi.useRealTimers();
  });

  it("reports a scheduled-evaluation warning without blocking core readiness", async () => {
    mocks.scheduledQueueDiagnostics.mockReturnValue({
      status: "warning",
      sampleAvailability: "available",
      queued: 4,
      running: 1,
      terminalLastWindow: { succeeded: 3, failed: 1, cancelled: 0 },
      duplicateTimeBucketGroups: 101,
      duplicateGroupsTruncated: true,
      duplicateGroupTrend: {
        direction: "increasing",
        firstCount: 97,
        latestCount: 101,
        change: 4,
      },
      duplicateBucketInventory: [{
        bucketFingerprint: "a".repeat(24),
        rowCount: 2,
        statuses: { queued: 1, running: 1, succeeded: 0, failed: 0, cancelled: 0 },
        queuedRunnable: 1,
        queuedExhausted: 0,
        runningWithValidLease: 1,
        runningWithoutLease: 0,
        runningLeaseExpiredRetryable: 0,
        runningLeaseExpiredExhausted: 0,
        candidateCounts: {
          preserveQueuedRunnable: 1,
          preserveValidLease: 1,
          preserveExpiredRetryableLease: 0,
          workerResolutionRequired: 0,
          manualReviewRequired: 0,
          preserveTerminalHistory: 0,
          safeRemoval: 0,
        },
        reviewClass: "preserve_runnable_or_leased",
      }],
      duplicateBucketInventoryTruncated: true,
      duplicateBucketReviewRules: [
        "Preserve queued jobs with attempts remaining and running jobs with a valid lease.",
        "No rows are automatically designated safe to remove; cleanup requires a separate owner-approved, audited transaction.",
      ],
      warningCodes: ["backlog_stalled"],
      sampleCount: 6,
      windowMs: 300_000,
      lastSampleAt: "2026-10-08T12:00:00.000Z",
    });

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
      diagnostics: { scheduledEvaluationQueue: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.backgroundWorkers).toBe("warning");
    expect(body.diagnostics.scheduledEvaluationQueue).toMatchObject({
      status: "warning",
      queued: 4,
      running: 1,
      duplicateTimeBucketGroups: 101,
      duplicateGroupsTruncated: true,
      duplicateGroupTrend: {
        direction: "increasing",
        firstCount: 97,
        latestCount: 101,
        change: 4,
      },
      duplicateBucketInventoryTruncated: true,
      duplicateBucketInventory: [{
        bucketFingerprint: "a".repeat(24),
        rowCount: 2,
        reviewClass: "preserve_runnable_or_leased",
        candidateCounts: {
          preserveQueuedRunnable: 1,
          preserveValidLease: 1,
          safeRemoval: 0,
        },
      }],
      duplicateBucketReviewRules: expect.arrayContaining([
        expect.stringContaining("Preserve queued jobs"),
        expect.stringContaining("No rows are automatically designated safe to remove"),
      ]),
      warningCodes: ["backlog_stalled"],
    });
    expect(JSON.stringify(body.diagnostics.scheduledEvaluationQueue))
      .not.toMatch(/scope|idempotency|input|result/i);
  });

  it("distinguishes an unavailable queue sample from a measured backlog warning", async () => {
    mocks.scheduledQueueDiagnostics.mockReturnValue({
      status: "ok",
      sampleAvailability: "unavailable",
      queued: 4,
      running: 1,
      terminalLastWindow: { succeeded: 3, failed: 1, cancelled: 0 },
      duplicateTimeBucketGroups: 0,
      duplicateGroupsTruncated: false,
      duplicateGroupTrend: {
        direction: "unavailable",
        firstCount: null,
        latestCount: null,
        change: null,
      },
      warningCodes: [],
      sampleCount: 6,
      windowMs: 300_000,
      lastSampleAt: "2026-10-08T12:00:00.000Z",
    });

    const response = await fetch(`${baseUrl}/readyz`);
    const body = await response.json() as {
      checks: Record<string, string>;
      diagnostics: { scheduledEvaluationQueue: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(body.checks.backgroundWorkers).toBe("warning");
    expect(body.diagnostics.scheduledEvaluationQueue).toMatchObject({
      status: "ok",
      sampleAvailability: "unavailable",
      queued: 4,
      warningCodes: [],
      duplicateGroupTrend: {
        direction: "unavailable",
        firstCount: null,
        latestCount: null,
        change: null,
      },
    });
    expect(mocks.info.mock.calls.at(-1)?.[0]).toMatchObject({
      checks: { backgroundWorkers: "warning" },
    });
  });
});

describe("core readiness gates", () => {
  it("returns 503 when the database is unavailable without exposing its error", async () => {
    const rawDatabaseError = "private database connection string";
    mocks.execute.mockRejectedValueOnce(
      Object.assign(new Error(rawDatabaseError), { code: "ECONNREFUSED" }),
    );

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
      diagnostics: { auditProtection: { status: string; detail?: string } };
    };

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("error");
    expect(body.checks.auditProtection).toBe("error");
    expect(body.diagnostics.auditProtection).toEqual({
      status: "error",
      detail: "database_unreachable",
    });
    expect(JSON.stringify(body)).not.toContain(rawDatabaseError);
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain(rawDatabaseError);
  });
});

describe("audit append-only protection readiness", () => {
  it("fails readiness with an operator-facing reason when protection is missing", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          has_trigger: false,
          has_guard_function: true,
          has_redact_function: false,
          has_delete_function: true,
        }],
      });

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      checks: Record<string, string>;
      diagnostics: {
        auditProtection: { status: string; detail?: string };
      };
    };

    expect(response.status).toBe(503);
    expect(body.checks.auditProtection).toBe("error");
    expect(body.diagnostics.auditProtection).toEqual({
      status: "error",
      detail: "audit_append_only_protection_missing: append-only trigger, redact_audit_log(integer,jsonb)",
    });
  });
});

describe("readiness AI provider dependency", () => {
  it("accepts GOOGLE_API_KEY as a configured provider", async () => {
    delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GOOGLE_API_KEY = "direct-gemini-key";

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      checks: Record<string, string>;
    };

    expect(response.status).toBe(200);
    expect(body.checks.dependencies).toBe("ok");
  });

  it("reports a missing AI provider as a non-blocking readiness warning", async () => {
    delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LOCAL_AI_BASE_URL;

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      checks: Record<string, string>;
    };

    // AI is optional for core API traffic: absence is a warning, not an error.
    expect(response.status).toBe(200);
    expect(body.checks.dependencies).toBe("warning");
  });
});

describe("startup probes", () => {
  it("returns liveness without touching the database", async () => {
    beginStartup(1_000);
    const response = await fetch(`${baseUrl}/livez`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      probe: "liveness",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns a bounded 503 while startup is in progress or failed", async () => {
    beginStartup(2_000);
    let response = await fetch(`${baseUrl}/readyz`);
    let body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
      capabilities: { ai: { status: string } };
      startup: {
        phase: string;
        stage: string | null;
        durationMs: number;
        errorCode?: string;
      };
      correlationId: string;
    };
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "starting",
      checks: {
        startup: "error",
        database: "pending",
        auditProtection: "pending",
        dependencies: "pending",
        backgroundWorkers: "pending",
      },
      capabilities: { ai: { status: "pending" } },
      startup: { phase: "starting", stage: null },
    });
    expect(body.correlationId).toBeTruthy();

    markStartupFailed("data_heals", "data_heals_failed", 2_500);
    response = await fetch(`${baseUrl}/healthz`);
    body = (await response.json()) as typeof body;
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      checks: {
        startup: "error",
        database: "pending",
        auditProtection: "pending",
        dependencies: "pending",
        backgroundWorkers: "pending",
      },
      capabilities: { ai: { status: "pending" } },
      startup: {
        phase: "failed",
        stage: "data_heals",
        errorCode: "data_heals_failed",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /password|secret|database_url|stack/i,
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
