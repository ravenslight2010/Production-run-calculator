import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS,
  startServiceWorkerUpdateChecks,
} from "./pwaUpdateChecks";

const originalVisibilityState = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState",
);

function setVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

afterEach(() => {
  vi.useRealTimers();
  if (originalVisibilityState) {
    Object.defineProperty(document, "visibilityState", originalVisibilityState);
  }
});

describe("startServiceWorkerUpdateChecks", () => {
  it("checks at startup, on foreground, and at the conservative visible-session interval", () => {
    vi.useFakeTimers();
    setVisibilityState("visible");
    const update = vi.fn().mockResolvedValue(undefined);

    const stop = startServiceWorkerUpdateChecks({ update });

    expect(update).toHaveBeenCalledTimes(1);

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(update).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(4);

    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(4);
  });

  it("only discovers updates and never activates the waiting worker", () => {
    vi.useFakeTimers();
    setVisibilityState("visible");
    const postMessage = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);

    const stop = startServiceWorkerUpdateChecks({
      update,
      // This property is intentionally outside the helper's narrow
      // registration type. Its spy proves discovery never activates a worker.
      waiting: { postMessage },
    } as ServiceWorkerRegistration);

    vi.advanceTimersByTime(SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS);
    stop();

    expect(update).toHaveBeenCalledTimes(2);
    expect(postMessage).not.toHaveBeenCalled();
  });
});