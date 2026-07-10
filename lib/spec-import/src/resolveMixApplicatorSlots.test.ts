import { describe, it, expect } from "vitest";
import { resolveMixApplicatorSlots, type ParsedApplicator } from "./index";

const app = (type: string, ozPerPizza = 0): ParsedApplicator => ({ type, ozPerPizza });

describe("resolveMixApplicatorSlots", () => {
  it("re-types matched mix slots to the literal 'Mix' and keeps oz", () => {
    const { applicators, links } = resolveMixApplicatorSlots(
      [app("Sausage (C&F)", 2.25), app("White Fajita Mix", 3), app("Bacon", 1.2)],
      ["White Fajita Mix"],
    );
    expect(applicators.map((a) => a.type)).toEqual(["Sausage (C&F)", "Mix", "Bacon"]);
    expect(applicators.map((a) => a.ozPerPizza)).toEqual([2.25, 3, 1.2]);
    expect(links).toEqual([{ slot: 2, recipeName: "White Fajita Mix" }]);
  });

  it("matches an applicator whose name carries a trailing per-pizza weight", () => {
    const { applicators, links } = resolveMixApplicatorSlots(
      [app("White Fajita Mix 3.0", 3)],
      ["White Fajita Mix"],
    );
    expect(applicators[0].type).toBe("Mix");
    // The link carries the canonical (cleaned) mix name so it hydrates the pool.
    expect(links).toEqual([{ slot: 1, recipeName: "White Fajita Mix" }]);
  });

  it("matches across case / punctuation / spacing differences", () => {
    const { applicators } = resolveMixApplicatorSlots(
      [app("white  fajita   mix", 2)],
      ["White Fajita Mix"],
    );
    expect(applicators[0].type).toBe("Mix");
  });

  it("leaves non-matching applicators untouched", () => {
    const input = [app("Sausage", 2.25), app("Bacon", 1.2)];
    const { applicators, links } = resolveMixApplicatorSlots(input, ["White Fajita Mix"]);
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("skips slots already typed as generic cheese or Mix", () => {
    const input = [app("cheese", 2.9), app("Mix", 3), app("mix", 3)];
    const { applicators, links } = resolveMixApplicatorSlots(input, ["Mix", "cheese"]);
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("is a no-op with an empty candidate list", () => {
    const input = [app("Sausage", 2.25)];
    const { applicators, links } = resolveMixApplicatorSlots(input, []);
    expect(applicators).toEqual(input);
    expect(links).toEqual([]);
  });

  it("handles empty and blank applicator types safely", () => {
    const { applicators, links } = resolveMixApplicatorSlots(
      [app("", 0), app("   ", 0)],
      ["White Fajita Mix"],
    );
    expect(applicators.map((a) => a.type)).toEqual(["", "   "]);
    expect(links).toEqual([]);
  });
});
