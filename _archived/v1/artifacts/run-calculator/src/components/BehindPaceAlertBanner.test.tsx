// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  BEHIND_PACE_AUTO_DISMISS_MS,
  BehindPaceAlertBanner,
} from "./BehindPaceAlertBanner";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BehindPaceAlertBanner", () => {
  it("keeps the existing status semantics and accessible dismiss control", () => {
    render(
      <BehindPaceAlertBanner
        runId="run-1"
        message="Run station — behind pace."
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("dismisses after 30 seconds when untouched", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <BehindPaceAlertBanner
        runId="run-1"
        message="Run station — behind pace."
        onDismiss={onDismiss}
      />,
    );

    vi.advanceTimersByTime(BEHIND_PACE_AUTO_DISMISS_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("pauses while the dismiss control has focus", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <BehindPaceAlertBanner
        runId="run-1"
        message="Run station — behind pace."
        onDismiss={onDismiss}
      />,
    );
    const dismiss = screen.getByRole("button", { name: "Dismiss" });

    vi.advanceTimersByTime(20_000);
    fireEvent.focus(dismiss);
    vi.advanceTimersByTime(30_000);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.blur(dismiss);
    vi.advanceTimersByTime(9_999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("uses the same callback for manual dismissal", () => {
    const onDismiss = vi.fn();
    render(
      <BehindPaceAlertBanner
        runId="run-1"
        message="Run station — behind pace."
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});