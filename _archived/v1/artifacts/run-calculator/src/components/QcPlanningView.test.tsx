// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QcPlanningView from "./QcPlanningView";

function response(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  };
}

const scheduled = {
  range: { from: "2030-12-30", through: "2031-01-28", days: 30 },
  maxDays: 90,
  days: [{
    date: "2030-12-31",
    status: "scheduled",
    runs: [{
      runId: "synthetic-run-1",
      brand: "Synthetic Brand",
      flavor: "Cheese",
      casesNeeded: 24,
    }],
  }, {
    date: "2031-01-01",
    status: "scheduled",
    runs: [{
      runId: null,
      brand: null,
      flavor: "Pepperoni",
      casesNeeded: null,
    }],
  }],
};

describe("QC upcoming production planning", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows scheduled items and labels incomplete fields as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(scheduled));
    vi.stubGlobal("fetch", fetchMock);

    render(<QcPlanningView />);

    const completeRun = await screen.findByTestId("qc-planning-run-synthetic-run-1");
    expect(completeRun.textContent).toContain("Synthetic Brand");
    expect(completeRun.textContent).toContain("Cheese");
    expect(screen.getAllByText("Unknown", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("24 cases")).toBeTruthy();
    expect(fetchMock.mock.calls[0]![0]).toMatch(
      /^\/api\/qc\/planning\?today=\d{4}-\d{2}-\d{2}&days=30$/,
    );
    expect(screen.getByTestId("qc-planning-day-2031-01-01")).toBeTruthy();
  });

  it("distinguishes a successful empty schedule from a failed read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      range: { from: "2030-12-30", through: "2031-01-28", days: 30 },
      maxDays: 90,
      days: [],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<QcPlanningView />);
    const noPersistedDays = await screen.findByTestId("empty-qc-planning");
    expect(noPersistedDays.textContent).toContain("No persisted schedule days");

    view.unmount();
    fetchMock.mockResolvedValueOnce(response({ error: "source unavailable" }, false));
    render(<QcPlanningView />);
    expect(await screen.findByTestId("alert-qc-planning-error")).toBeTruthy();
    expect(screen.queryByTestId("empty-qc-planning")).toBeNull();
  });

  it("refreshes canonical data and keeps a valid selected range across reloads", async () => {
    const changed = {
      ...scheduled,
      days: [{
        date: "2031-01-02",
        status: "scheduled",
        runs: [{
          runId: "synthetic-run-2",
          brand: "Updated Brand",
          flavor: "Updated Flavor",
          casesNeeded: 48,
        }],
      }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(scheduled))
      .mockResolvedValueOnce(response(changed))
      .mockResolvedValue(response(changed));
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<QcPlanningView />);
    expect(await screen.findByTestId("qc-planning-run-synthetic-run-1")).toBeTruthy();
    fireEvent.change(screen.getByTestId("select-qc-planning-range"), { target: { value: "7" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(window.localStorage.getItem("qc-planning-days-v1")).toBe("7");
    const updatedRun = await screen.findByTestId("qc-planning-run-synthetic-run-2");
    expect(updatedRun.textContent).toContain("Updated Brand");

    fireEvent.click(screen.getByTestId("button-refresh-qc-planning"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    view.unmount();
    render(<QcPlanningView />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.at(-1)![0]).toMatch(/&days=7$/);
    const reloadedUpdatedRun = await screen.findByTestId("qc-planning-run-synthetic-run-2");
    expect(reloadedUpdatedRun.textContent).toContain("Updated Flavor");
  });
});
