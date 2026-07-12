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

function makePrepared(
  recipe: ParsedRecipe,
  profiles: ParsedProfile[] = [],
  aliasLinkSuggestions?: Record<string, string>,
): SpecImportPrepared {
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
    ...(aliasLinkSuggestions ? { aliasLinkSuggestions } : {}),
  };
}

function renderDialog(
  prepared: SpecImportPrepared,
  onConfirm: (p: ParsedSpecImport, learned?: unknown) => void,
) {
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
        cheese: ["Aldo's Cheese Mix", "Lowe's Spinach Cheese Mix"],
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

  it("pre-selects 'Use existing' from a remembered link suggestion (cheese)", () => {
    const recipe: ParsedRecipe = {
      kind: "cheese",
      name: "Aldo's Spinach Blend",
      brand: "Aldo's",
      flavor: "SPINACH",
      rows: [{ ingredient: "Mozzarella", lbs: 20 }],
    };
    renderDialog(
      makePrepared(recipe, [{ brand: "Aldo's", flavor: "SPINACH" }], {
        "aldo's spinach blend": "Lowe's Spinach Cheese Mix",
      }),
      () => {},
    );

    const select = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    expect(select.value).toBe("Lowe's Spinach Cheese Mix");
    // Advisory only — the reuse note shows and the user could still clear it.
    expect(screen.getByText(/Using your existing/)).toBeTruthy();
  });

  it("ignores a remembered link whose target recipe no longer exists in the pool", () => {
    const recipe: ParsedRecipe = {
      kind: "cheese",
      name: "Aldo's Spinach Blend",
      brand: "Aldo's",
      flavor: "SPINACH",
      rows: [{ ingredient: "Mozzarella", lbs: 20 }],
    };
    renderDialog(
      makePrepared(recipe, [{ brand: "Aldo's", flavor: "SPINACH" }], {
        "aldo's spinach blend": "Deleted Cheese Mix",
      }),
      () => {},
    );

    const select = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("learns a manual 'Use existing' cheese pick as an appType alias on Apply", () => {
    const recipe: ParsedRecipe = {
      kind: "cheese",
      name: "Aldo's Spinach Blend",
      brand: "Aldo's",
      flavor: "SPINACH",
      rows: [{ ingredient: "Mozzarella", lbs: 20 }],
    };
    const onConfirm = vi.fn();
    renderDialog(makePrepared(recipe, [{ brand: "Aldo's", flavor: "SPINACH" }]), onConfirm);

    fireEvent.change(screen.getByTestId("spec-recipe-link-rk0"), {
      target: { value: "Lowe's Spinach Cheese Mix" },
    });
    fireEvent.click(screen.getByText(/^Apply/));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const learned = onConfirm.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(learned).toContainEqual({
      kind: "appType",
      externalName: "Aldo's Spinach Blend",
      canonicalName: "Lowe's Spinach Cheese Mix",
      context: null,
    });
  });

  it("re-points a blend-named applicator type to the linked recipe on Apply", () => {
    const recipe: ParsedRecipe = {
      kind: "cheese",
      name: "Aldo's Spinach Blend",
      brand: "Aldo's",
      flavor: "SPINACH",
      rows: [{ ingredient: "Mozzarella", lbs: 20 }],
    };
    const prepared = makePrepared(recipe, [
      {
        brand: "Aldo's",
        flavor: "SPINACH",
        applicators: [
          { type: "Aldo's Spinach Blend", ozPerPizza: 3 },
          { type: "Sausage", ozPerPizza: 1 },
        ],
        pepperonis: [],
      } as ParsedProfile,
    ]);
    const onConfirm = vi.fn();
    renderDialog(prepared, onConfirm);

    fireEvent.change(screen.getByTestId("spec-recipe-link-rk0"), {
      target: { value: "Lowe's Spinach Cheese Mix" },
    });
    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    const types = (out.profiles[0]?.applicators ?? []).map((a) => a.type);
    // The blend slot follows the linked recipe name so applySpecImport's slot
    // resolver re-types it to the generic cheese card; unrelated slots untouched.
    expect(types).toEqual(["Lowe's Spinach Cheese Mix", "Sausage"]);
    // The linked (reference-only) recipe carries the same name — they match.
    expect(out.recipes[0].name).toBe("Lowe's Spinach Cheese Mix");
    expect(out.recipes[0].referenceOnly).toBe(true);
  });

  it("learns a dough 'Use existing' pick as a kind-scoped recipeName alias on Apply", () => {
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
    fireEvent.click(screen.getByText(/^Apply/));

    const learned = onConfirm.mock.calls[0][1] as Array<Record<string, unknown>>;
    // Dough/sauce picks are remembered under the kind-scoped "recipeName"
    // namespace, NOT the cheese/mix blend-name ("appType") namespace.
    expect(learned.filter((a) => a.kind === "appType")).toEqual([]);
    expect(learned).toContainEqual({
      kind: "recipeName",
      externalName: "Sheet Dough",
      canonicalName: "House Dough",
      context: "dough",
    });
  });

  it("pre-selects a remembered dough link via the kind-scoped suggestion key", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "Corner Booth",
      flavor: "PLAIN",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(
      makePrepared(recipe, [{ brand: "Corner Booth", flavor: "PLAIN" }], {
        // Built by the prepare pass via recipeLinkSuggestionKey("dough", name).
        "dough\u0000sheet dough": "House Dough",
      }),
      () => {},
    );

    const select = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    expect(select.value).toBe("House Dough");
  });

  it("does NOT let a sauce-scoped remembered link pre-select on a dough row", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "Corner Booth",
      flavor: "PLAIN",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(
      makePrepared(recipe, [{ brand: "Corner Booth", flavor: "PLAIN" }], {
        "sauce\u0000sheet dough": "House Dough",
      }),
      () => {},
    );

    const select = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    expect(select.value).toBe("");
  });
});
