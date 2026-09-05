import type { Request, Response } from "express";
import { checkCostLimit, costLimitMiddleware, AI_ENDPOINT_COSTS } from "../lib/rateLimitCost";
import { MemoryRateLimitStore, type RateLimitStore } from "./rateLimit";
import { PostgresRateLimitStore } from "./rateLimitStore";

/**
 * AI cost-limit middleware instance.
 * Attach to /api/ai/* routes to prevent API credential exhaustion.
 *
 * Each AI endpoint has a cost multiplier relative to a base cost of 1.
 * A 1-minute window with budget 300 allows roughly 300 regular calls
 * or ~20 forecast calls before throttling a single IP.
 */
export const AI_COST_LIMIT_WINDOW_MS = 60_000;
export const AI_COST_LIMIT_MAX = 300;

function publicAiPath(req: Request): string {
  // Express removes each mounted path segment from req.path. At the /ai
  // boundary in the production app this becomes:
  //   baseUrl="/api/ai", path="/optimize"
  // Recombine them so the public API paths in AI_ENDPOINT_COSTS keep working.
  const mountedPath = `${req.baseUrl ?? ""}${req.path ?? ""}`;
  if (mountedPath.startsWith("/api/ai/")) return mountedPath;
  if (mountedPath.startsWith("/ai/")) return `/api${mountedPath}`;

  // This fallback also keeps direct middleware tests, where baseUrl is absent,
  // aligned with the public route naming convention.
  return req.path ?? "";
}

export function aiRequestCost(req: Request): number {
  return AI_ENDPOINT_COSTS[publicAiPath(req)] ?? 1;
}

export function createAiCostLimit(
  options: {
    windowMs?: number;
    maxCost?: number;
    store?: RateLimitStore;
  } = {},
) {
  const windowMs = options.windowMs ?? AI_COST_LIMIT_WINDOW_MS;
  // The shared Postgres store makes a single cap effective when production is
  // scaled across API instances. Development and tests intentionally remain
  // in-memory so they do not require a database to serve or run.
  const store =
    options.store ??
    (process.env.NODE_ENV === "production"
      ? new PostgresRateLimitStore(windowMs)
      : new MemoryRateLimitStore(windowMs));

  return costLimitMiddleware({
    windowMs,
    maxCost: options.maxCost ?? AI_COST_LIMIT_MAX,
    store,
    costFn: aiRequestCost,
  },
  );
}

const aiCostLimitStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(AI_COST_LIMIT_WINDOW_MS)
    : new MemoryRateLimitStore(AI_COST_LIMIT_WINDOW_MS);

const aiCostLimitOptions = {
  windowMs: AI_COST_LIMIT_WINDOW_MS,
  maxCost: AI_COST_LIMIT_MAX,
  store: aiCostLimitStore,
  costFn: aiRequestCost,
};

export const aiCostLimit = costLimitMiddleware(aiCostLimitOptions);

// Cacheable routes call this only inside the single in-flight miss owner, after
// validation and prompt grounding. Cache hits never reach this function.
export async function chargeAiCost(req: Request, res: Response): Promise<boolean> {
  return (await checkCostLimit(req, res, aiCostLimitOptions)).allowed;
}
