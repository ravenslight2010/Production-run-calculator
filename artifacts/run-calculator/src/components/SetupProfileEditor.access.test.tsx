// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_VALUES } from "../types";

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
  FrontlineRecipeCard: ({
    recipePickerLabel,
    recipePickerTestId,
  }: {
    recipePickerLabel?: string;
    recipePickerTestId?: string;
  }) => recipePickerTestId ? (
    <div data-testid={recipePickerTestId} aria-label={recipePickerLabel} />
  ) : null,
  TypeDropdown: () => null,
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
  it("keeps the sauce ingredient picker labeled in Setup Profiles", () => {
    mocks.loadProfile.mockReturnValue({
      ...DEFAULT_VALUES,
      frontlineRecipeName: "Tomato Sauce",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 1 }],
    });

    render(<SetupProfileEditor {...editorProps(true)} />);

    const picker = screen.getByTestId("setup-recipe-picker-sauce-ingredients");
    expect(picker.getAttribute("aria-label")).toBe("Sauce recipe ingredients");
  });

  it("keeps a missing case pack saveable as a clearly labeled draft", async () => {
    mocks.loadProfile.mockReturnValue(null);
    mocks.saveProfileAndWaitForServer.mockResolvedValue("saved");
    const user = userEvent.setup();

    render(<SetupProfileEditor {...editorProps(true)} />);

    expect(screen.getByTestId("setup-profile-case-pack-readiness").textContent).toMatch(
      /not ready for case-based runs/i,
    );
    expect(screen.getByText(/you can still save this setup as a draft/i)).toBeTruthy();
    expect(document.getElementById("setup-profile-pizzas-per-case")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save Setup" }));
    expect(mocks.saveProfileAndWaitForServer).toHaveBeenCalled();
  });

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

  it("shows the save acknowledgement after run-refresh feedback", async () => {
    mocks.loadProfile.mockReturnValue(null);
    mocks.saveProfileAndWaitForServer.mockResolvedValue("saved");
    const events: string[] = [];
    mocks.toast.mockImplementation(({ title }: { title?: string }) => {
      events.push(title ?? "");
    });
    const onSaved = vi.fn(async () => {
      await Promise.resolve();
      mocks.toast({ title: "Run form updated" });
    });
    const user = userEvent.setup();

    render(<SetupProfileEditor {...editorProps(true)} onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: "Save Setup" }));

    await waitFor(() =>
      expect(events).toEqual([
        "Run form updated",
        "Saved setup for Northstar — Pepperoni",
      ]),
    );
  });

  it("distinguishes a saved setup from a failed run refresh", async () => {
    mocks.loadProfile.mockReturnValue(null);
    mocks.saveProfileAndWaitForServer.mockResolvedValue("saved");
    const onSaved = vi.fn().mockRejectedValue(new Error("run refresh failed"));
    const user = userEvent.setup();

    render(<SetupProfileEditor {...editorProps(true)} onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: "Save Setup" }));

    const error = await screen.findByTestId("setup-profile-save-error");
    expect(error.textContent).toMatch(/setup was saved.*run could not be refreshed/i);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Setup saved, but run refresh did not complete",
        variant: "destructive",
      }),
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Setup was not saved" }),
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
