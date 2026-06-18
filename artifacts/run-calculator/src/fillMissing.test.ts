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
function lookup(key: string): { profile?: string | number; spec?: string | number } {
  switch (key) {
    case "casesNeeded":
      return { profile: 500 }; // profile wins
    case "cycleSpeed":
      return { spec: 9.1 }; // no profile -> spec
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
      "crustsPerStack",
      "doughBatchYield",
      "crustsPerCase",
      "sauceOzPerPizza",
      "sauceBarrelLbs",
    ]);
    // Applicator / pepperoni slots are not in use, so none are flagged.
    expect(keys.some((k) => /^app\d/.test(k) || /^pep\d/.test(k))).toBe(false);
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
});

// ── buildProposals (source priority) ─────────────────────────────────────────

describe("buildProposals", () => {
  const proposalsFor = (rec: Record<string, unknown>) => {
    const props = fm.buildProposals(fm.detectMissingFields(rec), lookup);
    return new Map(props.map((p) => [p.key, p]));
  };

  it("resolves sources in the order profile -> spec -> default -> none", () => {
    const byKey = proposalsFor({});
    expect(byKey.get("casesNeeded")).toMatchObject({ source: "profile", value: 500 });
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
