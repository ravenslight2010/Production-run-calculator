import { describe, it, expect } from "vitest";
import {
  ALLERGENS,
  DEFAULT_ALLERGEN,
  allergenLabel,
  allergenMeta,
  allergenSequenceWarnings,
  allergenTransitionWarning,
  isAllergen,
  normalizeAllergen,
  type AllergenSequenceItem,
} from "@workspace/allergen";

describe("normalizeAllergen", () => {
  it("passes through the known values", () => {
    expect(normalizeAllergen("none")).toBe("none");
    expect(normalizeAllergen("egg")).toBe("egg");
    expect(normalizeAllergen("soy")).toBe("soy");
  });
  it("is case/space tolerant", () => {
    expect(normalizeAllergen(" Egg ")).toBe("egg");
    expect(normalizeAllergen("SOY")).toBe("soy");
  });
  it("fails safe to none for junk/missing", () => {
    expect(normalizeAllergen(undefined)).toBe("none");
    expect(normalizeAllergen("")).toBe("none");
    expect(normalizeAllergen("peanut")).toBe("none");
    expect(normalizeAllergen(42)).toBe("none");
    expect(normalizeAllergen(null)).toBe("none");
  });
  it("DEFAULT_ALLERGEN is none", () => {
    expect(DEFAULT_ALLERGEN).toBe("none");
  });
});

describe("metadata", () => {
  it("egg is yellow, soy is red, none is neutral", () => {
    expect(allergenMeta("egg").color).toBe("#eab308");
    expect(allergenMeta("soy").color).toBe("#dc2626");
    expect(allergenMeta("none").color).toBe("#94a3b8");
  });
  it("isAllergen flags egg/soy but not none", () => {
    expect(isAllergen("egg")).toBe(true);
    expect(isAllergen("soy")).toBe(true);
    expect(isAllergen("none")).toBe(false);
  });
  it("labels are human readable", () => {
    expect(allergenLabel("none")).toBe("None");
    expect(allergenLabel("egg")).toBe("Egg");
    expect(allergenLabel("soy")).toBe("Soy");
  });
  it("ALLERGENS lists none first then egg, soy", () => {
    expect(ALLERGENS.map((a) => a.value)).toEqual(["none", "egg", "soy"]);
  });
});

describe("allergenTransitionWarning", () => {
  it("safe transitions return null", () => {
    expect(allergenTransitionWarning("none", "none")).toBeNull();
    expect(allergenTransitionWarning("none", "egg")).toBeNull(); // recommended order
    expect(allergenTransitionWarning("none", "soy")).toBeNull();
    expect(allergenTransitionWarning("egg", "egg")).toBeNull(); // same allergen
    expect(allergenTransitionWarning("soy", "soy")).toBeNull();
  });
  it("allergen -> different allergen warns to clean", () => {
    const w = allergenTransitionWarning("egg", "soy");
    expect(w?.kind).toBe("clean");
    expect(w?.message).toMatch(/clean the line/i);
    expect(allergenTransitionWarning("soy", "egg")?.kind).toBe("clean");
  });
  it("allergen -> none warns to clean and is not advisable", () => {
    const w = allergenTransitionWarning("soy", "none");
    expect(w?.kind).toBe("clean-not-advisable");
    expect(w?.message).toMatch(/not advisable/i);
    expect(w?.message).toMatch(/clean the line/i);
    expect(allergenTransitionWarning("egg", "none")?.kind).toBe("clean-not-advisable");
  });
});

describe("allergenSequenceWarnings", () => {
  const item = (id: string, allergen: AllergenSequenceItem["allergen"]): AllergenSequenceItem => ({
    id,
    label: `Run ${id}`,
    allergen,
  });

  it("none for an empty or single-run day", () => {
    expect(allergenSequenceWarnings([])).toEqual([]);
    expect(allergenSequenceWarnings([item("1", "egg")])).toEqual([]);
  });

  it("recommended order (none -> allergen at end) is clean", () => {
    const out = allergenSequenceWarnings([item("1", "none"), item("2", "egg"), item("3", "egg")]);
    expect(out).toEqual([]);
  });

  it("flags each risky consecutive transition with from/to identity", () => {
    const out = allergenSequenceWarnings([
      item("1", "none"),
      item("2", "egg"),
      item("3", "soy"), // egg -> soy: clean
      item("4", "none"), // soy -> none: clean-not-advisable
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ fromId: "2", toId: "3", kind: "clean" });
    expect(out[1]).toMatchObject({ fromId: "3", toId: "4", kind: "clean-not-advisable" });
  });
});
