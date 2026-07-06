import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type {
  ParsedProfile,
  ParsedRecipe,
  ParsedSpecImport,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import SpecImportDialog from "../SpecImportDialog";

// Focus: the two-step wizard (step 1 = confirm brand/flavor + include; step 2 =
// recipes, die types, diff) and its deterministic re-target on Back → edit → Next.
vi.mock("@/specImport", () => ({
  buildDiscrepancies: () => [],
}));
vi.mock("@/storage", () => ({
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  // Offer the die as an existing option so the step-2 die selector always renders
  // (even when a row's die is empty), letting the test read its value directly.
  existingDieTypesForImport: () => ["D1"],
  specImportRecipeDisplayKind: (r: ParsedRecipe) => r.kind,
}));

afterEach(() => cleanup());

function makePrepared(
  profiles: ParsedProfile[],
  recipes: ParsedRecipe[] = [],
): SpecImportPrepared {
  const parsed: ParsedSpecImport = { profiles, recipes };
  return {
    parsed,
    summary: {
      profilesNew: profiles.length,
      profilesUpdated: 0,
      recipesNew: recipes.length,
      recipesUpdated: 0,
      totalProfiles: profiles.length,
      totalRecipes: recipes.length,
    },
    newAliases: [],
    flagged: [],
    discrepancies: [],
    skipped: { profiles: [], recipes: [] },
    brands: [],
    flavorsByBrand: {},
  };
}

function renderDialog(
  prepared: SpecImportPrepared,
  onConfirm: (p: ParsedSpecImport) => void = () => {},
) {
  return render(
    <SpecImportDialog
      open={true}
      onClose={() => {}}
      loading={false}
      error={null}
      prepared={prepared}
      applying={false}
      existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
      onConfirm={onConfirm}
    />,
  );
}

describe("SpecImportDialog two-step wizard", () => {
  it("shows only product name confirmation in step 1, hiding recipes and the diff", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "A",
      flavor: "X",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(makePrepared([{ brand: "A", flavor: "X" }], [recipe]));

    // Step 1: product brand/flavor editors are present, recipes are not.
    expect(screen.getByTestId("spec-profile-brand-pk0")).toBeTruthy();
    expect(screen.queryByTestId("spec-recipe-name-rk0")).toBeNull();
    expect(screen.getByText("Next")).toBeTruthy();
    expect(screen.queryByText(/^Apply/)).toBeNull();

    // Step 2: recipes appear, product name editors are gone.
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByTestId("spec-recipe-name-rk0")).toBeTruthy();
    expect(screen.queryByTestId("spec-profile-brand-pk0")).toBeNull();
    expect(screen.getByText(/^Apply/)).toBeTruthy();
    expect(screen.getByText("Back")).toBeTruthy();
  });

  it("blocks Next until every checked product has a brand and a flavor", () => {
    renderDialog(makePrepared([{ brand: "A", flavor: "" }]));

    const next = screen.getByText("Next").closest("button") as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("spec-profile-flavor-pk0"), {
      target: { value: "X" },
    });
    expect(next.disabled).toBe(false);
  });

  it("cross-fills a blank die from a same-brand sibling on step 2", () => {
    renderDialog(
      makePrepared([
        { brand: "A", flavor: "X", dieType: "D1" },
        { brand: "A", flavor: "Y" },
      ]),
    );
    fireEvent.click(screen.getByText("Next"));

    // Both included rows show the die selector; the blank one inherited D1.
    expect((screen.getByTestId("spec-profile-die-pk0") as HTMLSelectElement).value).toBe("D1");
    expect((screen.getByTestId("spec-profile-die-pk1") as HTMLSelectElement).value).toBe("D1");
  });

  it("re-derives cross-fill on Back → rename → Next (no stale inherited die)", () => {
    renderDialog(
      makePrepared([
        { brand: "A", flavor: "X", dieType: "D1" },
        { brand: "A", flavor: "Y" },
      ]),
    );

    fireEvent.click(screen.getByText("Next"));
    expect((screen.getByTestId("spec-profile-die-pk1") as HTMLSelectElement).value).toBe("D1");

    // Back to step 1, move the second product to a different brand so it no longer
    // groups with the die-bearing sibling.
    fireEvent.click(screen.getByText("Back"));
    fireEvent.change(screen.getByTestId("spec-profile-brand-pk1"), {
      target: { value: "B" },
    });
    fireEvent.click(screen.getByText("Next"));

    // The previously inherited die must be cleared — it belonged to brand A.
    expect((screen.getByTestId("spec-profile-die-pk1") as HTMLSelectElement).value).toBe("");
  });

  it("re-derives sauce cross-fill on Back → rename → Next (no stale inherited sauce)", () => {
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared([
        { brand: "A", flavor: "X", sauceOzPerPizza: 2 },
        { brand: "A", flavor: "Y" },
      ]),
      onConfirm,
    );

    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));
    // Sibling under brand A inherited the sauce.
    let out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.profiles[1].sauceOzPerPizza).toBe(2);

    cleanup();
    onConfirm.mockClear();
    const { getByText, getByTestId } = renderDialog(
      makePrepared([
        { brand: "A", flavor: "X", sauceOzPerPizza: 2 },
        { brand: "A", flavor: "Y" },
      ]),
      onConfirm,
    );
    // Advance, go back, and move the second product to its own brand.
    fireEvent.click(getByText("Next"));
    fireEvent.click(getByText("Back"));
    fireEvent.change(getByTestId("spec-profile-brand-pk1"), {
      target: { value: "B" },
    });
    fireEvent.click(getByText("Next"));
    fireEvent.click(getByText(/^Apply/));

    out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    const moved = out.profiles.find((p) => p.brand === "B");
    // The previously inherited sauce must be gone — brand B has no sibling.
    expect(moved?.sauceOzPerPizza).toBeUndefined();
  });

  it("re-points a recipe's attach product to the renamed brand/flavor deterministically", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "A",
      flavor: "X",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const onConfirm = vi.fn();
    renderDialog(makePrepared([{ brand: "A", flavor: "X" }], [recipe]), onConfirm);

    // Rename the product in step 1.
    fireEvent.change(screen.getByTestId("spec-profile-brand-pk0"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByTestId("spec-profile-flavor-pk0"), {
      target: { value: "Plain" },
    });
    fireEvent.click(screen.getByText("Next"));

    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.profiles[0]).toMatchObject({ brand: "Acme", flavor: "Plain" });
    // The recipe followed the rename with no AI re-run and no manual retype.
    expect(out.recipes[0]).toMatchObject({ brand: "Acme", flavor: "Plain" });
  });

  it("keeps a user-typed recipe attach name across the step-1 rename", () => {
    // A recipe the AI left attached to nothing shows the manual attach editor.
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared(
        [
          { brand: "A", flavor: "X" },
          { brand: "Keep", flavor: "Me" },
        ],
        [recipe],
      ),
      onConfirm,
    );

    fireEvent.click(screen.getByText("Next"));
    // User manually attaches the recipe to a product in step 2.
    fireEvent.change(screen.getByTestId("spec-recipe-brand-rk0"), {
      target: { value: "Keep" },
    });
    fireEvent.change(screen.getByTestId("spec-recipe-flavor-rk0"), {
      target: { value: "Me" },
    });

    // Back, rename the OTHER product, and return — the manual attach must stick
    // (the re-target must not clobber a brand/flavor the user typed).
    fireEvent.click(screen.getByText("Back"));
    fireEvent.change(screen.getByTestId("spec-profile-brand-pk0"), {
      target: { value: "Acme" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.recipes[0]).toMatchObject({ brand: "Keep", flavor: "Me" });
  });

  it("lets a recipe-only workbook (no profiles) advance straight to step 2", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(makePrepared([], [recipe]));

    const next = screen.getByText("Next").closest("button") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByTestId("spec-recipe-name-rk0")).toBeTruthy();
  });
});
