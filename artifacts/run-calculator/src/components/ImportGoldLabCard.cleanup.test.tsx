// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  applyImportGoldSyntheticReview: vi.fn(),
  deleteImportGoldCleanupCase: vi.fn(),
  deleteImportGoldCase: vi.fn(),
  downloadImportGoldJsonl: vi.fn(),
  fetchImportGoldCleanupCases: vi.fn(),
  fetchImportGoldCases: vi.fn(),
  fetchImportGoldConfig: vi.fn(),
  fetchImportGoldSyntheticReview: vi.fn(),
  scoreImportGold: vi.fn(),
  setImportGoldLocalScoringEnabled: vi.fn(),
  setImportGoldExcluded: vi.fn(),
}));

vi.mock("@/importGold", () => api);

import ImportGoldLabCard from "./ImportGoldLabCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.values(api).forEach((mock) => mock.mockReset());
});

describe("ImportGoldLabCard cleanup-only mode", () => {
  it("shows only bounded case metadata and refreshes after a confirmed deletion", async () => {
    api.fetchImportGoldConfig.mockResolvedValue({
      enabled: false,
      cleanupEnabled: true,
      localConfigured: false,
      localAvailable: false,
      localScoringSwitchAvailable: true,
      localScoringEnabled: true,
      syntheticFixtureAvailable: true,
      geminiConfigured: false,
      retention: "Synthetic retention text",
      persistsAcrossFactoryPurge: true,
    });
    api.fetchImportGoldCleanupCases
      .mockResolvedValueOnce([{
        id: 57,
        importType: "premix",
        createdAt: "2026-10-30T12:00:00.000Z",
      }])
      .mockResolvedValue([]);
    api.deleteImportGoldCleanupCase.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    render(<ImportGoldLabCard />);

    const cleanupPanel = await screen.findByTestId("import-gold-cleanup-only");
    expect(withinText(cleanupPanel)).toContain("premix · #57");
    expect(withinText(cleanupPanel)).toContain("Source approval is off");
    expect(withinText(cleanupPanel)).not.toMatch(/SYNTHETIC_PRIVATE|Export JSONL|Score locally|field differences|Expected:|Predicted:/i);
    expect(screen.queryByRole("button", { name: "Export JSONL" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Score locally" })).toBeNull();
    expect(api.fetchImportGoldCases).not.toHaveBeenCalled();
    expect(api.fetchImportGoldSyntheticReview).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete case and scores" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("does not delete source workbooks, exports, or backups"));
    expect(api.deleteImportGoldCleanupCase).toHaveBeenCalledWith(57);
    await waitFor(() => expect(screen.getByText("No retained cases are available for cleanup in this scope.")).toBeTruthy());
  });
});

function withinText(element: HTMLElement): string {
  return element.textContent ?? "";
}
