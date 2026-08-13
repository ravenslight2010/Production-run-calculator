// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(() => cleanup());
import ProactiveAlertBanner from "./ProactiveAlertBanner";
import type { ProactiveAlert } from "../aiProactive";

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
});
