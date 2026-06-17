import type { Request, Response, NextFunction, RequestHandler } from "express";

// Minimal in-memory, per-key fixed-window rate limiter. Intended for cheap
// abuse/cost protection on a single expensive endpoint, not as a general-purpose
// distributed limiter — counters live in process memory and reset on restart.
type Options = {
  windowMs: number;
  max: number;
  // Derives the bucket key for a request. Defaults to the client IP.
  keyGenerator?: (req: Request) => string;
};

type Bucket = { count: number; resetAt: number };

export function rateLimit(opts: Options): RequestHandler {
  const { windowMs, max } = opts;
  const keyGenerator = opts.keyGenerator ?? ((req) => req.ip ?? "unknown");
  const buckets = new Map<string, Bucket>();

  // Periodically drop expired buckets so the map can't grow unbounded under
  // many distinct keys. Unref so it never keeps the process alive.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  sweep.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = keyGenerator(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      req.log.warn({ key, count: bucket.count }, "rate limit exceeded");
      res.status(429).json({
        error: "Too many requests. Please wait a moment and try again.",
      });
      return;
    }
    next();
  };
}
