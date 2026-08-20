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
    const now = Date.now();

    (async () => {
      try {
        const result = await options.store.hit(
          key,
          options.windowMs,
          now,
          cost,
        );
        const totalCost = result.count;
        const remaining = Math.max(0, options.maxCost - totalCost);
        const resetInSec = Math.ceil((result.resetAt - now) / 1000);

        // Return the current quota on every response so callers can show users
        // how much AI budget remains before they hit the cap.
        res.setHeader("X-Cost-Limit", String(options.maxCost));
        res.setHeader("X-Cost-Used", String(totalCost));
        res.setHeader("X-Cost-Remaining", String(remaining));
        res.setHeader("X-Cost-Requested", String(cost));
        res.setHeader("X-Cost-Reset", String(resetInSec));

        if (totalCost > options.maxCost) {
          res.setHeader("Retry-After", String(resetInSec));
          req.log?.warn(
            { key, totalCost, maxCost: options.maxCost, cost },
            "Cost limit exceeded",
          );
          res.status(429).json({
            error: `Cost limit exceeded. Budget: ${options.maxCost}, used: ${totalCost}, requested: ${cost}. Retry after ${resetInSec}s.`,
          });
          return;
        }

        req.log?.debug(
          { key, cost, totalCost, maxCost: options.maxCost },
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
