// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheesePickCard, DoughRecipeCard, FrontlineRecipeCard, MixRecipeCard } from "./RecipeCards";

afterEach(cleanup);

describe("recipe cards", () => {
  it("displays a temporary cheese swap without changing saved rows or invoking the caller", () => {
    const recipe = [
      { ingredient: "Whole Mozzarella", lbs: 40 },
      { ingredient: "Provolone", lbs: 10 },
    ];
    const savedRecipe = recipe.map(row => ({ ...row }));
    // This pick-only card exposes recipe selection, not a separate save callback.
    const onRecipeNameChange = vi.fn();
    const props = {
      label: "Cheese",
      batches: 2,
      ozPerPizza: 4,
      recipe,
      recipeName: "House Blend",
      recipeNameOptions: ["House Blend"],
      shredderSetting: "",
      cellulose: "",
      onRecipeNameChange,
    };
    const { rerender } = render(
      <CheesePickCard
        {...props}
        substitutions={[{
          id: "temporary-mozzarella-swap",
          action: "swap",
          ingredient: "Whole Mozzarella",
          substitute: "Skim Mozzarella",
        }]}
      />,
    );

    expect(screen.getByTestId("temporary-cheese-recipe-overlay")).toBeTruthy();
    expect(screen.getByText("Skim Mozzarella")).toBeTruthy();
    expect(screen.getByText("Provolone")).toBeTruthy();
    expect(screen.queryByText("Whole Mozzarella")).toBeNull();
    expect(recipe).toEqual(savedRecipe);
    expect(onRecipeNameChange).not.toHaveBeenCalled();

    rerender(<CheesePickCard {...props} substitutions={[]} />);

    expect(screen.queryByTestId("temporary-cheese-recipe-overlay")).toBeNull();
    expect(screen.queryByText("Skim Mozzarella")).toBeNull();
    expect(screen.getByText("Whole Mozzarella")).toBeTruthy();
    expect(screen.getByText("Provolone")).toBeTruthy();
    expect(recipe).toEqual(savedRecipe);
    expect(onRecipeNameChange).not.toHaveBeenCalled();
  });

  it("passes Mix card add-row actions to the caller", async () => {
    const user = userEvent.setup();
    const onAppend = vi.fn();

    render(
      <MixRecipeCard
        embedded
        label="Applicator 1"
        totalRunLbs={12}
        fields={[]}
        recipe={[]}
        fieldPrefix="app1CheeseRecipe"
        register={vi.fn()}
        ingredientOptions={[]}
        onSetIngredient={vi.fn()}
        onAppend={onAppend}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText("Applicator 1 — Mix Recipe")).toBeTruthy();
    expect(screen.getByText("12.0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /add ingredient/i }));
    expect(onAppend).toHaveBeenCalledOnce();
  });

  it("passes Dough card target-weight and add-row changes to the caller", async () => {
    const onTargetWeightChange = vi.fn();
    const onAppend = vi.fn();

    render(
      <DoughRecipeCard
        batchesNeeded={2}
        fields={[]}
        recipe={[]}
        register={vi.fn()}
        targetWeight={8}
        doughBatchYield={0}
        ingredientOptions={[]}
        onAddIngredient={vi.fn()}
        onRemoveIngredient={vi.fn()}
        onSetIngredient={vi.fn()}
        onAppend={onAppend}
        onRemove={vi.fn()}
        onTargetWeightChange={onTargetWeightChange}
        recipeName=""
        recipeNameOptions={[]}
        onAddRecipeName={vi.fn()}
        onRemoveRecipeName={vi.fn()}
        onRecipeNameChange={vi.fn()}
      />,
    );

    const weight = screen.getByPlaceholderText("0.00");
    fireEvent.change(weight, { target: { value: "9" } });
    expect(onTargetWeightChange).toHaveBeenLastCalledWith(9);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add ingredient/i }));
    expect(onAppend).toHaveBeenCalledOnce();
  });

  it("passes Frontline card add-row actions to the caller", async () => {
    const user = userEvent.setup();
    const onAppend = vi.fn();

    render(
      <FrontlineRecipeCard
        embedded
        fields={[]}
        recipe={[]}
        register={vi.fn()}
        ingredientOptions={[]}
        onAddIngredient={vi.fn()}
        onRemoveIngredient={vi.fn()}
        onSetIngredient={vi.fn()}
        onAppend={onAppend}
        onRemove={vi.fn()}
        recipeName=""
        recipeNameOptions={[]}
        onAddRecipeName={vi.fn()}
        onRemoveRecipeName={vi.fn()}
        onRecipeNameChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Sauce Recipe")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /add ingredient/i }));
    expect(onAppend).toHaveBeenCalledOnce();
  });
});
