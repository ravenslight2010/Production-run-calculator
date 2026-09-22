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
  execute: vi.fn(async () => []),
  info: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mocks.execute },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: mocks.info },
}));

let server: Server;
let baseUrl: string;
let previousOpenAiKey: string | undefined;
let previousGeminiKey: string | undefined;
let previousGoogleKey: string | undefined;

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
  if (previousGeminiKey === undefined) {
    delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  } else {
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousGeminiKey;
  }
  if (previousOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
  if (previousGoogleKey === undefined) {
    delete process.env.GOOGLE_API_KEY;
  } else {
    process.env.GOOGLE_API_KEY = previousGoogleKey;
  }
});

beforeEach(async () => {
  await clearCacheMaintenanceDiagnosticsForTests();
  await clearBackgroundOperationDiagnosticsForTests();
  resetStartupHealthForTests();
  mocks.execute.mockClear();
  mocks.info.mockClear();
  previousGeminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "configured-for-test";
  previousGoogleKey = process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_API_KEY;
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

  it("flags a missing AI provider as degraded", async () => {
    delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const response = await fetch(`${baseUrl}/readyz`);
    const body = (await response.json()) as {
      checks: Record<string, string>;
    };

    expect(response.status).toBe(503);
    expect(body.checks.dependencies).toBe("error");
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
