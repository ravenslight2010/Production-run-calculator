import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisibleTabScheduler } from "./visibleTabScheduler";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

describe("VisibleTabScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    setHidden(false);
  });
  afterEach(() => vi.useRealTimers());

  it("serializes cadence jobs in order and performs no hidden work", async () => {
    const calls: string[] = [];
    const scheduler = new VisibleTabScheduler();
    scheduler.register({ id: "memory", cadenceMs: 60_000, runOnStart: true, order: 1, run: () => calls.push("memory") });
    scheduler.register({ id: "profiles", cadenceMs: 60_000, runOnStart: true, order: 2, run: async () => calls.push("profiles") });
    scheduler.start();
    await vi.runOnlyPendingTimersAsync();
    expect(calls).toEqual(["memory", "profiles"]);

    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(calls).toEqual(["memory", "profiles"]);
    scheduler.stop();
  });

  it("coalesces show and focus into one foreground reconciliation", async () => {
    const wake = vi.fn();
    const scheduler = new VisibleTabScheduler();
    scheduler.register({ id: "wake", runOnForeground: true, order: 0, run: wake });
    scheduler.start();
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.setSystemTime(new Date("2026-09-08T12:05:00Z"));
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(wake).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("runs one bounded foreground pass after a long sleep, wake first", async () => {
    const calls: string[] = [];
    const scheduler = new VisibleTabScheduler();
    scheduler.register({ id: "wake", runOnForeground: true, order: 0, run: () => calls.push("wake") });
    scheduler.register({ id: "minute", cadenceMs: 60_000, order: 10, run: () => calls.push("minute") });
    scheduler.start();
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["wake", "minute"]);
    scheduler.stop();
  });

  it("runs a foreground date check after a short hide spanning midnight", async () => {
    const dates: string[] = [];
    const scheduler = new VisibleTabScheduler();
    scheduler.register({
      id: "date-rollover",
      cadenceMs: 60_000,
      runOnForeground: true,
      order: 50,
      run: () => dates.push(new Date().toISOString().slice(0, 10)),
    });
    scheduler.start();
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.setSystemTime(new Date("2026-09-09T00:00:02Z"));
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(dates).toEqual(["2026-09-09"]);
    scheduler.stop();
  });

  it("removes its timer and listeners on stop", async () => {
    const run = vi.fn();
    const scheduler = new VisibleTabScheduler();
    scheduler.register({ id: "job", cadenceMs: 60_000, order: 1, run });
    scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});