export type AnimationFrameScheduler = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  setDelay: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearDelay: (handle: ReturnType<typeof setTimeout>) => void;
  now: () => number;
};

const browserScheduler: AnimationFrameScheduler = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  setDelay: (callback, delayMs) => setTimeout(callback, delayMs),
  clearDelay: (handle) => clearTimeout(handle),
  now: () => performance.now(),
};

export function createFrameRepeater(
  delayMs = 400,
  repeatMs = 80,
  scheduler: AnimationFrameScheduler = browserScheduler,
) {
  let delayHandle: ReturnType<typeof setTimeout> | undefined;
  let frameHandle: number | undefined;
  let repeat: (() => void) | undefined;
  let active = false;
  let previousTime = 0;
  let elapsedMs = 0;

  const stop = () => {
    active = false;
    repeat = undefined;
    if (delayHandle !== undefined) scheduler.clearDelay(delayHandle);
    if (frameHandle !== undefined) scheduler.cancelFrame(frameHandle);
    delayHandle = undefined;
    frameHandle = undefined;
    elapsedMs = 0;
  };

  const onFrame = (time: number) => {
    if (!active || !repeat) return;
    elapsedMs += Math.max(0, time - previousTime);
    previousTime = time;
    while (elapsedMs >= repeatMs && active && repeat) {
      elapsedMs -= repeatMs;
      repeat();
    }
    if (active) frameHandle = scheduler.requestFrame(onFrame);
  };

  const start = (callback: () => void) => {
    stop();
    active = true;
    repeat = callback;
    callback();
    delayHandle = scheduler.setDelay(() => {
      delayHandle = undefined;
      if (!active || !repeat) return;
      previousTime = scheduler.now();
      frameHandle = scheduler.requestFrame(onFrame);
    }, delayMs);
  };

  return { start, stop };
}