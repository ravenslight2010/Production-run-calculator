// @vitest-environment node
//
// Unit tests for the shared "fill in missing data" detection/proposal logic.
// Web and mobile both consume this logic from the @workspace/fill-missing lib
// (one source of truth, replit.md web<->mobile parity rule), so the lib is
// imported directly here — there is no longer a second copy to load through a
// strip-imports -> transpile pipeline.

import { describe, it, expect } from "vitest";
import * as fm from "@workspace/fill-missing";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const keysOf = (rec: Record<string, unknown>) =>
  fm.detectMissingFields(rec).map((f) => f.spec.key);

// A deterministic KnownLookup exercising every source-priority branch.
function lookup(key: string): {
  learned?: string | number;
  profile?: string | number;
  spec?: string | number;
} {
  switch (key) {
    case "casesNeeded":
      return { learned: 600, profile: 500 }; // learned beats profile
    case "cycleSpeed":
      return { spec: 9.1 }; // no learned/profile -> spec
    case "shipper":
      return { profile: "12in", spec: "costco" }; // profile beats spec
    case "sauceOzPerPizza":
      return { profile: 0 }; // blank profile is ignored -> falls to default
    default:
      return {}; // -> documentedDefault when present, else none
  }
}

// ── detectMissingFields ──────────────────────────────────────────────────────

