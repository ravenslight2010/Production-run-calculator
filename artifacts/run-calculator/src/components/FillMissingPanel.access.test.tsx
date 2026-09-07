// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  hasCapability: vi.fn(),
  fetchFillMissingValues: vi.fn(),
  saveFillMissingValues: vi.fn(),
  detectMissingFields: vi.fn(),
  buildProposals: vi.fn(),
  makeWebLookup: vi.fn(),
}));

vi.mock("../useRole", () => ({
  useMe: () => ({ hasCapability: mocks.hasCapability }),
}));

vi.mock("../fillMissing", () => ({
  fetchFillMissingValues: mocks.fetchFillMissingValues,
  saveFillMissingValues: mocks.saveFillMissingValues,
  detectMissingFields: mocks.detectMissingFields,
  buildProposals: mocks.buildProposals,
  makeWebLookup: mocks.makeWebLookup,
  aiCandidates: () => [],
  buildFillMissingInput: vi.fn(),
  requestFillMissing: vi.fn(),
  fillMissingErrorMessage: (error: unknown) => String(error),
}));

import FillMissingPanel from "./FillMissingPanel";

const proposal = {
  key: "targetDoughballWeight",
  label: "Doughball weight",
  category: "dough",
  value: "8",
  source: "learned",
  fillable: true,
  kind: "number",
} as const;

function renderPanel(canManageProfiles: boolean, onCommit = vi.fn()) {
  mocks.hasCapability.mockImplementation((capability: string) => {
    if (capability === "manage-profiles") return canManageProfiles;
    return false;
  });
  mocks.fetchFillMissingValues.mockResolvedValue([]);
  mocks.saveFillMissingValues.mockResolvedValue(undefined);
  mocks.detectMissingFields.mockReturnValue([{ key: proposal.key }]);
  mocks.buildProposals.mockReturnValue([proposal]);
  mocks.makeWebLookup.mockReturnValue({});

  render(
    <FillMissingPanel
      getRecord={() => ({})}
      brand="Northstar"
      flavor="Pepperoni"
      dieType="12 inch"
      canEdit
      onCommit={onCommit}
    />,
  );
  return onCommit;
}

afterEach(() => {
  cleanup();
  mocks.hasCapability.mockReset();
  mocks.fetchFillMissingValues.mockReset();
  mocks.saveFillMissingValues.mockReset();
  mocks.detectMissingFields.mockReset();
  mocks.buildProposals.mockReset();
  mocks.makeWebLookup.mockReset();
});

describe("FillMissingPanel capability gates", () => {
  it("still applies a confirmed value to the current run without profile management", async () => {
    const onCommit = renderPanel(false);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /scan for missing data/i }));
    expect(screen.getByText(/does not save a remembered profile value/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /apply/i }));

    expect(onCommit).toHaveBeenCalledWith("targetDoughballWeight", 8);
    expect(mocks.saveFillMissingValues).not.toHaveBeenCalled();
  });

  it("persists a confirmed value as remembered data only with manage-profiles", async () => {
    renderPanel(true);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /scan for missing data/i }));
    await user.click(screen.getByRole("button", { name: /apply/i }));

    expect(mocks.saveFillMissingValues).toHaveBeenCalledWith([
      {
        brand: "Northstar",
        flavor: "Pepperoni",
        fieldKey: "targetDoughballWeight",
        value: "8",
      },
    ]);
  });
});