import { describe, it, expect } from "vitest";
import type { Mix } from "@workspace/mixes";
import {
  specImportToMixProducts,
  reconcileMixesWithSpec,
  reconcileMixesWithPremixSheet,
  formatMixDiscrepanciesForPrompt,
  type MixSpecProduct,
} from "./index";

function mix(overrides: Partial<Mix>): Mix {
  return {
    id: "m1",
    name: "Bobos Veggie Mix",
    brand: "Bobos",
    flavor: "Veggie",
    batchSize: 100,
    daysEarly: 0,
    amountAlreadyMade: 0,
    components: [{ ingredient: "Onion", perPizza: 0.05 }],
    enabled: true,
    ...overrides,
  };
}

describe("specImportToMixProducts", () => {
  it("flattens recipes per product and aggregates same ingredient across kinds", () => {
    const parsed = {
      recipes: [
        {
          kind: "dough" as const,
          name: "Bobos Dough",
          brand: "Bobos",
          flavor: "Veggie",
          rows: [
            { ingredient: "Flour", lbs: 0.2 },
            { ingredient: "Salt", lbs: 0.01 },
          ],
        },
        {
          kind: "sauce" as const,
          name: "Bobos Sauce",
          brand: "Bobos",
          flavor: "Veggie",
          rows: [{ ingredient: "Salt", lbs: 0.005 }],
        },
      ],
    };
    const products = specImportToMixProducts(parsed);
    expect(products).toHaveLength(1);
    const p = products[0];
    expect(p.brand).toBe("Bobos");
    expect(p.flavor).toBe("Veggie");
    const salt = p.rows.find((r) => r.ingredient === "Salt");
    expect(salt?.perPizza).toBeCloseTo(0.015, 6);
    expect(p.rows.find((r) => r.ingredient === "Flour")?.perPizza).toBeCloseTo(0.2, 6);
  });

  it("ties one recipe to every product in its targets", () => {
    const parsed = {
      recipes: [
        {
          kind: "dough" as const,
          name: "Shared Dough",
          targets: [
            { brand: "Bobos", flavor: "Veggie" },
            { brand: "Bobos", flavor: "Cheese" },
          ],
          rows: [{ ingredient: "Flour", lbs: 0.2 }],
        },
      ],
    };
    const products = specImportToMixProducts(parsed);
    expect(products.map((p) => p.flavor).sort()).toEqual(["Cheese", "Veggie"]);
  });

  it("handles empty / missing input", () => {
    expect(specImportToMixProducts(null)).toEqual([]);
    expect(specImportToMixProducts({})).toEqual([]);
  });
});

describe("reconcileMixesWithSpec", () => {
  const specProducts: MixSpecProduct[] = [
    {
      brand: "Bobos",
      flavor: "Veggie",
      rows: [
        { ingredient: "Onion", perPizza: 0.06 },
        { ingredient: "Pepper", perPizza: 0.04 },
      ],
    },
  ];

  it("flags an amount-mismatch and syncs the suggestion to the spec", () => {
    const out = reconcileMixesWithSpec({
      currentMixes: [mix({ components: [{ ingredient: "Onion", perPizza: 0.05 }] })],
      specProducts,
    });
    expect(out.discrepancies).toHaveLength(1);
    expect(out.discrepancies[0].type).toBe("amount-mismatch");
    expect(out.discrepancies[0].source).toBe("spec");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].status).toBe("drift");
    expect(out.items[0].suggestedMix.components[0].perPizza).toBeCloseTo(0.06, 6);
  });

  it("flags extra-component but never missing-component", () => {
    const out = reconcileMixesWithSpec({
      currentMixes: [
        mix({
          components: [
            { ingredient: "Onion", perPizza: 0.06 },
            { ingredient: "Mystery", perPizza: 0.01 },
          ],
        }),
      ],
      specProducts,
    });
    // Onion matches (no line); Mystery is extra; Pepper missing from the mix is NOT reported.
    expect(out.discrepancies.map((d) => d.type)).toEqual(["extra-component"]);
    expect(out.discrepancies[0].ingredient).toBe("Mystery");
    // extra component is kept untouched in the suggestion (advisory)
    expect(
      out.items[0].suggestedMix.components.find((c) => c.ingredient === "Mystery"),
    ).toBeTruthy();
  });

  it("respects tolerance and skips products not on the sheet", () => {
    const withinTol = reconcileMixesWithSpec({
      currentMixes: [mix({ components: [{ ingredient: "Onion", perPizza: 0.0600004 }] })],
      specProducts,
    });
    expect(withinTol.discrepancies).toHaveLength(0);

    const otherProduct = reconcileMixesWithSpec({
      currentMixes: [mix({ brand: "Other", flavor: "Thing" })],
      specProducts,
    });
    expect(otherProduct.discrepancies).toHaveLength(0);
  });

  it("ignores disabled mixes", () => {
    const out = reconcileMixesWithSpec({
      currentMixes: [mix({ enabled: false, components: [{ ingredient: "Onion", perPizza: 0.05 }] })],
      specProducts,
    });
    expect(out.discrepancies).toHaveLength(0);
  });
});

