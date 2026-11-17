// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  deriveRunAllergenFootprint,
  type Ingredient,
} from "@workspace/ingredient-catalog";
import type { IngredientSubstitution } from "@workspace/inventory-math";
import { DEFAULT_VALUES } from "../types";
import { collectRunAllergenComponents } from "../runAllergenFootprint";
import RunAllergenFootprintPanel from "./RunAllergenFootprintPanel";

afterEach(cleanup);

function renderPanel(
  values: typeof DEFAULT_VALUES,
  ingredients: Ingredient[],
  substitutions: IngredientSubstitution[] = [],
  runId = "run-1",
) {
  const footprint = deriveRunAllergenFootprint(
    collectRunAllergenComponents(values, substitutions),
    ingredients,
  );
  return render(
    <RunAllergenFootprintPanel
      runId={runId}
      footprint={footprint}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
    />,
  );
}

describe("RunAllergenFootprintPanel", () => {
  it("shows mapped contributors and identifies missing or unreviewed mappings as unknown", () => {
    const values = {
      ...DEFAULT_VALUES,
      doughRecipeName: "House Dough",
      doughRecipe: [{ ingredient: "Flour", ingredientId: "flour", lbs: 20 }],
      app1Type: "cheese",
      app1CheeseRecipeName: "Cheese Blend",
      app1CheeseRecipe: [{ ingredient: "Oil", ingredientId: "oil", lbs: 5 }],
      pep1Type: "Legacy Pep Type",
    };
    renderPanel(values, [
      {
        id: "flour",
        name: "Flour",
        categories: ["dough"],
        mergedInto: null,
        enabled: true,
        allergens: ["wheat"],
        allergensReviewed: true,
      },
      {
        id: "oil",
        name: "Oil",
        categories: ["cheese"],
        mergedInto: null,
        enabled: true,
        allergens: [],
        allergensReviewed: false,
      },
    ]);

    expect(screen.getByTestId("qc-allergen-run-id").textContent).toBe("Run run-1");
    expect(screen.getByTestId("run-allergen-coverage-status").textContent).toMatch(/Coverage incomplete/i);
    expect(screen.getByTestId("run-allergen-wheat").textContent).toContain("Flour");
    const unknownRows = screen.getAllByTestId("run-allergen-unknown-ingredient");
    expect(unknownRows).toHaveLength(2);
    expect(unknownRows.map((row) => row.textContent).join(" ")).toContain(
      "Legacy Pep Type — not found in the ingredient catalog",
    );
    expect(unknownRows.map((row) => row.textContent).join(" ")).toContain(
      "Oil — mapping not reviewed",
    );
  });

  it("distinguishes reviewed-empty mappings from unavailable recipe data", () => {
    renderPanel(
      {
        ...DEFAULT_VALUES,
        doughRecipeName: "House Dough",
        doughRecipe: [{ ingredient: "Salt", ingredientId: "salt", lbs: 1 }],
      },
      [{
        id: "salt",
        name: "Salt",
        categories: ["dough"],
        mergedInto: null,
        enabled: true,
        allergens: [],
        allergensReviewed: true,
      }],
    );
    expect(screen.getByTestId("run-allergen-coverage-status").textContent).toMatch(/Coverage complete/i);
    expect(screen.getByText(/No tracked allergens are mapped among the reviewed ingredients shown/)).toBeTruthy();
    expect(screen.getByText(/not a verified food-label declaration or cleaning clearance/i)).toBeTruthy();
    cleanup();

    renderPanel({ ...DEFAULT_VALUES }, []);
    expect(screen.getByText(/No recipe ingredient data is available for this run/i)).toBeTruthy();
    expect(screen.queryByTestId("run-allergen-coverage-status")).toBeNull();
  });

  it("derives from active substitutions instead of the replaced recipe ingredient", () => {
    renderPanel(
      {
        ...DEFAULT_VALUES,
        doughRecipeName: "House Dough",
        doughRecipe: [{ ingredient: "Flour", ingredientId: "flour", lbs: 20 }],
      },
      [
        {
          id: "flour",
          name: "Flour",
          categories: ["dough"],
          mergedInto: null,
          enabled: true,
          allergens: ["wheat"],
          allergensReviewed: true,
        },
        {
          id: "substitute",
          name: "Sample Substitute",
          categories: ["dough"],
          mergedInto: null,
          enabled: true,
          allergens: [],
          allergensReviewed: true,
        },
      ],
      [{
        id: "sub-flour",
        ingredient: "Flour",
        action: "swap",
        substitute: "Sample Substitute",
      }],
    );

    expect(screen.getByTestId("run-allergen-coverage-status").textContent).toMatch(/Coverage complete/i);
    expect(screen.queryByTestId("run-allergen-wheat")).toBeNull();
    expect(screen.getByText(/No tracked allergens are mapped among the reviewed ingredients shown/)).toBeTruthy();
  });
});
