import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type {
  ParsedProfile,
  ParsedRecipe,
  ParsedSpecImport,
  SpecImportWarning,
} from "@workspace/spec-import";
import { sanitizeParsedSpecImport } from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import SpecImportDialog from "../SpecImportDialog";

// Keep the test focused on the dialog's UI wiring: the discrepancy diff and the
// profile/recipe existence lookups pull in the whole import/storage stack and
// are covered by their own tests.
vi.mock("@/specImport", () => ({
  buildDiscrepancies: () => [],
}));
vi.mock("@/storage", () => ({
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  existingRecipeNamesForImport: () => [],
  existingDieTypesForImport: () => [],
  specImportRecipeDisplayKind: (r: { kind: string }) => r.kind,
}));

afterEach(() => cleanup());

function profile(brand: string, flavor: string): ParsedProfile {
  return { brand, flavor };
}

// Minimal real-shape SpecImportPrepared carrying only what this screen reads.
function makePrepared(
  profiles: ParsedProfile[],
  warnings?: SpecImportWarning[],
  recipes: ParsedRecipe[] = [],
): SpecImportPrepared {
  const parsed: ParsedSpecImport = { profiles, recipes };
  if (warnings?.length) parsed.warnings = warnings;
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
  onConfirm: ComponentProps<typeof SpecImportDialog>["onConfirm"] = () => {},
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

describe("SpecImportDialog flavor-correction warnings", () => {
  it("shows incomplete-row warnings and an accurate overflow count from a saved sanitized review", () => {
    const parsed = sanitizeParsedSpecImport({
      profiles: Array.from({ length: 30 }, (_, i) => ({ brand: `Brand ${i}`, flavor: "" })),
      recipes: [{ kind: "sauce", name: "Example Sauce", rows: [{ ingredient: "Tomato", lbs: 1 }] }],
    });
    const restored = JSON.parse(JSON.stringify(parsed)) as ParsedSpecImport;
    renderDialog(makePrepared(restored.profiles, restored.warnings, restored.recipes));
    const callout = screen.getByTestId("spec-import-warnings");
    expect(within(callout).getByText("30 items were corrected or flagged")).toBeTruthy();
    expect(within(callout).getAllByText(/missing a flavor and will not be saved/)).toHaveLength(9);
    expect(within(callout).getByText(/21 additional import warnings are not shown/)).toBeTruthy();
    expect(screen.queryByTestId("spec-profile-pk0")).toBeNull();
  });
  it("renders the top-level amber callout and attaches the per-row callout to the matching profile", () => {
    const prepared = makePrepared(
      [profile("Tombstone", "Pepperoni"), profile("DiGiorno", "Four Cheese")],
      [
        {
          brand: "Tombstone",
          flavor: "Pepperoni",
          message: 'Flavor "Pepperonni" was corrected to "Pepperoni".',
        },
      ],
    );
    renderDialog(prepared);

    // Top-level callout with the count summary.
    const callout = screen.getByTestId("spec-import-warnings");
    expect(
      within(callout).getByText("1 item was corrected or flagged"),
    ).toBeTruthy();

    // Per-row callout is attached to the Tombstone row (first kept profile = pk0)
    // and carries the warning message.
    const row0 = screen.getByTestId("spec-profile-pk0");
    const rowWarning = within(row0).getByTestId("spec-profile-warning-pk0");
    expect(
      within(rowWarning).getByText(
        'Flavor "Pepperonni" was corrected to "Pepperoni".',
      ),
    ).toBeTruthy();

    // The unrelated DiGiorno row must NOT get a callout.
    expect(screen.queryByTestId("spec-profile-warning-pk1")).toBeNull();

    // The matched warning must not ALSO be listed in the top-level callout
    // (that list is reserved for unmatched warnings).
    expect(
      within(callout).queryByText(
        'Flavor "Pepperonni" was corrected to "Pepperoni".',
      ),
    ).toBeNull();
  });

  it("matches warnings to rows case-insensitively with trimming", () => {
    const prepared = makePrepared(
      [profile("Tombstone", "Pepperoni")],
      [
        {
          brand: "  tombstone ",
          flavor: "PEPPERONI",
          message: "Check this flavor name.",
        },
      ],
    );
    renderDialog(prepared);

    const rowWarning = screen.getByTestId("spec-profile-warning-pk0");
    expect(within(rowWarning).getByText("Check this flavor name.")).toBeTruthy();
  });

  it("surfaces warnings with no matching profile row in the top-level callout instead of hiding them", () => {
    const prepared = makePrepared(
      [profile("Tombstone", "Pepperoni")],
      [
        {
          brand: "Red Baron",
          flavor: "Supreme",
          message: 'Flavor "Suprême" did not match any product on the sheet.',
        },
      ],
    );
    renderDialog(prepared);

    // No profile row matches, so no per-row callout anywhere.
    expect(screen.queryByTestId("spec-profile-warning-pk0")).toBeNull();

    // The unmatched warning's message is listed inside the top-level callout.
    const callout = screen.getByTestId("spec-import-warnings");
    expect(
      within(callout).getByText(
        'Flavor "Suprême" did not match any product on the sheet.',
      ),
    ).toBeTruthy();
  });

  it("attaches multiple warnings for the same profile to one per-row callout", () => {
    const prepared = makePrepared(
      [profile("Tombstone", "Pepperoni")],
      [
        { brand: "Tombstone", flavor: "Pepperoni", message: "First warning." },
        { brand: "Tombstone", flavor: "Pepperoni", message: "Second warning." },
      ],
    );
    renderDialog(prepared);

    expect(
      within(screen.getByTestId("spec-import-warnings")).getByText(
        "2 items were corrected or flagged",
      ),
    ).toBeTruthy();

    const rowWarning = screen.getByTestId("spec-profile-warning-pk0");
    expect(within(rowWarning).getByText("First warning.")).toBeTruthy();
    expect(within(rowWarning).getByText("Second warning.")).toBeTruthy();
  });

  it("renders no warning callouts when the parse result carries no warnings", () => {
    renderDialog(makePrepared([profile("Tombstone", "Pepperoni")]));

    expect(screen.queryByTestId("spec-import-warnings")).toBeNull();
    expect(screen.queryByTestId("spec-profile-warning-pk0")).toBeNull();
  });

  it("warns about missing formula results and opens the cited workbook cell", () => {
    const prepared = makePrepared([profile("Acme", "Classic")]);
    prepared.missingFormulaResults = [{
      field: "Sauce oz/pizza",
      location: {
        file: "spec.xlsx",
        sheet: "Profiles",
        cell: "D2",
      },
      hasSavedResult: false,
      brand: "Acme",
      flavor: "Classic",
    }];
    prepared.sourcePreviewCells = [{
      file: "spec.xlsx",
      sheet: "Profiles",
      cell: "D2",
      value: "",
      formula: "1/2",
      hasSavedResult: false,
    }];
    renderDialog(prepared);

    const warning = screen.getByTestId("spec-import-missing-formula-results");
    expect(within(warning).getByText("1 formula cell has no saved result")).toBeTruthy();
    const warningRow = warning.querySelector("li");
    expect(warningRow?.textContent).toContain("Sauce oz/pizza · Acme — Classic");
    expect(warningRow?.textContent).toContain("spec.xlsx · Profiles!D2");

    fireEvent.click(screen.getByRole("button", {
      name: "Review missing formula result at spec.xlsx · Profiles!D2",
    }));
    expect(screen.getByTestId("spec-source-preview-formula").textContent).toBe("=1/2");
    expect(screen.getByTestId("spec-source-preview-value").textContent)
      .toBe("No saved result in workbook");
  });

  it("validates and applies a manager-entered value without adding source evidence", () => {
    const prepared = makePrepared([
      {
        ...profile("Acme", "Classic"),
        sourceLocations: {
          brand: [{ file: "spec.xlsx", sheet: "Profiles", cell: "A2" }],
          flavor: [{ file: "spec.xlsx", sheet: "Profiles", cell: "B2" }],
        },
      },
    ]);
    prepared.missingFormulaResults = [{
      field: "Sauce oz/pizza",
      location: { file: "spec.xlsx", sheet: "Profiles", cell: "D2" },
      hasSavedResult: false,
      brand: "Acme",
      flavor: "Classic",
    }];
    prepared.sourcePreviewCells = [{
      file: "spec.xlsx",
      sheet: "Profiles",
      cell: "D2",
      value: "",
      formula: "1/2",
      hasSavedResult: false,
    }];
    const onConfirm = vi.fn();
    renderDialog(prepared, onConfirm);

    const valueInput = screen.getByRole("textbox", {
      name: "Manual value for Sauce oz/pizza · Acme — Classic",
    });
    const nextButton = screen.getByRole("button", { name: "Next" });
    fireEvent.change(valueInput, { target: { value: "-0.5" } });
    expect(nextButton).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe("Enter a number of 0 or more.");

    fireEvent.change(valueInput, { target: { value: "0.75" } });
    expect(nextButton).toHaveProperty("disabled", false);
    fireEvent.click(nextButton);
    fireEvent.click(screen.getByRole("button", { name: /^Apply/ }));

    const applied = onConfirm.mock.calls[0]?.[0] as ParsedSpecImport;
    expect(applied.profiles[0].sauceOzPerPizza).toBe(0.75);
    expect(applied.profiles[0]).not.toHaveProperty("sourceLocations");
    expect(applied.profiles[0]).not.toHaveProperty("formula");
    expect(applied).not.toHaveProperty("sourceEvidence");
  });

  it("lets a manager supply a missing profile identity before applying", () => {
    const prepared = makePrepared([]);
    prepared.missingFormulaResults = [{
      field: "Brand",
      location: { file: "spec.xlsx", sheet: "Profiles", cell: "A2" },
      hasSavedResult: false,
      flavor: "Classic",
    }];
    prepared.sourcePreviewCells = [{
      file: "spec.xlsx",
      sheet: "Profiles",
      cell: "A2",
      value: "",
      formula: "A1",
      hasSavedResult: false,
    }];
    const onConfirm = vi.fn();
    renderDialog(prepared, onConfirm);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Manual value for Brand · Classic" }),
      { target: { value: "Acme" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /^Apply/ }));

    const applied = onConfirm.mock.calls[0]?.[0] as ParsedSpecImport;
    expect(applied.profiles).toHaveLength(1);
    expect(applied.profiles[0]).toMatchObject({ brand: "Acme", flavor: "Classic" });
    expect(applied.profiles[0]).not.toHaveProperty("sourceLocations");
  });
});

