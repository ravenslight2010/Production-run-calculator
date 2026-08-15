import { describe, it, expect } from "vitest";
import { detectNewMixComponents, applyNewMixComponents, normalizeMix, type Mix } from "./index";

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

// ── detectNewMixComponents ──────────────────────────────────────────────────

describe("detectNewMixComponents", () => {
  it("detects a new ingredient row that is not in the existing mix", () => {
    const existing = [
      mix("White Fajita Mix", {
        brand: "Aldo's",
        components: [{ ingredient: "Mozzarella", perPizza: 2.5 }],
      }),
    ];
    const updates = [
      {
        name: "White Fajita Mix",
        brand: "Aldo's",
        components: [
          { ingredient: "Mozzarella", perPizza: 2.5 },
          { ingredient: "Bell Peppers", perPizza: 0.75 }, // NEW
        ],
      },
    ];
    const result = detectNewMixComponents(existing, updates);
    expect(result).toHaveLength(1);
    expect(result[0].mixName).toBe("White Fajita Mix");
    expect(result[0].newComponents).toHaveLength(1);
    expect(result[0].newComponents[0].ingredient).toBe("Bell Peppers");
    expect(result[0].newComponents[0].perPizza).toBe(0.75);
  });

  it("returns empty when all incoming ingredients already exist on the mix", () => {
    const existing = [
      mix("Veggie Mix", {
        brand: "Aldo's",
        components: [
          { ingredient: "Bell Peppers", perPizza: 1.0 },
          { ingredient: "Onions", perPizza: 0.5 },
        ],
      }),
    ];
    const updates = [
      {
        name: "Veggie Mix",
        brand: "Aldo's",
        components: [
          { ingredient: "Bell Peppers", perPizza: 1.0 },
          { ingredient: "Onions", perPizza: 0.5 },
        ],
      },
    ];
    const result = detectNewMixComponents(existing, updates);
    expect(result).toHaveLength(0);
  });

  it("returns empty when the update names a mix that doesn't exist yet (addSpecMixesIfAbsent territory)", () => {
    const existing = [
      mix("Existing Mix", { brand: "Aldo's", components: [{ ingredient: "Cheese", perPizza: 2 }] }),
    ];
    const updates = [{ name: "Brand New Mix", brand: "Aldo's", components: [{ ingredient: "Ham", perPizza: 1 }] }];
    const result = detectNewMixComponents(existing, updates);
    expect(result).toHaveLength(0);
  });

  it("includes new ingredients with perPizza=0 (missing amount) so they appear in the review", () => {
    const existing = [
      mix("Sauce Mix", { brand: "Lucia's", components: [{ ingredient: "Tomatoes", perPizza: 3.0 }] }),
    ];
    const updates = [
      {
        name: "Sauce Mix",
        brand: "Lucia's",
        components: [
          { ingredient: "Tomatoes", perPizza: 3.0 },
          { ingredient: "Basil", perPizza: 0 }, // NEW, no amount yet
        ],
      },
    ];
    const result = detectNewMixComponents(existing, updates);
    expect(result).toHaveLength(1);
    expect(result[0].newComponents[0].ingredient).toBe("Basil");
    expect(result[0].newComponents[0].perPizza).toBe(0);
  });

  it("ignores blank ingredient names", () => {
    const existing = [
      mix("Spice Mix", { brand: "", components: [{ ingredient: "Cumin", perPizza: 0.1 }] }),
    ];
    const updates = [
      {
        name: "Spice Mix",
        brand: "",
        components: [
          { ingredient: "Cumin", perPizza: 0.1 },
          { ingredient: "", perPizza: 1.5 }, // blank — must be ignored
          { ingredient: "  ", perPizza: 1.5 }, // whitespace-only
        ],
      },
    ];
    const result = detectNewMixComponents(existing, updates);
    expect(result).toHaveLength(0);
  });

  it("deduplicates new ingredient names within one update", () => {
    const existing = [
      mix("Blend", { brand: "Hannaford", components: [{ ingredient: "Cheese", perPizza: 2 }] }),
    ];
    const updates = [
      {
        name: "Blend",
        brand: "Hannaford",
        components: [
          { ingredient: "Cheese", perPizza: 2 },
          { ingredient: "Ham", perPizza: 1 },
          { ingredient: "Ham", perPizza: 1.5 }, // duplicate new — only first survives
        ],
      },
    ];
    const result = detectNewMixComponents(existing, updates);
    expect(result[0].newComponents).toHaveLength(1);
    expect(result[0].newComponents[0].ingredient).toBe("Ham");
  });

  it("does not match across brand scopes — branded update vs unbranded existing is no match", () => {
    const existing = [
      mix("Taco Mix", { brand: "", components: [{ ingredient: "Cheese", perPizza: 2 }] }),
    ];
    const updates = [{ name: "Taco Mix", brand: "Aldo's", components: [{ ingredient: "Ham", perPizza: 1 }] }];
    const result = detectNewMixComponents(existing, updates);
    expect(result).toHaveLength(0);
  });

  it("matches using the loose name key — punctuation/case differences still match", () => {
    const existing = [
      mix("Aldo's Cheese Mix", {
        brand: "Aldo's",
        components: [{ ingredient: "Mozzarella", perPizza: 2 }],
      }),
    ];
    const updates = [
      {
        name: "aldos cheese mix", // loose-key equivalent
        brand: "Aldo's",
        components: [
          { ingredient: "Mozzarella", perPizza: 2 },
          { ingredient: "Cheddar", perPizza: 1 }, // NEW
        ],
      },
    ];
    const result = detectNewMixComponents(existing, updates);
    expect(result).toHaveLength(1);
    expect(result[0].mixName).toBe("Aldo's Cheese Mix"); // returns the SAVED name
  });

  it("carries the saved mix's brand onto the result entry", () => {
    const existing = [
      mix("Fajita Blend", { brand: "Lucia's", components: [{ ingredient: "Peppers", perPizza: 1 }] }),
    ];
    const updates = [
      { name: "Fajita Blend", brand: "Lucia's", components: [{ ingredient: "Peppers", perPizza: 1 }, { ingredient: "Cumin", perPizza: 0.2 }] },
    ];
    const result = detectNewMixComponents(existing, updates);
    expect(result[0].brand).toBe("Lucia's");
  });

  it("detects new ingredients when the existing mix was unbranded but has been tag-backfilled (simulating fillSpecMixTags)", () => {
    // Simulates the caller having already applied fillSpecMixTags so the
    // unbranded existing mix now carries the candidate's brand.
    const existing = [
      mix("Veggie Mix", {
        brand: "Aldo's", // post-fillSpecMixTags: was "" before tagging
        components: [{ ingredient: "Mozzarella", perPizza: 2.5 }],
      }),
    ];
    const updates = [
      {
        name: "Veggie Mix",
        brand: "Aldo's",
        components: [
          { ingredient: "Mozzarella", perPizza: 2.5 },
          { ingredient: "Bell Peppers", perPizza: 0.75 }, // NEW
        ],
      },
    ];
    const result = detectNewMixComponents(existing, updates);
    expect(result).toHaveLength(1);
    expect(result[0].newComponents[0].ingredient).toBe("Bell Peppers");
  });
});

