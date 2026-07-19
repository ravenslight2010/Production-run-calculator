import { describe, expect, it } from "vitest";
import {
  brandPrefixedName,
  brandTagLabels,
  buildNearDupNameMatcher,
  isSingleEditApart,
  looseNameKey,
} from "./index";

describe("looseNameKey", () => {
  it("lowercases, folds punctuation, collapses apostrophes", () => {
    expect(looseNameKey("Aldo's  Cheese-Mix!")).toBe("aldos cheese mix");
  });

  it("drops generic filler tokens but keeps all-filler names", () => {
    expect(looseNameKey("Mystic Pizza Sauce")).toBe("mystic sauce");
    expect(looseNameKey("Standard")).toBe("standard");
  });

  it("returns empty for blank input", () => {
    expect(looseNameKey("")).toBe("");
    expect(looseNameKey("  !! ")).toBe("");
  });
});

describe("isSingleEditApart", () => {
  it("detects substitution, insertion, deletion of one char", () => {
    expect(isSingleEditApart("peperoni", "pepperoni")).toBe(true); // insert
    expect(isSingleEditApart("pepperoni", "peperoni")).toBe(true); // delete
    expect(isSingleEditApart("pepperoni", "pepparoni")).toBe(true); // sub
  });

  it("rejects identical strings and distance >= 2", () => {
    expect(isSingleEditApart("pepperoni", "pepperoni")).toBe(false);
    expect(isSingleEditApart("pepperoni", "peparoni")).toBe(false);
    expect(isSingleEditApart("sauce", "dough")).toBe(false);
  });
});

describe("buildNearDupNameMatcher", () => {
  it("layer 1: matches on loose key (case/punct/filler drift)", () => {
    const match = buildNearDupNameMatcher(["Aldo's Standard Cheese Mix"]);
    expect(match("Aldos Cheese-Mix")).toBe("Aldo's Standard Cheese Mix");
  });

  it("layer 2: matches reordered words", () => {
    const match = buildNearDupNameMatcher(["Craft Pepperoni Blend"]);
    expect(match("Pepperoni Craft Blend")).toBe("Craft Pepperoni Blend");
  });

  it("extra-word layer is OFF by default (an extra word can be meaningful)", () => {
    const match = buildNearDupNameMatcher(["Cheese Mix Blend"]);
    expect(match("Spicy Cheese Mix Blend")).toBeNull();
  });

  it("extra-word layer (opt-in): matches one extra word on either side", () => {
    const opts = { allowExtraToken: true };
    const match = buildNearDupNameMatcher(["Pepperoni Blend"], opts);
    expect(match("Craft Pepperoni Blend")).toBe("Pepperoni Blend");
    const match2 = buildNearDupNameMatcher(["Craft Pepperoni Blend"], opts);
    expect(match2("Pepperoni Blend")).toBe("Craft Pepperoni Blend");
  });

  it("extra-word layer (opt-in): refuses when the shared part is too short/generic", () => {
    const match = buildNearDupNameMatcher(["Mix"], { allowExtraToken: true });
    expect(match("Craft Mix")).toBeNull();
  });

  it("extra-word layer (opt-in): refuses when the extra word contains a digit", () => {
    const match = buildNearDupNameMatcher(["Pepperoni Blend"], {
      allowExtraToken: true,
    });
    expect(match("Pepperoni Blend 2")).toBeNull();
  });

  it("typo layer: matches a single typo", () => {
    const match = buildNearDupNameMatcher(["Pepperoni Blend"]);
    expect(match("Peperoni Blend")).toBe("Pepperoni Blend");
  });

  it("typo layer: refuses short keys and digit changes", () => {
    expect(buildNearDupNameMatcher(["Red"])(`Rad`)).toBeNull();
    expect(
      buildNearDupNameMatcher(["Pepperoni 2"])("Pepperoni 3"),
    ).toBeNull();
    expect(buildNearDupNameMatcher(["12x12 Die"])("12x14 Die")).toBeNull();
  });

  it("ambiguity guard: two qualifying saved names -> no match, no fall-through", () => {
    const match = buildNearDupNameMatcher(
      ["Craft Pepperoni Blend", "Smoked Pepperoni Blend"],
      { allowExtraToken: true },
    );
    // Both are one-extra-word from "Pepperoni Blend" — must refuse.
    expect(match("Pepperoni Blend")).toBeNull();
  });

  it("duplicate saved entries of the same name are not a false ambiguity", () => {
    const match = buildNearDupNameMatcher([
      "Pepperoni Blend",
      "pepperoni blend",
    ]);
    expect(match("Peperoni Blend")).toBe("Pepperoni Blend");
  });

  it("returns null for blank or unmatched names", () => {
    const match = buildNearDupNameMatcher(["Pepperoni Blend"]);
    expect(match("")).toBeNull();
    expect(match("Sausage Crumble")).toBeNull();
  });

  it("honors a custom keyOf", () => {
    const keyOf = (s: string) =>
      looseNameKey(s).replace(/\bmozz\b/g, "mozzarella");
    const match = buildNearDupNameMatcher(["Whole Mozzarella"], { keyOf });
    expect(match("Whole Mozz")).toBe("Whole Mozzarella");
  });

  it("genuinely different names never collide", () => {
    const match = buildNearDupNameMatcher([
      "Aldo's Cheese Mix",
      "Cornerbooth Cheese Mix",
    ]);
    expect(match("Mystic Cheese Mix")).toBeNull();
  });
});

