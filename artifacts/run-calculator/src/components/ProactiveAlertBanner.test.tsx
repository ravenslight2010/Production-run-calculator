// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(() => cleanup());
import ProactiveAlertBanner from "./ProactiveAlertBanner";
import type { ProactiveAlert } from "../aiProactive";
import {
  PROACTIVE_NOTICE_NON_URGENT_MS,
  PROACTIVE_NOTICE_URGENT_MS,
  proactiveNoticeDurationMs,
} from "./ProactiveAlertBanner";

function makeAlert(overrides: Partial<ProactiveAlert> = {}): ProactiveAlert {
  return {
    key: "behind-plan",
    category: "run",
    impact: "high",
    title: "Falling behind",
    detail: "Line is slower than planned.",
    ...overrides,
  };
}

describe("ProactiveAlertBanner", () => {
  afterEach(() => vi.useRealTimers());

  it("renders nothing when alert is null", () => {
    const { container } = render(
      <ProactiveAlertBanner alert={null} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the title and detail when alert is present", () => {
    render(<ProactiveAlertBanner alert={makeAlert()} onDismiss={() => {}} />);
    expect(screen.getByText("Falling behind")).toBeTruthy();
    expect(screen.getByText("Line is slower than planned.")).toBeTruthy();
  });

  it("renders the dismiss button", () => {
    render(<ProactiveAlertBanner alert={makeAlert()} onDismiss={() => {}} />);
    expect(screen.getByTestId("proactive-alert-dismiss")).toBeTruthy();
  });

  it("does NOT render the Apply button when onApply is absent", () => {
    render(<ProactiveAlertBanner alert={makeAlert()} onDismiss={() => {}} />);
    expect(screen.queryByTestId("proactive-alert-apply")).toBeNull();
  });

  it("does NOT render the Apply button when onApply is provided but alert has no suggestedAction", () => {
    render(
      <ProactiveAlertBanner
        alert={makeAlert()}
        onDismiss={() => {}}
        onApply={() => {}}
      />,
    );
    expect(screen.queryByTestId("proactive-alert-apply")).toBeNull();
  });

  it("renders the Apply button when onApply is provided AND alert has suggestedAction", () => {
    const alert = makeAlert({ suggestedAction: { skidsCompleted: 10, casesOnCurrentSkid: 3 } });
    render(
      <ProactiveAlertBanner alert={alert} onDismiss={() => {}} onApply={() => {}} />,
    );
    expect(screen.getByTestId("proactive-alert-apply")).toBeTruthy();
  });

  it("Apply button calls onApply and onDismiss when clicked", async () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    const alert = makeAlert({ suggestedAction: { skidsCompleted: 10, casesOnCurrentSkid: 3 } });
    render(
      <ProactiveAlertBanner alert={alert} onDismiss={onDismiss} onApply={onApply} />,
    );
    await userEvent.click(screen.getByTestId("proactive-alert-apply"));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("dismiss button calls onDismiss", async () => {
    const onDismiss = vi.fn();
    render(<ProactiveAlertBanner alert={makeAlert()} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByTestId("proactive-alert-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it.each([
    ["low", PROACTIVE_NOTICE_NON_URGENT_MS],
    ["medium", PROACTIVE_NOTICE_NON_URGENT_MS],
    ["high", PROACTIVE_NOTICE_URGENT_MS],
  ] as const)("uses the approved %s-impact duration", (impact, durationMs) => {
    expect(proactiveNoticeDurationMs(impact)).toBe(durationMs);
    render(<ProactiveAlertBanner alert={makeAlert({ impact })} onDismiss={() => {}} />);
    expect(screen.getByTestId("proactive-alert").getAttribute("data-auto-dismiss-ms")).toBe(
      String(durationMs),
    );
  });

  it("auto-dismisses after the impact duration and preserves manual callback wiring", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ProactiveAlertBanner alert={makeAlert({ impact: "low" })} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(PROACTIVE_NOTICE_NON_URGENT_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("pauses while hovered or focused and resumes with the remaining time", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ProactiveAlertBanner alert={makeAlert({ impact: "low" })} onDismiss={onDismiss} />);
    const banner = screen.getByTestId("proactive-alert");

    vi.advanceTimersByTime(4_000);
    fireEvent.mouseEnter(banner);
    vi.advanceTimersByTime(20_000);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(banner);
    vi.advanceTimersByTime(5_999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();

    const secondDismiss = vi.fn();
    cleanup();
    render(
      <ProactiveAlertBanner
        alert={makeAlert({ key: "focused", impact: "low" })}
        onDismiss={secondDismiss}
      />,
    );
    const focusedBanner = screen.getByTestId("proactive-alert");
    vi.advanceTimersByTime(4_000);
    fireEvent.focus(focusedBanner.querySelector("button")!);
    vi.advanceTimersByTime(20_000);
    expect(secondDismiss).not.toHaveBeenCalled();
    fireEvent.blur(focusedBanner.querySelector("button")!);
    vi.advanceTimersByTime(5_999);
    expect(secondDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(secondDismiss).toHaveBeenCalledOnce();
  });

  it("resets the timer for a newly surfaced alert and cleans up the old timer", () => {
    vi.useFakeTimers();
    const firstDismiss = vi.fn();
    const secondDismiss = vi.fn();
    const first = makeAlert({ key: "first", impact: "low" });
    const { rerender, unmount } = render(
      <ProactiveAlertBanner alert={first} onDismiss={firstDismiss} />,
    );

    vi.advanceTimersByTime(8_000);
    rerender(
      <ProactiveAlertBanner
        alert={makeAlert({ key: "second", impact: "low" })}
        onDismiss={secondDismiss}
      />,
    );
    vi.advanceTimersByTime(2_000);
    expect(firstDismiss).not.toHaveBeenCalled();
    expect(secondDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PROACTIVE_NOTICE_NON_URGENT_MS - 2_000);
    expect(secondDismiss).toHaveBeenCalledOnce();
    unmount();
    vi.advanceTimersByTime(PROACTIVE_NOTICE_NON_URGENT_MS);
    expect(firstDismiss).not.toHaveBeenCalled();
  });
});
