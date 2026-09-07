import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (previousOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
});

beforeEach(async () => {
  await clearCacheMaintenanceDiagnosticsForTests();
  resetStartupHealthForTests();
  mocks.execute.mockClear();
  mocks.info.mockClear();
  previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "configured-for-test";
});

describe("GET /healthz cache maintenance diagnostics", () => {
  it("surfaces recurring failures without changing healthy probe behavior", async () => {
    const maintenanceLog = { info: vi.fn(), warn: vi.fn() };
    for (let i = 0; i < CACHE_MAINTENANCE_FAILURE_THRESHOLD; i += 1) {
      await recordCacheMaintenance(
        { scope: "live", operation: "prune", waitDurationMs: 10, outcome: "error" },
        maintenanceLog,
      );
    }

    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json() as {
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
    expect(JSON.stringify(body.diagnostics)).not.toMatch(/prompt|result|cache.?key/i);
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
    let body = await response.json() as { status: string; checks: Record<string, string> };
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "starting",
      checks: { startup: "error", database: "pending", dependencies: "pending" },
    });

    markStartupFailed("data_heals", "data_heals_failed", 2_500);
    response = await fetch(`${baseUrl}/healthz`);
    body = await response.json() as { status: string; checks: Record<string, string> };
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      checks: { startup: "error", database: "pending", dependencies: "pending" },
    });
    expect(JSON.stringify(body)).not.toMatch(/password|secret|database_url|stack/i);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});