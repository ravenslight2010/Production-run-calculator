// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  loadProfile: vi.fn(),
  saveProfileAndWaitForServer: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../storage", () => ({
  loadProfile: mocks.loadProfile,
  saveProfileAndWaitForServer: mocks.saveProfileAndWaitForServer,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mocks.toast,
}));

vi.mock("../hooks/useMixes", () => ({
  useMixes: () => ({ items: [] }),
}));

vi.mock("@/hooks/useCheeseRecipes", () => ({
  useCheeseRecipes: () => ({ items: [] }),
}));

vi.mock("@/hooks/useNamedRecipes", () => ({
  useNamedRecipes: () => ({ items: [] }),
}));

vi.mock("../hooks/useDieLineDefaults", () => ({
  useDieLineDefaults: () => ({ overrides: {} }),
}));

vi.mock("../savedSpecSheets", () => ({
  fetchSavedSpecSheets: vi.fn().mockResolvedValue([]),
}));

vi.mock("../savedShippingGuides", () => ({
  fetchSavedShippingGuides: vi.fn().mockResolvedValue([]),
}));

vi.mock("@workspace/name-match", () => ({
  brandTagLabels: () => new Map(),
}));

vi.mock("../pages/home", () => ({
  IngredientSelect: () => null,
  CheesePickCard: () => null,
  MixRecipeCard: () => null,
  DoughRecipeCard: () => null,
  FrontlineRecipeCard: () => null,
  TypeDropdown: () => null,
  NumField: () => null,
}));

import SetupProfileEditor from "./SetupProfileEditor";

const noop = vi.fn();

function editorProps(canManageProfiles: boolean) {
  return {
    open: true,
    onClose: noop,
    initialBrand: "Northstar",
    initialFlavor: "Pepperoni",
    isSupervisor: true,
    canManageProfiles,
    brands: ["Northstar"],
    brandFlavors: { Northstar: ["Pepperoni"] },
    onAddBrand: (name: string) => name,
    onRemoveBrand: noop,
    onAddFlavor: (name: string) => name,
    onRemoveFlavor: noop,
    dieTypes: [],
    onAddDieType: noop,
    circles: [],
    onAddCircle: noop,
    onRemoveCircle: noop,
    shipperOptions: [],
    onAddShipper: noop,
    onRemoveShipper: noop,
    skidStackingOptions: [],
    onAddSkidStacking: noop,
    onRemoveSkidStacking: noop,
    gripSheetsOptions: [],
    onAddGripSheets: noop,
    onRemoveGripSheets: noop,
    ingredientTypes: [],
    onAddIngredientType: noop,
    onRemoveIngredientType: noop,
    pepTypes: [],
    onAddPepType: noop,
    onRemovePepType: noop,
    doughIngredients: [],
    onAddDoughIngredient: noop,
    onRemoveDoughIngredient: noop,
    doughRecipeNames: [],
    onAddDoughRecipeName: noop,
    onRemoveDoughRecipeName: noop,
    frontlineIngredients: [],
    onAddFrontlineIngredient: noop,
    onRemoveFrontlineIngredient: noop,
    frontlineRecipeNames: [],
    onAddFrontlineRecipeName: noop,
    onRemoveFrontlineRecipeName: noop,
  };
}

afterEach(() => {
  cleanup();
  mocks.loadProfile.mockReset();
  mocks.saveProfileAndWaitForServer.mockReset();
  mocks.toast.mockReset();
});

describe("SetupProfileEditor capability gate", () => {
  it("replaces Save Setup with a read-only explanation without manage-profiles", () => {
    mocks.loadProfile.mockReturnValue(null);

    render(<SetupProfileEditor {...editorProps(false)} />);

    expect(screen.queryByRole("button", { name: "Save Setup" })).toBeNull();
    expect(screen.getByTestId("setup-profile-read-only")).toBeTruthy();
    expect(screen.getByText(/read-only setup profile/i)).toBeTruthy();
    expect(screen.getByText(/requires profile management access/i)).toBeTruthy();
    expect(mocks.saveProfileAndWaitForServer).not.toHaveBeenCalled();
  });

  it("saves setup changes for users with manage-profiles", async () => {
    mocks.loadProfile.mockReturnValue(null);
    mocks.saveProfileAndWaitForServer.mockResolvedValue("saved");
    const user = userEvent.setup();

    render(<SetupProfileEditor {...editorProps(true)} />);
    await user.click(screen.getByRole("button", { name: "Save Setup" }));

    expect(mocks.saveProfileAndWaitForServer).toHaveBeenCalledWith(
      "Northstar",
      "Pepperoni",
      expect.objectContaining({ pep1Combined: true }),
    );
  });

  it("keeps the editor open and does not fan out when the server rejects the save", async () => {
    mocks.loadProfile.mockReturnValue(null);
    mocks.saveProfileAndWaitForServer.mockRejectedValue(new Error("Save brand profile was not acknowledged"));
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<SetupProfileEditor {...editorProps(true)} onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: "Save Setup" }));

    const error = await screen.findByTestId("setup-profile-save-error");
    expect(error.textContent).toMatch(/could not be saved|not acknowledged/i);
    expect(onSaved).not.toHaveBeenCalled();
    expect(noop).not.toHaveBeenCalled();
  });

  it("reports an unchanged setup without propagating it", async () => {
    mocks.loadProfile.mockReturnValue(null);
    mocks.saveProfileAndWaitForServer.mockResolvedValue("unchanged");
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<SetupProfileEditor {...editorProps(true)} onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: "Save Setup" }));

    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No changes to save for Northstar — Pepperoni" }),
    );
  });
});