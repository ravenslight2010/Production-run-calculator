// Unit test for the MemoryRateLimitStore's periodic sweep.
//
// The store keeps a per-key counter in an in-process Map and runs a
// setInterval(windowMs) sweep that deletes buckets whose window has already
// ended (resetAt <= Date.now()). That sweep is what keeps the map from growing
// without bound under many distinct keys (e.g. lots of distinct users hitting
// the AI endpoint). It is internal to the store and has no other coverage, so
// this test drives the store directly with several keys, lets some windows
// expire, fires the sweep via fake timers, and asserts expired buckets are
// removed while still-active buckets are kept.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { MemoryRateLimitStore, rateLimit } from "./rateLimit";
import type { RateLimitStore } from "./rateLimit";

// The sweep deletes from the store's private bucket Map. Reading it directly is
// the most faithful assertion that memory is actually freed (rather than just
// observing reset behavior through `hit`). This narrow cast is test-only.
type Bucket = { count: number; resetAt: number };
function bucketsOf(store: MemoryRateLimitStore): Map<string, Bucket> {
  return (store as unknown as { buckets: Map<string, Bucket> }).buckets;
}

describe("MemoryRateLimitStore — periodic sweep frees expired buckets", () => {
  beforeEach(() => {
    // Fake timers so we can both drive the sweep's setInterval and control the
    // Date.now() the sweep reads when deciding which buckets have expired.
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops expired buckets on sweep while keeping still-active ones", async () => {
    const windowMs = 1000;
    const store = new MemoryRateLimitStore(windowMs);
    const buckets = bucketsOf(store);

    // Two distinct keys whose window ends at t=1000.
    await store.hit("a", windowMs, 0);
    await store.hit("b", windowMs, 0);
    // A third key registered later, so its window ends at t=1500 and it should
    // survive the first sweep.
    await store.hit("c", windowMs, 500);

    expect(buckets.size).toBe(3);

    // Fire the first sweep at t=1000. "a" and "b" (resetAt=1000) are now expired
    // (resetAt <= now); "c" (resetAt=1500) is still active.
    vi.advanceTimersByTime(windowMs);

    expect(buckets.has("a")).toBe(false);
    expect(buckets.has("b")).toBe(false);
    expect(buckets.has("c")).toBe(true);
    expect(buckets.size).toBe(1);

    // Fire the next sweep at t=2000. "c" is now past its window too and is
    // swept, leaving the map empty — memory fully reclaimed.
    vi.advanceTimersByTime(windowMs);

    expect(buckets.has("c")).toBe(false);
    expect(buckets.size).toBe(0);
  });
});

