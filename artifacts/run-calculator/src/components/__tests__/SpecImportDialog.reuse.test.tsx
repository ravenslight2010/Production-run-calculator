import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type {
  ParsedProfile,
  ParsedRecipe,
  ParsedSpecImport,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import SpecImportDialog from "../SpecImportDialog";

// Keep the test focused on the reuse picker wiring. The heavy import/storage
// stack is stubbed; the picker just needs a list of existing names to offer and
// the display-kind pass-through.
vi.mock("@/specImport", () => ({
  buildDiscrepancies: () => [],
}));
vi.mock("@/storage", () => ({
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  existingDieTypesForImport: () => [],
  specImportRecipeDisplayKind: (r: ParsedRecipe) => r.kind,
}));

afterEach(() => cleanup());

function makePrepared(recipe: ParsedRecipe, profiles: ParsedProfile[] = []): SpecImportPrepared {
  const parsed: ParsedSpecImport = { profiles, recipes: [recipe] };
  return {
    parsed,
    summary: {
      profilesNew: profiles.length,
      profilesUpdated: 0,
      recipesNew: 1,
      recipesUpdated: 0,
      totalProfiles: profiles.length,
      totalRecipes: 1,
    },
    newAliases: [],
    flagged: [],
    discrepancies: [],
    skipped: { profiles: [], recipes: [] },
    brands: [],
    flavorsByBrand: {},
  };
}

function renderDialog(prepared: SpecImportPrepared, onConfirm: (p: ParsedSpecImport) => void) {
  const result = render(
    <SpecImportDialog
      open={true}
      onClose={() => {}}
      loading={false}
      error={null}
      prepared={prepared}
      applying={false}
      existingRecipeNamesByKind={{
        dough: ["House Dough", "Thin Crust"],
        sauce: [],
        cheese: [],
        mix: [],
      }}
      onConfirm={onConfirm}
    />,
  );
  // The recipe rows and Apply live in step 2 of the two-step review; every reuse
  // test operates on recipes, so advance past the step-1 product confirmation.
  fireEvent.click(screen.getByText("Next"));
  return result;
}

describe("SpecImportDialog reuse-existing-recipe picker", () => {
  it("offers a 'Use existing' selector listing the user's saved recipes of that kind", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "Corner Booth",
      flavor: "PLAIN",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(makePrepared(recipe, [{ brand: "Corner Booth", flavor: "PLAIN" }]), () => {});

    const select = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "House Dough", "Thin Crust"]);
  });

  it("emits a referenceOnly recipe pointing at the chosen existing name on apply", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "Corner Booth",
      flavor: "PLAIN",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const onConfirm = vi.fn();
    renderDialog(makePrepared(recipe, [{ brand: "Corner Booth", flavor: "PLAIN" }]), onConfirm);

    fireEvent.change(screen.getByTestId("spec-recipe-link-rk0"), {
      target: { value: "House Dough" },
    });

    // Reuse note appears and the free-text name input is hidden.
    expect(screen.getByText(/Using your existing/)).toBeTruthy();
    expect(screen.queryByTestId("spec-recipe-name-rk0")).toBeNull();

    fireEvent.click(screen.getByText(/^Apply/));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.recipes).toHaveLength(1);
    expect(out.recipes[0]).toMatchObject({
      name: "House Dough",
      kind: "dough",
      referenceOnly: true,
    });
  });

  it("suppresses the 'won't show on any product' nudge for a reused recipe", () => {
    // A recipe with no brand/flavor attaches to nothing, so the nudge shows...
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(makePrepared(recipe, []), () => {});

    expect(screen.getByText(/Won't show on any product yet/)).toBeTruthy();

    // ...but once the user reuses an existing recipe, the nudge disappears.
    fireEvent.change(screen.getByTestId("spec-recipe-link-rk0"), {
      target: { value: "House Dough" },
    });
    expect(screen.queryByText(/Won't show on any product yet/)).toBeNull();
  });

  it("keeps the flavor selector visible after a brand is chosen (does not vanish + attach to all)", () => {
    // Regression: a recipe with no brand/flavor shows the attach editor. The
    // moment a brand is typed it matches every flavor of that brand, which used
    // to flip the row out of the "attaches to nothing" state and REMOVE the
    // whole editor — so the flavor field disappeared before the user could pick
    // one and the recipe silently stuck to all flavors.
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(
      makePrepared(recipe, [
        { brand: "Corner Booth", flavor: "PLAIN" },
        { brand: "Corner Booth", flavor: "PEPPERONI" },
      ]),
      () => {},
    );

    // Starts in the "attaches to nothing" state with the flavor field visible.
    expect(screen.getByText(/Won't show on any product yet/)).toBeTruthy();
    expect(screen.getByTestId("spec-recipe-flavor-rk0")).toBeTruthy();

    // Type just a brand — it now matches all flavors of that brand.
    fireEvent.change(screen.getByTestId("spec-recipe-brand-rk0"), {
      target: { value: "Corner Booth" },
    });

    // The flavor field must remain so the user can still narrow to one flavor.
    expect(screen.getByTestId("spec-recipe-flavor-rk0")).toBeTruthy();
    expect(screen.getByText(/Attaching to every flavor/)).toBeTruthy();
    expect(screen.queryByText(/Won't show on any product yet/)).toBeNull();
  });

  it("emits a brand+flavor-scoped recipe once the user picks a specific flavor", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared(recipe, [
        { brand: "Corner Booth", flavor: "PLAIN" },
        { brand: "Corner Booth", flavor: "PEPPERONI" },
      ]),
      onConfirm,
    );

    fireEvent.change(screen.getByTestId("spec-recipe-brand-rk0"), {
      target: { value: "Corner Booth" },
    });
    fireEvent.change(screen.getByTestId("spec-recipe-flavor-rk0"), {
      target: { value: "PLAIN" },
    });

    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.recipes[0]).toMatchObject({ brand: "Corner Booth", flavor: "PLAIN" });
  });

  it("does NOT mark a recipe referenceOnly when 'Create new recipe' stays selected", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "Corner Booth",
      flavor: "PLAIN",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const onConfirm = vi.fn();
    renderDialog(makePrepared(recipe, [{ brand: "Corner Booth", flavor: "PLAIN" }]), onConfirm);

    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.recipes[0].name).toBe("Sheet Dough");
    expect(out.recipes[0].referenceOnly).toBeUndefined();
  });
});
