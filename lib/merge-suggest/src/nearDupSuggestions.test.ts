import { describe, expect, it } from "vitest";
import { nearDupSuggestions } from "./index";

describe("nearDupSuggestions", () => {
  it("returns empty for empty or singleton pools", () => {
    expect(nearDupSuggestions([])).toEqual([]);
    expect(nearDupSuggestions(["Pepperoni"])).toEqual([]);
  });

  it("groups word-order variants and keeps the longest name as target", () => {
    const out = nearDupSuggestions(["Craft Pepperoni", "Pepperoni Craft", "Sausage"]);
    expect(out).toHaveLength(1);
    expect(out[0].sources).toHaveLength(1);
    const all = [out[0].target, ...out[0].sources].sort();
    expect(all).toEqual(["Craft Pepperoni", "Pepperoni Craft"]);
  });

  it("groups single-typo variants", () => {
    const out = nearDupSuggestions(["Peperoni", "Pepperoni", "Sausage"]);
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("Pepperoni");
    expect(out[0].sources).toEqual(["Peperoni"]);
  });

  it("groups punctuation/apostrophe variants via the loose key", () => {
    const out = nearDupSuggestions(["Aldo's Cheese Mix", "Aldos Cheese Mix"]);
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("Aldo's Cheese Mix");
    expect(out[0].sources).toEqual(["Aldos Cheese Mix"]);
  });

  it("does NOT collapse a meaningful extra word (extra-word layer stays off)", () => {
    expect(nearDupSuggestions(["Spicy Cheese Mix", "Cheese Mix"])).toEqual([]);
    expect(nearDupSuggestions(["Craft Pepperoni", "Pepperoni"])).toEqual([]);
  });

  it("never matches names whose digits differ", () => {
    expect(nearDupSuggestions(["Pepperoni 2", "Pepperoni 3"])).toEqual([]);
  });

  it("leaves genuinely different names alone", () => {
    expect(nearDupSuggestions(["Mozzarella", "Cheddar", "Provolone"])).toEqual([]);
  });

  it("clusters transitively when a middle name pairs with both ends", () => {
    // "Peperoni" and "Pepperonni" are each one typo from "Pepperoni" (but two
    // apart from each other) — the shared middle links all three into one group.
    const out = nearDupSuggestions(["Peperoni", "Pepperoni", "Pepperonni", "Sausage"]);
    expect(out).toHaveLength(1);
    const all = [out[0].target, ...out[0].sources].sort();
    expect(all).toEqual(["Peperoni", "Pepperoni", "Pepperonni"]);
    expect(out[0].target).toBe("Pepperonni");
  });

  it("abandons an ambiguous pair but keeps the unambiguous group", () => {
    // "Pepperoni Kraft" is one typo from BOTH word-order variants of
    // "Craft Pepperoni", so the ambiguity guard keeps it out — but the two
    // word-order variants still group with each other.
    const out = nearDupSuggestions([
      "Craft Pepperoni",
      "Pepperoni Craft",
      "Pepperoni Kraft",
    ]);
    expect(out).toHaveLength(1);
    const all = [out[0].target, ...out[0].sources].sort();
    expect(all).toEqual(["Craft Pepperoni", "Pepperoni Craft"]);
  });

  it("ignores blank and case-duplicate entries", () => {
    const out = nearDupSuggestions(["", "  ", "Pepperoni", "pepperoni"]);
    expect(out).toEqual([]);
  });

  it("returns multiple independent groups sorted by target", () => {
    const out = nearDupSuggestions([
      "Peperoni",
      "Pepperoni",
      "Diced Tomato",
      "Tomato Diced",
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.target)).toEqual(["Diced Tomato", "Pepperoni"]);
  });
});

describe("nearDupSuggestions performance", () => {
  it("stays fast on large pools (single shared matcher, not O(n^2) rebuilds)", () => {
    const words = ["Mozzarella", "Cheddar", "Provolone", "Romano", "Asiago", "Parmesan", "Pepperoni", "Sausage", "Basil", "Oregano", "Garlic", "Onion", "Pepper", "Tomato", "Spinach", "Ricotta", "Fontina", "Gouda", "Salt", "Yeast", "Flour", "Oil", "Sugar", "Water", "Whey", "Starch", "Cellulose", "Paprika", "Fennel", "Anise"];
    const names: string[] = [];
    for (let i = 0; i < 3000; i++) {
      names.push(`${words[i % words.length]} ${words[(i * 7 + 3) % words.length]} ${i % 97}`);
    }
    const t0 = Date.now();
    nearDupSuggestions(names);
    // Pre-fix this took ~13s at 3000 names; the shared-matcher version runs in
    // well under a second. Generous bound so slow CI never flakes.
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