describe("detectMissingFields", () => {
  it("flags every non-slot-gated field on a fully blank run", () => {
    const keys = keysOf({});
    expect(keys).toEqual([
      "brand",
      "flavor",
      "dieType",
      "casesNeeded",
      "crustsPerCycle",
      "cycleSpeed",
      "speedAdjustment",
      "freezerTime",
      "pizzasPerCase",
      "casesPerSkid",
      "casesPerLayer",
      "cartonsPerCase",
      "shipper",
      "skidStacking",
      "doughballsPerTray",
      "doughBatchYield",
      "sauceOzPerPizza",
      "sauceBarrelLbs",
    ]);
    // Applicator / pepperoni slots are not in use, so none are flagged.
    expect(keys.some((k) => /^app\d/.test(k) || /^pep\d/.test(k))).toBe(false);
    // Default supply mode is dough, so crust-mode fields are not flagged.
    expect(keys).not.toContain("crustsPerStack");
    expect(keys).not.toContain("crustsPerCase");
  });

  it("skips fields that already hold a value", () => {
    const keys = keysOf({ brand: "Lucia's", casesNeeded: 384, sauceOzPerPizza: 4 });
    expect(keys).not.toContain("brand");
    expect(keys).not.toContain("casesNeeded");
    expect(keys).not.toContain("sauceOzPerPizza");
    expect(keys).toContain("flavor");
  });

  it("treats whitespace text and non-positive numbers as blank", () => {
    const keys = keysOf({ brand: "   ", casesNeeded: 0, cycleSpeed: -3 });
    expect(keys).toContain("brand");
    expect(keys).toContain("casesNeeded");
    expect(keys).toContain("cycleSpeed");
  });

  describe("slot gating", () => {
    it("flags an applicator slot only when it is in use (type set)", () => {
      const keys = keysOf({ app1Type: "Mozzarella" });
      expect(keys).toContain("app1OzPerPizza");
      expect(keys).toContain("app1BatchLbs");
      expect(keys).not.toContain("app1Type"); // already set
      // Other applicator slots stay off.
      expect(keys.some((k) => /^app[234]/.test(k))).toBe(false);
    });

    it("activates an applicator slot via oz/pizza or a cheese recipe", () => {
      expect(keysOf({ app2OzPerPizza: 3 })).toContain("app2Type");
      expect(keysOf({ app3CheeseRecipe: [{ x: 1 }] })).toContain("app3Type");
    });

    it("flags a pepperoni slot only when it is in use (sticks > 0)", () => {
      const keys = keysOf({ pep2Sticks: 10 });
      expect(keys).toContain("pep2Type");
      expect(keys).toContain("pep2OzPerPizza");
      expect(keys).toContain("pep2BatchLbs");
      expect(keys.some((k) => /^pep1/.test(k))).toBe(false);
    });

    it("gates cartonsPerCase on the cartoned flag", () => {
      expect(keysOf({})).toContain("cartonsPerCase");
      expect(keysOf({ cartoned: "no" })).not.toContain("cartonsPerCase");
      expect(keysOf({ cartoned: "yes" })).toContain("cartonsPerCase");
    });
  });

  describe("dough-supply mode gating (subTab)", () => {
    it("dough mode (default) flags dough fields, never crust fields", () => {
      for (const rec of [{}, { subTab: "dough" }]) {
        const keys = keysOf(rec);
        expect(keys).toContain("doughballsPerTray");
        expect(keys).toContain("doughBatchYield");
        expect(keys).not.toContain("crustsPerStack");
        expect(keys).not.toContain("crustsPerCase");
      }
    });

    it("crust mode flags crust fields, never dough fields", () => {
      const keys = keysOf({ subTab: "crusts" });
      expect(keys).toContain("crustsPerStack");
      expect(keys).toContain("crustsPerCase");
      expect(keys).not.toContain("doughballsPerTray");
      expect(keys).not.toContain("doughBatchYield");
    });
  });

  describe("sauceBarrelLbs derived from sauce recipe", () => {
    it("skips sauceBarrelLbs when frontlineRecipe rows have lbs > 0", () => {
      const keys = keysOf({
        frontlineRecipe: [{ ingredient: "Tomatoes", lbs: 450 }],
      });
      expect(keys).not.toContain("sauceBarrelLbs");
    });

    it("still flags sauceBarrelLbs when frontlineRecipe is absent", () => {
      expect(keysOf({})).toContain("sauceBarrelLbs");
    });

    it("still flags sauceBarrelLbs when frontlineRecipe rows all have lbs 0", () => {
      const keys = keysOf({
        frontlineRecipe: [{ ingredient: "Tomatoes", lbs: 0 }],
      });
      expect(keys).toContain("sauceBarrelLbs");
    });

    it("still flags sauceBarrelLbs when frontlineRecipe is an empty array", () => {
      expect(keysOf({ frontlineRecipe: [] })).toContain("sauceBarrelLbs");
    });
  });

  describe("app${n}BatchLbs derived from cheese/topping recipe", () => {
    it("skips app1BatchLbs when app1CheeseRecipe rows have lbs > 0", () => {
      const keys = keysOf({
        app1Type: "Mozzarella",
        app1CheeseRecipe: [{ ingredient: "Whole Milk Mozzarella", lbs: 30 }],
      });
      expect(keys).not.toContain("app1BatchLbs");
      // Other fields on the active slot still appear.
      expect(keys).toContain("app1OzPerPizza");
    });

    it("skips app3BatchLbs when app3CheeseRecipe rows have lbs > 0", () => {
      const keys = keysOf({
        app3Type: "Cheese Blend",
        app3CheeseRecipe: [{ ingredient: "Blend", lbs: 45 }],
      });
      expect(keys).not.toContain("app3BatchLbs");
    });

    it("still flags app1BatchLbs when the recipe is absent", () => {
      const keys = keysOf({ app1Type: "Mozzarella" });
      expect(keys).toContain("app1BatchLbs");
    });

    it("still flags app1BatchLbs when the recipe has all-zero lbs", () => {
      const keys = keysOf({
        app1Type: "Mozzarella",
        app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 0 }],
      });
      expect(keys).toContain("app1BatchLbs");
    });

    it("does not suppress app2BatchLbs when only app1 has a recipe", () => {
      const keys = keysOf({
        app1Type: "Mozz",
        app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 30 }],
        app2Type: "Provolone",
      });
      expect(keys).not.toContain("app1BatchLbs"); // recipe-derived → skipped
      expect(keys).toContain("app2BatchLbs");     // no recipe on slot 2 → still flagged
    });
  });

  describe("doughBatchYield derived from a selected recipe", () => {
    it("skips doughBatchYield when a recipe with lbs AND a doughball weight are set (web key)", () => {
      const keys = keysOf({
        doughRecipe: [{ ingredient: "Flour", lbs: 500 }],
        targetDoughballWeight: 16,
      });
      expect(keys).not.toContain("doughBatchYield");
    });

    it("skips doughBatchYield with the mobile weight key too", () => {
      const keys = keysOf({
        doughRecipe: [{ ingredient: "Flour", lbs: 500 }],
        doughballWeightOz: 16,
      });
      expect(keys).not.toContain("doughBatchYield");
    });

    it("still flags doughBatchYield when the recipe or the weight is missing", () => {
      expect(keysOf({ doughRecipe: [{ ingredient: "Flour", lbs: 500 }] })).toContain(
        "doughBatchYield",
      );
      expect(keysOf({ targetDoughballWeight: 16 })).toContain("doughBatchYield");
      expect(
        keysOf({ doughRecipe: [{ ingredient: "Flour", lbs: 0 }], targetDoughballWeight: 16 }),
      ).toContain("doughBatchYield");
    });
  });

  describe("sauceBarrelLbs derived from a frontline recipe", () => {
    it("skips sauceBarrelLbs when the frontline recipe has rows with lbs > 0", () => {
      const keys = keysOf({
        frontlineRecipe: [{ ingredient: "Tomato Sauce", lbs: 450 }],
      });
      expect(keys).not.toContain("sauceBarrelLbs");
    });

    it("still flags sauceBarrelLbs when the frontline recipe is absent", () => {
      expect(keysOf({})).toContain("sauceBarrelLbs");
    });

    it("still flags sauceBarrelLbs when the frontline recipe has no lbs (all zero)", () => {
      expect(
        keysOf({ frontlineRecipe: [{ ingredient: "Tomato Sauce", lbs: 0 }] }),
      ).toContain("sauceBarrelLbs");
    });

    it("still flags sauceBarrelLbs when the frontline recipe array is empty", () => {
      expect(keysOf({ frontlineRecipe: [] })).toContain("sauceBarrelLbs");
    });
  });

  describe("appNBatchLbs derived from a cheese recipe", () => {
    it("skips app1BatchLbs when app1CheeseRecipe has rows with lbs > 0", () => {
      const keys = keysOf({
        app1Type: "Mozzarella",
        app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 30 }],
      });
      expect(keys).not.toContain("app1BatchLbs");
      // Other slot fields are still flagged normally.
      expect(keys).toContain("app1OzPerPizza");
    });

    it("still flags app1BatchLbs when the cheese recipe is absent", () => {
      const keys = keysOf({ app1Type: "Mozzarella" });
      expect(keys).toContain("app1BatchLbs");
    });

    it("still flags app1BatchLbs when the cheese recipe has no lbs (all zero)", () => {
      const keys = keysOf({
        app1Type: "Mozzarella",
        app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 0 }],
      });
      expect(keys).toContain("app1BatchLbs");
    });

    it("skips only the affected slot's batch lbs; other slots are unaffected", () => {
      const keys = keysOf({
        app1Type: "Mozzarella",
        app1CheeseRecipe: [{ ingredient: "Mozz", lbs: 30 }],
        app2Type: "Provolone",
      });
      expect(keys).not.toContain("app1BatchLbs");
      expect(keys).toContain("app2BatchLbs");
    });

    it("applies the guard for all four slots independently", () => {
      for (const n of [1, 2, 3, 4]) {
        const keys = keysOf({
          [`app${n}Type`]: "Cheese",
          [`app${n}CheeseRecipe`]: [{ ingredient: "Cheese", lbs: 40 }],
        });
        expect(keys).not.toContain(`app${n}BatchLbs`);
      }
    });
  });
});