describe("SpecImportDialog recipe row unit review", () => {
  it("shows reported units and advisory warnings for dough, sauce, and cheese", () => {
    const recipes: ParsedRecipe[] = [
      {
        kind: "dough",
        name: "Clear Dough",
        rowsUnit: "lbs",
        rows: [{ ingredient: "Flour", lbs: 48 }],
      },
      {
        kind: "sauce",
        name: "Missing Unit Sauce",
        rows: [{ ingredient: "Tomato", lbs: 24 }],
      },
      {
        kind: "cheese",
        name: "Ambiguous Cheese",
        rowsUnit: "weight",
        rows: [{ ingredient: "Mozzarella", lbs: 2.5 }],
      },
    ];
    renderDialog(makePrepared([], undefined, recipes));

    fireEvent.click(screen.getByText("Next"));

    expect(
      within(screen.getByTestId("spec-recipe-rows-unit-rk0")).getByText("lbs"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("spec-recipe-rows-unit-warning-rk1")).getByText(
        /did not clearly state whether these row values are pounds or ounces/i,
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("spec-recipe-rows-unit-warning-rk2")).getByText(
        /reported row unit “weight” is ambiguous/i,
      ),
    ).toBeTruthy();

    const apply = screen.getByText(/^Apply/).closest("button") as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });

  it("confirms whole-recipe provenance for dough, sauce, and cheese without changing rows", () => {
    const recipes: ParsedRecipe[] = [
      {
        kind: "dough",
        name: "Dough",
        rows: [{ ingredient: "Flour", lbs: 48.25 }],
      },
      {
        kind: "sauce",
        name: "Sauce",
        rowsUnit: "weight",
        rows: [{ ingredient: "Tomato", lbs: 24.5 }],
      },
      {
        kind: "cheese",
        name: "Cheese",
        rows: [{ ingredient: "Mozzarella", lbs: 2.75 }],
      },
    ];
    const onConfirm = vi.fn();
    renderDialog(makePrepared([], undefined, recipes), onConfirm);
    fireEvent.click(screen.getByText("Next"));

    fireEvent.click(screen.getByTestId("spec-recipe-rows-unit-confirm-rk0-lbs"));
    fireEvent.click(screen.getByTestId("spec-recipe-rows-unit-confirm-rk1-oz"));
    fireEvent.click(screen.getByTestId("spec-recipe-rows-unit-confirm-rk2-lbs"));
    fireEvent.click(screen.getByText(/^Apply/));

    const submitted = onConfirm.mock.calls[0]?.[0] as ParsedSpecImport;
    expect(submitted.recipes.map((recipe) => recipe.confirmedRowsUnit)).toEqual([
      "lbs",
      "oz",
      "lbs",
    ]);
    expect(submitted.recipes.map((recipe) => recipe.rows)).toEqual(
      recipes.map((recipe) => recipe.rows),
    );
  });

  it("restores a confirmation from a reopened saved review", () => {
    const saved = JSON.parse(JSON.stringify(makePrepared([], undefined, [{
      kind: "sauce",
      name: "Saved Sauce",
      rowsUnit: "not stated",
      confirmedRowsUnit: "oz",
      rows: [{ ingredient: "Tomato", lbs: 19.125 }],
    }]))) as SpecImportPrepared;

    renderDialog(saved);
    fireEvent.click(screen.getByText("Next"));

    expect(
      screen.getByTestId("spec-recipe-rows-unit-confirm-rk0-oz").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByTestId("spec-recipe-rows-unit-confirmed-rk0").textContent).toMatch(
      /confirmed as ounces/i,
    );
  });
});
