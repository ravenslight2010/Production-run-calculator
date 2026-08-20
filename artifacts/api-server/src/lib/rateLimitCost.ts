import { Request } from "express";
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
}

const DEFAULT_COST_FN = (_req: Request) => 1;

/**
 * AI endpoint cost multipliers (relative to cost=1 for a regular endpoint).
 * Adjust based on actual API spend.
 */
export const AI_ENDPOINT_COSTS: Record<string, number> = {
  "/api/ai/diagnose-issue": 10,
  "/api/ai/cluster-incidents": 15,
  "/api/ai/proactive-alert": 5,
  "/api/ai/forecast": 20,
  "/api/ai/optimize": 12,
};

export function costLimitMiddleware(options: CostLimitOptions) {
  const costFn = options.costFn || DEFAULT_COST_FN;

  return (_req: Request, res: any, next: any) => {
    const req = _req as any;
    const key = `cost-limit:${req.ip}`;
    const cost = costFn(req);

    (async () => {
      try {
        const result = await options.store.hit(key, options.windowMs, Date.now());
        const currentCost = result.count;
        const newCost = currentCost + cost;

        if (newCost > options.maxCost) {
          const retryAfterSec = Math.ceil(
            (result.resetAt - Date.now()) / 1000,
          );
          res.setHeader("Retry-After", String(retryAfterSec));
          res.setHeader("X-Cost-Limit", String(options.maxCost));
          res.setHeader("X-Cost-Used", String(currentCost));
          res.setHeader("X-Cost-Requested", String(cost));
          req.log?.warn(
            { key, newCost, maxCost: options.maxCost, cost },
            "Cost limit exceeded",
          );
          res.status(429).json({
            error: `Cost limit exceeded. Budget: ${options.maxCost}, used: ${currentCost}, requested: ${cost}. Retry after ${retryAfterSec}s.`,
          });
          return;
        }

        req.log?.debug(
          { key, cost, totalCost: newCost, maxCost: options.maxCost },
          "Cost limit check passed",
        );
        next();
      } catch (err) {
        // Fail open: if store is down, allow the request
        req.log?.error({ err }, "Cost limit store error, failing open");
        next();
      }
    })();
  };
}