// ── buildProposals (source priority) ─────────────────────────────────────────

describe("buildProposals", () => {
  const proposalsFor = (rec: Record<string, unknown>) => {
    const props = fm.buildProposals(fm.detectMissingFields(rec), lookup);
    return new Map(props.map((p) => [p.key, p]));
  };

  it("resolves sources in the order learned -> profile -> spec -> default -> none", () => {
    const byKey = proposalsFor({});
    // learned outranks profile when both are present.
    expect(byKey.get("casesNeeded")).toMatchObject({ source: "learned", value: 600 });
    expect(byKey.get("cycleSpeed")).toMatchObject({ source: "spec", value: 9.1 });
    expect(byKey.get("shipper")).toMatchObject({ source: "profile", value: "12in" });
    // documentedDefault used when no known source.
    expect(byKey.get("freezerTime")).toMatchObject({
      source: "default",
      value: fm.DOCUMENTED_DEFAULTS.freezerTime,
    });
    // No source at all -> value null.
    expect(byKey.get("dieType")).toMatchObject({ source: "none", value: null });
  });

  it("ignores a blank known value and falls through to the default", () => {
    const byKey = proposalsFor({});
    expect(byKey.get("sauceOzPerPizza")).toMatchObject({
      source: "default",
      value: fm.DOCUMENTED_DEFAULTS.sauceOzPerPizza,
    });
  });
});

