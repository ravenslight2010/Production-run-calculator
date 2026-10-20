// Incident request validation, privacy redaction, and safe logging helpers.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildIncidentContext,
  isSafeCorrelationId,
  safeIncidentLogMetadata,
} from "./incidentsAi";

describe("buildIncidentContext — privacy-safe bounded evidence", () => {
  it("redacts secrets, contacts, queries, and paths while normalizing the device", () => {
    const context = buildIncidentContext({
      source: "auto_crash",
      screen: "/run",
      appPlatform: "web",
      errorMessage: "GET https://example.test/run?token=secret for person@example.com abcdefghijklmnopqrstuvwxyz123456",
      errorStack: "Error\n    at save (/Users/person/private/source.ts:12:3)\n".repeat(20),
      userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17 Safari/605.1.15",
      diagnostics: {
        action: "save_run",
        outcome: "error",
        retryCount: 99,
        connectivity: "online",
        syncState: "retrying",
        signalKind: "sync",
      },
    });

    expect(context.errorMessage).toContain("?[redacted]");
    expect(context.errorMessage).toContain("[contact redacted]");
    expect(context.errorMessage).toContain("[token redacted]");
    expect(context.errorStack).toContain("[path redacted]");
    expect(context.errorStack?.split("\n").length).toBeLessThanOrEqual(12);
    expect(context.browserFamily).toBe("Safari");
    expect(context.deviceClass).toBe("phone");
    expect(context.retryCount).toBe(10);
  });

  it("rejects token-shaped references and produces only allowlisted log metadata", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.secretpayload";
    const data = {
      source: "auto_crash" as const,
      screen: `/Users/private/person?token=${token}`,
      appPlatform: "web" as const,
      appVersion: token,
      errorMessage: "failed",
      diagnostics: { correlationId: token },
    };
    const context = buildIncidentContext(data);
    expect(context.relatedCorrelationId).toBeUndefined();
    expect(isSafeCorrelationId(token)).toBe(false);
    expect(isSafeCorrelationId("2bcc5135-248e-4989-aac0-e2228d30c375")).toBe(true);
    const metadata = safeIncidentLogMetadata(data, context);
    expect(JSON.stringify(metadata)).not.toContain(token);
    expect(JSON.stringify(metadata)).not.toContain("private");
    expect(metadata.screenClass).toBe("other");
  });

  it("keeps bounded API classifications and client-reported request references explicit", () => {
    const data = {
      source: "auto_crash" as const,
      screen: "/",
      appPlatform: "web" as const,
      errorMessage: "API 500",
      diagnostics: {
        signalKind: "api_failure" as const,
        correlationId: "018f3a8b-1b2c-4d3e-8f90-123456789abc",
        requestOperationCategory: "sync" as const,
        requestRoute: "sync_today_write" as const,
        requestOutcome: "http_server_error" as const,
        requestReasonCode: "SYNC_PAYLOAD_TOO_LARGE" as const,
        requestElapsedMs: 4_023_360,
        requestObservedAt: new Date("2026-10-16T22:48:00.000Z"),
        requestBackgroundInvolvement: "not_observed" as const,
        requestHttpStatus: 500,
      },
    };
    const context = buildIncidentContext(data);
    expect(context).toMatchObject({
      relatedCorrelationId: data.diagnostics.correlationId,
      requestOperationCategory: "sync",
      requestRoute: "sync_today_write",
      requestOutcome: "http_server_error",
      requestReasonCode: "SYNC_PAYLOAD_TOO_LARGE",
      requestElapsedMs: 4_023_360,
      requestObservedAt: "2026-10-16T22:48:00.000Z",
      requestBackgroundInvolvement: "not_observed",
      requestHttpStatus: 500,
    });
    const metadata = safeIncidentLogMetadata(data, context);
    expect(metadata).toMatchObject({
      requestOperationCategory: "sync",
      requestOutcome: "http_server_error",
      requestHttpStatus: 500,
    });
    expect(JSON.stringify(metadata)).not.toContain(data.diagnostics.correlationId);

    const forged = buildIncidentContext({
      ...data,
      diagnostics: {
        ...data.diagnostics,
        requestRoute: "private-record",
        requestReasonCode: "private-user-data",
        correlationId: "private-record-id",
        requestElapsedMs: 90_000_000,
        requestObservedAt: new Date("2001-01-01T00:00:00.000Z"),
      } as any,
    });
    expect(forged.relatedCorrelationId).toBeUndefined();
    expect(forged.requestElapsedMs).toBe(10_000_000);
    expect(forged.requestObservedAt).toBeUndefined();
    expect(forged.requestRoute).toBeUndefined();
    expect(forged.requestReasonCode).toBeUndefined();
  });
});

describe("incident route rate-limit keys are namespaced independently", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function fireMiddleware(
    middleware: ReturnType<typeof import("../middlewares/rateLimit").rateLimit>,
    userId: string,
  ) {
    const setHeader = vi.fn();
    const json = vi.fn(() => res);
    const status = vi.fn(() => res);
    const res = { setHeader, status, json } as unknown as import("express").Response;
    const req = {
      ip: "1.2.3.4",
      userId,
      log: { error: vi.fn(), warn: vi.fn() },
    } as unknown as import("express").Request;
    const next = vi.fn() as unknown as import("express").NextFunction;

    middleware(req, res, next);
    await vi.waitFor(() => {
      const n = (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      const s = status.mock.calls.length;
      expect(n + s).toBeGreaterThan(0);
    });
    return { next, status };
  }

  it("exhausting the incident-report quota does not block the incident-clusters quota", async () => {
    const { MemoryRateLimitStore, rateLimit } = await import("../middlewares/rateLimit");
    const windowMs = 60_000;
    const max = 2;

    const reportStore = new MemoryRateLimitStore(windowMs);
    const clustersStore = new MemoryRateLimitStore(windowMs);
    const reportLimiter = rateLimit({
      windowMs,
      max,
      keyGenerator: (req) => `incident-report:${(req as { userId?: string }).userId ?? req.ip ?? "unknown"}`,
      store: reportStore,
    });
    const clustersLimiter = rateLimit({
      windowMs,
      max,
      keyGenerator: (req) => `ai-incident-clusters:${(req as { userId?: string }).userId ?? req.ip ?? "unknown"}`,
      store: clustersStore,
    });

    const userId = "user-x";
    for (let i = 0; i <= max; i++) {
      await fireMiddleware(reportLimiter, userId);
    }
    const reportBlocked = await fireMiddleware(reportLimiter, userId);
    expect(reportBlocked.status).toHaveBeenCalledWith(429);

    const clustersFirst = await fireMiddleware(clustersLimiter, userId);
    expect(clustersFirst.next).toHaveBeenCalledTimes(1);
    expect(clustersFirst.status).not.toHaveBeenCalled();
  });
});
