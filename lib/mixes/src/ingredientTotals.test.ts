import { describe, expect, it } from "vitest";
import {
  addIngredientOzPerPizza,
  createIngredientOzPerPizza,
} from "./index";

describe("Mix Plan ingredient ounce accumulation", () => {
  it("sums duplicate ordinary ingredients and preserves key order and JSON output", () => {
    const totals = createIngredientOzPerPizza();

    addIngredientOzPerPizza(totals, "Mozzarella", 1.25);
    addIngredientOzPerPizza(totals, "Pepperoni", 0.5);
    addIngredientOzPerPizza(totals, "Mozzarella", 0.75);

    expect(Object.keys(totals)).toEqual(["Mozzarella", "Pepperoni"]);
    expect(totals.Mozzarella).toBe(2);
    expect(totals.Pepperoni).toBe(0.5);
    expect(JSON.stringify({
      ingredients: Object.keys(totals),
      ingredientOzPerPizza: totals,
    })).toBe(
      '{"ingredients":["Mozzarella","Pepperoni"],"ingredientOzPerPizza":{"Mozzarella":2,"Pepperoni":0.5}}',
    );
  });

  it("treats prototype-sensitive ingredient names as ordinary keys", () => {
    const totals = createIngredientOzPerPizza();

    addIngredientOzPerPizza(totals, "__proto__", 1.25);
    addIngredientOzPerPizza(totals, "constructor", 2);
    addIngredientOzPerPizza(totals, "prototype", 3);
    addIngredientOzPerPizza(totals, "__proto__", 0.75);
    addIngredientOzPerPizza(totals, "constructor", 0.5);
    addIngredientOzPerPizza(totals, "toString", 1.25);
    addIngredientOzPerPizza(totals, "hasOwnProperty", 0.4);
    addIngredientOzPerPizza(totals, "valueOf", 1.5);
    addIngredientOzPerPizza(totals, "toString", 0.75);
    addIngredientOzPerPizza(totals, "hasOwnProperty", 0.6);
    addIngredientOzPerPizza(totals, "valueOf", 2);

    expect(Object.getPrototypeOf(totals)).toBeNull();
    expect(Object.keys(totals)).toEqual([
      "__proto__",
      "constructor",
      "prototype",
      "toString",
      "hasOwnProperty",
      "valueOf",
    ]);
    expect(totals["__proto__"]).toBe(2);
    expect(totals.constructor).toBe(2.5);
    expect(totals.prototype).toBe(3);
    expect(Object.hasOwn(totals, "toString")).toBe(true);
    expect(Object.hasOwn(totals, "hasOwnProperty")).toBe(true);
    expect(Object.hasOwn(totals, "valueOf")).toBe(true);
    expect(totals.toString).toBe(2);
    expect(totals.hasOwnProperty).toBe(1);
    expect(totals.valueOf).toBe(3.5);
    expect(Object.entries(JSON.parse(JSON.stringify(totals)))).toEqual([
      ["__proto__", 2],
      ["constructor", 2.5],
      ["prototype", 3],
      ["toString", 2],
      ["hasOwnProperty", 1],
      ["valueOf", 3.5],
    ]);
  });
});
