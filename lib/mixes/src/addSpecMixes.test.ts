import { describe, it, expect } from "vitest";
import { addSpecMixesIfAbsent, normalizeMix, type Mix } from "./index";

function mix(name: string, extra: Partial<Mix> = {}): Mix {
  return normalizeMix({
    id: extra.id ?? name.toLowerCase(),
    name,
    brand: extra.brand ?? "",
    flavor: extra.flavor ?? "",
    batchSize: extra.batchSize ?? 0,
    daysEarly: extra.daysEarly ?? 0,
    amountAlreadyMade: extra.amountAlreadyMade ?? 0,
    components: extra.components ?? [],
    enabled: extra.enabled ?? true,
  })!;
}

describe("addSpecMixesIfAbsent", () => {
  it("adds mixes whose names are not already present", () => {
    const existing = [mix("White Fajita Mix")];
    const candidates = [mix("Buffalo Mix", { id: "buffalo-mix" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(1);
    expect(merged.map((m) => m.name)).toEqual(["White Fajita Mix", "Buffalo Mix"]);
  });

  it("skips a candidate whose name already exists (case-insensitive) and never clobbers it", () => {
    const existing = [mix("White Fajita Mix", { batchSize: 40, id: "kept" })];
    const candidates = [mix("white fajita mix", { batchSize: 0, id: "incoming" })];
    const { merged, added } = addSpecMixesIfAbsent(existing, candidates);
    expect(added).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kept");
    expect(merged[0].batchSize).toBe(40);
  });

  it("de-dupes candidates against each other by name", () => {
    const candidates = [
      mix("Buffalo Mix", { id: "a" }),
      mix("buffalo mix", { id: "b" }),
    ];
    const { merged, added } = addSpecMixesIfAbsent([], candidates);
    expect(added).toBe(1);
    expect(merged).toHaveLength(1);
  });

  it("ignores blank-named candidates", () => {
    const blank: Mix = {
      id: "blank",
      name: "   ",
      brand: "",
      flavor: "",
      batchSize: 0,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [],
      enabled: true,
    };
    const { merged, added } = addSpecMixesIfAbsent([], [blank]);
    expect(added).toBe(0);
    expect(merged).toHaveLength(0);
  });
});
