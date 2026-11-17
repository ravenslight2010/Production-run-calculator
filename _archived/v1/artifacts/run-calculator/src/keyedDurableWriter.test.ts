import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyedDurableWriter } from "./keyedDurableWriter";

afterEach(() => {
  vi.useRealTimers();
});

describe("KeyedDurableWriter", () => {
  it("coalesces rapid writes per key while preserving independent keys", () => {
    vi.useFakeTimers();
    const writer = new KeyedDurableWriter(100);
    const writes: string[] = [];

    writer.schedule("live:user-a:run-a", () => writes.push("run-a-v1"));
    writer.schedule("live:user-a:run-b", () => writes.push("run-b"));
    writer.schedule("live:user-a:run-a", () => writes.push("run-a-v2"));
    vi.advanceTimersByTime(99);
    expect(writes).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(writes).toEqual(["run-a-v2", "run-b"]);
  });

  it("bounds a key's delay even while newer values keep arriving", () => {
    vi.useFakeTimers();
    const writer = new KeyedDurableWriter(100);
    const writes: string[] = [];

    writer.schedule("run-a", () => writes.push("v1"));
    vi.advanceTimersByTime(90);
    writer.schedule("run-a", () => writes.push("v2"));
    vi.advanceTimersByTime(10);

    expect(writes).toEqual(["v2"]);
  });

  it("flushes synchronously at a durability boundary", () => {
    vi.useFakeTimers();
    const writer = new KeyedDurableWriter(100);
    const writes: string[] = [];
    writer.schedule("run-a", () => writes.push("saved"));

    writer.flushAll();
    expect(writes).toEqual(["saved"]);
    expect(writer.hasPending()).toBe(false);
    vi.runAllTimers();
    expect(writes).toEqual(["saved"]);
  });

  it("cancels a stale attributed write without affecting another key", () => {
    vi.useFakeTimers();
    const writer = new KeyedDurableWriter(100);
    const writes: string[] = [];
    writer.schedule("live:user-a:run-a", () => writes.push("wrong"));
    writer.schedule("sandbox:user-a:run-a", () => writes.push("sandbox"));

    writer.cancel("live:user-a:run-a");
    vi.runAllTimers();
    expect(writes).toEqual(["sandbox"]);
  });

  it("retains a failed write for a later retry", () => {
    vi.useFakeTimers();
    const writer = new KeyedDurableWriter(100);
    let attempts = 0;
    writer.schedule("run-a", () => {
      attempts += 1;
      if (attempts === 1) throw new Error("storage unavailable");
    });

    writer.flushAll();
    expect(attempts).toBe(1);
    expect(writer.hasPending("run-a")).toBe(true);
    vi.advanceTimersByTime(100);
    expect(attempts).toBe(2);
    expect(writer.hasPending()).toBe(false);
  });
});