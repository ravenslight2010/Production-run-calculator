// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  me: {
    userId: "manager-1",
    sandbox: false,
    capabilities: ["manage-profiles"],
  },
}));

vi.mock("../useAuth", () => ({ useAuth: () => ({ me: mocks.me }) }));
vi.mock("../profileCache", () => ({
  getProfileCacheVersion: () => 0,
  profileReadStatus: () => "ready",
  subscribeProfileCache: () => () => {},
}));
vi.mock("../profileServerSync", () => ({
  reconcileProfilesFromServer: vi.fn(),
  pendingProfileWriteCount: () => 0,
  profileRecoveryIsMemoryOnly: () => false,
}));
vi.mock("../runTemplatesRepository", () => ({
  reconcileRunTemplates: vi.fn(),
  flushRunTemplates: vi.fn(),
  runTemplatesStatus: () => "ready",
  runTemplatesVersion: () => 0,
  subscribeRunTemplates: () => () => {},
  pendingRunTemplateCount: () => 0,
}));
vi.mock("../completedHistorySync", () => ({
  completedHistoryStatus: () => "ready",
  COMPLETED_HISTORY_OUTBOX_EVENT: "test-completion-outbox",
  flushCompletedHistoryOutbox: vi.fn(),
  hydrateCompletedHistory: vi.fn(),
  pendingCompletedHistoryCount: () => 0,
}));

import { SharedRecordsStatus } from "./SharedRecordsStatus";

describe("retained local record review", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("run-calc-history", '[{"date":"2026-01-01","runs":[],"runValues":{},"detail":"PRIVATE_HISTORY_VALUE"}]');
    localStorage.setItem("run-calc-completed-history-cache.live", '[{"date":"2026-01-02","detail":"PRIVATE_CACHE_VALUE"}]');
    localStorage.setItem("run-calc-completed-history-outbox.live", '[{"pending":true}]');
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a plain-language summary, hides raw contents, and removes only the selected device copy", () => {
    render(<SharedRecordsStatus />);

    expect(screen.getByText("2 saved local items to review")).toBeTruthy();
    expect(screen.getByText("Older device history")).toBeTruthy();
    expect(screen.getByText("Saved record on this device. Date: 2026-01-01.")).toBeTruthy();
    expect(screen.getByText("Saved record on this device. Date: 2026-01-02.")).toBeTruthy();
    expect(screen.queryByText(/PRIVATE_HISTORY_VALUE|PRIVATE_CACHE_VALUE/)).toBeNull();
    expect(screen.queryByText(/outbox/i)).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove this saved copy from this device" })[0]);

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Permanently remove only this saved item"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Shared facility data will not be changed"));
    expect(localStorage.getItem("run-calc-history")).toBeNull();
    expect(localStorage.getItem("run-calc-completed-history-cache.live")).not.toBeNull();
    expect(localStorage.getItem("run-calc-completed-history-outbox.live")).toBe('[{"pending":true}]');
    expect(screen.queryByText("Older device history")).toBeNull();
    expect(screen.getByText("Saved completed-history copy")).toBeTruthy();
  });

  it("removes one selected dated history item while preserving the rest across reload", () => {
    const remaining = { date: "2026-01-03", runs: [], runValues: {}, detail: "KEEP_THIS" };
    localStorage.setItem("run-calc-history", JSON.stringify([
      { date: "2026-01-01", runs: [], runValues: {}, detail: "REMOVE_THIS" },
      remaining,
    ]));
    const { unmount } = render(<SharedRecordsStatus />);
    fireEvent.click(screen.getByText("3 saved local items to review"));
    const historyItem = screen.getByText("Item 1 of 2 on this device. Date: 2026-01-01.").closest("li")!;
    fireEvent.click(within(historyItem).getByRole("button", { name: "Remove this saved copy from this device" }));

    expect(JSON.parse(localStorage.getItem("run-calc-history")!)).toEqual([remaining]);
    expect(screen.queryByText("Item 1 of 2 on this device. Date: 2026-01-01.")).toBeNull();
    expect(screen.getByText("Saved record on this device. Date: 2026-01-03.")).toBeTruthy();

    unmount();
    render(<SharedRecordsStatus />);
    expect(screen.queryByText("REMOVE_THIS")).toBeNull();
    expect(screen.getByText("Saved record on this device. Date: 2026-01-03.")).toBeTruthy();
  });

  it("removes multiple reviewed copies one at a time and confirms the last removal", () => {
    render(<SharedRecordsStatus />);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove this saved copy from this device" })[0]);
    expect(localStorage.getItem("run-calc-history")).toBeNull();
    expect(localStorage.getItem("run-calc-completed-history-cache.live")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove this saved copy from this device" }));
    expect(localStorage.getItem("run-calc-completed-history-cache.live")).toBeNull();
    expect(localStorage.getItem("run-calc-completed-history-outbox.live")).toBe('[{"pending":true}]');
    expect(screen.getByText("Saved copy removed from this device.")).toBeTruthy();
    expect(screen.queryByText("2 saved local items to review")).toBeNull();
  });
});
