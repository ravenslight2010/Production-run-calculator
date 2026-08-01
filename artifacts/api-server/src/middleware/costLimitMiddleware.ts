import { Router } from "express";
import { costLimitMiddleware, AI_ENDPOINT_COSTS } from "../lib/rateLimitCost";
import { MemoryRateLimitStore } from "../middlewares/rateLimit";

/**
 * Factory function to create the cost-limit middleware for AI endpoints.
 * Attach to /api/ai/* routes to prevent API credential exhaustion.
 */

export function createAiCostLimitMiddleware() {
  const store = new MemoryRateLimitStore(60000); // 1-minute window

  return costLimitMiddleware({
    windowMs: 60000,
    maxCost: 300, // Adjust based on your budget
    store,
    costFn: (req) => {
      // Map endpoint path to cost multiplier
      const path = req.path;
      for (const [endpoint, cost] of Object.entries(AI_ENDPOINT_COSTS)) {
        if (path.includes(endpoint)) return cost;
      }
      return 1; // Default cost
    },
  });
}

// Export the middleware for use in routes
export const aiCostLimit = createAiCostLimitMiddleware();
