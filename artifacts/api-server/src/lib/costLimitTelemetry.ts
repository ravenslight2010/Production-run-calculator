import { logger } from "./logger";
import type {
  CostLimitTelemetryFields,
  CostLimitTelemetryLogger,
} from "./rateLimitCost";

function safeCostAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1_000_000_000, Math.max(0, Math.round(value)));
}

/**
 * Emit bounded cost-limit telemetry without retaining request, image, prompt,
 * or route-specific payload data. This is deliberately best-effort so a
 * logging failure can never change the limiter's decision.
 */
export function recordCostLimitEvent(
  fields: CostLimitTelemetryFields,
  log: CostLimitTelemetryLogger = logger,
): void {
  const outcome = fields.outcome;
  const event = {
    event: "cost_limit",
    scope: fields.scope,
    outcome,
    actorHash: fields.actorHash.slice(0, 64),
    requestedCost: safeCostAmount(fields.requestedCost),
    usedCost: safeCostAmount(fields.usedCost),
    limitCost: safeCostAmount(fields.limitCost),
    remainingCost: safeCostAmount(fields.remainingCost),
    safeCounts: {
      nearLimitResponses: outcome === "near_limit" ? 1 : 0,
      rejections: outcome === "rejected" ? 1 : 0,
    },
  };

  try {
    if (outcome === "rejected") {
      log.warn?.(event, "cost limit rejected request");
    } else {
      log.info?.(event, "cost limit nearing budget");
    }
  } catch {
    // Observability is intentionally fail-safe. A broken logger must not turn
    // an otherwise valid request or rejection into an application error.
  }
}