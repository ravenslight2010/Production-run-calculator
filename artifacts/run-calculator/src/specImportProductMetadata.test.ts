// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedSpecImport } from "@workspace/spec-import";
import { applySpecImport, loadProfile } from "./storage";

beforeEach(() => {
  localStorage.clear();
});

describe("profile-specific shared recipe metadata", () => {
  it("preserves each product's dough settings and exact cheese applicator slot", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        {
          brand: "Alpha",
          flavor: "One",
          dieType: "12 inch",
          doughName: "Shared Dough",
          targetDoughballWeight: 10,
          doughballsPerTray: 20,
          applicators: [
            {
              type: "cheese",
              ozPerPizza: 3,
              slot: 1,
              recipeName: "Shared Cheese",
            },
          ],
          pepperonis: [],
        },
        {
          brand: "Alpha",
          flavor: "Two",
          dieType: "14 inch",
          doughName: "Shared Dough",
          targetDoughballWeight: 12,
          doughballsPerTray: 24,
          applicators: [
            {
              type: "cheese",
              ozPerPizza: 4,
              slot: 2,
              recipeName: "Shared Cheese",
            },
          ],
          pepperonis: [],
        },
      ],
      recipes: [
        {
          kind: "dough",
          name: "Shared Dough",
          targets: [
            { brand: "Alpha", flavor: "One" },
            { brand: "Alpha", flavor: "Two" },
          ],
          doughballOz: 99,
          doughballsPerTray: 30,
          rows: [{ ingredient: "Flour", lbs: 100 }],
        },
        {
          kind: "cheese",
          name: "Shared Cheese",
          targets: [
            { brand: "Alpha", flavor: "One" },
            { brand: "Alpha", flavor: "Two" },
          ],
          rows: [{ ingredient: "Mozzarella", lbs: 40 }],
        },
      ],
    };

    applySpecImport(
      parsed,
      undefined,
      {
        dough: [
          {
            name: "Shared Dough",
            components: [{ ingredient: "Flour", lbs: 100 }],
            doughballWeightOz: 50,
            doughballsPerTray: 30,
          },
        ],
      },
      undefined,
      new Set(["alpha\u0000one", "alpha\u0000two"]),
    );

    const one = loadProfile("Alpha", "One");
    const two = loadProfile("Alpha", "Two");
    expect(one?.targetDoughballWeight).toBe(10);
    expect(one?.doughballsPerTray).toBe(20);
    expect(two?.targetDoughballWeight).toBe(12);
    expect(two?.doughballsPerTray).toBe(24);
    expect(one?.app1CheeseRecipeName).toBe("Shared Cheese");
    expect(one?.app2CheeseRecipeName).toBe("");
    expect(two?.app1CheeseRecipeName).toBe("");
    expect(two?.app2CheeseRecipeName).toBe("Shared Cheese");
  });

  it("keeps legacy type-only cheese linking when recipeName is absent", () => {
    applySpecImport({
      profiles: [
        {
          brand: "Legacy",
          flavor: "Cheese",
          dieType: "12 inch",
          applicators: [
            {
              type: "Legacy Blend",
              ozPerPizza: 3.5,
              slot: 3,
            },
          ],
          pepperonis: [],
        },
      ],
      recipes: [
        {
          kind: "cheese",
          name: "Legacy Blend",
          rows: [{ ingredient: "Mozzarella", lbs: 25 }],
        },
      ],
    });

    const profile = loadProfile("Legacy", "Cheese");
    expect(profile?.app3Type).toBe("cheese");
    expect(profile?.app3CheeseRecipeName).toBe("Legacy Blend");
  });

  it("preserves explicit profiles-only recipe links without loaded candidates", () => {
    applySpecImport({
      profiles: [
        {
          brand: "Split",
          flavor: "Workbook",
          dieType: "12 inch",
          applicators: [
            {
              type: "cheese",
              recipeName: "Exact Cheese Blend",
              ozPerPizza: 4,
              slot: 2,
            },
            {
              type: "Mix",
              recipeName: "Exact Herb Mix",
              ozPerPizza: 1.25,
              slot: 4,
            },
          ],
          pepperonis: [],
        },
      ],
      recipes: [],
    });

    const profile = loadProfile("Split", "Workbook");
    expect(profile?.app2Type).toBe("cheese");
    expect(profile?.app2CheeseRecipeName).toBe("Exact Cheese Blend");
    expect(profile?.app4Type).toBe("Mix");
    expect(profile?.app4CheeseRecipeName).toBe("Exact Herb Mix");
  });
});