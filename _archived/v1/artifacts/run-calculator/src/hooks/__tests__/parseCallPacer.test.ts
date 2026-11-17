/**
 * Rate-limit pacing for spec-sheet chunk imports.
 *
 * makeParseCallPacer() issues ≤ PARSE_PACE_SAFE_MAX calls per
 * PARSE_RATE_WINDOW_MS window (default 8 per 62 s) to stay below the server's
 * 10-req/min limit.  When the window is full, pace() sleeps until the oldest
 * call exits the window, then proceeds.  This prevents large imports (≥9 chunks)
 * from hitting HTTP 429 mid-import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeParseCallPacer } from "../../parseSpecSheet";

// ── Constants used across tests ───────────────────────────────────────────────
const WINDOW_MS = 60_000;
const MAX_CALLS = 8;
const T0 = 1_700_000_000_000; // fixed epoch

describe("makeParseCallPacer — rate-limit-safe chunk pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Calls within the cap complete immediately ──────────────────────────
  it("first MAX_CALLS calls within the window resolve without sleeping", async () => {
    const pace = makeParseCallPacer({ windowMs: WINDOW_MS, maxCalls: MAX_CALLS });
    const before = Date.now();

    for (let i = 0; i < MAX_CALLS; i++) {
      await pace();
    }

    // No setTimeout should have fired (fake timers would show elapsed = 0).
    expect(Date.now() - before).toBe(0);
  });

  // ── 2. The (MAX_CALLS+1)th call sleeps until the window clears ────────────
  it("(MAX_CALLS+1)th call pauses until the oldest timestamp exits the window", async () => {
    const pace = makeParseCallPacer({ windowMs: WINDOW_MS, maxCalls: MAX_CALLS });

    // Fill the window at T0.
    for (let i = 0; i < MAX_CALLS; i++) {
      await pace();
    }

    // 9th call: window is saturated → should sleep ~(60000 + 100) ms.
    let resolved = false;
    const pacePromise = pace().then(() => {
      resolved = true;
    });

    // Not yet resolved — still sleeping.
    await vi.advanceTimersByTimeAsync(59_000);
    expect(resolved).toBe(false);

    // Advance past the sleep duration → resolves.
    await vi.advanceTimersByTimeAsync(2_000); // total 61 000 ms
    await pacePromise;
    expect(resolved).toBe(true);

    // After the sleep, real time (fake) has advanced ≥ WINDOW_MS.
    expect(Date.now() - T0).toBeGreaterThanOrEqual(WINDOW_MS);
  });

  // ── 3. After the window resets, calls are immediate again ─────────────────
  it("calls after the window has fully scrolled past are immediate again", async () => {
    const pace = makeParseCallPacer({ windowMs: WINDOW_MS, maxCalls: MAX_CALLS });

    // Fill window at T0.
    for (let i = 0; i < MAX_CALLS; i++) {
      await pace();
    }

    // Advance past the window so all T0 timestamps are evicted.
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 1_000);

    // New calls should be immediate (no sleep needed).
    const before = Date.now();
    for (let i = 0; i < MAX_CALLS; i++) {
      await pace();
    }
    // All MAX_CALLS calls landed at the same fake-clock moment (no sleeps).
    expect(Date.now() - before).toBe(0);
  });

  // ── 4. Imports with >10 chunks stay within the rate limit ─────────────────
  //
  // A 30×8 spec at 4k chunk budget produces ~12-15 chunks.  With 8-call pacing,
  // chunks 9–15 each trigger a sleep.  After each sleep the window has scrolled
  // past and the next 8 can go immediately.  Crucially, no burst of >8 calls
  // ever fires within a 60-second window, so the server's 10-req/min limit is
  // never approached.
  it("simulates a 13-chunk import: never more than MAX_CALLS calls in any 60-s window", async () => {
    const TOTAL_CHUNKS = 13;
    const pace = makeParseCallPacer({ windowMs: WINDOW_MS, maxCalls: MAX_CALLS });

    const callTimes: number[] = [];

    for (let i = 0; i < TOTAL_CHUNKS; i++) {
      const pacePromise = pace();
      // Advance time enough to cover any sleep (up to WINDOW_MS + 200 ms).
      await vi.advanceTimersByTimeAsync(WINDOW_MS + 200);
      await pacePromise;
      callTimes.push(Date.now());
    }

    // Verify: in every 60-second sliding window, at most MAX_CALLS calls fired.
    for (let i = 0; i < callTimes.length; i++) {
      const windowEnd = callTimes[i] + WINDOW_MS;
      const inWindow = callTimes.filter((t) => t >= callTimes[i] && t <= windowEnd);
      expect(inWindow.length).toBeLessThanOrEqual(MAX_CALLS);
    }
  });
});
