import { expect, type Locator } from "@playwright/test";

export const RECIPE_PICKER_CONTRACT = [
  { context: "dough", testId: "setup-recipe-picker-dough", label: "Dough recipe" },
  { context: "sauce", testId: "setup-recipe-picker-sauce", label: "Sauce recipe" },
  {
    context: "cheese",
    testId: "setup-recipe-picker-app-1-cheese",
    label: "Applicator 1 cheese recipe",
  },
  {
    context: "mix",
    testId: "setup-recipe-picker-app-2-mix",
    label: "Applicator 2 mix recipe",
  },
] as const;

export async function assertRecipePickerContract(
  surface: Locator,
  surfaceName: string,
): Promise<void> {
  for (const picker of RECIPE_PICKER_CONTRACT) {
    const selector = surface.getByTestId(picker.testId);
    await expect(
      selector,
      `${surfaceName}: ${picker.context} picker drifted (${picker.testId})`,
    ).toHaveCount(1);
    await expect(
      selector,
      `${surfaceName}: ${picker.context} picker has the wrong accessible label`,
    ).toHaveAttribute("aria-label", picker.label);
  }
}