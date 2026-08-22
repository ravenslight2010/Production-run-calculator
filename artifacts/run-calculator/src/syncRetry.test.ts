import { describe, expect, it, vi } from "vitest";
import { createSyncRetryController, syncRetryDelay, SYNC_RETRY_MAX_MS } from "./syncRetry";

describe("sync retry backoff", () => {
  it("uses bounded exponential delays with deterministic jitter", () => {
    expect(syncRetryDelay(0, () => 0)).toBe(800);
    expect(syncRetryDelay(1, () => 0.5)).toBe(2_000);
    expect(syncRetryDelay(20, () => 1)).toBeLessThanOrEqual(SYNC_RETRY_MAX_MS);
    expect(syncRetryDelay(20, () => 0)).toBeLessThanOrEqual(SYNC_RETRY_MAX_MS);
  });

  it("coalesces failures into one scheduled chain and recovers", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const task = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const retry = createSyncRetryController({
      maxRetries: 3,
      random: () => 0.5,
      onState: (state) => states.push(state),
    });
    const result = retry.run(task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(3));
    await expect(result).resolves.toBe(true);
    expect(states).toContain("waiting");
    expect(states.at(-1)).toBe("idle");
    vi.useRealTimers();
  });

  it("cancels a scheduled retry without releasing another attempt", async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockResolvedValue(false);
    const retry = createSyncRetryController({ maxRetries: 3, random: () => 0.5 });
    const result = retry.run(task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    retry.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toBe(false);
    vi.useRealTimers();
  });
});