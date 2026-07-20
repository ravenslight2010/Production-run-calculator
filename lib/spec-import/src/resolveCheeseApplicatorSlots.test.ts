import { describe, it, expect } from "vitest";
import {
  resolveCheeseApplicatorSlots,
  type ParsedApplicator,
} from "./index";

const app = (type: string, ozPerPizza = 0): ParsedApplicator => ({ type, ozPerPizza });

describe("resolveCheeseApplicatorSlots", () => {
  it("re-types both cheese applicators of a two-cheese product and keeps oz", () => {
    // Meat Lover shape: slot1 Sausage, slot2 cheese, slot3 Bacon, slot4 cheese.
    const { applicators, links } = resolveCheeseApplicatorSlots(
      [
        app("Sausage (C&F)", 2.25),
        app("Aldo's Cheese Mix", 2.9),
        app("Bacon", 1.2),
        app("Aldo's Cheese Mix", 2.9),
      ],
      ["Aldo's Cheese Mix"],
    );
    expect(applicators.map((a) => a.type)).toEqual([
      "Sausage (C&F)",
      "cheese",
      "Bacon",
      "cheese",
    ]);
    // Oz is untouched on every slot (weight lives on the applicator).
    expect(applicators.map((a) => a.ozPerPizza)).toEqual([2.25, 2.9, 1.2, 2.9]);
    expect(links).toEqual([
      { slot: 2, recipeName: "Aldo's Cheese Mix" },
      { slot: 4, recipeName: "Aldo's Cheese Mix" },
    ]);
  });

  it("matches an applicator whose name carries a trailing per-pizza weight", () => {
    const { applicators, links } = resolveCheeseApplicatorSlots(
      [app("Aldo's Cheese Mix 1.75", 1.75)],
      ["Aldo's Cheese Mix"],
    );
    expect(applicators[0].type).toBe("cheese");
    // The link carries the canonical (cleaned) blend name so it hydrates the pool.
    expect(links).toEqual([{ slot: 1, recipeName: "Aldo's Cheese Mix" }]);
  });

  it("matches across case / punctuation / spacing differences", () => {
    const { applicators } = resolveCheeseApplicatorSlots(
      [app("aldos  cheese   mix", 2)],
      ["Aldo's Cheese Mix"],
    );
    expect(applicators[0].type).toBe("cheese");
  });

  it("leaves non-cheese applicators untouched", () => {
    const input = [app("Sausage", 2.25), app("Bacon", 1.2)];
    const { applicators, links } = resolveCheeseApplicatorSlots(input, [
      "Aldo's Cheese Mix",
    ]);
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("leaves a real Mix applicator alone because the caller keeps mixes out of the candidates", () => {
    // The caller filters mixes (specImportRecipeIsMix) out of candidateCheeseNames,
    // so a genuine Mix applicator never matches and keeps its own editable card —
    // even alongside a real cheese applicator that DOES match.
    const { applicators, links } = resolveCheeseApplicatorSlots(
      [app("White Fajita Mix", 0.5), app("Aldo's Cheese Mix", 2.9)],
      ["Aldo's Cheese Mix"],
    );
    expect(applicators.map((a) => a.type)).toEqual(["White Fajita Mix", "cheese"]);
    expect(links).toEqual([{ slot: 2, recipeName: "Aldo's Cheese Mix" }]);
  });

  it("leaves an already-'cheese' applicator alone (resolved elsewhere)", () => {
    const input = [app("cheese", 2.9)];
    const { applicators, links } = resolveCheeseApplicatorSlots(input, [
      "Aldo's Cheese Mix",
    ]);
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("returns the input array and no links when there are no candidates", () => {
    const input = [app("Aldo's Cheese Mix", 2.9)];
    const { applicators, links } = resolveCheeseApplicatorSlots(input, []);
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("does not touch a cheese applicator that matches no candidate blend", () => {
    const input = [app("Some Other Blend", 2.9)];
    const { applicators, links } = resolveCheeseApplicatorSlots(input, [
      "Aldo's Cheese Mix",
    ]);
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("matches an unbranded sheet label to the brand-prefixed pool recipe (sheet's own brand)", () => {
    // Corner Booth's sheet says "Monterey Jack"; the pool keeps the
    // brand-prefixed "Corner Booth Monterey Jack".
    const { applicators, links } = resolveCheeseApplicatorSlots(
      [app("Monterey Jack", 2.5)],
      ["Corner Booth Monterey Jack"],
      "Corner Booth",
    );
    expect(applicators[0].type).toBe("cheese");
    expect(links).toEqual([{ slot: 1, recipeName: "Corner Booth Monterey Jack" }]);
  });

  it("matches a brand-prefixed sheet label to the unbranded pool recipe", () => {
    const { applicators, links } = resolveCheeseApplicatorSlots(
      [app("Corner Booth Monterey Jack", 2.5)],
      ["Monterey Jack"],
      "Corner Booth",
    );
    expect(applicators[0].type).toBe("cheese");
    expect(links).toEqual([{ slot: 1, recipeName: "Monterey Jack" }]);
  });

  it("brand fold is possessive-tolerant (Bobo == Bobo's)", () => {
    const { links } = resolveCheeseApplicatorSlots(
      [app("Breakfast Blend", 2)],
      ["Bobo's Breakfast Blend"],
      "Bobo",
    );
    expect(links).toEqual([{ slot: 1, recipeName: "Bobo's Breakfast Blend" }]);
  });

  it("never brand-jumps to ANOTHER customer's recipe", () => {
    // Sheet brand is Corner Booth; the only candidate is Basha's blend —
    // must NOT match (the prod cross-link incident class).
    const input = [app("Monterey Jack", 2.5)];
    const { applicators, links } = resolveCheeseApplicatorSlots(
      input,
      ["Basha's Monterey Jack"],
      "Corner Booth",
    );
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("brand-prefix match without a brand param stays a non-match", () => {
    const input = [app("Monterey Jack", 2.5)];
    const { applicators, links } = resolveCheeseApplicatorSlots(input, [
      "Corner Booth Monterey Jack",
    ]);
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("brand-aware match drops out when TWO candidates claim the same folded key", () => {
    // Ambiguity guard: exact duplicate cores under the brand must never guess.
    const input = [app("Monterey Jack", 2.5)];
    const { links } = resolveCheeseApplicatorSlots(
      input,
      ["Corner Booth Monterey Jack", "Corner Booths Monterey Jack"],
      "Corner Booth",
    );
    expect(links).toEqual([]);
  });

  it("short generic cores never brand-jump", () => {
    const input = [app("Red", 1)];
    const { links } = resolveCheeseApplicatorSlots(input, ["Corner Booth Red"], "Corner Booth");
    expect(links).toEqual([]);
  });

  it("plain exact matches still win with a brand present", () => {
    const { links } = resolveCheeseApplicatorSlots(
      [app("Aldo's Cheese Mix", 2.9)],
      ["Aldo's Cheese Mix"],
      "Aldo's",
    );
    expect(links).toEqual([{ slot: 1, recipeName: "Aldo's Cheese Mix" }]);
  });

  it("resolves two DIFFERENT blends onto their own slots", () => {
    const { applicators, links } = resolveCheeseApplicatorSlots(
      [app("Provolone Blend", 1.5), app("Aldo's Cheese Mix", 2.9)],
      ["Aldo's Cheese Mix", "Provolone Blend"],
    );
    expect(applicators.map((a) => a.type)).toEqual(["cheese", "cheese"]);
    expect(links).toEqual([
      { slot: 1, recipeName: "Provolone Blend" },
      { slot: 2, recipeName: "Aldo's Cheese Mix" },
    ]);
  });
});
