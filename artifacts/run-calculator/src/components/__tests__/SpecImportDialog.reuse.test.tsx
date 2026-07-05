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
  return render(
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
