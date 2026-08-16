import type { Request, Response, NextFunction, RequestHandler } from "express";

// Per-key fixed-window rate limiter, intended for cheap abuse/cost protection on
// an expensive endpoint. The counting is delegated to a pluggable store so the
// same middleware can run against either in-process memory (single instance) or
// a shared backing store such as Postgres (so the cap holds when the API is
// scaled horizontally or restarts often). The default store is in-memory and
// keeps the original single-instance behavior — counters live in process memory
// and reset on restart.
type Options = {
  windowMs: number;
  max: number;
  // Derives the bucket key for a request. Defaults to the client IP.
  keyGenerator?: (req: Request) => string;
  // Where the per-key counters live. Defaults to an in-process Map. Provide a
  // shared store (e.g. PostgresRateLimitStore) to enforce the cap across
  // multiple instances.
  store?: RateLimitStore;
};

// The outcome of registering a single hit against a key.
export type RateLimitResult = {
  // Total hits recorded for the key in the current window, including this one.
  count: number;
  // Epoch ms at which the current window ends and the count resets.
  resetAt: number;
};

// A counting backend for the limiter. `hit` atomically records one request for
// `key` and returns the updated count plus the window's reset time. The window
// is anchored to the application clock via `now` (passed in by the middleware)
// rather than the store's own clock, so behavior is deterministic and identical
// across store implementations.
export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): Promise<RateLimitResult>;
}

type Bucket = { count: number; resetAt: number };

// Default single-instance store: counters in an in-process Map. A periodic sweep
// drops expired buckets so the map can't grow unbounded under many distinct
// keys. Counters reset on restart.
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor(windowMs: number) {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }, windowMs);
    // Unref so the timer never keeps the process alive.
    sweep.unref?.();
  }

  hit(key: string, windowMs: number, now: number): Promise<RateLimitResult> {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return Promise.resolve({ count: bucket.count, resetAt: bucket.resetAt });
  }
}

export function rateLimit(opts: Options): RequestHandler {
  const { windowMs, max } = opts;
  const keyGenerator = opts.keyGenerator ?? ((req) => req.ip ?? "unknown");
  const primaryStore = opts.store ?? new MemoryRateLimitStore(windowMs);
  // Fallback in-memory store used when the primary (Postgres-backed) store is
  // unreachable. This ensures rate limiting is never silently disabled by a
  // transient Postgres outage: instead of failing completely open, we apply a
  // local per-instance cap. The fallback allows somewhat more traffic than the
  // primary (it is per-instance and resets on restart), but it still prevents
  // unbounded request floods from a single client IP/user.
  const fallbackStore =
    primaryStore instanceof MemoryRateLimitStore
      ? null
      : new MemoryRateLimitStore(windowMs);

  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const now = Date.now();
      const key = keyGenerator(req);

      let result: RateLimitResult;
      try {
        result = await primaryStore.hit(key, windowMs, now);
      } catch (err) {
        // Primary store (Postgres) is unreachable. Fall back to the in-process
        // memory store rather than failing completely open — this keeps per-user
        // rate limiting active even during a Postgres outage, at the cost of the
        // cap being per-instance instead of cross-instance. The outage is still
        // logged so it surfaces through monitoring.
        req.log.error({ err, key }, "rate limit store error; falling back to in-memory limiter");
        if (fallbackStore) {
          try {
            result = await fallbackStore.hit(key, windowMs, now);
          } catch (fallbackErr) {
            req.log.error({ err: fallbackErr, key }, "rate limit fallback store error; allowing request");
            next();
            return;
          }
        } else {
          // Primary was already in-memory; nothing further to fall back to.
          next();
          return;
        }
      }

      const { count, resetAt } = result;
      const remaining = Math.max(0, max - count);
      res.setHeader("RateLimit-Limit", String(max));
      res.setHeader("RateLimit-Remaining", String(remaining));
      res.setHeader("RateLimit-Reset", String(Math.ceil((resetAt - now) / 1000)));

      if (count > max) {
        const retryAfter = Math.ceil((resetAt - now) / 1000);
        res.setHeader("Retry-After", String(retryAfter));
        req.log.warn({ key, count }, "rate limit exceeded");
        res.status(429).json({
          error: "Too many requests. Please wait a moment and try again.",
        });
        return;
      }
      next();
    })();
  };
}
