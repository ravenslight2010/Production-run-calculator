import { describe, it, expect } from "vitest";
import { applyMixPerPizza, normalizeMix, type Mix } from "./index";

function mix(
  name: string,
  extra: Partial<Mix> & { components?: Mix["components"] } = {},
): Mix {
  return normalizeMix({
    id: extra.id ?? name.toLowerCase(),
    name,
    brand: extra.brand ?? "",
    flavor: extra.flavor ?? "",
    batchSize: extra.batchSize ?? 0,
    daysEarly: extra.daysEarly ?? 0,
    amountAlreadyMade: extra.amountAlreadyMade ?? 0,
    components: extra.components ?? [],
    enabled: extra.enabled ?? true,
  })!;
}

function component(ingredient: string, perPizza: number) {
  return { ingredient, perPizza };
}

describe("applyMixPerPizza", () => {
  it("backfills perPizza onto components that are currently 0", () => {
    const existing = [
      mix("White Fajita Mix", {
        brand: "Aldo's",
        components: [component("Mozzarella", 0), component("Cheddar", 0)],
      }),
    ];
    const updates = [
      {
        name: "White Fajita Mix",
        brand: "Aldo's",
        components: [
          { ingredient: "Mozzarella", perPizza: 2.5 },
          { ingredient: "Cheddar", perPizza: 1.5 },
        ],
      },
    ];
    const { next, updated } = applyMixPerPizza(existing, updates);
    expect(updated).toBe(1);
    expect(next[0].components[0].perPizza).toBe(2.5);
    expect(next[0].components[1].perPizza).toBe(1.5);
  });

  it("never overwrites a nonzero perPizza (preserves manager-entered values)", () => {
    const existing = [
      mix("Buffalo Mix", {
        brand: "Aldo's",
        components: [component("Sauce", 3.0), component("Spices", 0)],
      }),
    ];
    const updates = [
      {
        name: "Buffalo Mix",
        brand: "Aldo's",
        components: [
          { ingredient: "Sauce", perPizza: 9.9 },   // existing is 3.0 — must NOT change
          { ingredient: "Spices", perPizza: 0.5 },  // existing is 0 — backfill OK
        ],
      },
    ];
    const { next, updated } = applyMixPerPizza(existing, updates);
    expect(updated).toBe(1);
    expect(next[0].components[0].perPizza).toBe(3.0); // unchanged
    expect(next[0].components[1].perPizza).toBe(0.5); // filled in
  });

  it("returns updated=0 and same array when all components are already nonzero", () => {
    const existing = [
      mix("Veggie Mix", {
        brand: "Aldo's",
        components: [component("Bell Peppers", 1.0), component("Onions", 0.5)],
      }),
    ];
    const updates = [
      {
        name: "Veggie Mix",
        brand: "Aldo's",
        components: [
          { ingredient: "Bell Peppers", perPizza: 9.9 },
          { ingredient: "Onions", perPizza: 9.9 },
        ],
      },
    ];
    const { next, updated } = applyMixPerPizza(existing, updates);
    expect(updated).toBe(0);
    expect(next[0]).toBe(existing[0]); // same reference — no copy made
  });

  it("ignores incoming zero perPizza values (never fills a zero-from-zero update)", () => {
    const existing = [
      mix("Cheese Mix", {
        brand: "Aldo's",
        components: [component("Mozzarella", 0)],
      }),
    ];
    const updates = [
      {
        name: "Cheese Mix",
        brand: "Aldo's",
        components: [{ ingredient: "Mozzarella", perPizza: 0 }],
      },
    ];
    const { next, updated } = applyMixPerPizza(existing, updates);
    expect(updated).toBe(0);
    expect(next[0].components[0].perPizza).toBe(0);
  });

  it("does NOT update a same-named mix belonging to a different brand (cross-brand isolation)", () => {
    const existing = [
      mix("Taco Mix", { brand: "Lucia's", components: [component("Beef", 0)] }),
      mix("Taco Mix", { id: "taco-mix-aldos", brand: "Aldo's", components: [component("Beef", 0)] }),
    ];
    // Update scoped to Aldo's — must not touch Lucia's mix
    const updates = [
      {
        name: "Taco Mix",
        brand: "Aldo's",
        components: [{ ingredient: "Beef", perPizza: 2.0 }],
      },
    ];
    const { next, updated } = applyMixPerPizza(existing, updates);
    expect(updated).toBe(1);
    const lucias = next.find((m) => m.brand === "Lucia's")!;
    const aldos = next.find((m) => m.brand === "Aldo's")!;
    expect(lucias.components[0].perPizza).toBe(0); // untouched
    expect(aldos.components[0].perPizza).toBe(2.0); // filled
  });

  it("does NOT update an unbranded mix when the update carries a brand", () => {
    const existing = [
      mix("Ranch Mix", { brand: "", components: [component("Ranch", 0)] }),
    ];
    const updates = [
      {
        name: "Ranch Mix",
        brand: "Aldo's",
        components: [{ ingredient: "Ranch", perPizza: 1.5 }],
      },
    ];
    const { next, updated } = applyMixPerPizza(existing, updates);
    expect(updated).toBe(0);
    expect(next[0].components[0].perPizza).toBe(0);
  });

  it("only fills ingredients that exist on the mix (no phantom components added)", () => {
    const existing = [
      mix("Veggie Mix", {
        brand: "Aldo's",
        components: [component("Bell Peppers", 0)],
      }),
    ];
    const updates = [
      {
        name: "Veggie Mix",
        brand: "Aldo's",
        components: [
          { ingredient: "Bell Peppers", perPizza: 1.0 },
          { ingredient: "Extra Ingredient", perPizza: 2.0 }, // not in existing mix
        ],
      },
    ];
    const { next } = applyMixPerPizza(existing, updates);
    expect(next[0].components).toHaveLength(1);
    expect(next[0].components[0].ingredient).toBe("Bell Peppers");
  });

  it("returns identity (no change) when no updates match existing mixes", () => {
    const existing = [mix("Buffalo Mix", { brand: "Aldo's" })];
    const { next, updated } = applyMixPerPizza(existing, [
      { name: "Completely Different", brand: "Aldo's", components: [{ ingredient: "A", perPizza: 1 }] },
    ]);
    expect(updated).toBe(0);
    expect(next).toHaveLength(1);
  });

  it("matches by loose name key (punctuation/case insensitive)", () => {
    const existing = [
      mix("Aldo's White Fajita Mix", {
        brand: "Aldo's",
        components: [component("Mozzarella", 0)],
      }),
    ];
    const updates = [
      {
        name: "aldos white fajita mix", // loose-key match
        brand: "Aldo's",
        components: [{ ingredient: "Mozzarella", perPizza: 2.0 }],
      },
    ];
    const { updated, next } = applyMixPerPizza(existing, updates);
    expect(updated).toBe(1);
    expect(next[0].components[0].perPizza).toBe(2.0);
  });
});
