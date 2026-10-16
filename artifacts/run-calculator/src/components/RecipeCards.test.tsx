// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoughRecipeCard, FrontlineRecipeCard, MixRecipeCard } from "./RecipeCards";

afterEach(cleanup);

describe("recipe cards", () => {
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
