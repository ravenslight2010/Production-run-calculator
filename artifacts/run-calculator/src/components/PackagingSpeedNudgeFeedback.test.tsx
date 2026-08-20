import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PackagingSpeedNudgeFeedback } from "./PackagingSpeedNudgeFeedback";

describe("PackagingSpeedNudgeFeedback", () => {
  it("keeps the requirement message and the Accept/Dismiss recommendation visible in a phone-width Packaging control area", () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <div style={{ width: 375 }}>
        <PackagingSpeedNudgeFeedback
          nudge={null}
          status={{
            kind: "correction-size",
            direction: "faster",
            correctionCases: 2,
            correctionCasesNeeded: 3,
          }}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      </div>,
    );

    expect(screen.getByTestId("speed-nudge-status").textContent).toContain(
      "Make one more correction in the same direction",
    );
    expect(screen.getByText("Line Speed Check")).not.toBeNull();

    rerender(
      <div style={{ width: 375 }}>
        <PackagingSpeedNudgeFeedback
          nudge={{ value: 1.3, isCrust: false, direction: "faster" }}
          status={null}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      </div>,
    );

    expect(screen.queryByTestId("speed-nudge-status")).toBeNull();
    expect(screen.getByTestId("speed-nudge-card")).not.toBeNull();
    fireEvent.click(screen.getByTestId("speed-nudge-accept"));
    fireEvent.click(screen.getByTestId("speed-nudge-dismiss"));
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});