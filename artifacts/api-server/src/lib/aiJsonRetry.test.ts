// Unit tests for the shared AI-call retry helper, focused on the 429
// rate-limit path: a 429 rejection is free (the provider refused the call),
// so it gets ONE retry after a backoff inside the same 2-attempt cap, and an
// exhausted retry surfaces as reason "rate-limited" so routes can return a
// friendly HTTP 429 instead of a generic 502. Non-429 provider throws must
// still fail fast with NO retry (each of those attempts is a paid call).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  fetchModelJsonWithRetry,
  setAiRateLimitBackoffMsForTests,
  isAiRateLimitError,
  aiCallFailureHttp,
  AI_RATE_LIMITED_MESSAGE,
} from "./aiJsonRetry";

const silentLog = { info() {}, warn() {}, error() {} };

let prevBackoff: number;
beforeEach(() => {
  prevBackoff = setAiRateLimitBackoffMsForTests(0);
});
afterAll(() => {
  setAiRateLimitBackoffMsForTests(prevBackoff);
});

function rateLimit429(): Error & { status: number } {
  const err = new Error(
    '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}',
  ) as Error & { status: number };
  err.status = 429;
  return err;
}

describe("429 rate-limit retry", () => {
  it("retries once after a 429 and succeeds on the second attempt", async () => {
    let calls = 0;
    const result = await fetchModelJsonWithRetry({
      label: "test",
      log: silentLog,
      call: async () => {
        calls += 1;
        if (calls === 1) throw rateLimit429();
        return '{"ok":true}';
      },
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ ok: true, raw: { ok: true } });
  });

  it("returns reason rate-limited when the retry is also 429-rejected", async () => {
    let calls = 0;
    const result = await fetchModelJsonWithRetry({
      label: "test",
      log: silentLog,
      call: async () => {
        calls += 1;
        throw rateLimit429();
      },
    });
    // Bounded: exactly 2 attempts, never a third.
    expect(calls).toBe(2);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("rate-limited");
  });

  it("does NOT retry a non-429 provider throw (paid call — fail fast)", async () => {
    let calls = 0;
    const result = await fetchModelJsonWithRetry({
      label: "test",
      log: silentLog,
      call: async () => {
        calls += 1;
        throw new Error("provider blew up");
      },
    });
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("provider");
  });
});

describe("isAiRateLimitError", () => {
  it("recognizes status 429 and RESOURCE_EXHAUSTED shapes", () => {
    expect(isAiRateLimitError(rateLimit429())).toBe(true);
    expect(isAiRateLimitError({ status: 429 })).toBe(true);
    expect(isAiRateLimitError({ code: 429 })).toBe(true);
    expect(isAiRateLimitError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isAiRateLimitError(new Error("got 429 from upstream"))).toBe(true);
  });

  it("rejects non-rate-limit errors", () => {
    expect(isAiRateLimitError(new Error("provider blew up"))).toBe(false);
    expect(isAiRateLimitError({ status: 500 })).toBe(false);
    expect(isAiRateLimitError(null)).toBe(false);
    expect(isAiRateLimitError("429")).toBe(false);
    // "429" embedded in a longer number must not match.
    expect(isAiRateLimitError(new Error("id 14290 failed"))).toBe(false);
  });
});

describe("aiCallFailureHttp", () => {
  it("maps rate-limited to HTTP 429 with the friendly wait message", () => {
    expect(aiCallFailureHttp({ reason: "rate-limited" }, "AI provider error")).toEqual({
      status: 429,
      error: AI_RATE_LIMITED_MESSAGE,
    });
  });

  it("maps provider to HTTP 502 with the route's own wording", () => {
    expect(aiCallFailureHttp({ reason: "provider" }, "Vision provider error")).toEqual({
      status: 502,
      error: "Vision provider error",
    });
  });
});
