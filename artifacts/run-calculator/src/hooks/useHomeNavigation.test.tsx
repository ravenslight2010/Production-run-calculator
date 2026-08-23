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
});