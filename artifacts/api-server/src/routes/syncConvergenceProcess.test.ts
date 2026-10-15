import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopIsolatedSyncProcess } from "./syncConvergenceProcess";

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
});
