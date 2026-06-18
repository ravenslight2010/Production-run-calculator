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
import { MemoryRateLimitStore } from "./rateLimit";

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
