import { costLimitMiddleware, AI_ENDPOINT_COSTS } from "../lib/rateLimitCost";
import { MemoryRateLimitStore } from "./rateLimit";

/**
 * AI cost-limit middleware instance.
 * Attach to /api/ai/* routes to prevent API credential exhaustion.
 *
 * Each AI endpoint has a cost multiplier relative to a base cost of 1.
 * A 1-minute window with budget 300 allows roughly 300 regular calls
 * or ~20 forecast calls before throttling a single IP.
 */
export const aiCostLimit = costLimitMiddleware({
  windowMs: 60_000, // 1-minute window
  maxCost: 300,
  store: new MemoryRateLimitStore(60_000),
  costFn: (req) => {
    const path = req.path;
    for (const [endpoint, cost] of Object.entries(AI_ENDPOINT_COSTS)) {
      if (path.includes(endpoint)) return cost;
    }
    return 1;
  },
});
