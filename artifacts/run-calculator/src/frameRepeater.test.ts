import { describe, expect, it, vi } from "vitest";
import { createFrameRepeater, type AnimationFrameScheduler } from "./frameRepeater";

function makeScheduler() {
  let now = 0;
  let nextHandle = 1;
  const delays = new Map<number, () => void>();
  const frames = new Map<number, FrameRequestCallback>();
  const scheduler: AnimationFrameScheduler = {
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
    setDelay: (callback) => {
      const handle = nextHandle++;
      delays.set(handle, callback);
      return handle as ReturnType<typeof setTimeout>;
    },
    clearDelay: (handle) => {
      delays.delete(handle as number);
    },
    now: () => now,
  };

  return {
    scheduler,
    fireDelay() {
      const callbacks = [...delays.values()];
      delays.clear();
      callbacks.forEach((callback) => callback());
    },
    frameAt(time: number) {
      now = time;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(time));
    },
    pendingFrames: () => frames.size,
  };
}

describe("createFrameRepeater", () => {
  it("steps immediately, waits for the delay, then preserves the 80ms cadence", () => {
    const clock = makeScheduler();
    const step = vi.fn();
    const repeater = createFrameRepeater(400, 80, clock.scheduler);

    repeater.start(step);
    expect(step).toHaveBeenCalledTimes(1);
    clock.frameAt(400);
    expect(step).toHaveBeenCalledTimes(1);

    clock.fireDelay();
    clock.frameAt(440);
    expect(step).toHaveBeenCalledTimes(1);
    clock.frameAt(480);
    expect(step).toHaveBeenCalledTimes(2);
    clock.frameAt(650);
    expect(step).toHaveBeenCalledTimes(4);
  });

  it("cancels both pending delay and frame work immediately", () => {
    const beforeDelay = makeScheduler();
    const delayedStep = vi.fn();
    const delayed = createFrameRepeater(400, 80, beforeDelay.scheduler);
    delayed.start(delayedStep);
    delayed.stop();
    beforeDelay.fireDelay();
    beforeDelay.frameAt(1_000);
    expect(delayedStep).toHaveBeenCalledTimes(1);
    expect(beforeDelay.pendingFrames()).toBe(0);

    const afterDelay = makeScheduler();
    const frameStep = vi.fn();
    const framed = createFrameRepeater(400, 80, afterDelay.scheduler);
    framed.start(frameStep);
    afterDelay.fireDelay();
    framed.stop();
    afterDelay.frameAt(1_000);
    expect(frameStep).toHaveBeenCalledTimes(1);
    expect(afterDelay.pendingFrames()).toBe(0);
  });

  it("restarting replaces the previous callback without overlapping work", () => {
    const clock = makeScheduler();
    const first = vi.fn();
    const second = vi.fn();
    const repeater = createFrameRepeater(400, 80, clock.scheduler);

    repeater.start(first);
    repeater.start(second);
    clock.fireDelay();
    clock.frameAt(80);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(clock.pendingFrames()).toBe(1);
  });
});