describe("buildNearDupNameMatcher excludeSelf", () => {
  it("skips the query's own entry but still matches near-dups in the pool", () => {
    const match = buildNearDupNameMatcher(
      ["Pepperoni Blend", "Peperoni Blend", "Sausage"],
      { excludeSelf: true },
    );
    // Own entry is skipped (would otherwise be an exact layer-1 self hit)…
    expect(match("Peperoni Blend")).toBe("Pepperoni Blend");
    expect(match("Pepperoni Blend")).toBe("Peperoni Blend");
    // …and a name with no near-dup gets nothing (not itself).
    expect(match("Sausage")).toBeNull();
  });

  it("self-exclusion is case-insensitive on the trimmed name", () => {
    const match = buildNearDupNameMatcher(["Pepperoni Blend"], {
      excludeSelf: true,
    });
    expect(match("  pepperoni blend  ")).toBeNull();
  });

  it("without excludeSelf an in-pool name still matches its own entry", () => {
    const match = buildNearDupNameMatcher(["Pepperoni Blend"]);
    expect(match("Pepperoni Blend")).toBe("Pepperoni Blend");
  });
});

describe("brandPrefixedName", () => {
  it("prefixes the brand onto a colliding name", () => {
    expect(brandPrefixedName("Lucia's", "Taco Mix")).toBe("Lucia's Taco Mix");
  });

  it("is idempotent — an already-prefixed name is unchanged", () => {
    expect(brandPrefixedName("Lucia's", "Lucia's Taco Mix")).toBe("Lucia's Taco Mix");
    // Loose normalization: apostrophe drift still counts as prefixed.
    expect(brandPrefixedName("Lucia's", "Lucias Taco Mix")).toBe("Lucias Taco Mix");
  });

  it("blank or all-punctuation brand never changes the name", () => {
    expect(brandPrefixedName("", "Taco Mix")).toBe("Taco Mix");
    expect(brandPrefixedName("  !! ", "Taco Mix")).toBe("Taco Mix");
  });

  it("a name that IS the brand is left alone", () => {
    expect(brandPrefixedName("Lucia's", "Lucias")).toBe("Lucias");
  });
});

describe("brandTagLabels", () => {
  it("tags same-named rows under two brands with both brands", () => {
    const labels = brandTagLabels([
      { name: "Taco Mix", brand: "Marco's" },
      { name: "Taco Mix", brand: "Lucia's" },
    ]);
    expect(labels.get("Taco Mix")).toBe("Taco Mix (Marco's / Lucia's)");
  });

  it("tags a bare name whose brand-prefixed twin exists, but not the prefixed twin", () => {
    const labels = brandTagLabels([
      { name: "Taco Mix", brand: "Marco's" },
      { name: "Lucia's Taco Mix", brand: "Lucia's" },
    ]);
    expect(labels.get("Taco Mix")).toBe("Taco Mix (Marco's)");
    // The prefixed name already tells staff whose it is.
    expect(labels.has("Lucia's Taco Mix")).toBe(false);
  });

  it("non-colliding names get no entry", () => {
    const labels = brandTagLabels([
      { name: "Buffalo Mix", brand: "Hannaford" },
      { name: "Deluxe Mix", brand: "Bobos" },
    ]);
    expect(labels.size).toBe(0);
  });

  it("an unbranded colliding row never mints a tag for itself", () => {
    const labels = brandTagLabels([
      { name: "Taco Mix", brand: "" },
      { name: "Lucia's Taco Mix", brand: "Lucia's" },
    ]);
    // Bare name collides but has no brand to show — no entry.
    expect(labels.has("Taco Mix")).toBe(false);
  });
});
