import { describe, it, expect } from "vitest";
import { addSpecMixesIfAbsent, normalizeMix, type Mix } from "./index";

function mix(name: string, extra: Partial<Mix> = {}): Mix {
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

describe("addSpecMixesIfAbsent", () => {
  it("adds mixes whose names are not already present", () => {
    const existing = [mix("White Fajita Mix")];
    const candidates = [mix("Buffalo Mix", { id: "buffalo-mix" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(1);
    expect(merged.map((m) => m.name)).toEqual(["White Fajita Mix", "Buffalo Mix"]);
  });

  it("skips a candidate whose name already exists (case-insensitive) and never clobbers it", () => {
    const existing = [mix("White Fajita Mix", { batchSize: 40, id: "kept" })];
    const candidates = [mix("white fajita mix", { batchSize: 0, id: "incoming" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kept");
    expect(merged[0].batchSize).toBe(40);
  });

  it("links a candidate to an existing mix that differs only by punctuation/spacing (no duplicate)", () => {
    const existing = [mix("Aldo's Fajita Mix", { batchSize: 40, id: "kept" })];
    const candidates = [mix("Aldos  FAJITA mix", { batchSize: 0, id: "incoming" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kept");
    expect(merged[0].batchSize).toBe(40);
  });

  it("links a candidate whose words are just reordered (no duplicate)", () => {
    const existing = [mix("Aldo's Fajita Mix", { batchSize: 40, id: "kept" })];
    const candidates = [mix("Fajita Aldo's Mix", { batchSize: 0, id: "incoming" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kept");
    expect(merged[0].batchSize).toBe(40);
  });

  it("links a candidate that differs by a single typo (no duplicate)", () => {
    const existing = [mix("Aldo's Fajita Mix", { batchSize: 40, id: "kept" })];
    const candidates = [mix("Aldo's Fajta Mix", { batchSize: 0, id: "incoming" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kept");
  });

  it("links a candidate that differs only by a filler word (Standard) to an existing mix", () => {
    const existing = [mix("Aldo's Standard Cheese Mix", { batchSize: 40, id: "kept" })];
    const candidates = [mix("Aldo's Cheese Mix", { batchSize: 0, id: "incoming" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kept");
    expect(merged[0].batchSize).toBe(40);
  });

  it("keeps a meaningful qualifier (Spicy) as a distinct mix", () => {
    const existing = [mix("Aldo's Cheese Mix", { id: "kept" })];
    const candidates = [mix("Aldo's Spicy Cheese Mix", { id: "incoming" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(1);
    expect(merged.map((m) => m.name)).toEqual(["Aldo's Cheese Mix", "Aldo's Spicy Cheese Mix"]);
  });

  it("de-dupes candidates against each other by name", () => {
    const candidates = [
      mix("Buffalo Mix", { id: "a" }),
      mix("buffalo mix", { id: "b" }),
    ];
    const { merged, added } = addSpecMixesIfAbsent([], candidates);
    expect(added).toBe(1);
    expect(merged).toHaveLength(1);
  });

  it("ignores blank-named candidates", () => {
    const blank: Mix = {
      id: "blank",
      name: "   ",
      brand: "",
      flavor: "",
      batchSize: 0,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [],
      enabled: true,
    };
    const { merged, added } = addSpecMixesIfAbsent([], [blank]);
    expect(added).toBe(0);
    expect(merged).toHaveLength(0);
  });
});

describe("addSpecMixesIfAbsent spec-wins update", () => {
  it("re-import overwrites components of an existing mix when names match exactly", () => {
    const existing = [
      mix("White Fajita Mix", {
        id: "kept",
        batchSize: 40,
        components: [{ ingredient: "Old Pepper", perPizza: 0.5 }],
      }),
    ];
    const incoming = mix("White Fajita Mix", {
      id: "incoming",
      batchSize: 0,
      components: [{ ingredient: "New Pepper", perPizza: 1.2 }],
    });
    const { merged, added, updated } = addSpecMixesIfAbsent(existing, [incoming]);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kept");
    expect(merged[0].components).toEqual([{ ingredient: "New Pepper", perPizza: 1.2 }]);
  });

  it("preserves amountAlreadyMade, enabled, and notes on update", () => {
    const existing: Mix[] = [
      {
        ...mix("Veggie Mix", {
          id: "kept",
          amountAlreadyMade: 12,
          enabled: false,
          components: [{ ingredient: "Old Onion", perPizza: 0.3 }],
        }),
        notes: "Pull 2 days early",
      },
    ];
    const incoming = mix("Veggie Mix", {
      id: "incoming",
      components: [{ ingredient: "New Onion", perPizza: 0.6 }],
    });
    const { merged, updated } = addSpecMixesIfAbsent(existing, [incoming]);
    expect(updated).toBe(1);
    expect(merged[0].amountAlreadyMade).toBe(12);
    expect(merged[0].enabled).toBe(false);
    expect(merged[0].notes).toBe("Pull 2 days early");
    expect(merged[0].components).toEqual([{ ingredient: "New Onion", perPizza: 0.6 }]);
  });

  it("does NOT count as updated when components are identical (no spurious saves)", () => {
    const comp = { ingredient: "Pepper", perPizza: 1.0 };
    const existing = [mix("Fajita Mix", { id: "kept", components: [comp] })];
    const incoming = mix("Fajita Mix", { id: "incoming", components: [comp] });
    const { added, updated } = addSpecMixesIfAbsent(existing, [incoming]);
    expect(added).toBe(0);
    expect(updated).toBe(0);
  });

  it("does NOT overwrite when candidate has an empty components list", () => {
    const existing = [
      mix("Fajita Mix", {
        id: "kept",
        components: [{ ingredient: "Pepper", perPizza: 1.5 }],
      }),
    ];
    const incoming = mix("Fajita Mix", { id: "incoming", components: [] });
    const { merged, added, updated } = addSpecMixesIfAbsent(existing, [incoming]);
    expect(added).toBe(0);
    expect(updated).toBe(0);
    expect(merged[0].components).toEqual([{ ingredient: "Pepper", perPizza: 1.5 }]);
  });

  it("updates an existing mix matched via near-dup (punctuation drift)", () => {
    const existing = [
      mix("Aldo's Fajita Mix", {
        id: "kept",
        components: [{ ingredient: "Old Pepper", perPizza: 0.5 }],
      }),
    ];
    const incoming = mix("Aldos  FAJITA mix", {
      id: "incoming",
      components: [{ ingredient: "New Pepper", perPizza: 1.2 }],
    });
    const { merged, added, updated } = addSpecMixesIfAbsent(existing, [incoming]);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(merged[0].id).toBe("kept");
    expect(merged[0].components).toEqual([{ ingredient: "New Pepper", perPizza: 1.2 }]);
  });

  it("updates the prefixed mix on a cross-brand re-import", () => {
    // First import creates "Lucia's Taco Mix" as prefixed
    const first = addSpecMixesIfAbsent(
      [mix("Taco Mix", { id: "marcos", brand: "Marco's" })],
      [mix("Taco Mix", { id: "lucias", brand: "Lucia's", components: [{ ingredient: "Old", perPizza: 1.0 }] })],
    ).merged;
    // Re-import with updated components
    const { merged, added, updated } = addSpecMixesIfAbsent(first, [
      mix("Taco Mix", {
        id: "lucias-2",
        brand: "Lucia's",
        components: [{ ingredient: "New", perPizza: 2.0 }],
      }),
    ]);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    const lucias = merged.find((m) => m.brand === "Lucia's");
    expect(lucias?.components).toEqual([{ ingredient: "New", perPizza: 2.0 }]);
  });

  it("returns updated:0 when no candidates match any existing mix", () => {
    const existing = [mix("White Fajita Mix")];
    const { added, updated } = addSpecMixesIfAbsent(existing, [mix("Buffalo Mix")]);
    expect(added).toBe(1);
    expect(updated).toBe(0);
  });
});

describe("addSpecMixesIfAbsent brand scope", () => {
  it("same name under a DIFFERENT brand is added brand-prefixed, both survive", () => {
    const existing = [mix("Taco Mix", { id: "marcos", brand: "Marco's", batchSize: 40 })];
    const candidates = [mix("Taco Mix", { id: "lucias", brand: "Lucia's" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(1);
    expect(merged.map((m) => m.name)).toEqual(["Taco Mix", "Lucia's Taco Mix"]);
    expect(merged[0].batchSize).toBe(40);
  });

  it("re-import of the prefixed mix converges (idempotent, no stacking)", () => {
    const first = addSpecMixesIfAbsent(
      [mix("Taco Mix", { id: "marcos", brand: "Marco's" })],
      [mix("Taco Mix", { id: "lucias", brand: "Lucia's" })],
    ).merged;
    const { merged, added } = addSpecMixesIfAbsent(first, [
      mix("Taco Mix", { id: "lucias-2", brand: "Lucia's" }),
    ]);
    expect(added).toBe(0);
    expect(merged.map((m) => m.name)).toEqual(["Taco Mix", "Lucia's Taco Mix"]);
  });

  it("same-brand collision still links (never adds)", () => {
    const existing = [mix("Taco Mix", { id: "kept", brand: "Lucia's", batchSize: 40 })];
    const { merged, added } = addSpecMixesIfAbsent(existing, [
      mix("taco mix", { id: "incoming", brand: "Lucia's" }),
    ]);
    expect(added).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kept");
  });

  it("an unbranded pool mix is shared master-data — branded candidate links, not forks", () => {
    const existing = [mix("Taco Mix", { id: "shared", brand: "" })];
    const { added } = addSpecMixesIfAbsent(existing, [
      mix("Taco Mix", { id: "lucias", brand: "Lucia's" }),
    ]);
    expect(added).toBe(0);
  });

  it("cross-brand near-dup (typo) also prefixes instead of linking", () => {
    const existing = [mix("Buffalo Mix", { id: "hann", brand: "Hannaford" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, [
      mix("Bufalo Mix", { id: "bobos", brand: "Bobos" }),
    ]);
    expect(added).toBe(1);
    expect(merged[1].name).toBe("Bobos Bufalo Mix");
  });
});
