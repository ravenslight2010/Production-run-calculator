// Tests for the shared mix-list browsing helpers (@workspace/mixes) used by
// the redesigned Mixes settings list on BOTH web and mobile: search matching
// and brand grouping. Pure logic — no UI.
import { describe, it, expect } from "vitest";
import {
  mixMatchesQuery,
  groupMixesByBrand,
  type Mix,
} from "@workspace/mixes";

function mk(p: Partial<Mix>): Mix {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    name: p.name ?? "",
    brand: p.brand ?? "",
    flavor: p.flavor ?? "",
    batchSize: p.batchSize ?? 0,
    daysEarly: p.daysEarly ?? 0,
    notes: p.notes ?? "",
    amountAlreadyMade: p.amountAlreadyMade ?? 0,
    components: p.components ?? [],
    enabled: p.enabled ?? true,
  };
}

describe("mixMatchesQuery", () => {
  const mix = mk({ name: "Veggie Blend", brand: "TopShelf", flavor: "Supreme" });

  it("matches case-insensitively on name, brand, and flavor", () => {
    expect(mixMatchesQuery(mix, "veggie")).toBe(true);
    expect(mixMatchesQuery(mix, "TOPSHELF")).toBe(true);
    expect(mixMatchesQuery(mix, "supr")).toBe(true);
    expect(mixMatchesQuery(mix, "pepperoni")).toBe(false);
  });

  it("empty / whitespace query matches everything", () => {
    expect(mixMatchesQuery(mix, "")).toBe(true);
    expect(mixMatchesQuery(mix, "   ")).toBe(true);
  });
});

describe("groupMixesByBrand", () => {
  it("groups case-insensitively, sorts brands alphabetically, no-brand last", () => {
    const groups = groupMixesByBrand([
      mk({ name: "Z Mix", brand: "zeta" }),
      mk({ name: "Loose Mix", brand: "" }),
      mk({ name: "A Mix", brand: "Alpha" }),
      mk({ name: "B Mix", brand: "ALPHA" }),
    ]);
    expect(groups.map((g) => g.brand)).toEqual(["Alpha", "zeta", ""]);
    expect(groups[0].mixes.map((m) => m.name)).toEqual(["A Mix", "B Mix"]);
  });

  it("sorts mixes inside a group by name, case-insensitively", () => {
    const groups = groupMixesByBrand([
      mk({ name: "banana", brand: "X" }),
      mk({ name: "Apple", brand: "X" }),
      mk({ name: "cherry", brand: "X" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].mixes.map((m) => m.name)).toEqual([
      "Apple",
      "banana",
      "cherry",
    ]);
  });

  it("trims brand whitespace when grouping", () => {
    const groups = groupMixesByBrand([
      mk({ name: "One", brand: " Acme " }),
      mk({ name: "Two", brand: "Acme" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].brand).toBe("Acme");
    expect(groups[0].mixes).toHaveLength(2);
  });

  it("returns empty array for no mixes", () => {
    expect(groupMixesByBrand([])).toEqual([]);
  });
});
