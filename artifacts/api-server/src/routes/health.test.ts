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
}));

vi.mock("../lib/buildInfo", () => ({ getBuildInfo: mocks.buildInfo }));

vi.mock("@workspace/db", () => ({
  db: { execute: mocks.execute },
  pool: mocks.pool,
}));

vi.mock("../lib/logger", () => ({
  logger: { info: mocks.info },
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
      sourcePolicy: "production-source-v1", sourceFingerprintSha256: "a".repeat(64),
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
      name: "only a proposed local endpoint",
      env: { LOCAL_AI_BASE_URL: "http://127.0.0.1:11434/v1" },
      expectedStatus: 200,
      expectedDependency: "warning",
      expectedAiStatus: "not_configured",
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
