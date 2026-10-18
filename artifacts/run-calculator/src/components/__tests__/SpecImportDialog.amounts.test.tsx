import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  sanitizeParsedSpecImport,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedSpecImport,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import SpecImportDialog from "../SpecImportDialog";

vi.mock("@/specImport", () => ({
  buildDiscrepancies: () => [],
  importReviewSignature: () => "review-signature",
}));
vi.mock("@/storage", () => ({
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  existingDieTypesForImport: () => [],
  specImportRecipeDisplayKind: (r: ParsedRecipe) => r.kind,
}));
afterEach(cleanup);

function profile(value = 17, flavor = "Supreme"): ParsedProfile {
  return {
    brand: "Example", flavor, sauceOzPerPizza: value, sauceBarrelLbs: 300,
    targetDoughballWeight: 16,
    applicators: [{ type: "Cheese", ozPerPizza: value, batchLbs: 50, slot: 2 }],
    pepperonis: [{ type: "Natural", ozPerPizza: value, sticks: 3, batchLbs: 40 }],
  };
}
function prepared(profiles: ParsedProfile[], recipes: ParsedRecipe[] = []): SpecImportPrepared {
  return {
    parsed: { profiles, recipes },
    summary: {
      profilesNew: profiles.length, profilesUpdated: 0, recipesNew: recipes.length,
      recipesUpdated: 0, totalProfiles: profiles.length, totalRecipes: recipes.length,
    },
    newAliases: [], discrepancies: [], skipped: { profiles: [], recipes: [] },
    brands: [], flavorsByBrand: {},
    importReview: {
      changes: [], counts: {
        added: 0, removed: 0, "quantity-changed": 0, "formula-cleared": 0,
        "family-collapsed": 0, "variant-loss": 0, "customer-remapped": 0,
      },
      requiresExplicitConfirmation: false, confirmationReasons: [],
    },
  };
}
function show(input: SpecImportPrepared, onConfirm = vi.fn()) {
  render(<SpecImportDialog
    open onClose={() => {}} loading={false} error={null} prepared={input}
    applying={false} canUseAiTools={false} onUseAiFallback={() => {}}
    existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
    onConfirm={onConfirm}
  />);
  return onConfirm;
}

describe("per-pizza amount review before Apply", () => {
  it.each([0.25, 4, 15.999, 16])("does not flag normal/boundary values %s", (value) => {
    show(prepared([profile(value)]));
    expect(screen.queryByTestId("spec-import-amount-warnings")).toBeNull();
    expect(screen.queryByTestId("spec-profile-amount-warning-pk0")).toBeNull();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByTestId("spec-profile-amount-warning-pk0")).toBeNull();
  });

  it.each([16.000001, 1e6])("shows fresh advisories on both steps and applies %s unchanged", (value) => {
    const parsed = sanitizeParsedSpecImport({
      profiles: [profile(value)],
      recipes: [{
        kind: "sauce", name: "Example Sauce", rowsUnit: "oz",
        rows: [{ ingredient: "Tomato", lbs: 123.456 }],
      }],
    });
    // Old cached reviews have no persisted amount warnings: derive at render.
    const input = JSON.parse(JSON.stringify(prepared(parsed.profiles, parsed.recipes))) as SpecImportPrepared;
    const before = structuredClone(input);
    const onConfirm = show(input);
    expect(screen.getByTestId("spec-import-amount-warnings").textContent)
      .toContain("3 per-pizza amounts above the advisory limit");
    const assertRow = () => {
      const warning = within(screen.getByTestId("spec-profile-amount-warning-pk0"));
      expect(warning.getByText("Check per-pizza amounts — advisory only")).toBeTruthy();
      expect(warning.getByText(new RegExp(`^Sauce: ${value} oz per pizza`))).toBeTruthy();
      expect(warning.getByText(/^Applicator 2 \(Cheese\):/)).toBeTruthy();
      expect(warning.getByText(/^Pepperoni entry 1 \(Natural\):/)).toBeTruthy();
    };
    assertRow();
    fireEvent.click(screen.getByText("Next"));
    assertRow();
    expect(screen.getByTestId("spec-import-amount-warnings").textContent)
      .toContain("do not block Apply or change values");
    expect(screen.getByTestId("spec-recipe-rows-unit-rk0").textContent).toContain("oz");
    const apply = screen.getByText(/^Apply/).closest("button") as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    const submitted = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(submitted.profiles[0]).toMatchObject(parsed.profiles[0]);
    expect(submitted.recipes[0].rows).toEqual(parsed.recipes[0].rows);
    expect(submitted.recipes[0].rowsUnit).toBe("oz");
    expect(input).toEqual(before);
  });

  it("adds warnings for inherited sauce on step 2, then recomputes after exclusion", () => {
    const sibling = { ...profile(4, "Cheese"), sauceOzPerPizza: undefined };
    show(prepared([profile(17), sibling]));
    expect(screen.queryByTestId("spec-profile-amount-warning-pk1")).toBeNull();
    fireEvent.click(screen.getByText("Next"));
    const inherited = screen.getByTestId("spec-profile-amount-warning-pk1");
    expect(within(inherited).getByText(/^Sauce: 17 oz per pizza/)).toBeTruthy();
    expect(screen.getByTestId("spec-import-amount-warnings").textContent)
      .toContain("4 per-pizza amounts");
    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(screen.getByTestId("spec-profile-include-pk0"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByTestId("spec-import-amount-warnings")).toBeNull();
    expect(screen.queryByTestId("spec-profile-amount-warning-pk1")).toBeNull();
  });

  it("keeps warnings attached to renamed products and lets the manager exclude them", () => {
    const onConfirm = show(prepared([profile(17), profile(4, "Cheese")]));
    fireEvent.change(screen.getByTestId("spec-profile-brand-pk0"), { target: { value: "Reviewed Brand" } });
    fireEvent.change(screen.getByTestId("spec-profile-flavor-pk0"), { target: { value: "Reviewed Flavor" } });
    fireEvent.click(screen.getByText("Next"));
    const row = screen.getByTestId("spec-profile-pk0");
    expect(row.textContent).toContain("Reviewed Brand — Reviewed Flavor");
    expect(within(row).getByTestId("spec-profile-amount-warning-pk0")).toBeTruthy();
    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(screen.getByTestId("spec-profile-include-pk0"));
    expect(screen.queryByTestId("spec-import-amount-warnings")).toBeNull();
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));
    expect(onConfirm.mock.calls[0][0].profiles).toHaveLength(1);
    expect(onConfirm.mock.calls[0][0].profiles[0].flavor).toBe("Cheese");
  });
});