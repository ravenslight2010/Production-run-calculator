// @vitest-environment jsdom
//
// Rendered verification for the run/setup cheese applicator "no matching cheese
// recipe" warning (the inline `showMissingWarning` branch of `CheesePickCard`).
//
// Task #113 added an amber "No matching cheese recipe found" callout to the
// pick-only cheese applicator card when a picked recipe NAME has no match in the
// server cheese pool (e.g. a spec sheet referenced a blend that was never
// imported, or a manager since deleted/renamed it). Previously that state showed
// a confusing blank body. The picking logic is guarded by
// cheesePick.parity.test.ts, but the actual rendered warning was only covered by
// typecheck. This test renders the REAL `CheesePickCard` component (exported from
// pages/home.tsx — the same component the Setup screen and run applicators use)
// across the three states the task cares about, so an inverted condition or a
// warning hidden behind another branch fails loudly instead of silently
// dead-ending staff.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CheesePickCard } from "./pages/home";

afterEach(cleanup);

const noop = () => {};

describe("CheesePickCard — missing-cheese warning render", () => {
  it("shows the amber 'No matching cheese recipe found' warning when the picked name is not in the pool", () => {
    render(
      <CheesePickCard
        label="Cheese"
        batches={0}
        recipe={[]}
        recipeName="Ghost Blend"
        recipeNameOptions={["Real Blend"]}
        shredderSetting=""
        cellulose=""
        onRecipeNameChange={noop}
        recipeMissing
      />,
    );
    expect(
      screen.getByText(/isn't in Cheese Recipes/i),
    ).toBeTruthy();
    expect(screen.getAllByText(/Ghost Blend/).length).toBeGreaterThan(0);
    // The confusing "no ingredients yet" dead-end must NOT show in its place.
    expect(screen.queryByText(/has no ingredients yet/i)).toBeNull();
  });

  it("shows the recipe's ingredient rows (and NO warning) for a real recipe with rows", () => {
    render(
      <CheesePickCard
        label="Cheese"
        batches={2}
        recipe={[
          { ingredient: "Whole Mozzarella", lbs: 40 },
          { ingredient: "Provolone", lbs: 10 },
        ]}
        recipeName="Real Blend"
        recipeNameOptions={["Real Blend"]}
        shredderSetting=""
        cellulose=""
        onRecipeNameChange={noop}
        recipeMissing={false}
      />,
    );
    expect(screen.getByText("Whole Mozzarella")).toBeTruthy();
    expect(screen.getByText("Provolone")).toBeTruthy();
    expect(screen.queryByText(/No matching cheese recipe found/i)).toBeNull();
  });

  it("shows an added temporary ingredient while preserving the saved blend", () => {
    render(
      <CheesePickCard
        label="Cheese"
        batches={1}
        recipe={[
          { ingredient: "Whole Mozzarella", lbs: 0.2 },
          { ingredient: "Provolone", lbs: 0.1 },
          { ingredient: "Cow's Romano", lbs: 0 },
        ]}
        substitutions={[{
          id: "skim-mozz-today",
          action: "add",
          ingredient: "Whole Mozzarella",
          substitute: "Skim Mozzarella",
          amount: 20,
        }]}
        recipeName="Corner Booth Pepperoni Cheese Blend"
        recipeNameOptions={["Corner Booth Pepperoni Cheese Blend"]}
        shredderSetting=""
        cellulose=""
        onRecipeNameChange={noop}
      />,
    );

    expect(screen.getByTestId("temporary-cheese-recipe-overlay")).toBeTruthy();
    expect(screen.getByText("Skim Mozzarella")).toBeTruthy();
    expect(screen.getAllByText("20.0")).toHaveLength(2);
    expect(screen.getAllByText("20.3 lbs")).toHaveLength(2);
  });

  it("shows the original 'no ingredients yet' hint (and NO warning) for a real recipe with zero rows", () => {
    render(
      <CheesePickCard
        label="Cheese"
        batches={0}
        recipe={[]}
        recipeName="Empty Blend"
        recipeNameOptions={["Empty Blend"]}
        shredderSetting=""
        cellulose=""
        onRecipeNameChange={noop}
        recipeMissing={false}
      />,
    );
    expect(screen.getByText(/has no ingredients yet/i)).toBeTruthy();
    expect(screen.queryByText(/No matching cheese recipe found/i)).toBeNull();
  });

  it("does not warn when no recipe is picked yet (empty name), even if recipeMissing is falsy", () => {
    render(
      <CheesePickCard
        label="Cheese"
        batches={0}
        recipe={[]}
        recipeName=""
        recipeNameOptions={["Real Blend"]}
        shredderSetting=""
        cellulose=""
        onRecipeNameChange={noop}
      />,
    );
    expect(screen.queryByText(/No matching cheese recipe found/i)).toBeNull();
    // The blank-pick prompt shows instead.
    expect(screen.getByText(/Pick a cheese recipe above/i)).toBeTruthy();
  });
});
