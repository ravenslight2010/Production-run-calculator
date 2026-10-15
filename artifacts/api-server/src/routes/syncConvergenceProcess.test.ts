import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stopIsolatedSyncProcess,
  stopIsolatedSyncProcesses,
} from "./syncConvergenceProcess";

class FakeSyncProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((_signal: NodeJS.Signals) => true);

  asChildProcess(): import("node:child_process").ChildProcess {
    return this as unknown as import("node:child_process").ChildProcess;
  }
}

function expectShutdownListenersRemoved(child: FakeSyncProcess) {
  expect(child.listenerCount("exit")).toBe(0);
  expect(child.listenerCount("close")).toBe(0);
  expect(child.listenerCount("error")).toBe(0);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("stopIsolatedSyncProcess", () => {
  it("returns immediately for an already-exited child", async () => {
    vi.useFakeTimers();
    const child = new FakeSyncProcess();
    child.exitCode = 0;

    await expect(stopIsolatedSyncProcess(child.asChildProcess())).resolves.toBeUndefined();

    expect(child.kill).not.toHaveBeenCalled();
    expectShutdownListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for SIGTERM shutdown and removes its timer and listeners", async () => {
    vi.useFakeTimers();
    const child = new FakeSyncProcess();
    const shutdown = stopIsolatedSyncProcess(child.asChildProcess(), {
      forceKillTimeoutMs: 25,
    });

    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(1);
    child.exitCode = 0;
    child.emit("close", 0, null);

    await expect(shutdown).resolves.toBeUndefined();
    expectShutdownListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends SIGKILL after the grace period but waits for process exit", async () => {
    vi.useFakeTimers();
    const child = new FakeSyncProcess();
    const shutdown = stopIsolatedSyncProcess(child.asChildProcess(), {
      forceKillTimeoutMs: 25,
    });
    let completed = false;
    void shutdown.then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(25);

    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(completed).toBe(false);
    expect(child.listenerCount("exit")).toBe(1);
    expect(child.listenerCount("close")).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    child.signalCode = "SIGKILL";
    child.emit("exit", null, "SIGKILL");
    await expect(shutdown).resolves.toBeUndefined();

    expectShutdownListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a failed SIGTERM, immediately tries SIGKILL, and cleans up", async () => {
    vi.useFakeTimers();
    const child = new FakeSyncProcess();
    child.kill.mockImplementation((signal) => signal === "SIGTERM" ? false : true);
    const shutdown = stopIsolatedSyncProcess(child.asChildProcess(), {
      forceKillTimeoutMs: 25,
    });
    const shutdownResult = shutdown.then(
      () => null,
      (error: unknown) => error,
    );

    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    const failure = await shutdownResult;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "Failed to send SIGTERM to isolated sync process during teardown",
    );
    expectShutdownListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports ChildProcess signal errors with their cause and cleans up", async () => {
    vi.useFakeTimers();
    const child = new FakeSyncProcess();
    const osError = new Error("operation not permitted");
    child.kill.mockImplementation((signal) => {
      if (signal === "SIGTERM") child.emit("error", osError);
      return true;
    });

    const shutdown = stopIsolatedSyncProcess(child.asChildProcess(), {
      forceKillTimeoutMs: 25,
    });

    await expect(shutdown).rejects.toMatchObject({
      message: expect.stringContaining("Failed to send SIGTERM"),
      cause: osError,
    });
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expectShutdownListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a failed SIGKILL attempt and removes its pending timer and listeners", async () => {
    vi.useFakeTimers();
    const child = new FakeSyncProcess();
    child.kill.mockImplementation((signal) => signal !== "SIGKILL");
    const shutdown = stopIsolatedSyncProcess(child.asChildProcess(), {
      forceKillTimeoutMs: 25,
    });
    const shutdownResult = shutdown.then(
      () => null,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(25);

    const failure = await shutdownResult;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "Failed to send SIGKILL to isolated sync process during teardown",
    );
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expectShutdownListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("attempts every child and preserves the first shutdown failure", async () => {
    vi.useFakeTimers();
    const failedChild = new FakeSyncProcess();
    failedChild.kill.mockReturnValue(false);
    const healthyChild = new FakeSyncProcess();
    const stopping = stopIsolatedSyncProcesses([
      failedChild.asChildProcess(),
      healthyChild.asChildProcess(),
    ]).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failedChild.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(failedChild.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(healthyChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    healthyChild.exitCode = 0;
    healthyChild.emit("exit", 0, null);

    const failure = await stopping;
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toMatchObject({
      message: expect.stringContaining("Failed to send SIGTERM"),
    });
    expect((failure as AggregateError).cause).toBe((failure as AggregateError).errors[0]);
    expect(healthyChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expectShutdownListenersRemoved(failedChild);
    expectShutdownListenersRemoved(healthyChild);
    expect(vi.getTimerCount()).toBe(0);
  });
});
