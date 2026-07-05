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
