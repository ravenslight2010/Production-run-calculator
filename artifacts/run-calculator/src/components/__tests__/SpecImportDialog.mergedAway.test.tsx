import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type {
  ParsedProfile,
  ParsedRecipe,
  ParsedSpecImport,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import SpecImportDialog from "../SpecImportDialog";

// Merge-re-import treatment for dough/sauce rows — mirrors the premix/cheese
// importers: when a sheet's name was merged onto an existing recipe (learned
// alias link suggestion) and that survivor's OWN sheet is also in the same
// workbook, the merged-away row starts UNCHECKED with a plain-language note,
// and Apply works immediately.
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
  recipes: ParsedRecipe[],
  profiles: ParsedProfile[] = [],
  aliasLinkSuggestions?: Record<string, string>,
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
    ...(aliasLinkSuggestions ? { aliasLinkSuggestions } : {}),
  };
}

function renderDialog(
  prepared: SpecImportPrepared,
  onConfirm: (p: ParsedSpecImport, learned?: unknown) => void = () => {},
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
        dough: ["Masa Dough", "House Dough"],
        sauce: ["Gravy Sauce"],
        cheese: [],
        mix: [],
      }}
      onConfirm={onConfirm}
    />,
  );
  // Recipe rows and Apply live in step 2 of the two-step review.
  fireEvent.click(screen.getByText("Next"));
  return result;
}

const naan: ParsedRecipe = {
  kind: "dough",
  name: "Naan Dough",
  rows: [{ ingredient: "Flour", lbs: 100 }],
};
const masa: ParsedRecipe = {
  kind: "dough",
  name: "Masa Dough",
  rows: [{ ingredient: "Masa Flour", lbs: 80 }],
};

describe("SpecImportDialog merged-away dough/sauce re-import", () => {
  it("auto-unchecks the merged-away row and shows the merge note when the survivor is also in the workbook", () => {
    renderDialog(
      makePrepared([naan, masa], [], {
        // Learned by the merge: Naan Dough → Masa Dough (kind-scoped key).
        "dough\u0000naan dough": "Masa Dough",
      }),
    );

    // Merged-away row: unchecked, pre-linked, with the amber note.
    const mergedCheckbox = screen.getByTestId(
      "spec-recipe-include-rk0",
    ) as HTMLInputElement;
    expect(mergedCheckbox.checked).toBe(false);
    const link = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    expect(link.value).toBe("Masa Dough");
    expect(screen.getByTestId("spec-recipe-merged-away-rk0")).toBeTruthy();
    expect(screen.getByText(/merged into/)).toBeTruthy();

    // The survivor's own row stays checked with no note.
    const survivorCheckbox = screen.getByTestId(
      "spec-recipe-include-rk1",
    ) as HTMLInputElement;
    expect(survivorCheckbox.checked).toBe(true);
    expect(screen.queryByTestId("spec-recipe-merged-away-rk1")).toBeNull();
  });

  it("Apply works immediately and excludes the merged-away row", () => {
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared([naan, masa], [], {
        "dough\u0000naan dough": "Masa Dough",
      }),
      onConfirm,
    );

    const applyBtn = screen.getByText(/^Apply/).closest("button")!;
    expect(applyBtn.disabled).toBe(false);
    fireEvent.click(applyBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    // Only the survivor's row is applied; nothing resurrects "Naan Dough".
    expect(out.recipes.map((r) => r.name)).toEqual(["Masa Dough"]);
    expect(out.recipes[0].referenceOnly).toBeUndefined();
  });

  it("keeps the pre-link WITHOUT unchecking when the survivor is NOT in the workbook", () => {
    renderDialog(
      makePrepared([naan], [], {
        "dough\u0000naan dough": "Masa Dough",
      }),
    );

    const checkbox = screen.getByTestId(
      "spec-recipe-include-rk0",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    const link = screen.getByTestId("spec-recipe-link-rk0") as HTMLSelectElement;
    expect(link.value).toBe("Masa Dough");
    expect(screen.queryByTestId("spec-recipe-merged-away-rk0")).toBeNull();
  });

  it("treats sauce rows the same way (kind-scoped, no cross-kind false positives)", () => {
    const asiago: ParsedRecipe = {
      kind: "sauce",
      name: "Asiago Sauce",
      rows: [{ ingredient: "Cream", lbs: 30 }],
    };
    const gravy: ParsedRecipe = {
      kind: "sauce",
      name: "Gravy Sauce",
      rows: [{ ingredient: "Tomato Paste", lbs: 50 }],
    };
    renderDialog(
      makePrepared([asiago, gravy], [], {
        "sauce\u0000asiago sauce": "Gravy Sauce",
      }),
    );

    const mergedCheckbox = screen.getByTestId(
      "spec-recipe-include-rk0",
    ) as HTMLInputElement;
    expect(mergedCheckbox.checked).toBe(false);
    expect(screen.getByTestId("spec-recipe-merged-away-rk0")).toBeTruthy();
    const survivorCheckbox = screen.getByTestId(
      "spec-recipe-include-rk1",
    ) as HTMLInputElement;
    expect(survivorCheckbox.checked).toBe(true);
  });

  it("lets the manager re-check the merged-away row; the note stays as a reminder", () => {
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared([naan, masa], [], {
        "dough\u0000naan dough": "Masa Dough",
      }),
      onConfirm,
    );

    fireEvent.click(screen.getByTestId("spec-recipe-include-rk0"));
    expect(
      (screen.getByTestId("spec-recipe-include-rk0") as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByTestId("spec-recipe-merged-away-rk0")).toBeTruthy();

    fireEvent.click(screen.getByText(/^Apply/));
    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    // Re-checked merged-away row rides along as a reference-only link to the
    // survivor — it still can't resurrect the old name.
    expect(out.recipes.map((r) => r.name).sort()).toEqual([
      "Masa Dough",
      "Masa Dough",
    ]);
    expect(out.recipes.some((r) => r.referenceOnly)).toBe(true);
  });
});
