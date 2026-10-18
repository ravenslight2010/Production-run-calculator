import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsMobile, useIsTouchDevice } from "./use-mobile";

type ChangeListener = (event: MediaQueryListEvent) => void;

function legacyMediaQuery(matches: boolean) {
  let listener: ChangeListener | undefined;
  const addListener = vi.fn((next: ChangeListener) => {
    listener = next;
  });
  const removeListener = vi.fn((next: ChangeListener) => {
    if (listener === next) listener = undefined;
  });
  const query = {
    matches,
    media: "",
    onchange: null,
    addListener,
    removeListener,
  } as unknown as MediaQueryList;

  return {
    query,
    addListener,
    removeListener,
    emit(event: MediaQueryListEvent) {
      listener?.(event);
    },
  };
}

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(
  navigator,
  "maxTouchPoints",
);

function restoreDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

afterEach(() => {
  restoreDescriptor(window, "matchMedia", originalMatchMedia);
  restoreDescriptor(window, "innerWidth", originalInnerWidth);
  restoreDescriptor(navigator, "maxTouchPoints", originalMaxTouchPoints);
  vi.restoreAllMocks();
});

describe("legacy MediaQueryList listeners", () => {
  it("updates and cleans up the mobile breakpoint through addListener", () => {
    const breakpoint = legacyMediaQuery(false);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => breakpoint.query),
    });

    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    expect(breakpoint.addListener).toHaveBeenCalledTimes(1);

    act(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 500,
      });
      breakpoint.emit({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current).toBe(true);

    unmount();
    expect(breakpoint.removeListener).toHaveBeenCalledTimes(1);
  });

  it("subscribes to and removes touch-pointer queries through addListener", () => {
    const coarse = legacyMediaQuery(true);
    const fine = legacyMediaQuery(false);
    const anyCoarse = legacyMediaQuery(true);
    const queries = new Map([
      ["(pointer: coarse)", coarse.query],
      ["(pointer: fine)", fine.query],
      ["(any-pointer: coarse)", anyCoarse.query],
    ]);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => {
        const match = queries.get(query);
        if (!match) throw new Error(`Unexpected media query: ${query}`);
        return match;
      }),
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
    });

    const { result, unmount } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(true);
    for (const media of [coarse, fine, anyCoarse]) {
      expect(media.addListener).toHaveBeenCalledTimes(1);
    }

    unmount();
    for (const media of [coarse, fine, anyCoarse]) {
      expect(media.removeListener).toHaveBeenCalledTimes(1);
    }
  });
});