import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type {
  ParsedProfile,
  ParsedRecipe,
  ParsedSpecImport,
  SpecImportAlias,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import SpecImportDialog from "../SpecImportDialog";

// Focus: the two-step wizard (step 1 = confirm brand/flavor + include; step 2 =
// recipes, die types, diff) and its deterministic re-target on Back → edit → Next.
vi.mock("@/specImport", () => ({
  buildDiscrepancies: () => [],
  importReviewSignature: () => "review-signature",
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
    importReview: {
      changes: [],
      counts: {
        added: 0,
        removed: 0,
        "quantity-changed": 0,
        "formula-cleared": 0,
        "family-collapsed": 0,
        "variant-loss": 0,
        "customer-remapped": 0,
      },
      requiresExplicitConfirmation: false,
      confirmationReasons: [],
    },
    skipped: { profiles: [], recipes: [] },
    brands: [],
    flavorsByBrand: {},
  };
}

function renderDialog(
  prepared: SpecImportPrepared,
  onConfirm: (p: ParsedSpecImport, learnedRenames: SpecImportAlias[]) => void = () => {},
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
  it("requires explicit acknowledgement for a single destructive formula removal", () => {
    const prepared = makePrepared([{ brand: "A", flavor: "X" }]);
    prepared.importReview = {
      ...prepared.importReview,
      changes: [{
        kind: "removed",
        entity: 'dough "Standard"',
        message: 'Removes "Sugar" from dough "Standard".',
        requiresConfirmation: true,
      }],
      counts: { ...prepared.importReview.counts, removed: 1 },
      requiresExplicitConfirmation: true,
      confirmationReasons: ['Removes "Sugar" from dough "Standard".'],
    };
    const onConfirm = vi.fn();
    renderDialog(prepared, onConfirm);
    fireEvent.click(screen.getByText("Next"));

    const apply = screen.getByText(/^Apply/).closest("button") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("spec-import-destructive-confirmation"));
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), true, "review-signature",
    );
  });

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

  it("re-points a brand-only recipe after a rename even when a same-brand row is excluded", () => {
    // Brand A has flavors X and Y. The user includes X and renames A → NewA,
    // but excludes Y (still under the original "A"). The excluded row must NOT
    // register an identity rename that makes the brand map ambiguous — the
    // brand-anchored recipe has to follow the confirmed name of the rows that
    // are actually being imported.
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "A",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared(
        [
          { brand: "A", flavor: "X" },
          { brand: "A", flavor: "Y" },
        ],
        [recipe],
      ),
      onConfirm,
    );

    fireEvent.change(screen.getByTestId("spec-profile-brand-pk0"), {
      target: { value: "NewA" },
    });
    fireEvent.click(screen.getByTestId("spec-profile-include-pk1"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0]).toMatchObject({ brand: "NewA", flavor: "X" });
    // The brand-only recipe followed the included row's confirmed brand.
    expect(out.recipes[0]).toMatchObject({ brand: "NewA" });
  });

  it("passes step-1 brand/flavor renames to onConfirm as learnable aliases", () => {
    const onConfirm = vi.fn();
    const prepared = makePrepared([{ brand: '11" Four Hands', flavor: "Chz" }]);
    // A prior learned alias points AT the shown brand: the rename must re-point
    // the raw sheet label to the edited name (no alias chain).
    prepared.newAliases = [
      { kind: "brand", externalName: "11 IN FOUR HANDS", canonicalName: '11" Four Hands', context: null },
    ];
    renderDialog(prepared, onConfirm);

    fireEvent.change(screen.getByTestId("spec-profile-brand-pk0"), {
      target: { value: "Four Hands" },
    });
    fireEvent.change(screen.getByTestId("spec-profile-flavor-pk0"), {
      target: { value: "Cheese" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));

    const learned = onConfirm.mock.calls[0][1] as SpecImportAlias[];
    expect(learned).toContainEqual({
      kind: "brand",
      externalName: '11" Four Hands',
      canonicalName: "Four Hands",
      context: null,
    });
    expect(learned).toContainEqual({
      kind: "brand",
      externalName: "11 IN FOUR HANDS",
      canonicalName: "Four Hands",
      context: null,
    });
    expect(learned).toContainEqual({
      kind: "flavor",
      externalName: "Chz",
      canonicalName: "Cheese",
      context: "Four Hands",
    });
  });

  it("passes no learned aliases when names were confirmed unchanged", () => {
    const onConfirm = vi.fn();
    renderDialog(makePrepared([{ brand: "A", flavor: "X" }]), onConfirm);
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));
    expect(onConfirm.mock.calls[0][1]).toEqual([]);
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
