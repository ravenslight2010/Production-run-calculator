import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

export type OperationOutcome = "success" | "error" | "degraded";

const OPERATION_NAMES: Array<[RegExp, string]> = [
  [/\/sync(?:\/|$)/, "sync"],
  [/\/(?:ai|photo|quality|label|waste)/, "ai"],
  [/\/(?:inventory|ingredients|mixes)/, "inventory"],
  [/\/(?:export|reports)/, "export"],
  [/\/(?:roles|auth|staff|permissions)/, "permission"],
  [/\/(?:import|spec-sheet|shipping-guide|premix)/, "import"],
];

export function operationType(path: string): string {
  return OPERATION_NAMES.find(([pattern]) => pattern.test(path))?.[1] ?? "request";
}

export function safeQueueAgeMs(queuedAt: unknown, now = Date.now()): number | undefined {
  if (typeof queuedAt !== "number" || !Number.isFinite(queuedAt)) return undefined;
  const age = now - queuedAt;
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000 ? Math.round(age) : undefined;
}

function numericHeader(res: Response, name: string): number | undefined {
  const value = Number(res.getHeader(name));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_.-]{1,64}$/.test(code)
    ? code
    : "internal_error";
}

export function logOperation(
  log: Logger,
  fields: {
    correlationId: string;
    operationType: string;
    durationMs: number;
    outcome: OperationOutcome;
    statusCode?: number;
    safeCounts?: Record<string, number>;
    errorCode?: string;
    [key: string]: unknown;
  },
): void {
  const level = fields.outcome === "error" ? "warn" : "info";
  log[level](
    {
      event: "operation",
      correlationId: fields.correlationId,
      operationType: fields.operationType,
      durationMs: Math.max(0, Math.round(fields.durationMs)),
      outcome: fields.outcome,
      ...(fields.statusCode === undefined ? {} : { statusCode: fields.statusCode }),
      ...(fields.safeCounts ? { safeCounts: fields.safeCounts } : {}),
      ...(fields.errorCode ? { errorCode: fields.errorCode } : {}),
      ...(fields.syncResponse ? { syncResponse: fields.syncResponse } : {}),
      ...(fields.syncRetries === undefined ? {} : { syncRetries: fields.syncRetries }),
      ...(fields.syncQueueAgeMs === undefined ? {} : { syncQueueAgeMs: fields.syncQueueAgeMs }),
      ...(fields.syncConvergence ? { syncConvergence: fields.syncConvergence } : {}),
    },
    "operation completed",
  );
}

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestCorrelationId =
    typeof req.header("x-correlation-id") === "string" &&
    /^[a-zA-Z0-9_.:-]{1,128}$/.test(req.header("x-correlation-id")!)
      ? req.header("x-correlation-id")!
      : typeof req.id === "string" ? req.id : randomUUID();
  const correlationId = requestCorrelationId;
  const startedAt = performance.now();
  res.setHeader("X-Correlation-ID", correlationId);
  (req as Request & { correlationId?: string }).correlationId = correlationId;

  res.once("finish", () => {
    const statusCode = res.statusCode;
    logOperation((req as Request & { log?: Logger }).log ?? logger, {
      correlationId,
      operationType: operationType(req.path),
      durationMs: performance.now() - startedAt,
      outcome: statusCode >= 500 ? "error" : statusCode >= 400 ? "degraded" : "success",
      statusCode,
      safeCounts: { responseBytes: Number(res.getHeader("content-length") ?? 0) },
      ...(res.getHeader("X-Sync-Response") ? { syncResponse: res.getHeader("X-Sync-Response") } : {}),
      ...(numericHeader(res, "X-Sync-Retry-Count") === undefined ? {} : { syncRetries: numericHeader(res, "X-Sync-Retry-Count") }),
      ...(numericHeader(res, "X-Sync-Queue-Age-Ms") === undefined ? {} : { syncQueueAgeMs: numericHeader(res, "X-Sync-Queue-Age-Ms") }),
      ...(res.getHeader("X-Sync-Convergence") ? { syncConvergence: res.getHeader("X-Sync-Convergence") } : {}),
    });
  });
  next();
}

export function recordStartupEvent(
  event: string,
  fields: { durationMs: number; outcome: OperationOutcome; safeCounts?: Record<string, number>; errorCode?: string },
): void {
  logOperation(logger, {
    correlationId: `startup-${process.pid}`,
    operationType: "startup",
    ...fields,
    startupEvent: event,
  });
}
