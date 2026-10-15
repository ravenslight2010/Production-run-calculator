import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stopIsolatedApiProcess,
  waitForIsolatedApiProcess,
  type IsolatedApiProcess,
} from "./serverJobsProcess";

class FakeApiProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((_signal: NodeJS.Signals) => true);

  asIsolatedApiProcess(): IsolatedApiProcess {
    return this as unknown as IsolatedApiProcess;
  }
}

function expectStartupListenersRemoved(child: FakeApiProcess) {
  expect(child.listenerCount("close")).toBe(0);
  expect(child.listenerCount("error")).toBe(0);
  expect(child.listenerCount("exit")).toBe(0);
  expect(child.stdout.listenerCount("data")).toBe(0);
  expect(child.stderr.listenerCount("data")).toBe(0);
}

function expectShutdownListenersRemoved(child: FakeApiProcess) {
  expect(child.listenerCount("close")).toBe(0);
  expect(child.listenerCount("exit")).toBe(0);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("stopIsolatedApiProcess", () => {
  it("returns immediately for an already exited child without adding listeners or timers", async () => {
    vi.useFakeTimers();
    const child = new FakeApiProcess();
    child.exitCode = 0;

    await expect(
      stopIsolatedApiProcess(child.asIsolatedApiProcess(), { forceKillTimeoutMs: 25 }),
    ).resolves.toBeUndefined();

    expect(child.kill).not.toHaveBeenCalled();
    expectShutdownListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  it("waits for a SIGTERM close and removes its timer and listeners", async () => {
    vi.useFakeTimers();
    const child = new FakeApiProcess();
    const shutdown = stopIsolatedApiProcess(child.asIsolatedApiProcess(), {
      forceKillTimeoutMs: 25,
    });

    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(1);
    child.exitCode = 0;
    child.emit("close", 0, null);

    await expect(shutdown).resolves.toBeUndefined();
    expectShutdownListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  it("escalates to SIGKILL but waits for the child to exit", async () => {
    vi.useFakeTimers();
    const child = new FakeApiProcess();
    const shutdown = stopIsolatedApiProcess(child.asIsolatedApiProcess(), {
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
    child.stdout.destroy();
    child.stderr.destroy();
  });
});

describe("waitForIsolatedApiProcess", () => {
  it("resolves on the ready marker and removes startup listeners", async () => {
    vi.useFakeTimers();
    const child = new FakeApiProcess();
    const startup = waitForIsolatedApiProcess(child.asIsolatedApiProcess());

    child.stdout.write('{"port":4321}\n');

    await expect(startup).resolves.toEqual({
      child: child.asIsolatedApiProcess(),
      url: "http://127.0.0.1:4321",
    });
    expectStartupListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  it("terminates and cleans up a child that reports a startup error", async () => {
    vi.useFakeTimers();
    const child = new FakeApiProcess();
    const startup = waitForIsolatedApiProcess(child.asIsolatedApiProcess());
    const startupError = new Error("spawn failed");

    child.emit("error", startupError);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.exitCode = 1;
    child.emit("exit", 1, null);
    child.emit("close", 1, null);

    await expect(startup).rejects.toBe(startupError);
    expect(child.exitCode).toBe(1);
    expectStartupListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  it("terminates and cleans up a child when startup times out", async () => {
    vi.useFakeTimers();
    const child = new FakeApiProcess();
    const startup = waitForIsolatedApiProcess(child.asIsolatedApiProcess(), {
      startupTimeoutMs: 25,
      forceKillTimeoutMs: 50,
    });

    await vi.advanceTimersByTimeAsync(25);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.signalCode = "SIGKILL";
    child.emit("exit", null, "SIGKILL");
    child.emit("close", null, "SIGKILL");

    await expect(startup).rejects.toThrow("did not become ready");
    expect(child.signalCode).toBe("SIGKILL");
    expectStartupListenersRemoved(child);
    expect(vi.getTimerCount()).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });
});