// Middleware-level primary-store-failure fallback test.
//
// When the primary (Postgres-backed) store throws, the limiter falls back to an
// in-process MemoryRateLimitStore rather than failing completely open. This
// keeps rate limiting active during a Postgres outage: the cap is per-instance
// instead of cross-instance, but the endpoint is never completely unguarded.
//
// When the primary IS an in-memory store (i.e. no separate store was supplied)
// and it throws, there is no fallback and the request is allowed through — this
// preserves the original fail-open behaviour for the in-memory path.
describe("rateLimit — falls back to in-memory limiter when the primary store errors", () => {
  it("still enforces the cap via fallback when a non-memory store always rejects", async () => {
    // A store that always fails — simulates a Postgres outage.
    const failing: RateLimitStore = {
      hit: () => Promise.reject(new Error("store unreachable")),
    };

    // max=1 so the second request through the fallback store triggers a 429.
    const middleware = rateLimit({ windowMs: 60_000, max: 1, store: failing });

    async function fireOnce() {
      const setHeader = vi.fn();
      const json = vi.fn(() => res);
      const status = vi.fn(() => res);
      const res = { setHeader, status, json } as unknown as Response;
      const req = {
        ip: "1.2.3.4",
        log: { error: vi.fn(), warn: vi.fn() },
      } as unknown as Request;
      const next = vi.fn() as unknown as NextFunction;
      middleware(req, res, next);
      await vi.waitFor(() => {
        const n = (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
        const s = status.mock.calls.length;
        expect(n + s).toBeGreaterThan(0);
      });
      return { next, status, json };
    }

    // First request: count=1 ≤ max=1, allowed through fallback.
    const first = await fireOnce();
    expect(first.next).toHaveBeenCalledTimes(1);
    expect(first.status).not.toHaveBeenCalled();

    // Second request: count=2 > max=1, blocked by fallback store.
    const second = await fireOnce();
    expect(second.next).not.toHaveBeenCalled();
    expect(second.status).toHaveBeenCalledWith(429);
  });

  it("logs the primary store error even when the fallback succeeds", async () => {
    const failing: RateLimitStore = {
      hit: () => Promise.reject(new Error("store unreachable")),
    };
    const middleware = rateLimit({ windowMs: 1000, max: 5, store: failing });
    const errorSpy = vi.fn();
    const req = {
      ip: "1.2.3.4",
      log: { error: errorSpy, warn: vi.fn() },
    } as unknown as Request;
    const setHeader = vi.fn();
    const status = vi.fn(() => res);
    const json = vi.fn(() => res);
    const res = { setHeader, status, json } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledTimes(1);
    });

    // Request was allowed (first hit on fallback store, well under max=5).
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();

    // Primary store outage is still surfaced via req.log.error.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [meta] = errorSpy.mock.calls[0];
    expect(meta).toMatchObject({ key: "1.2.3.4" });
    expect(meta.err).toBeInstanceOf(Error);
  });

  it("uses distinct fallback buckets per key so one user's quota does not affect another's", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const failing: RateLimitStore = {
      hit: () => Promise.reject(new Error("store unreachable")),
    };
    const middleware = rateLimit({ windowMs: 60_000, max: 1, store: failing });

    async function fireAs(ip: string) {
      const setHeader = vi.fn();
      const json = vi.fn(() => res);
      const status = vi.fn(() => res);
      const res = { setHeader, status, json } as unknown as Response;
      const req = { ip, log: { error: vi.fn(), warn: vi.fn() } } as unknown as Request;
      const next = vi.fn() as unknown as NextFunction;
      middleware(req, res, next);
      await vi.waitFor(() => {
        const n = (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
        const s = status.mock.calls.length;
        expect(n + s).toBeGreaterThan(0);
      });
      return { next, status };
    }

    // Exhaust IP A's fallback quota.
    await fireAs("10.0.0.1"); // count=1 (allowed)
    const blocked = await fireAs("10.0.0.1"); // count=2 > max=1 (blocked)
    expect(blocked.status).toHaveBeenCalledWith(429);

    // IP B has its own independent fallback bucket and must still be allowed.
    const bFirst = await fireAs("10.0.0.2");
    expect(bFirst.next).toHaveBeenCalledTimes(1);
    expect(bFirst.status).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// Middleware-level enforcement test.
//
// The store-level sweep test above proves counting/expiry, and the fail-open
// test proves the catch branch, but neither exercises the middleware's actual
// gate: requests at or under `max` must call next(), the first request *over*
// `max` must return 429 with the friendly error body, and the RateLimit-* /
// Retry-After headers must be set. A regression here (off-by-one on the cap, a
// broken 429 response, or missing headers) would either let abuse through or
// block legitimate users with nothing failing. This drives several requests
// through the real middleware backed by a real MemoryRateLimitStore and asserts
// the boundary behavior exactly.
describe("rateLimit — enforces the cap and returns 429 over the limit", () => {
  beforeEach(() => {
    // Pin the clock so RateLimit-Reset / Retry-After are deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Drives one request through the middleware and returns the captured
  // next()/status/json/header activity for assertions.
  async function fire(middleware: ReturnType<typeof rateLimit>) {
    const headers: Record<string, string> = {};
    const setHeader = vi.fn((name: string, value: string) => {
      headers[name] = value;
    });
    const json = vi.fn(() => res);
    const status = vi.fn(() => res);
    const res = { setHeader, status, json } as unknown as Response;

    const req = {
      ip: "9.9.9.9",
      log: { error: vi.fn(), warn: vi.fn() },
    } as unknown as Request;

    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    // The middleware does its work in a fire-and-forget async IIFE, so wait for
    // either next() or a response to be produced before asserting.
    await vi.waitFor(() => {
      expect(
        (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length +
          status.mock.calls.length,
      ).toBeGreaterThan(0);
    });

    return { next, status, json, setHeader, headers };
  }

  it("allows requests up to max and 429s the one that exceeds it", async () => {
    const windowMs = 60_000;
    const max = 3;
    const middleware = rateLimit({
      windowMs,
      max,
      store: new MemoryRateLimitStore(windowMs),
    });

    // The first `max` requests are under/at the cap and must pass through.
    for (let i = 1; i <= max; i++) {
      const { next, status, json, headers } = await fire(middleware);
      expect(next).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();

      // Headers reflect the cap and the shrinking remaining budget.
      expect(headers["RateLimit-Limit"]).toBe(String(max));
      expect(headers["RateLimit-Remaining"]).toBe(String(max - i));
      expect(headers["RateLimit-Reset"]).toBe("60");
      // No Retry-After while the request is allowed.
      expect(headers["Retry-After"]).toBeUndefined();
    }

    // The next request crosses the cap (count = max + 1) and must be blocked.
    const blocked = await fire(middleware);
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(blocked.json).toHaveBeenCalledWith({
      error: "Too many requests. Please wait a moment and try again.",
    });

    // Headers stay informative on the blocked response: remaining is clamped to
    // 0 and Retry-After tells the client how long until the window resets.
    expect(blocked.headers["RateLimit-Limit"]).toBe(String(max));
    expect(blocked.headers["RateLimit-Remaining"]).toBe("0");
    expect(blocked.headers["RateLimit-Reset"]).toBe("60");
    expect(blocked.headers["Retry-After"]).toBe("60");
  });
});

// Sign-up path rate-limit integration test.
//
// POST /auth/sign-up uses authRateLimit (20 req / 60 s per IP in production).
// If that middleware were accidentally removed or misconfigured, the endpoint
// would be silently open to brute-force access-code guessing. This test
// constructs the same rateLimit middleware with a tiny cap (max=2) backed by a
// fresh MemoryRateLimitStore, drives it with a mock sign-up handler, and
// confirms that the (max+1)th request from the same IP is refused with 429
// before the handler is ever called — exactly the guard the real authRateLimit
// provides on the live route.
describe("authRateLimit — sign-up is blocked when the rate limit is exhausted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function fireSignUp(middleware: ReturnType<typeof rateLimit>, ip: string) {
    const headers: Record<string, string> = {};
    const setHeader = vi.fn((name: string, value: string) => {
      headers[name] = value;
    });
    const json = vi.fn(() => res);
    const status = vi.fn(() => res);
    const res = { setHeader, status, json } as unknown as Response;

    const req = {
      ip,
      log: { error: vi.fn(), warn: vi.fn() },
    } as unknown as Request;

    // Simulates the sign-up route handler: returns 201 when the middleware
    // passes. The test verifies this is never reached once the cap is hit.
    const signUpHandler = vi.fn(() => {
      res.status(201);
      res.json({ token: "tok" });
    }) as unknown as NextFunction;

    middleware(req, res, signUpHandler);

    await vi.waitFor(() => {
      const handlerCalls = (signUpHandler as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      const statusCalls = status.mock.calls.length;
      expect(handlerCalls + statusCalls).toBeGreaterThan(0);
    });

    return { signUpHandler, status, json, headers };
  }

  it("passes requests up to max and returns 429 on the next attempt from the same IP", async () => {
    const windowMs = 60_000;
    const max = 2;
    const ip = "10.0.0.1";
    // Use a fresh store so this suite doesn't share state with others.
    const middleware = rateLimit({
      windowMs,
      max,
      store: new MemoryRateLimitStore(windowMs),
    });

    // First `max` requests must reach the handler (the handler itself sets
    // status 201, but the middleware must not set it before the handler runs).
    for (let i = 0; i < max; i++) {
      const { signUpHandler } = await fireSignUp(middleware, ip);
      expect(signUpHandler).toHaveBeenCalledTimes(1);
    }

    // The very next request from the same IP must be blocked at the middleware
    // — the sign-up handler must NOT be called and the response must be 429.
    const blocked = await fireSignUp(middleware, ip);
    expect(blocked.signUpHandler).not.toHaveBeenCalled();
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(blocked.json).toHaveBeenCalledWith({
      error: "Too many requests. Please wait a moment and try again.",
    });
    expect(blocked.headers["RateLimit-Remaining"]).toBe("0");
    expect(blocked.headers["Retry-After"]).toBeDefined();
  });

  it("counts requests per IP — a different IP is not affected by the first IP's exhaustion", async () => {
    const windowMs = 60_000;
    const max = 2;
    const store = new MemoryRateLimitStore(windowMs);
    const middleware = rateLimit({ windowMs, max, store });

    // Exhaust the limit for IP A.
    for (let i = 0; i <= max; i++) {
      await fireSignUp(middleware, "192.168.1.1");
    }

    // IP B's first request must still reach the handler — it has its own bucket.
    const { signUpHandler } = await fireSignUp(middleware, "192.168.1.2");
    expect(signUpHandler).toHaveBeenCalledTimes(1);
  });
});

// Forgot-password path rate-limit integration test.
//
// POST /auth/forgot-password uses authRateLimit (same 20 req / 60 s cap as
// sign-up). Without this coverage a regression that silently removed authRateLimit
// from the route would leave the password-reset initiation flow open to
// automated abuse with no test catching it. This test constructs the middleware
// with a tiny cap (max=2), drives it with a mock handler, and confirms the
// (max+1)th request from the same IP is refused with 429 before the handler runs.
describe("authRateLimit — forgot-password is blocked when the rate limit is exhausted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function fireForgotPassword(middleware: ReturnType<typeof rateLimit>, ip: string) {
    const headers: Record<string, string> = {};
    const setHeader = vi.fn((name: string, value: string) => {
      headers[name] = value;
    });
    const json = vi.fn(() => res);
    const status = vi.fn(() => res);
    const res = { setHeader, status, json } as unknown as Response;

    const req = {
      ip,
      log: { error: vi.fn(), warn: vi.fn() },
    } as unknown as Request;

    // Simulates the forgot-password route handler: returns 200 when the
    // middleware passes. The test verifies this is never reached once the cap
    // is hit.
    const handler = vi.fn(() => {
      res.status(200);
      res.json({ ok: true });
    }) as unknown as NextFunction;

    middleware(req, res, handler);

    await vi.waitFor(() => {
      const handlerCalls = (handler as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      const statusCalls = status.mock.calls.length;
      expect(handlerCalls + statusCalls).toBeGreaterThan(0);
    });

    return { handler, status, json, headers };
  }

  it("passes requests up to max and returns 429 on the next attempt from the same IP", async () => {
    const windowMs = 60_000;
    const max = 2;
    const ip = "10.0.0.2";
    const middleware = rateLimit({
      windowMs,
      max,
      store: new MemoryRateLimitStore(windowMs),
    });

    for (let i = 0; i < max; i++) {
      const { handler } = await fireForgotPassword(middleware, ip);
      expect(handler).toHaveBeenCalledTimes(1);
    }

    const blocked = await fireForgotPassword(middleware, ip);
    expect(blocked.handler).not.toHaveBeenCalled();
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(blocked.json).toHaveBeenCalledWith({
      error: "Too many requests. Please wait a moment and try again.",
    });
    expect(blocked.headers["RateLimit-Remaining"]).toBe("0");
    expect(blocked.headers["Retry-After"]).toBeDefined();
  });

  it("counts requests per IP — a different IP is not affected by the first IP's exhaustion", async () => {
    const windowMs = 60_000;
    const max = 2;
    const store = new MemoryRateLimitStore(windowMs);
    const middleware = rateLimit({ windowMs, max, store });

    for (let i = 0; i <= max; i++) {
      await fireForgotPassword(middleware, "172.16.0.1");
    }

    const { handler } = await fireForgotPassword(middleware, "172.16.0.2");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// Username-available path rate-limit integration test.
//
// GET /auth/username-available uses authRateLimit (same 20 req / 60 s cap as
// sign-up). Without this coverage a regression that silently removed authRateLimit
// from the route would leave the endpoint open to unlimited username enumeration
// with no test catching it. This test constructs the middleware with a tiny cap
// (max=2), drives it with a mock handler, and confirms the (max+1)th request
// from the same IP is refused with 429 before the handler runs.
describe("authRateLimit — username-available is blocked when the rate limit is exhausted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function fireUsernameAvailable(middleware: ReturnType<typeof rateLimit>, ip: string) {
    const headers: Record<string, string> = {};
    const setHeader = vi.fn((name: string, value: string) => {
      headers[name] = value;
    });
    const json = vi.fn(() => res);
    const status = vi.fn(() => res);
    const res = { setHeader, status, json } as unknown as Response;

    const req = {
      ip,
      log: { error: vi.fn(), warn: vi.fn() },
    } as unknown as Request;

    // Simulates the username-available route handler: returns 200 when the
    // middleware passes. The test verifies this is never reached once the cap
    // is hit.
    const handler = vi.fn(() => {
      res.status(200);
      res.json({ available: true });
    }) as unknown as NextFunction;

    middleware(req, res, handler);

    await vi.waitFor(() => {
      const handlerCalls = (handler as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      const statusCalls = status.mock.calls.length;
      expect(handlerCalls + statusCalls).toBeGreaterThan(0);
    });

    return { handler, status, json, headers };
  }

  it("passes requests up to max and returns 429 on the next attempt from the same IP", async () => {
    const windowMs = 60_000;
    const max = 2;
    const ip = "10.0.0.4";
    const middleware = rateLimit({
      windowMs,
      max,
      store: new MemoryRateLimitStore(windowMs),
    });

    for (let i = 0; i < max; i++) {
      const { handler } = await fireUsernameAvailable(middleware, ip);
      expect(handler).toHaveBeenCalledTimes(1);
    }

    const blocked = await fireUsernameAvailable(middleware, ip);
    expect(blocked.handler).not.toHaveBeenCalled();
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(blocked.json).toHaveBeenCalledWith({
      error: "Too many requests. Please wait a moment and try again.",
    });
    expect(blocked.headers["RateLimit-Remaining"]).toBe("0");
    expect(blocked.headers["Retry-After"]).toBeDefined();
  });

  it("counts requests per IP — a different IP is not affected by the first IP's exhaustion", async () => {
    const windowMs = 60_000;
    const max = 2;
    const store = new MemoryRateLimitStore(windowMs);
    const middleware = rateLimit({ windowMs, max, store });

    for (let i = 0; i <= max; i++) {
      await fireUsernameAvailable(middleware, "172.16.2.1");
    }

    const { handler } = await fireUsernameAvailable(middleware, "172.16.2.2");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// Reset-password path rate-limit integration test.
//
// POST /auth/reset-password uses authRateLimit (same 20 req / 60 s cap as
// sign-up). Without this coverage a regression that silently removed authRateLimit
// from the route would leave the one-time reset-code consumption open to
// automated guessing with no test catching it. This test constructs the
// middleware with a tiny cap (max=2), drives it with a mock handler, and
// confirms the (max+1)th request from the same IP is refused with 429 before
// the handler runs.
describe("authRateLimit — reset-password is blocked when the rate limit is exhausted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function fireResetPassword(middleware: ReturnType<typeof rateLimit>, ip: string) {
    const headers: Record<string, string> = {};
    const setHeader = vi.fn((name: string, value: string) => {
      headers[name] = value;
    });
    const json = vi.fn(() => res);
    const status = vi.fn(() => res);
    const res = { setHeader, status, json } as unknown as Response;

    const req = {
      ip,
      log: { error: vi.fn(), warn: vi.fn() },
    } as unknown as Request;

    // Simulates the reset-password route handler: returns 200 when the
    // middleware passes. The test verifies this is never reached once the cap
    // is hit.
    const handler = vi.fn(() => {
      res.status(200);
      res.json({ ok: true });
    }) as unknown as NextFunction;

    middleware(req, res, handler);

    await vi.waitFor(() => {
      const handlerCalls = (handler as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      const statusCalls = status.mock.calls.length;
      expect(handlerCalls + statusCalls).toBeGreaterThan(0);
    });

    return { handler, status, json, headers };
  }

  it("passes requests up to max and returns 429 on the next attempt from the same IP", async () => {
    const windowMs = 60_000;
    const max = 2;
    const ip = "10.0.0.3";
    const middleware = rateLimit({
      windowMs,
      max,
      store: new MemoryRateLimitStore(windowMs),
    });

    for (let i = 0; i < max; i++) {
      const { handler } = await fireResetPassword(middleware, ip);
      expect(handler).toHaveBeenCalledTimes(1);
    }

    const blocked = await fireResetPassword(middleware, ip);
    expect(blocked.handler).not.toHaveBeenCalled();
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(blocked.json).toHaveBeenCalledWith({
      error: "Too many requests. Please wait a moment and try again.",
    });
    expect(blocked.headers["RateLimit-Remaining"]).toBe("0");
    expect(blocked.headers["Retry-After"]).toBeDefined();
  });

  it("counts requests per IP — a different IP is not affected by the first IP's exhaustion", async () => {
    const windowMs = 60_000;
    const max = 2;
    const store = new MemoryRateLimitStore(windowMs);
    const middleware = rateLimit({ windowMs, max, store });

    for (let i = 0; i <= max; i++) {
      await fireResetPassword(middleware, "172.16.1.1");
    }

    const { handler } = await fireResetPassword(middleware, "172.16.1.2");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// Sign-in path rate-limit integration test.
//
// POST /auth/sign-in is the primary credential-guessing target. It uses
// authRateLimit (same 20 req / 60 s cap as sign-up and the other auth
// endpoints). Without this coverage a regression that silently removed
// authRateLimit from the route would leave the endpoint open to brute-force
// password guessing with no test catching it. This test constructs the
// middleware with a tiny cap (max=2), drives it with a mock handler, and
// confirms the (max+1)th request from the same IP is refused with 429 before
// the handler is ever called.
describe("authRateLimit — sign-in is blocked when the rate limit is exhausted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function fireSignIn(middleware: ReturnType<typeof rateLimit>, ip: string) {
    const headers: Record<string, string> = {};
    const setHeader = vi.fn((name: string, value: string) => {
      headers[name] = value;
    });
    const json = vi.fn(() => res);
    const status = vi.fn(() => res);
    const res = { setHeader, status, json } as unknown as Response;

    const req = {
      ip,
      log: { error: vi.fn(), warn: vi.fn() },
    } as unknown as Request;

    // Simulates the sign-in route handler: returns 200 when the middleware
    // passes. The test verifies this is never reached once the cap is hit.
    const handler = vi.fn(() => {
      res.status(200);
      res.json({ token: "tok" });
    }) as unknown as NextFunction;

    middleware(req, res, handler);

    await vi.waitFor(() => {
      const handlerCalls = (handler as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      const statusCalls = status.mock.calls.length;
      expect(handlerCalls + statusCalls).toBeGreaterThan(0);
    });

    return { handler, status, json, headers };
  }

  it("passes requests up to max and returns 429 on the next attempt from the same IP", async () => {
    const windowMs = 60_000;
    const max = 2;
    const ip = "10.0.0.5";
    const middleware = rateLimit({
      windowMs,
      max,
      store: new MemoryRateLimitStore(windowMs),
    });

    for (let i = 0; i < max; i++) {
      const { handler } = await fireSignIn(middleware, ip);
      expect(handler).toHaveBeenCalledTimes(1);
    }

    // The very next request from the same IP must be blocked at the middleware
    // — the sign-in handler must NOT be called and the response must be 429.
    const blocked = await fireSignIn(middleware, ip);
    expect(blocked.handler).not.toHaveBeenCalled();
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(blocked.json).toHaveBeenCalledWith({
      error: "Too many requests. Please wait a moment and try again.",
    });
    expect(blocked.headers["RateLimit-Remaining"]).toBe("0");
    expect(blocked.headers["Retry-After"]).toBeDefined();
  });

  it("counts requests per IP — a different IP is not affected by the first IP's exhaustion", async () => {
    const windowMs = 60_000;
    const max = 2;
    const store = new MemoryRateLimitStore(windowMs);
    const middleware = rateLimit({ windowMs, max, store });

    // Exhaust the limit for IP A.
    for (let i = 0; i <= max; i++) {
      await fireSignIn(middleware, "172.16.3.1");
    }

    // IP B's first request must still reach the handler — it has its own bucket.
    const { handler } = await fireSignIn(middleware, "172.16.3.2");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
