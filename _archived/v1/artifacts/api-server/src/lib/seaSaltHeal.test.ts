import { describe, it, expect } from "vitest";
import {
  healSeaSaltComponents,
  SEA_SALT_DOUGH_TARGETS,
  SEA_SALT_SAUCE_TARGETS,
  SEA_SALT_MIX_TARGETS,
} from "./seaSaltHeal";

const lbsOf = (c: { ingredient: string; lbs?: number }) =>
  typeof c.lbs === "number" ? c.lbs : 0;
const perPizzaOf = (c: { ingredient: string; perPizza?: number }) =>
  typeof c.perPizza === "number" ? c.perPizza : 0;

describe("healSeaSaltComponents", () => {
  it("renames the poisoned Malted Barley SALT row back to Sea Salt", () => {
    const healed = healSeaSaltComponents(
      "Malted Barley Dough",
      [
        { ingredient: "ADM WHEAT FLOUR", lbs: 200 },
        { ingredient: "SALT", lbs: 1 },
      ],
      SEA_SALT_DOUGH_TARGETS,
      lbsOf,
    );
    expect(healed).not.toBeNull();
    expect(healed![1].ingredient).toBe("Sea Salt");
    expect(healed![1].lbs).toBe(1);
    expect(healed![0].ingredient).toBe("ADM WHEAT FLOUR");
  });

  it("matches Modified Malted Barley by its own sheet amount, not the plain one", () => {
    const healed = healSeaSaltComponents(
      "Modified Malted Barley Dough",
      [{ ingredient: "Salt", lbs: 1.3 }],
      SEA_SALT_DOUGH_TARGETS,
      lbsOf,
    );
    expect(healed![0].ingredient).toBe("Sea Salt");
    // plain-malted-barley amount on the Modified recipe does NOT match
    const wrongAmt = healSeaSaltComponents(
      "Modified Malted Barley Dough",
      [{ ingredient: "Salt", lbs: 0.5 }],
      SEA_SALT_DOUGH_TARGETS,
      lbsOf,
    );
    expect(wrongAmt).toBeNull();
  });

  it("never touches recipes whose sheets genuinely call for Salt", () => {
    expect(
      healSeaSaltComponents(
        "CRB Dough",
        [{ ingredient: "SALT", lbs: 1 }],
        SEA_SALT_DOUGH_TARGETS,
        lbsOf,
      ),
    ).toBeNull();
    expect(
      healSeaSaltComponents(
        "Lucia Pizza Sauce",
        [{ ingredient: "Salt", lbs: 4 }],
        SEA_SALT_SAUCE_TARGETS,
        lbsOf,
      ),
    ).toBeNull();
  });

  it("does not rename when the stored amount disagrees with the sheet", () => {
    expect(
      healSeaSaltComponents(
        "Malted Barley Dough",
        [{ ingredient: "SALT", lbs: 3 }],
        SEA_SALT_DOUGH_TARGETS,
        lbsOf,
      ),
    ).toBeNull();
  });

  it("heals 0-amount stub rows (spec-import stubs) on matching recipes", () => {
    const healed = healSeaSaltComponents(
      "Grilled Vegetable Mix",
      [{ ingredient: "SALT", perPizza: 0 }],
      SEA_SALT_MIX_TARGETS,
      perPizzaOf,
    );
    expect(healed![0].ingredient).toBe("Sea Salt");
  });

  it("heals the Aldo sauce row and is idempotent", () => {
    const first = healSeaSaltComponents(
      "Aldo Pizza Sauce",
      [{ ingredient: "Salt", lbs: 1 }],
      SEA_SALT_SAUCE_TARGETS,
      lbsOf,
    );
    expect(first![0].ingredient).toBe("Sea Salt");
    // Second pass: nothing left to heal (Sea Salt row present).
    expect(healSeaSaltComponents("Aldo Pizza Sauce", first!, SEA_SALT_SAUCE_TARGETS, lbsOf)).toBeNull();
  });

  it("skips recipes that already have a Sea Salt row (no duplicate minting)", () => {
    expect(
      healSeaSaltComponents<{ ingredient: string; lbs: number }>(
        "Malted Barley Dough",
        [
          { ingredient: "Sea Salt", lbs: 1 },
          { ingredient: "Salt", lbs: 1 },
        ],
        SEA_SALT_DOUGH_TARGETS,
        lbsOf,
      ),
    ).toBeNull();
  });
});
