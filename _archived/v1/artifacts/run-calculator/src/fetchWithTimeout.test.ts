// Locks the two behaviors the import chain depends on:
// 1) a timeout/abort is remapped to the friendly "server may be waking up"
//    message (so a cold-starting deployment surfaces a retryable error), and
// 2) every OTHER failure (network error, server error) is rethrown unchanged
//    so existing caller error handling keeps working.
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchAndConsumeWithTimeout, fetchWithTimeout, IMPORT_WAKE_HINT } from "./fetchWithTimeout";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("bounds a stalled body read even after successful response headers", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;
    let bodySignal: AbortSignal | undefined;
    const request = fetchAndConsumeWithTimeout("/api/sync/today", {}, 10_000, async (_response, signal) => {
      bodySignal = signal;
      return new Promise<never>(() => {});
    });
    const rejection = expect(request).rejects.toThrow(IMPORT_WAKE_HINT);
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(bodySignal?.aborted).toBe(true);
  });

  it("keeps caller cancellation attached during the body read", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;
    const controller = new AbortController();
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => { bodyStarted = resolve; });
    const request = fetchAndConsumeWithTimeout("/api/sync/today", { signal: controller.signal }, 10_000, async () => {
      bodyStarted();
      return new Promise<never>(() => {});
    });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await started;
    controller.abort();
    await rejection;
  });
  it("passes through a successful response and attaches a timeout signal", async () => {
    const ok = new Response("{}", { status: 200 });
    const spy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return ok;
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await fetchWithTimeout("/api/x", { method: "GET" }, 5_000);
    expect(res).toBe(ok);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("remaps a TimeoutError to the friendly wake-up message", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(fetchWithTimeout("/api/x", {}, 5_000)).rejects.toThrow(IMPORT_WAKE_HINT);
  });

  it("remaps AbortError only when its own timeout fired", async () => {
    vi.useFakeTimers();
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted.", "AbortError")));
      })) as unknown as typeof fetch;
    const request = fetchWithTimeout("/api/x", {}, 5_000);
    const rejection = expect(request).rejects.toThrow(IMPORT_WAKE_HINT);
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
  });

  it("actually times out a hung fetch with an explicit timeout abort reason", async () => {
    globalThis.fetch = realFetch;
    // A fetch that never resolves on its own: point at a signal-respecting stub.
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted.", "AbortError"));
        });
      })) as unknown as typeof fetch;
    await expect(fetchWithTimeout("/api/hang", {}, 50)).rejects.toThrow(IMPORT_WAKE_HINT);
  });

  it("rethrows non-abort failures unchanged", async () => {
    const boom = new TypeError("Failed to fetch");
    globalThis.fetch = vi.fn(async () => {
      throw boom;
    }) as unknown as typeof fetch;
    await expect(fetchWithTimeout("/api/x", {}, 5_000)).rejects.toBe(boom);
  });

  it("preserves caller cancellation instead of describing it as a timeout", async () => {
    const caller = new AbortController();
    const failure = new DOMException("Caller stopped request", "AbortError");
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(failure));
      })) as unknown as typeof fetch;
    const request = fetchWithTimeout("/api/x", { signal: caller.signal }, 5_000);
    caller.abort(failure);
    await expect(request).rejects.toBe(failure);
  });
});
