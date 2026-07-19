// Stale recipe references on the merge screen (all four recipe-name tabs):
// collectStaleRecipeLinkNames finds names referenced by values objects (runs,
// profiles, templates, history) that match NO server pool name, per category's
// link fields; buildStaleCleanupSuggestions proposes the closest REAL pool
// recipe (ambiguity-guarded, extra-word tolerant) to PRE-FILL the merge form —
// suggestions are never auto-applied.
import { describe, it, expect } from "vitest";
import {
  RECIPE_NAME_FIELDS_BY_CATEGORY,
  collectStaleRecipeLinkNames,
  buildStaleCleanupSuggestions,
} from "./mergeRecipeNames";

const ci = (names: string[]) => new Set(names.map((n) => n.trim().toLowerCase()));

describe("collectStaleRecipeLinkNames", () => {
  it("scans dough's selection field only", () => {
    const stale = collectStaleRecipeLinkNames(
      [
        { doughRecipeName: "Old House Dough", frontlineRecipeName: "Ghost Sauce" },
        { doughRecipeName: "Thin Crust Dough" }, // in pool → excluded
      ],
      ci(["Thin Crust Dough"]),
      RECIPE_NAME_FIELDS_BY_CATEGORY.dough,
    );
    expect(stale).toEqual(["Old House Dough"]);
  });

  it("scans sauce's selection field only", () => {
    const stale = collectStaleRecipeLinkNames(
      [{ frontlineRecipeName: "Legacy Frontline", doughRecipeName: "Old House Dough" }],
      ci(["Classic Frontline"]),
      RECIPE_NAME_FIELDS_BY_CATEGORY.sauce,
    );
    expect(stale).toEqual(["Legacy Frontline"]);
  });

  it("scans all four applicator link slots for cheese/mixes, deduped ci, sorted", () => {
    const objects = [
      { app1CheeseRecipeName: "Zeta Blend", app2CheeseRecipeName: "old mix" },
      { app3CheeseRecipeName: "Old Mix", app4CheeseRecipeName: "" },
      { app1CheeseRecipeName: "Real Cheese Mix" }, // in pool → excluded
    ];
    for (const cat of ["cheese", "mixes"] as const) {
      const stale = collectStaleRecipeLinkNames(
        objects,
        ci(["Real Cheese Mix"]),
        RECIPE_NAME_FIELDS_BY_CATEGORY[cat],
      );
      // First-seen spelling kept ("old mix" seen before "Old Mix"), sorted.
      expect(stale).toEqual(["old mix", "Zeta Blend"]);
    }
  });

  it("ignores blanks and non-string values", () => {
    const stale = collectStaleRecipeLinkNames(
      [{ doughRecipeName: "  " }, { doughRecipeName: undefined }, {}],
      ci([]),
      RECIPE_NAME_FIELDS_BY_CATEGORY.dough,
    );
    expect(stale).toEqual([]);
  });
});

describe("buildStaleCleanupSuggestions", () => {
  it("suggests the near-duplicate pool recipe (typo + word order)", () => {
    const out = buildStaleCleanupSuggestions(
      ["Aldos Standard Cheese Mix", "Mix Cheese Standard HT"],
      ["Aldo's Standard Cheese Mix", "HT Standard Cheese Mix", "Four Hands Gyro Blend"],
    );
    expect(out).toEqual([
      { name: "Aldos Standard Cheese Mix", suggestion: "Aldo's Standard Cheese Mix" },
      { name: "Mix Cheese Standard HT", suggestion: "HT Standard Cheese Mix" },
    ]);
  });

  it("tolerates one extra word (safe: user-confirmed before apply)", () => {
    const out = buildStaleCleanupSuggestions(
      ["Old HT Standard Cheese Mix"],
      ["HT Standard Cheese Mix", "Four Hands Gyro Blend"],
    );
    expect(out[0].suggestion).toBe("HT Standard Cheese Mix");
  });

  it("returns null when no close match or when the match is ambiguous", () => {
    const none = buildStaleCleanupSuggestions(["Totally Unrelated"], ["HT Standard Cheese Mix"]);
    expect(none[0].suggestion).toBeNull();
    // Two single-typo candidates → ambiguity guard refuses to pick.
    const ambiguous = buildStaleCleanupSuggestions(["Chese Mix"], ["Cheese Mix", "Chase Mix"]);
    expect(ambiguous[0].suggestion).toBeNull();
  });

  it("never suggests for an empty pool", () => {
    const out = buildStaleCleanupSuggestions(["Old Name"], []);
    expect(out).toEqual([{ name: "Old Name", suggestion: null }]);
  });
});
