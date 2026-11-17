// Pure-helper coverage for the Bobo cross-family alias undo heal: saved spec
// parses whose applicator type carries the poisoned canonical name (the alias
// rename baked "Bobo's Breakfast Cheese Mix" into the premix station) get the
// sheet's verbatim label "Bobo Breakfast Mix" restored. The full pool name
// never appears as a raw applicator label in any source workbook, so a ci
// match can only be alias poison.
import { describe, expect, it } from "vitest";

import { healBoboApplicatorsInParse } from "./dataHeals";

describe("healBoboApplicatorsInParse", () => {
  it("restores the verbatim sheet name on poisoned applicator entries", () => {
    const data = {
      profiles: [
        {
          applicators: [
            { type: "Bobo Breakfast Cheese", ozPerPizza: 3 },
            { type: "Bobo's breakfast cheese mix", ozPerPizza: 1.4 },
            { type: "Bobo Breakfast Cheese", ozPerPizza: 1 },
          ],
        },
      ],
    };
    expect(healBoboApplicatorsInParse(data)).toBe(true);
    expect(data.profiles[0].applicators.map((a) => a.type)).toEqual([
      "Bobo Breakfast Cheese",
      "Bobo Breakfast Mix",
      "Bobo Breakfast Cheese",
    ]);
  });

  it("returns false and touches nothing when no poisoned entry exists", () => {
    const data = {
      profiles: [
        { applicators: [{ type: "Bobo Breakfast Mix" }, { type: "Whole Mozzarella" }] },
      ],
    };
    expect(healBoboApplicatorsInParse(data)).toBe(false);
    expect(data.profiles[0].applicators.map((a) => a.type)).toEqual([
      "Bobo Breakfast Mix",
      "Whole Mozzarella",
    ]);
  });

  it("tolerates malformed parse shapes", () => {
    expect(healBoboApplicatorsInParse({})).toBe(false);
    expect(
      healBoboApplicatorsInParse({ profiles: [{}, { applicators: [{ type: 5 }] }] } as never),
    ).toBe(false);
  });
});