describe("reconcileMixesWithPremixSheet", () => {
  it("flags a missing-mix (new) for a sheet mix with no current counterpart", () => {
    const out = reconcileMixesWithPremixSheet({
      currentMixes: [],
      sheetMixes: [mix({ id: "sheet-1" })],
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].status).toBe("new");
    expect(out.discrepancies[0].type).toBe("missing-mix");
    expect(out.items[0].suggestedMix.id).toBe("sheet-1");
  });

  it("matches by product+name when ids differ and reports full drift", () => {
    const current = mix({
      id: "current-id",
      batchSize: 100,
      components: [
        { ingredient: "Onion", perPizza: 0.05 },
        { ingredient: "OldStuff", perPizza: 0.02 },
      ],
    });
    const sheet = mix({
      id: "sheet-id",
      batchSize: 120,
      components: [
        { ingredient: "Onion", perPizza: 0.06 }, // amount-mismatch
        { ingredient: "Garlic", perPizza: 0.01 }, // missing-component
      ],
    });
    const out = reconcileMixesWithPremixSheet({
      currentMixes: [current],
      sheetMixes: [sheet],
    });
    const types = out.discrepancies.map((d) => d.type).sort();
    expect(types).toEqual([
      "amount-mismatch", // Onion
      "amount-mismatch", // batch size
      "extra-component", // OldStuff
      "missing-component", // Garlic
    ]);
    expect(out.items[0].status).toBe("drift");
    expect(out.items[0].mixId).toBe("current-id");
    // suggestion replaces components with the sheet's and keeps the current id/state
    expect(out.items[0].suggestedMix.components.map((c) => c.ingredient).sort()).toEqual([
      "Garlic",
      "Onion",
    ]);
    expect(out.items[0].suggestedMix.batchSize).toBe(120);
    expect(out.items[0].suggestedMix.id).toBe("current-id");
  });

  it("reports nothing when the mix already matches the sheet", () => {
    const m = mix({ id: "x" });
    const out = reconcileMixesWithPremixSheet({ currentMixes: [m], sheetMixes: [{ ...m }] });
    expect(out.discrepancies).toHaveLength(0);
    expect(out.items).toHaveLength(0);
  });
});

describe("formatMixDiscrepanciesForPrompt", () => {
  it("renders a fallback line when there are no discrepancies", () => {
    expect(formatMixDiscrepanciesForPrompt([])).toMatch(/match the imported sheets/i);
  });
  it("renders one bullet per discrepancy tagged by source", () => {
    const out = reconcileMixesWithPremixSheet({
      currentMixes: [],
      sheetMixes: [mix({ id: "s" })],
    });
    const text = formatMixDiscrepanciesForPrompt(out.discrepancies);
    expect(text).toMatch(/^- \[premix\]/);
  });
});
