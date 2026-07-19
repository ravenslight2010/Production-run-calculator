import { describe, expect, it } from "vitest";

import { healAldoCheeseOzInValues } from "./dataHeals";

const MIX = "Aldo's Standard Cheese Mix";

describe("healAldoCheeseOzInValues", () => {
  it("copies the sibling station's weight onto a poisoned 0.2 slot", () => {
    const values: Record<string, unknown> = {
      app2CheeseRecipeName: MIX,
      app2OzPerPizza: 2.9,
      app3CheeseRecipeName: MIX,
      app3OzPerPizza: 0.2,
    };
    expect(healAldoCheeseOzInValues(values)).toBe(true);
    expect(values.app3OzPerPizza).toBe(2.9);
    expect(values.app2OzPerPizza).toBe(2.9);
  });

  it("uses the 3.65 donor on the plain-cheese profile", () => {
    const values: Record<string, unknown> = {
      app1CheeseRecipeName: MIX,
      app1OzPerPizza: 3.65,
      app3CheeseRecipeName: MIX,
      app3OzPerPizza: 0.2,
    };
    expect(healAldoCheeseOzInValues(values)).toBe(true);
    expect(values.app3OzPerPizza).toBe(3.65);
  });

  it("does nothing without a same-named >=2oz donor slot", () => {
    const values: Record<string, unknown> = {
      app3CheeseRecipeName: MIX,
      app3OzPerPizza: 0.2,
    };
    expect(healAldoCheeseOzInValues(values)).toBe(false);
    expect(values.app3OzPerPizza).toBe(0.2);
  });

  it("never touches other mixes or non-0.2 weights", () => {
    const values: Record<string, unknown> = {
      app1CheeseRecipeName: "Hannaford Club Cheese Mix",
      app1OzPerPizza: 4,
      app2CheeseRecipeName: "Hannaford Club Mix",
      app2OzPerPizza: 0.85,
      app3CheeseRecipeName: MIX,
      app3OzPerPizza: 2.75,
      app4CheeseRecipeName: MIX,
      app4OzPerPizza: 2.9,
    };
    const before = { ...values };
    expect(healAldoCheeseOzInValues(values)).toBe(false);
    expect(values).toEqual(before);
  });

  it("ignores 0.2 slots whose recipe name is not the Aldo mix", () => {
    const values: Record<string, unknown> = {
      app2CheeseRecipeName: MIX,
      app2OzPerPizza: 2.9,
      app3CheeseRecipeName: "Red Onion Diced",
      app3OzPerPizza: 0.2,
    };
    expect(healAldoCheeseOzInValues(values)).toBe(false);
    expect(values.app3OzPerPizza).toBe(0.2);
  });
});
