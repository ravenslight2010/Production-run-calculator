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
}));

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
  setProviderEnv({ AI_INTEGRATIONS_GEMINI_API_KEY: "test-replit-gemini-key" });
});

describe("GET /readyz Gemini provider configuration", () => {
  it.each([
    {
      name: "Replit Gemini credentials",
      env: { AI_INTEGRATIONS_GEMINI_API_KEY: "test-replit-gemini-key" },
      expectedStatus: 200,
      expectedDependency: "ok",
    },
    {
      name: "a direct Gemini credential",
      env: { GOOGLE_API_KEY: "test-direct-gemini-key" },
      expectedStatus: 200,
      expectedDependency: "ok",
    },
    {
      name: "only an unused OpenAI credential",
      env: { OPENAI_API_KEY: "test-unused-openai-key" },
      expectedStatus: 503,
      expectedDependency: "error",
    },
    {
      name: "no AI credential",
      env: {},
      expectedStatus: 503,
      expectedDependency: "error",
    },
  ])("classifies $name", async ({
    env,
    expectedStatus,
    expectedDependency,
  }) => {
    setProviderEnv(env);

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      checks: Record<string, string>;
    };

    expect(response.status).toBe(expectedStatus);
    expect(body.checks.dependencies).toBe(expectedDependency);
    expect(JSON.stringify(body)).not.toContain("test-");
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
  it("returns 503 after sustained failures and recovers after a successful pass", async () => {
    for (let i = 0; i < BACKGROUND_OPERATION_FAILURE_THRESHOLD; i += 1) {
      await expect(runBackgroundOperation("daily-rollover", async () => {
        throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      }, { delay: async () => {} })).rejects.toBeTruthy();
    }

    let response = await fetch(`${baseUrl}/readyz`);
    let body = (await response.json()) as {
      checks: Record<string, string>;
      diagnostics: { backgroundOperations: Record<string, { status: string; recentFailureCount: number }> };
    };
    expect(response.status).toBe(503);
    expect(body.checks.backgroundWorkers).toBe("error");
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
        dependencies: "pending",
      },
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
        dependencies: "pending",
      },
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
