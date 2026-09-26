import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisibilityAwareInterval } from "../useVisibilityAwareInterval";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

describe("useVisibilityAwareInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("ticks while visible", () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityAwareInterval(callback, 1_000));

    act(() => vi.advanceTimersByTime(2_000));

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("does not start while hidden", () => {
    setHidden(true);
    const callback = vi.fn();
    renderHook(() => useVisibilityAwareInterval(callback, 1_000));

    act(() => vi.advanceTimersByTime(3_000));

    expect(callback).not.toHaveBeenCalled();
  });

  it("ticks immediately and restarts when visibility returns", () => {
    setHidden(true);
    const callback = vi.fn();
    renderHook(() => useVisibilityAwareInterval(callback, 1_000));

    act(() => {
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1_000));
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("ticks immediately and restarts on visible focus", () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityAwareInterval(callback, 1_000));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1_000));
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("starts only after becoming enabled", () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useVisibilityAwareInterval(callback, 1_000, enabled),
      { initialProps: { enabled: false } },
    );

    act(() => vi.advanceTimersByTime(2_000));
    expect(callback).not.toHaveBeenCalled();

    rerender({ enabled: true });
    act(() => vi.advanceTimersByTime(1_000));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("restarts when its restart key changes", () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ restartKey }) => useVisibilityAwareInterval(callback, 1_000, true, restartKey),
      { initialProps: { restartKey: "running" } },
    );

    act(() => vi.advanceTimersByTime(500));
    rerender({ restartKey: "paused" });
    act(() => vi.advanceTimersByTime(500));
    expect(callback).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("cleans up its interval and listeners", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useVisibilityAwareInterval(callback, 1_000));

    unmount();
    act(() => {
      vi.advanceTimersByTime(2_000);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(callback).not.toHaveBeenCalled();
  });
});