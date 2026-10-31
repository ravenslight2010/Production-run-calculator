// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSauceDailyNeeds } from "./sauceDailyNeeds";
import type { FormValues, RunMeta } from "./types";

const runs = [
  { id: "run-a" },
  { id: "run-b" },
  { id: "run-c" },
] as RunMeta[];
const plan = (overrides: Partial<FormValues> = {}) => ({
  casesNeeded: 10,
  pizzasPerCase: 8,
  sauceOzPerPizza: 2,
  sauceBarrelLbs: 30,
  frontlineRecipeName: "Classic",
  frontlineRecipe: [{ ingredient: "Tomato", ingredientId: "tomato-id", lbs: 30 }],
  ...overrides,
}) as FormValues;

describe("buildSauceDailyNeeds", () => {
  it("groups identical saved Sauce recipes and sums planned demand, not stock or remaining work", () => {
    const result = buildSauceDailyNeeds(runs, {
      "run-a": plan(),
      "run-b": plan({ frontlineRecipe: [{ ingredient: "Tomato", ingredientId: "tomato-id", lbs: 15 }, { ingredient: "Tomato", ingredientId: "tomato-id", lbs: 15 }] }),
      "run-c": plan({ frontlineRecipeName: "Spicy", frontlineRecipe: [{ ingredient: "Tomato", ingredientId: "tomato-id", lbs: 29 }, { ingredient: "Chili", ingredientId: "chili-id", lbs: 1 }] }),
    });
    expect(result).toHaveLength(2);
    expect(result.find((entry) => entry.recipeName === "Classic")?.runCount).toBe(2);
    expect(result.find((entry) => entry.recipeName === "Classic")?.plannedBarrels).toBeCloseTo(2 * (10 * 8 * 2 / 16 + 30) / 30);
    expect(result.find((entry) => entry.recipeName === "Spicy")?.runCount).toBe(1);
  });

  it("ignores missing and zero-demand run plans", () => {
    expect(buildSauceDailyNeeds(runs, {
      "run-a": plan({ casesNeeded: 0 }),
    })).toEqual([]);
  });
});
