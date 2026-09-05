import { Request, type Response } from "express";
import { createHash } from "node:crypto";
import type { RateLimitStore } from "../middlewares/rateLimit";

/**
 * Cost-based rate limiting: AI endpoints consume more "quota" than regular endpoints.
 * Prevents a single bad actor from exhausting API credentials for the entire facility.
 */

export interface CostLimitOptions {
  windowMs: number;
  maxCost: number; // Total cost budget per window
  store: RateLimitStore;
  costFn?: (req: Request) => number; // Default: 1 for all requests
  telemetryScope?: (req: Request) => CostLimitTelemetryScope | undefined;
  telemetry?: (fields: CostLimitTelemetryFields, log?: CostLimitTelemetryLogger) => void;
}

export type CostLimitTelemetryScope = "inventory_photo_analysis";
export type CostLimitCheck = {
  allowed: boolean;
  attemptedCost?: number;
};

const DEFAULT_COST_FN = (_req: Request) => 1;

function actorHash(actor: unknown): string {
  return createHash("sha256").update(String(actor)).digest("hex").slice(0, 16);
}
/**
 * AI endpoint cost multipliers (relative to cost=1 for a regular endpoint).
 * Adjust based on actual API spend.
 */
export const AI_ENDPOINT_COSTS: Record<string, number> = {
  "/api/inventory/count-observations": 20,
};

export async function checkCostLimit(
  _req: Request,
  res: Response,
  options: CostLimitOptions,
): Promise<CostLimitCheck> {
  const costFn = options.costFn || DEFAULT_COST_FN;
  const req = _req as any;
  const actor = req.userId ?? req.ip ?? "unknown";
  const safeActorHash = actorHash(actor);
  const key = `cost-limit:${actor}`;
  const cost = costFn(req);
  const now = Date.now();

  try {
    const result = await options.store.hit(key, options.windowMs, now, cost);
    const attemptedCost = result.count;
    const totalCost = Math.min(attemptedCost, options.maxCost);
    const remaining = Math.max(0, options.maxCost - totalCost);
    const resetInSec = Math.ceil((result.resetAt - now) / 1000);
    const telemetryScope = options.telemetryScope?.(req);

    res.setHeader("X-Cost-Limit", String(options.maxCost));
    res.setHeader("X-Cost-Used", String(totalCost));
    res.setHeader("X-Cost-Remaining", String(remaining));
    res.setHeader("X-Cost-Requested", String(cost));
    res.setHeader("X-Cost-Reset", String(resetInSec));

    if (attemptedCost > options.maxCost) {
      if (telemetryScope) {
        options.telemetry?.(
          {
            scope: telemetryScope,
            outcome: "rejected",
            actorHash: safeActorHash,
            requestedCost: cost,
            usedCost: totalCost,
            limitCost: options.maxCost,
            remainingCost: remaining,
          },
          req.log,
        );
      }
      res.setHeader("Retry-After", String(resetInSec));
      req.log?.warn(
        { actorHash: safeActorHash, totalCost, maxCost: options.maxCost, cost },
        "Cost limit exceeded",
      );
      res.status(429).json({
        error: `Cost limit exceeded. Budget: ${options.maxCost}, used: ${totalCost}, requested: ${cost}. Retry after ${resetInSec}s.`,
      });
      return { allowed: false, attemptedCost };
    }

    if (telemetryScope && isNearLimit(remaining, options.maxCost)) {
      options.telemetry?.(
        {
          scope: telemetryScope,
          outcome: "near_limit",
          actorHash: safeActorHash,
          requestedCost: cost,
          usedCost: totalCost,
          limitCost: options.maxCost,
          remainingCost: remaining,
        },
        req.log,
      );
    }
    req.log?.debug(
      { actorHash: safeActorHash, cost, totalCost, maxCost: options.maxCost },
      "Cost limit check passed",
    );
    return { allowed: true, attemptedCost };
  } catch (err) {
    req.log?.error({ err }, "Cost limit store error, failing open");
    return { allowed: true };
  }
}

export function costLimitMiddleware(options: CostLimitOptions) {
  return (_req: Request, res: Response, next: any) => {
    void checkCostLimit(_req, res, options).then((result) => {
      if (result.allowed) next();
    });
  };
}

export type CostLimitTelemetryOutcome = "near_limit" | "rejected";

const NEAR_LIMIT_RATIO = 0.2;

export type CostLimitTelemetryLogger = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
};

function isNearLimit(remaining: number, maxCost: number): boolean {
  return maxCost > 0 && remaining <= Math.max(1, Math.ceil(maxCost * NEAR_LIMIT_RATIO));
}

export type CostLimitTelemetryFields = {
  scope: CostLimitTelemetryScope;
  outcome: CostLimitTelemetryOutcome;
  actorHash: string;
  requestedCost: number;
  usedCost: number;
  limitCost: number;
  remainingCost: number;
};