// ── applyNewMixComponents ───────────────────────────────────────────────────

describe("applyNewMixComponents", () => {
  it("appends accepted new components to the matching mix", () => {
    const existing = [
      mix("White Fajita Mix", {
        brand: "Aldo's",
        components: [{ ingredient: "Mozzarella", perPizza: 2.5 }],
      }),
    ];
    const accepted = [
      {
        mixName: "White Fajita Mix",
        brand: "Aldo's",
        newComponents: [{ ingredient: "Bell Peppers", perPizza: 0.75 }],
      },
    ];
    const { next, applied } = applyNewMixComponents(existing, accepted);
    expect(applied).toBe(1);
    expect(next[0].components).toHaveLength(2);
    expect(next[0].components[1].ingredient).toBe("Bell Peppers");
    expect(next[0].components[1].perPizza).toBe(0.75);
  });

  it("does not append if the ingredient already exists (double-guard)", () => {
    const existing = [
      mix("Blend", {
        brand: "",
        components: [{ ingredient: "Cheese", perPizza: 2 }, { ingredient: "Ham", perPizza: 1 }],
      }),
    ];
    // Acceptance list includes "Ham" which is already in the mix
    const accepted = [
      { mixName: "Blend", brand: "", newComponents: [{ ingredient: "Ham", perPizza: 1.5 }] },
    ];
    const { next, applied } = applyNewMixComponents(existing, accepted);
    expect(applied).toBe(0);
    expect(next[0].components).toHaveLength(2); // unchanged
  });

  it("appends components with perPizza=0 (manager fills amount later)", () => {
    const existing = [
      mix("Sauce Mix", { brand: "Lucia's", components: [{ ingredient: "Tomatoes", perPizza: 3 }] }),
    ];
    const accepted = [
      { mixName: "Sauce Mix", brand: "Lucia's", newComponents: [{ ingredient: "Basil", perPizza: 0 }] },
    ];
    const { next, applied } = applyNewMixComponents(existing, accepted);
    expect(applied).toBe(1);
    expect(next[0].components[1].ingredient).toBe("Basil");
    expect(next[0].components[1].perPizza).toBe(0);
  });

  it("returns applied=0 and same-ref array when acceptedAdditions is empty", () => {
    const existing = [
      mix("Taco Mix", { brand: "", components: [{ ingredient: "Beef", perPizza: 4 }] }),
    ];
    const { next, applied } = applyNewMixComponents(existing, []);
    expect(applied).toBe(0);
    expect(next[0].components).toHaveLength(1);
  });

  it("does not mutate the existing mix's components array", () => {
    const m = mix("Blend", { brand: "", components: [{ ingredient: "Cheese", perPizza: 2 }] });
    const original = [...m.components];
    applyNewMixComponents([m], [{ mixName: "Blend", brand: "", newComponents: [{ ingredient: "Ham", perPizza: 1 }] }]);
    expect(m.components).toEqual(original);
  });

  it("matches by the same loose name key as detection", () => {
    const existing = [
      mix("Aldo's Fajita Mix", {
        brand: "Aldo's",
        components: [{ ingredient: "Cheese", perPizza: 2 }],
      }),
    ];
    const accepted = [
      { mixName: "aldos fajita mix", brand: "Aldo's", newComponents: [{ ingredient: "Peppers", perPizza: 1 }] },
    ];
    const { next, applied } = applyNewMixComponents(existing, accepted);
    expect(applied).toBe(1);
    expect(next[0].components).toHaveLength(2);
  });
});
