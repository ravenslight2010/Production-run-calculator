// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BatchDueNoticeDock } from "./BatchDueNoticeDock";

const liveRun = vi.hoisted(() => ({
  showBatchDue: true,
  setShowBatchDue: vi.fn(),
}));

vi.mock("../contexts/LiveRunContext", () => ({
  useLiveRun: () => liveRun,
}));

afterEach(() => {
  cleanup();
  liveRun.showBatchDue = true;
  liveRun.setShowBatchDue.mockClear();
});

describe("BatchDueNoticeDock", () => {
  it("routes to Dough and keeps the reminder's existing acknowledgment action", () => {
    const onNavigateToDough = vi.fn();
    render(<BatchDueNoticeDock onNavigateToDough={onNavigateToDough} />);

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Dough batch due. Start the next batch when ready.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /open dough/i }));
    expect(onNavigateToDough).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss reminder" }));
    expect(liveRun.setShowBatchDue).toHaveBeenCalledWith(false);
  });

  it("does not show when the reminder is dismissed or the station shell is unavailable", () => {
    liveRun.showBatchDue = false;
    const { rerender } = render(<BatchDueNoticeDock onNavigateToDough={() => {}} />);
    expect(screen.queryByTestId("batch-due-notice-dock")).toBeNull();

    liveRun.showBatchDue = true;
    rerender(<BatchDueNoticeDock onNavigateToDough={() => {}} enabled={false} />);
    expect(screen.queryByTestId("batch-due-notice-dock")).toBeNull();
  });
});
