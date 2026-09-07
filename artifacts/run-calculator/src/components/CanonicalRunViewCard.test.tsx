// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CanonicalRunViewCard from "./CanonicalRunViewCard";
import { useMe } from "../useRole";

vi.mock("../useRole", () => ({ useMe: vi.fn() }));
vi.mock("../inventoryShared", () => ({ reportUnauthorized: vi.fn() }));

const view = {
  version: 1,
  date: "2026-09-07",
  runId: "run/a",
  observed: { status: "running", elapsedBatchSec: 3600 },
  recap: { casesNeeded: 100, casesCompleted: 60, casesLeftToRun: 40, pressDone: false, extraCases: 0 },
  elapsed: {
    batchSec: 3600,
    phase: {
      stage1: { label: "Press / Oven / Frontline", state: "empty", remainMs: 0 },
      stage2: { label: "Freeze tunnel", state: "active", remainMs: 0 },
      stage3: { label: "Wrapper / Packaging", state: "draining", remainMs: 1000 },
    },
  },
  pace: { ppm: 42.5, paceStatus: "behind", paceDelta: -2, catchUpPpm: 45 },
  advisory: { freezer: { cases: 8, configuredMinutes: 30 }, line: { cases: 3 } },
  calculatedAt: 1_788_777_600_000,
  freshness: {
    status: "fresh",
    snapshotId: "snapshot-1",
    capturedAt: 1_788_777_600_000,
    ageMs: 100,
    maxAgeMs: 60_000,
  },
  formulaProvenance: { calculator: "computeServerCalc" },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CanonicalRunViewCard", () => {
  it("requests the scoped server model and renders canonical facts", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null, role: null, capabilities: ["review-incidents"],
      hasCapability: (capability) => capability === "review-incidents",
      isManager: true, isLoading: false,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => view });
    vi.stubGlobal("fetch", fetchMock);
    render(<CanonicalRunViewCard date="2026-09-07" runId="run/a" />);

    expect(await screen.findByText("60/100")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/reports/operational-view?date=2026-09-07&runId=run%2Fa",
    );
    expect(screen.getByText("Freeze tunnel (active) · Wrapper / Packaging (draining)")).toBeTruthy();
    expect(screen.getByText(/revision 1.*computeServerCalc/i)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /refresh canonical/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("labels stale and unavailable snapshots without presenting local values as canonical", async () => {
    vi.mocked(useMe).mockReturnValue({
      me: null, role: null, capabilities: ["review-incidents"],
      hasCapability: (capability) => capability === "review-incidents",
      isManager: true, isLoading: false,
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...view, freshness: { ...view.freshness, status: "stale" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "No canonical snapshot exists." } }),
      }));
    const rendered = render(<CanonicalRunViewCard date="2026-09-07" runId="run/a" />);
    expect(await screen.findByText(/stale canonical snapshot/i)).toBeTruthy();

    rendered.rerender(<CanonicalRunViewCard date="2026-09-08" runId="run-b" />);
    expect(await screen.findByText(/local live displays continue as offline\/provisional/i)).toBeTruthy();
  });

  it("does not request the protected model without its matching capability", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(useMe).mockReturnValue({
      me: null, role: null, capabilities: [],
      hasCapability: () => false, isManager: true, isLoading: false,
    });
    render(<CanonicalRunViewCard date="2026-09-07" runId="run/a" />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("canonical-run-view")).toBeNull();
  });
});