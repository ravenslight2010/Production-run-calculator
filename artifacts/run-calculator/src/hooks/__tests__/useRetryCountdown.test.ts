import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRetryCountdown } from "../useRetryCountdown";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

describe("useRetryCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T00:00:00Z"));
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("counts down against elapsed wall time while visible", () => {
    const { result } = renderHook(() => useRetryCountdown());

    act(() => result.current[1](3));
    expect(result.current[0]).toBe(3);

    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current[0]).toBe(2);

    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current[0]).toBe(0);
  });

  it("expires immediately after the page was hidden past its deadline", () => {
    const { result } = renderHook(() => useRetryCountdown());
    act(() => result.current[1](5));

    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current[0]).toBe(5);

    act(() => {
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current[0]).toBe(0);
  });

  it("reconciles the remaining time after a shorter hidden period", () => {
    const { result } = renderHook(() => useRetryCountdown());
    act(() => result.current[1](10));

    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(4_000);
      setHidden(false);
      window.dispatchEvent(new Event("focus"));
    });

    expect(result.current[0]).toBe(6);
  });
});