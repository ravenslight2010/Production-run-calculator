import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_TAB_STORAGE_KEY, useHomeNavigation } from "./useHomeNavigation";

const mocks = vi.hoisted(() => ({
  recordPerformance: vi.fn(),
}));

vi.mock("../performanceDiagnostics", () => ({
  recordPerformance: mocks.recordPerformance,
}));

describe("useHomeNavigation performance diagnostics", () => {
  afterEach(() => {
    localStorage.clear();
    window.location.hash = "";
    mocks.recordPerformance.mockReset();
    vi.restoreAllMocks();
  });

  it("records both navigation and committed render time for a tab change", () => {
    const { result } = renderHook(() => useHomeNavigation());

    act(() => {
      result.current.setActiveTab("quality");
    });

    const [navigation, render] = mocks.recordPerformance.mock.calls;
    expect(navigation).toEqual(["tab:quality", expect.any(Number), "navigation"]);
    expect(render).toEqual(["tab-render:quality", expect.any(Number), "render"]);
    expect(navigation?.[1]).toBe(render?.[1]);
    expect(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)).toBe("quality");
  });

  it("resets only the page scroll when the selected tab changes", () => {
    const { result } = renderHook(() => useHomeNavigation());

    document.documentElement.scrollTop = 480;
    act(() => {
      result.current.setActiveTab("run");
    });
    expect(document.documentElement.scrollTop).toBe(480);

    act(() => {
      result.current.setActiveTab("quality");
    });
    expect(document.documentElement.scrollTop).toBe(0);

    document.documentElement.scrollTop = 320;
    act(() => {
      result.current.setActiveTab("quality");
    });
    expect(document.documentElement.scrollTop).toBe(320);
  });

  it.each([
    ["#incidents", "incidents"],
    ["#incidents/incident-123", "incidents"],
    ["#sync-diagnostics", "summary"],
  ] as const)("maps %s to the %s Home surface", (hash, expectedTab) => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "warehouse");
    window.location.hash = hash;

    const { result } = renderHook(() => useHomeNavigation());

    expect(result.current.activeTab).toBe(expectedTab);
  });
});
