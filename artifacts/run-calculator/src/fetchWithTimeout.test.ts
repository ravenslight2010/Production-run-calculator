// Locks the two behaviors the import chain depends on:
// 1) a timeout/abort is remapped to the friendly "server may be waking up"
//    message (so a cold-starting deployment surfaces a retryable error), and
// 2) every OTHER failure (network error, server error) is rethrown unchanged
//    so existing caller error handling keeps working.
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchWithTimeout, IMPORT_WAKE_HINT } from "./fetchWithTimeout";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("fetchWithTimeout", () => {
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

  it("remaps an AbortError to the friendly wake-up message", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("Aborted.", "AbortError");
    }) as unknown as typeof fetch;
    await expect(fetchWithTimeout("/api/x", {}, 5_000)).rejects.toThrow(IMPORT_WAKE_HINT);
  });

  it("actually times out a hung fetch via AbortSignal.timeout", async () => {
    globalThis.fetch = realFetch;
    // A fetch that never resolves on its own: point at a signal-respecting stub.
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal!.reason ?? new DOMException("Aborted.", "AbortError"));
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
});
