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
  existingMixNames: string[] = [],
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
        mix: existingMixNames,
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

  it("emits an updating recipe pointing at the chosen existing name on apply (spec wins)", () => {
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
    // A linked dough pick with parsed rows UPDATES the existing recipe with
    // the sheet's rows (spec-wins) — never a reference-only no-op link.
    expect(out.recipes[0]).toMatchObject({
      name: "House Dough",
      kind: "dough",
      userNamed: true,
    });
    expect(out.recipes[0].referenceOnly).toBeUndefined();
  });

  it("suppresses the shared-library note for a reused recipe", () => {
    // A new recipe shows the neutral "saved to your library" note (recipes
    // attach by NAME — no brand/flavor targeting editor anymore)...
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(makePrepared(recipe, []), () => {});

    expect(screen.getByText(/Saved to your library/)).toBeTruthy();
    // The retired attach-targeting editor must not render.
    expect(screen.queryByTestId("spec-recipe-brand-rk0")).toBeNull();
    expect(screen.queryByTestId("spec-recipe-flavor-rk0")).toBeNull();

    // ...but once the user reuses an existing recipe, the note disappears.
    fireEvent.change(screen.getByTestId("spec-recipe-link-rk0"), {
      target: { value: "House Dough" },
    });
    expect(screen.queryByText(/Saved to your library/)).toBeNull();
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

  it("prefers a BRAND-scoped remembered blend pick over the factory-wide one", () => {
    // Two brands can use the same generic blend name on their sheets; each
    // brand's remembered pick lives under blendLinkSuggestionKey(brand, name)
    // and must win over the legacy context-free (plain lowercased name) entry.
    const recipe: ParsedRecipe = {
      kind: "cheese",
      name: "Cheeseburger Cheese Mix",
      brand: "Aldo's",
      flavor: "CHEESEBURGER",
      rows: [{ ingredient: "Mozzarella", lbs: 20 }],
    };
    renderDialog(
      makePrepared(recipe, [{ brand: "Aldo's", flavor: "CHEESEBURGER" }], {
        // Factory-wide (legacy) entry points at one recipe...
        "cheeseburger cheese mix": "Lowe's Spinach Cheese Mix",
        // ...but Aldo's own remembered pick points at another.
        "blend\u0000aldo's\u0000cheeseburger cheese mix": "Aldo's Cheese Mix",
      }),
      () => {},
    );

    const select = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    expect(select.value).toBe("Aldo's Cheese Mix");
  });

  it("falls back to the factory-wide blend pick when the brand has none remembered", () => {
    const recipe: ParsedRecipe = {
      kind: "cheese",
      name: "Cheeseburger Cheese Mix",
      brand: "Corner Booth",
      flavor: "CHEESEBURGER",
      rows: [{ ingredient: "Mozzarella", lbs: 20 }],
    };
    renderDialog(
      makePrepared(recipe, [{ brand: "Corner Booth", flavor: "CHEESEBURGER" }], {
        "cheeseburger cheese mix": "Lowe's Spinach Cheese Mix",
        "blend\u0000aldo's\u0000cheeseburger cheese mix": "Aldo's Cheese Mix",
      }),
      () => {},
    );

    const select = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    expect(select.value).toBe("Lowe's Spinach Cheese Mix");
  });

  it("learns a cheese pick under BOTH the context-free and brand-scoped alias rows", () => {
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

    const learned = onConfirm.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(learned).toContainEqual({
      kind: "appType",
      externalName: "Aldo's Spinach Blend",
      canonicalName: "Lowe's Spinach Cheese Mix",
      context: null,
    });
    expect(learned).toContainEqual({
      kind: "appType",
      externalName: "Aldo's Spinach Blend",
      canonicalName: "Lowe's Spinach Cheese Mix",
      context: "Aldo's",
    });
  });

  it("always updates a linked dough/sauce recipe with the sheet's rows — no checkbox, spec wins", () => {
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
    // No opt-in checkbox anymore — the note says the ingredients WILL be replaced.
    expect(screen.queryByTestId("spec-recipe-update-existing-rk0")).toBeNull();
    expect(screen.getByText(/will be replaced/)).toBeTruthy();
    expect(screen.getByText(/Will change to:/)).toBeTruthy();

    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.recipes[0]).toMatchObject({
      name: "House Dough",
      kind: "dough",
      userNamed: true,
    });
    // The update replaces referenceOnly — the sheet's rows must apply.
    expect(out.recipes[0].referenceOnly).toBeUndefined();
  });

  it("keeps a linked dough pick reference-only when the sheet parsed no ingredient rows", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "Corner Booth",
      flavor: "PLAIN",
      rows: [],
    };
    const onConfirm = vi.fn();
    renderDialog(makePrepared(recipe, [{ brand: "Corner Booth", flavor: "PLAIN" }]), onConfirm);

    fireEvent.change(screen.getByTestId("spec-recipe-link-rk0"), {
      target: { value: "House Dough" },
    });
    // Nothing to replace with → the existing recipe is left untouched.
    expect(screen.getByText(/won't be changed/)).toBeTruthy();

    fireEvent.click(screen.getByText(/^Apply/));
    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.recipes[0]).toMatchObject({ name: "House Dough", referenceOnly: true });
  });

  it("updates a linked mix with the sheet's ingredients", () => {
    const recipe: ParsedRecipe = {
      kind: "cheese",
      name: "Sheet Fajita Mix",
      brand: "Basha's",
      flavor: "RED",
      rows: [{ ingredient: "Red Pepper", lbs: 1.4 }],
    };
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared(recipe, [{ brand: "Basha's", flavor: "RED" }]),
      onConfirm,
      ["Basha's Red Fajita Mix"],
    );

    fireEvent.change(screen.getByTestId("spec-recipe-kind-rk0"), {
      target: { value: "mix" },
    });
    fireEvent.change(screen.getByTestId("spec-recipe-link-rk0"), {
      target: { value: "Basha's Red Fajita Mix" },
    });

    expect(screen.getByText(/ingredients will be replaced/)).toBeTruthy();
    expect(screen.getByText(/Will change to:/)).toBeTruthy();

    fireEvent.click(screen.getByText(/^Apply/));
    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.recipes[0]).toMatchObject({
      name: "Basha's Red Fajita Mix",
      kind: "cheese",
      forcedCategory: "mix",
      userNamed: true,
    });
    expect(out.recipes[0].referenceOnly).toBeUndefined();
  });

  it("never updates a linked CHEESE pick (per-pizza vs per-batch units)", () => {
    const recipe: ParsedRecipe = {
      kind: "cheese",
      name: "Aldo's Spinach Blend",
      brand: "Aldo's",
      flavor: "SPINACH",
      rows: [{ ingredient: "Mozzarella", lbs: 2.07 }],
    };
    const onConfirm = vi.fn();
    renderDialog(makePrepared(recipe, [{ brand: "Aldo's", flavor: "SPINACH" }]), onConfirm);

    fireEvent.change(screen.getByTestId("spec-recipe-link-rk0"), {
      target: { value: "Lowe's Spinach Cheese Mix" },
    });
    // Even with parsed rows, cheese picks never update — spec sheets carry
    // per-pizza ounces while the cheese pool stores per-batch pounds.
    // The hint explains the sheet's ounces land in the oz-per-pizza column only.
    expect(screen.getByText(/won't be changed/)).toBeTruthy();
    expect(screen.getByText(/batch pounds are kept as-is/)).toBeTruthy();

    fireEvent.click(screen.getByText(/^Apply/));
    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    // The linked cheese pick stays reference-only — never an update.
    expect(out.recipes[0]).toMatchObject({
      name: "Lowe's Spinach Cheese Mix",
      referenceOnly: true,
    });
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
