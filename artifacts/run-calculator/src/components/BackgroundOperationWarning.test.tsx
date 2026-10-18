// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  hasCapability: vi.fn(),
  useDiagnostics: vi.fn(),
}));

vi.mock("../useRole", () => ({
  useMe: () => ({
    hasCapability: mocks.hasCapability,
    isLoading: false,
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetBackgroundOperationDiagnosticsQueryKey: () => ["/background-operations/diagnostics"],
  useGetBackgroundOperationDiagnostics: mocks.useDiagnostics,
}));

import BackgroundOperationWarning from "./BackgroundOperationWarning";

afterEach(() => {
  cleanup();
  mocks.hasCapability.mockReset();
  mocks.useDiagnostics.mockReset();
});

describe("BackgroundOperationWarning", () => {
  it("does not request or render diagnostics for staff", () => {
    mocks.hasCapability.mockReturnValue(false);
    mocks.useDiagnostics.mockReturnValue({ data: undefined });

    render(<BackgroundOperationWarning />);

    expect(screen.queryByTestId("background-operation-warning")).toBeNull();
    expect(mocks.useDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ enabled: false }),
    }));
  });

  it("shows only the fixed operation label and sanitized failure time", () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.useDiagnostics.mockReturnValue({
      data: {
        warnings: [{
          operation: "server-job-prune",
          lastFailureAt: "2026-09-15T12:30:00.000Z",
        }],
        automaticTrackingBackoff: {
          deferredDateCount: 0,
          deferredDateCountCapped: false,
          nextEligibleRetryAt: null,
        },
        windowMs: 300_000,
      },
    });

    render(<BackgroundOperationWarning />);

    expect(screen.getByTestId("background-operation-warning").textContent)
      .toContain("Job cleanup");
    expect(screen.getByTestId("background-operation-server-job-prune")
      .querySelector("time")?.getAttribute("datetime"))
      .toBe("2026-09-15T12:30:00.000Z");
  });

  it("clears the warning when the shared diagnostics return no warnings", () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.useDiagnostics.mockReturnValue({
      data: {
        warnings: [],
        automaticTrackingBackoff: {
          deferredDateCount: 0,
          deferredDateCountCapped: false,
          nextEligibleRetryAt: null,
        },
        windowMs: 300_000,
      },
    });

    render(<BackgroundOperationWarning />);

    expect(screen.queryByTestId("background-operation-warning")).toBeNull();
  });

  it("shows bounded automatic-tracking recovery without requiring a repeated-failure warning", () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.useDiagnostics.mockReturnValue({
      data: {
        warnings: [],
        automaticTrackingBackoff: {
          deferredDateCount: 100,
          deferredDateCountCapped: true,
          nextEligibleRetryAt: "2026-09-15T12:31:00.000Z",
        },
        windowMs: 300_000,
      },
    });

    render(<BackgroundOperationWarning />);

    expect(screen.getByTestId("automatic-tracking-backoff").textContent)
      .toContain("100+ dates");
    expect(screen.getByTestId("automatic-tracking-backoff")
      .querySelector("time")?.getAttribute("datetime"))
      .toBe("2026-09-15T12:31:00.000Z");
  });
});