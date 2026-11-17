import type { RequestHandler } from "express";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";

export const DEFAULT_USER_RATE_WINDOW_MS = 60_000;
export const DEFAULT_USER_RATE_MAX = 10;

/**
 * Shared policy for bounded, per-user operations.
 *
 * Production uses the database-backed store so the limit holds across server
 * instances. Development and tests retain the middleware's in-memory store.
 */
export function fixedWindowPerUserPolicy(
  namespace: string,
  options: { windowMs?: number; max?: number } = {},
): RequestHandler {
  const windowMs = options.windowMs ?? DEFAULT_USER_RATE_WINDOW_MS;
  const max = options.max ?? DEFAULT_USER_RATE_MAX;
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => `${namespace}:${req.userId ?? req.ip ?? "unknown"}`,
    store: process.env.NODE_ENV === "production"
      ? new PostgresRateLimitStore(windowMs)
      : undefined,
  });
}