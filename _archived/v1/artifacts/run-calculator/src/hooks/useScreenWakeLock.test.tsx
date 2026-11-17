import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenWakeLock } from "./useScreenWakeLock";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

function makeSentinel() {
  return {
    release: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe("useScreenWakeLock", () => {
  beforeEach(() => {
    setVisibility("visible");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "wakeLock");
  });

  it("requests a screen lock only while active and visible", async () => {
    const sentinel = makeSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), {
      initialProps: { active: false },
    });
    expect(request).not.toHaveBeenCalled();

    rerender({ active: true });
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    expect(sentinel.addEventListener).toHaveBeenCalledWith("release", expect.any(Function));
  });

  it("releases while hidden and reacquires when visibility returns", async () => {
    const first = makeSentinel();
    const second = makeSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    renderHook(() => useScreenWakeLock(true));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(first.release).toHaveBeenCalledTimes(1);

    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("releases when Floor Mode exits or the component unmounts", async () => {
    const first = makeSentinel();
    const second = makeSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    const { rerender, unmount } = renderHook(
      ({ active }) => useScreenWakeLock(active),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    rerender({ active: false });
    expect(first.release).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    unmount();
    expect(second.release).toHaveBeenCalledTimes(1);
  });

  it("safely ignores unsupported browsers and rejected requests", async () => {
    const unsupported = renderHook(() => useScreenWakeLock(true));
    expect(() => unsupported.unmount()).not.toThrow();

    const request = vi.fn().mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"));
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    const rejected = renderHook(() => useScreenWakeLock(true));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(() => rejected.unmount()).not.toThrow();
  });

  it("releases a lock that resolves after Floor Mode exits", async () => {
    let resolveRequest!: (sentinel: ReturnType<typeof makeSentinel>) => void;
    const request = vi.fn(() => new Promise<ReturnType<typeof makeSentinel>>((resolve) => {
      resolveRequest = resolve;
    }));
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    const { rerender } = renderHook(
      ({ active }) => useScreenWakeLock(active),
      { initialProps: { active: true } },
    );
    expect(request).toHaveBeenCalledTimes(1);
    rerender({ active: false });

    const lateSentinel = makeSentinel();
    await act(async () => resolveRequest(lateSentinel));
    expect(lateSentinel.release).toHaveBeenCalledTimes(1);
    expect(lateSentinel.addEventListener).not.toHaveBeenCalled();
  });
});