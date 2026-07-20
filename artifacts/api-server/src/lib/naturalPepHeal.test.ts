// Unit guards for the Lowe's bare-"NATURAL" pep-type heal helpers: the AI
// parse reduced "Pepperoni Stick - NATURAL (Hormel - 24878)" to a bare
// qualifier and it spread into profiles + synced pep-type lists. The heal
// must fold every observed variant onto the canonical name without touching
// legitimate "Natural X" product names (e.g. "Natural Bacon").
import { describe, it, expect } from "vitest";
import { healNaturalPepInValues, healNaturalPepList } from "./dataHeals";

describe("healNaturalPepInValues", () => {
  it("renames bare NATURAL variants on all four pep slots", () => {
    const values: Record<string, unknown> = {
      pep1Type: "Natural",
      pep2Type: "NATURAL",
      pep1TypeB: "NATURAL (Hormel - 24878)",
      pep2TypeB: "natural",
    };
    expect(healNaturalPepInValues(values)).toBe(true);
    expect(values.pep1Type).toBe("Pepperoni Stick - NATURAL");
    expect(values.pep2Type).toBe("Pepperoni Stick - NATURAL");
    expect(values.pep1TypeB).toBe("Pepperoni Stick - NATURAL");
    expect(values.pep2TypeB).toBe("Pepperoni Stick - NATURAL");
  });

  it("leaves real product names and other fields alone", () => {
    const values: Record<string, unknown> = {
      pep1Type: "Pepperoni Stick",
      pep2Type: "Natural Bacon",
      app1Type: "Natural",
    };
    expect(healNaturalPepInValues(values)).toBe(false);
    expect(values.pep2Type).toBe("Natural Bacon");
    expect(values.app1Type).toBe("Natural");
  });
});

describe("healNaturalPepList", () => {
  it("renames and dedupes the observed poisoned list", () => {
    const healed = healNaturalPepList([
      "Mozzarella Stick",
      "Natural",
      "NATURAL",
      "NATURAL (Hormel - 24878)",
      "Pepperoni Stick",
    ]);
    expect(healed).toEqual([
      "Mozzarella Stick",
      "Pepperoni Stick - NATURAL",
      "Pepperoni Stick",
    ]);
  });

  it("returns null when nothing changes", () => {
    expect(
      healNaturalPepList(["Pepperoni Stick", "Pepperoni Stick - NATURAL"]),
    ).toBeNull();
    expect(healNaturalPepList(undefined)).toBeNull();
  });

  it("keeps genuine Natural-prefixed names", () => {
    expect(healNaturalPepList(["Natural Bacon"])).toBeNull();
  });
});
