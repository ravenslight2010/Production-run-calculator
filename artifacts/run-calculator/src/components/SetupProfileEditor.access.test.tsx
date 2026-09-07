// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  loadProfile: vi.fn(),
  saveProfile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../storage", () => ({
  loadProfile: mocks.loadProfile,
  saveProfile: mocks.saveProfile,
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
  mocks.saveProfile.mockReset();
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
    expect(mocks.saveProfile).not.toHaveBeenCalled();
  });

  it("saves setup changes for users with manage-profiles", async () => {
    mocks.loadProfile.mockReturnValue(null);
    const user = userEvent.setup();

    render(<SetupProfileEditor {...editorProps(true)} />);
    await user.click(screen.getByRole("button", { name: "Save Setup" }));

    expect(mocks.saveProfile).toHaveBeenCalledWith(
      "Northstar",
      "Pepperoni",
      expect.objectContaining({ pep1Combined: true }),
    );
  });
});