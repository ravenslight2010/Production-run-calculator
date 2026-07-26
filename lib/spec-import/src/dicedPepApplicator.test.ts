import { describe, it, expect } from "vitest";
import { isDicedPepStandaloneApplicator } from "./index";

describe("isDicedPepStandaloneApplicator", () => {
  it("drops a standalone 'Diced Pep' slot with no rows", () => {
    expect(isDicedPepStandaloneApplicator("Diced Pep", [])).toBe(true);
  });

  it("drops a standalone 'Diced Pepperoni' slot with one row", () => {
    expect(
      isDicedPepStandaloneApplicator("Diced Pepperoni", [
        { ingredient: "Diced Pepperoni", lbs: 4 },
      ]),
    ).toBe(true);
  });

  it("drops hyphenated 'Diced-Pep' variant", () => {
    expect(isDicedPepStandaloneApplicator("Diced-Pep", [])).toBe(true);
  });

  it("does NOT drop a real cheese blend that contains diced pep among other ingredients", () => {
    // 2+ rows → this is a real blend (e.g. "Lowe's Topping Blend")
    expect(
      isDicedPepStandaloneApplicator("Diced Pep Topping", [
        { ingredient: "Diced Pepperoni", lbs: 4 },
        { ingredient: "Mozzarella", lbs: 30 },
      ]),
    ).toBe(false);
  });

  it("does NOT drop a multi-ingredient blend whose name contains 'Diced Pepperoni'", () => {
    expect(
      isDicedPepStandaloneApplicator("Diced Pepperoni Blend", [
        { ingredient: "Diced Pepperoni", lbs: 6 },
        { ingredient: "Italian Sausage", lbs: 4 },
      ]),
    ).toBe(false);
  });

  it("does NOT drop a regular pepperoni stick (non-diced name)", () => {
    expect(
      isDicedPepStandaloneApplicator("Pepperoni Stick", [
        { ingredient: "Pepperoni Stick", lbs: 2 },
      ]),
    ).toBe(false);
  });

  it("does NOT drop a normal cheese blend with no diced pep in the name", () => {
    expect(
      isDicedPepStandaloneApplicator("Lucia's Cheese Blend", [
        { ingredient: "Mozzarella", lbs: 30 },
      ]),
    ).toBe(false);
  });
});
