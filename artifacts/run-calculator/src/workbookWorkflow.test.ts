import { describe, expect, it, vi } from "vitest";
import { createRetryableLoader } from "./workbookWorkflow";

describe("createRetryableLoader", () => {
  it("caches a successful load", async () => {
    const load = vi.fn(async () => ({ ready: true }));
    const cached = createRetryableLoader(load);

    await expect(cached()).resolves.toEqual({ ready: true });
    await expect(cached()).resolves.toEqual({ ready: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh attempt after a transient load failure", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce("loaded");
    const retryable = createRetryableLoader(load);

    await expect(retryable()).rejects.toThrow("chunk unavailable");
    await expect(retryable()).resolves.toBe("loaded");
    expect(load).toHaveBeenCalledTimes(2);
  });
});