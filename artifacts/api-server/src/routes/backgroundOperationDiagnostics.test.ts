import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDiagnostics: vi.fn(),
}));

vi.mock("../middlewares/requireCapability", () => ({
  requireCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/backgroundOperations", () => ({
  getBackgroundOperationDiagnostics: mocks.getDiagnostics,
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { default: router } = await import("./backgroundOperationDiagnostics");
  const app = express();
  app.use(router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /background-operations/diagnostics", () => {
  it("returns only active fixed-operation names and sanitized timestamps", async () => {
    mocks.getDiagnostics.mockResolvedValue({
      "daily-rollover": {
        status: "warning",
        recentFailureCount: 3,
        threshold: 3,
        windowMs: 300_000,
        lastFailureAt: "2026-09-15T12:30:00.000Z",
        errorCode: "PRIVATE_INTERNAL_CODE",
      },
      "server-job-run": {
        status: "ok",
        recentFailureCount: 0,
        threshold: 3,
        windowMs: 300_000,
      },
      "server-job-prune": {
        status: "ok",
        recentFailureCount: 0,
        threshold: 3,
        windowMs: 300_000,
      },
      "web-push-schedule": {
        status: "ok",
        recentFailureCount: 0,
        threshold: 3,
        windowMs: 300_000,
      },
    });

    const response = await fetch(`${baseUrl}/background-operations/diagnostics`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      warnings: [{
        operation: "daily-rollover",
        lastFailureAt: "2026-09-15T12:30:00.000Z",
      }],
      windowMs: 300_000,
    });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_INTERNAL_CODE");
    expect(JSON.stringify(body)).not.toMatch(/errorCode|recentFailureCount|threshold/);
  });
});