import { describe, it, expect } from "vitest";
import {
  mirrorSingleCheeseAcrossApplicators,
  type CheeseApplicatorSlot,
} from "./index";

const slot = (
  type: string,
  cheeseRecipeName = "",
  cheeseRecipe: { ingredient: string; lbs: number }[] = [],
): CheeseApplicatorSlot => ({ type, cheeseRecipeName, cheeseRecipe });

describe("mirrorSingleCheeseAcrossApplicators", () => {
  it("fills a blank cheese applicator from the only cheese blend present", () => {
    const rows = [{ ingredient: "Whole Mozz", lbs: 40 }];
    const out = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese", "Aldo's Standard Cheese Mix", rows),
      slot("Cheese"),
    ]);
    expect(out[0].cheeseRecipeName).toBe("Aldo's Standard Cheese Mix");
    expect(out[1].cheeseRecipeName).toBe("Aldo's Standard Cheese Mix");
    expect(out[1].cheeseRecipe).toEqual(rows);
    // Copied rows are a fresh array (not shared with the source slot).
    expect(out[1].cheeseRecipe).not.toBe(rows);
  });

  it("fills whichever cheese slot is blank regardless of order", () => {
    const rows = [{ ingredient: "Whole Mozz", lbs: 40 }];
    const out = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese"),
      slot("Cheese", "Aldo's Cheese Mix", rows),
    ]);
    expect(out[0].cheeseRecipeName).toBe("Aldo's Cheese Mix");
    expect(out[1].cheeseRecipeName).toBe("Aldo's Cheese Mix");
  });

  it("fills every blank cheese slot when three cheese applicators share one blend", () => {
    const out = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese", "Blend A", [{ ingredient: "Mozz", lbs: 30 }]),
      slot("Cheese"),
      slot("Cheese"),
    ]);
    expect(out.map((s) => s.cheeseRecipeName)).toEqual(["Blend A", "Blend A", "Blend A"]);
  });

  it("leaves a blank cheese applicator alone when two DISTINCT blends are present", () => {
    const out = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese", "Blend A", [{ ingredient: "Mozz", lbs: 30 }]),
      slot("Cheese", "Blend B", [{ ingredient: "Provolone", lbs: 10 }]),
      slot("Cheese"),
    ]);
    expect(out[2].cheeseRecipeName).toBe("");
    // Same-name variants only differ by case → still one distinct blend.
    const out2 = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese", "Blend A", [{ ingredient: "Mozz", lbs: 30 }]),
      slot("Cheese", "blend a", [{ ingredient: "Mozz", lbs: 30 }]),
      slot("Cheese"),
    ]);
    expect(out2[2].cheeseRecipeName).toBe("Blend A");
  });

  it("never touches non-cheese applicator slots", () => {
    const out = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese", "Blend A", [{ ingredient: "Mozz", lbs: 30 }]),
      slot("Sauce"),
      slot("Garlic"),
    ]);
    expect(out[1].cheeseRecipeName).toBe("");
    expect(out[2].cheeseRecipeName).toBe("");
  });

  it("is a no-op (returns the same array) when nothing needs filling", () => {
    const already = [
      slot("Cheese", "Blend A", [{ ingredient: "Mozz", lbs: 30 }]),
      slot("Cheese", "Blend A", [{ ingredient: "Mozz", lbs: 30 }]),
    ];
    expect(mirrorSingleCheeseAcrossApplicators(already)).toBe(already);

    const noCheese = [slot("Sauce"), slot("Garlic")];
    expect(mirrorSingleCheeseAcrossApplicators(noCheese)).toBe(noCheese);

    const singleFilled = [slot("Cheese", "Blend A", [{ ingredient: "Mozz", lbs: 30 }])];
    expect(mirrorSingleCheeseAcrossApplicators(singleFilled)).toBe(singleFilled);
  });

  it("treats a whitespace-only recipe name as blank and fillable", () => {
    const out = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese", "Blend A", [{ ingredient: "Mozz", lbs: 30 }]),
      slot("Cheese", "   "),
    ]);
    expect(out[1].cheeseRecipeName).toBe("Blend A");
  });

  it("does NOT mirror a named-but-empty blend (malformed import stays contained)", () => {
    const out = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese", "Blend A", []),
      slot("Cheese"),
    ]);
    expect(out[1].cheeseRecipeName).toBe("");
    // A blend whose only row has a blank ingredient is not a valid source either.
    const out2 = mirrorSingleCheeseAcrossApplicators([
      slot("Cheese", "Blend A", [{ ingredient: "   ", lbs: 30 }]),
      slot("Cheese"),
    ]);
    expect(out2[1].cheeseRecipeName).toBe("");
  });

  it("matches cheese type case-insensitively with surrounding space", () => {
    const out = mirrorSingleCheeseAcrossApplicators([
      slot(" CHEESE ", "Blend A", [{ ingredient: "Mozz", lbs: 30 }]),
      slot("cheese"),
    ]);
    expect(out[1].cheeseRecipeName).toBe("Blend A");
  });
});
