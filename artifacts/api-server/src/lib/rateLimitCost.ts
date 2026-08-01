import { Request, Response, NextFunction } from 'express';
import { RateLimitStore } from '../middlewares/rateLimit';

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
export const AI_ENDPOINT_COSTS = {
  '/api/ai/diagnose-issue': 10, // OpenAI + Drizzle query
  '/api/ai/cluster-incidents': 15, // GPT-4 + large context window
  '/api/ai/proactive-alert': 5, // Lighter, cached incident patterns
  '/api/ai/forecast': 20, // Complex multi-step analysis
  '/api/ai/optimize': 12, // Production rule synthesis
} as const;

export function costLimitMiddleware(options: CostLimitOptions) {
  const costFn = options.costFn || DEFAULT_COST_FN;

  return (_req: Request, res: Response, next: NextFunction) => {
    const req = _req as any;
    const key = `cost-limit:${req.ip}`;
    const cost = costFn(req);

    // Fire-and-forget: check cost budget
    (async () => {
      try {
        const result = await options.store.hit(key, options.windowMs);
        const newCost = result.current + cost;

        if (newCost > options.maxCost) {
          const retryAfterSec = Math.ceil(
            (result.resetAt - Date.now()) / 1000
          );
          res.setHeader('Retry-After', String(retryAfterSec));
          res.setHeader('X-Cost-Limit', String(options.maxCost));
          res.setHeader('X-Cost-Used', String(result.current));
          res.setHeader('X-Cost-Requested', String(cost));
          req.log.warn(
            { key, newCost, maxCost: options.maxCost, cost },
            'Cost limit exceeded'
          );
          res.status(429).json({
            error: `Cost limit exceeded. Budget: ${options.maxCost}, used: ${result.current}, requested: ${cost}. Retry after ${retryAfterSec}s.`,
          });
          return;
        }

        // Log cost for observability
        req.log.debug(
          { key, cost, totalCost: newCost, maxCost: options.maxCost },
          'Cost limit check passed'
        );
        next();
      } catch (err) {
        // Fail open: if store is down, allow the request
        req.log.error({ err }, 'Cost limit store error, failing open');
        next();
      }
    })();
  };
}
