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

// ── Mocks ──────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────

function makePrepared(
  extra: Partial<SpecImportPrepared> = {},
  profiles: ParsedProfile[] = [{ brand: "Aldo's", flavor: "BBQ Chicken", applicators: [], pepperonis: [] }],
): SpecImportPrepared {
  const parsed: ParsedSpecImport = { profiles, recipes: [] };
  return {
    parsed,
    summary: {
      profilesNew: profiles.length,
      profilesUpdated: 0,
      recipesNew: 0,
      recipesUpdated: 0,
      totalProfiles: profiles.length,
      totalRecipes: 0,
    },
    newAliases: [],
    flagged: [],
    discrepancies: [],
    skipped: { profiles: [], recipes: [] },
    brands: [],
    flavorsByBrand: {},
    ...extra,
  };
}

function advanceToStep2() {
  fireEvent.click(screen.getByText("Next"));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SpecImportDialog — new mix ingredients section", () => {
  it("does NOT render the new-mix-ingredients section when newMixIngredients is absent", () => {
    const prepared = makePrepared();
    render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={() => {}}
      />,
    );
    advanceToStep2();
    expect(screen.queryByTestId("spec-new-mix-ingredients")).toBeNull();
  });

  it("does NOT render the section in step 1", () => {
    const prepared = makePrepared({
      newMixIngredients: [
        { mixName: "Veggie Mix", brand: "Aldo's", newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }] },
      ],
    });
    render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={() => {}}
      />,
    );
    // Still in step 1 — section must not be visible
    expect(screen.queryByTestId("spec-new-mix-ingredients")).toBeNull();
  });

  it("renders the new-mix-ingredients section in step 2 with mix name and ingredient detail", () => {
    const prepared = makePrepared({
      newMixIngredients: [
        {
          mixName: "Veggie Mix",
          brand: "Aldo's",
          newComponents: [
            { ingredient: "Bell Peppers", perPizza: 0.75 },
            { ingredient: "Zucchini", perPizza: 0 },
          ],
        },
      ],
    });
    render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={() => {}}
      />,
    );
    advanceToStep2();
    expect(screen.getByTestId("spec-new-mix-ingredients")).toBeTruthy();
    expect(screen.getByText("Veggie Mix")).toBeTruthy();
    expect(screen.getByText(/Bell Peppers/)).toBeTruthy();
    // Zero oz/pizza ingredient is still shown
    expect(screen.getByText(/Zucchini/)).toBeTruthy();
  });

  it("starts all new-mix checkboxes UNCHECKED so no silent changes happen on routine re-imports", () => {
    const prepared = makePrepared({
      newMixIngredients: [
        { mixName: "Veggie Mix", brand: "Aldo's", newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }] },
        { mixName: "Sauce Mix", brand: "Lucia's", newComponents: [{ ingredient: "Basil", perPizza: 0.1 }] },
      ],
    });
    render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={() => {}}
      />,
    );
    advanceToStep2();
    // testKey uses "|" separator (URL-safe variant of compound brand|name key)
    const veggieCheck = screen.getByTestId("spec-new-mix-accept-aldo's|veggie mix") as HTMLInputElement;
    const sauceCheck = screen.getByTestId("spec-new-mix-accept-lucia's|sauce mix") as HTMLInputElement;
    expect(veggieCheck.checked).toBe(false);
    expect(sauceCheck.checked).toBe(false);
  });

  it("passes an empty accepted set when the manager does not check any mix", () => {
    let captured: ReadonlySet<string> | undefined;
    const prepared = makePrepared({
      newMixIngredients: [
        { mixName: "Veggie Mix", brand: "Aldo's", newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }] },
      ],
    });
    render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={(_parsed, _renames, _remove, _force, accepted) => {
          captured = accepted;
        }}
      />,
    );
    advanceToStep2();
    fireEvent.click(screen.getByText(/^Apply/));
    expect(captured).toBeDefined();
    expect(captured!.size).toBe(0);
  });

  it("passes the compound brand+name key when the manager accepts a mix", () => {
    let captured: ReadonlySet<string> | undefined;
    const prepared = makePrepared({
      newMixIngredients: [
        { mixName: "Veggie Mix", brand: "Aldo's", newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }] },
        { mixName: "Sauce Mix", brand: "Lucia's", newComponents: [{ ingredient: "Basil", perPizza: 0.1 }] },
      ],
    });
    render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={(_parsed, _renames, _remove, _force, accepted) => {
          captured = accepted;
        }}
      />,
    );
    advanceToStep2();
    // Accept "Veggie Mix / Aldo's" only via its compound testKey
    fireEvent.click(screen.getByTestId("spec-new-mix-accept-aldo's|veggie mix"));
    fireEvent.click(screen.getByText(/^Apply/));
    // Internal key uses NUL separator
    expect(captured!.has("aldo's\0veggie mix")).toBe(true);
    expect(captured!.has("lucia's\0sauce mix")).toBe(false);
  });

  it("same-name mixes under different brands have independent checkboxes", () => {
    let captured: ReadonlySet<string> | undefined;
    const prepared = makePrepared({
      newMixIngredients: [
        { mixName: "Taco Mix", brand: "Aldo's",  newComponents: [{ ingredient: "Ham", perPizza: 1 }] },
        { mixName: "Taco Mix", brand: "Lucia's", newComponents: [{ ingredient: "Cumin", perPizza: 0.3 }] },
      ],
    });
    render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={(_parsed, _renames, _remove, _force, accepted) => { captured = accepted; }}
      />,
    );
    advanceToStep2();
    // Check only Aldo's "Taco Mix"; Lucia's should remain unchecked
    fireEvent.click(screen.getByTestId("spec-new-mix-accept-aldo's|taco mix"));
    fireEvent.click(screen.getByText(/^Apply/));
    expect(captured!.has("aldo's\0taco mix")).toBe(true);
    expect(captured!.has("lucia's\0taco mix")).toBe(false);
    expect(captured!.size).toBe(1);
  });

  it("unchecking a previously checked mix removes it from the accepted set", () => {
    let captured: ReadonlySet<string> | undefined;
    const prepared = makePrepared({
      newMixIngredients: [
        { mixName: "Veggie Mix", brand: "Aldo's", newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }] },
      ],
    });
    render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={(_parsed, _renames, _remove, _force, accepted) => {
          captured = accepted;
        }}
      />,
    );
    advanceToStep2();
    const checkbox = screen.getByTestId("spec-new-mix-accept-aldo's|veggie mix");
    fireEvent.click(checkbox); // check
    fireEvent.click(checkbox); // uncheck
    fireEvent.click(screen.getByText(/^Apply/));
    expect(captured!.size).toBe(0);
  });

  it("resets accepted set when a new prepared payload arrives", () => {
    const prepared1 = makePrepared({
      newMixIngredients: [
        { mixName: "Veggie Mix", brand: "Aldo's", newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }] },
      ],
    });
    const prepared2 = makePrepared({
      newMixIngredients: [
        { mixName: "Sauce Mix", brand: "Lucia's", newComponents: [{ ingredient: "Basil", perPizza: 0.1 }] },
      ],
    });
    let captured: ReadonlySet<string> | undefined;
    const { rerender } = render(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared1}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={(_parsed, _renames, _remove, _force, accepted) => { captured = accepted; }}
      />,
    );
    advanceToStep2();
    fireEvent.click(screen.getByTestId("spec-new-mix-accept-aldo's|veggie mix")); // check veggie

    // New prepared arrives — dialog resets to step 1 with new payload
    rerender(
      <SpecImportDialog
        open={true}
        onClose={() => {}}
        loading={false}
        error={null}
        prepared={prepared2}
        applying={false}
        existingRecipeNamesByKind={{ dough: [], sauce: [], cheese: [], mix: [] }}
        onConfirm={(_parsed, _renames, _remove, _force, accepted) => { captured = accepted; }}
      />,
    );
    advanceToStep2();
    fireEvent.click(screen.getByText(/^Apply/));
    // Only sauce mix section is shown — veggie was from the old payload, accepted set reset
    expect(captured!.has("aldo's\0veggie mix")).toBe(false);
    expect(captured!.size).toBe(0);
  });
});