// ── aiCandidates ─────────────────────────────────────────────────────────────

describe("aiCandidates", () => {
  it("returns only fillable, AI-eligible fields with no known source", () => {
    const proposals = fm.buildProposals(fm.detectMissingFields({}), lookup);
    const keys = fm.aiCandidates(proposals).map((p) => p.key);
    // dieType + skidStacking have no source and are AI-eligible & fillable.
    expect(keys).toEqual(["dieType", "skidStacking"]);
    // brand/flavor are "none" too but not fillable -> excluded.
    expect(keys).not.toContain("brand");
    expect(keys).not.toContain("flavor");
    // shipper had a profile source -> excluded.
    expect(keys).not.toContain("shipper");
  });

  it("excludes slot AI-eligible fields that resolve to a default", () => {
    // app1BatchLbs has a documentedDefault, so it never reaches "none".
    const proposals = fm.buildProposals(
      fm.detectMissingFields({ app1Type: "Mozz" }),
      lookup,
    );
    const keys = fm.aiCandidates(proposals).map((p) => p.key);
    expect(keys).toContain("app1OzPerPizza"); // no default -> none -> AI
    expect(keys).not.toContain("app1BatchLbs"); // default -> not AI
  });
});

// ── buildFillMissingInput ────────────────────────────────────────────────────

describe("buildFillMissingInput", () => {
  it("packs identity, known context, and requested fields", () => {
    const candidates = fm.aiCandidates(
      fm.buildProposals(fm.detectMissingFields({}), lookup),
    );
    const input = fm.buildFillMissingInput("Lucia's", "PEPPERONI", "12in", candidates, {
      pizzasPerCase: 12,
      brand: "Lucia's",
    });
    expect(input.brand).toBe("Lucia's");
    expect(input.flavor).toBe("PEPPERONI");
    expect(input.dieType).toBe("12in");
    // brand/flavor are never echoed back as context.
    expect(input.context?.some((c) => c.key === "brand" || c.key === "flavor")).toBe(false);
    expect(input.context).toContainEqual({ key: "pizzasPerCase", label: "Pizzas / Case", value: "12" });
    expect(input.fields.map((f) => f.key)).toEqual(["dieType", "skidStacking"]);
  });
});

// ── pickLearnedForProduct ────────────────────────────────────────────────────

describe("pickLearnedForProduct", () => {
  const rows = [
    { brand: "Lucia's", flavor: "Pepperoni", fieldKey: "casesNeeded", value: "600" },
    { brand: "Lucia's", flavor: "Pepperoni", fieldKey: "dieType", value: "12in" },
    { brand: "Other", flavor: "Cheese", fieldKey: "casesNeeded", value: "999" },
  ];

  it("returns only the fields for the matching brand+flavor", () => {
    const got = fm.pickLearnedForProduct(rows, "Lucia's", "Pepperoni");
    expect(got).toEqual({ casesNeeded: "600", dieType: "12in" });
  });

  it("matches brand+flavor case-insensitively and trims", () => {
    const got = fm.pickLearnedForProduct(rows, "  lucia's ", "PEPPERONI");
    expect(got).toEqual({ casesNeeded: "600", dieType: "12in" });
  });

  it("returns an empty map when nothing matches", () => {
    expect(fm.pickLearnedForProduct(rows, "Nope", "Pepperoni")).toEqual({});
    expect(fm.pickLearnedForProduct([], "Lucia's", "Pepperoni")).toEqual({});
  });
});

// ── isBlankValue ─────────────────────────────────────────────────────────────

describe("isBlankValue", () => {
  it("treats non-positive numbers and empty/whitespace text as blank", () => {
    expect(fm.isBlankValue("number", 0)).toBe(true);
    expect(fm.isBlankValue("number", -1)).toBe(true);
    expect(fm.isBlankValue("number", "0")).toBe(true);
    expect(fm.isBlankValue("number", 5)).toBe(false);
    expect(fm.isBlankValue("text", "")).toBe(true);
    expect(fm.isBlankValue("text", "   ")).toBe(true);
    expect(fm.isBlankValue("text", "x")).toBe(false);
  });
});
