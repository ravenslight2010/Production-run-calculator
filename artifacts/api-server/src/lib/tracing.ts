import { Request } from "express";
import { Logger } from "pino";

/**
 * Request tracing: inject and propagate request IDs through all layers
 * (DB queries, AI API calls, cross-service calls) for end-to-end observability.
 */

export interface TraceContext {
  requestId: string;
  userId: string | null;
  timestamp: number;
  scope: string;
}

export function extractTraceContext(req: Request): TraceContext {
  return {
    requestId:
      (req as any).id ||
      `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId: (req as any).user?.id || null,
    timestamp: Date.now(),
    scope: (req as any).scope || "live",
  };
}

/**
 * Log structured metrics for AI API calls.
 * Use in ai.ts routes to track:
 * - Call counts and latencies
 * - Model errors vs. business errors
 * - Incident clustering accuracy
 * - Proactive alert nudge acceptance rates
 */
export interface AiMetrics {
  endpoint: string; // e.g. 'parse-spec-sheet', 'match-import'
  model: string; // e.g. 'gpt-4', 'gemini-pro'
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  status: "success" | "error" | "fallback";
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export function logAiMetric(metric: AiMetrics, log: Logger) {
  const level = metric.status === "error" ? "error" : "info";
  log[level](metric, `AI metric: ${metric.endpoint}`);
}

/**
 * Log sync conflict resolution for offline-first data reconciliation.
 * Answers: Are merges converging? Which fields conflict most? Is data drifting?
 */
export interface SyncConflictEvent {
  scope: string;
  date: string;
  fieldsWithConflicts: string[];
  conflictCount: number;
  resolution: "additive-union" | "server-wins" | "client-wins";
  clientStateHash: string;
  serverStateHash: string;
  mergedStateHash: string;
  timestamp: number;
}

export function logSyncConflict(event: SyncConflictEvent, logger: Logger) {
  logger.info(event, "Sync conflict resolved");
}
