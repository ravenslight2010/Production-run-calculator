import { describe, expect, it } from "vitest";
import { backfillMixFromMergedSources, type Mix } from "./index";

function mix(over: Partial<Mix>): Mix {
  return {
    id: over.id ?? (over.name ?? "m").toLowerCase(),
    name: "M",
    brand: "",
    flavor: "",
    batchSize: 0,
    daysEarly: 0,
    amountAlreadyMade: 0,
    components: [],
    enabled: true,
    ...over,
  };
}

describe("backfillMixFromMergedSources", () => {
  it("fills a stub target from the merged-away source", () => {
    const target = mix({
      name: "Veggie Mix",
      components: [{ ingredient: "Onion", perPizza: 0 }],
    });
    const source = mix({
      name: "Deluxe Veggie Mix",
      brand: "Bobo's",
      flavor: "Deluxe",
      batchSize: 40,
      daysEarly: 2,
      notes: "Mix cold",
      components: [
        { ingredient: "Onions", perPizza: 0.5, perBatchLbs: 10 },
        { ingredient: "Green Pepper", perPizza: 0.4 },
      ],
    });
    const out = backfillMixFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    expect(out!.brand).toBe("Bobo's");
    expect(out!.flavor).toBe("Deluxe");
    expect(out!.batchSize).toBe(40);
    expect(out!.daysEarly).toBe(2);
    expect(out!.notes).toBe("Mix cold");
    expect(out!.components).toEqual([
      { ingredient: "Onion", perPizza: 0.5, perBatchLbs: 10 },
      { ingredient: "Green Pepper", perPizza: 0.4 },
    ]);
  });

  it("never clobbers real data on a populated target", () => {
    const target = mix({
      name: "T",
      brand: "A",
      batchSize: 30,
      components: [{ ingredient: "Onion", perPizza: 0.6 }],
    });
    const source = mix({
      name: "S",
      brand: "B",
      batchSize: 99,
      components: [{ ingredient: "Onion", perPizza: 0.1, perBatchLbs: 5 }],
    });
    const out = backfillMixFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    expect(out!.brand).toBe("A");
    expect(out!.batchSize).toBe(30);
    expect(out!.components[0]).toEqual({
      ingredient: "Onion",
      perPizza: 0.6,
      perBatchLbs: 5,
    });
  });

  it("returns null when the source adds nothing", () => {
    const target = mix({
      name: "T",
      brand: "A",
      flavor: "F",
      batchSize: 30,
      daysEarly: 1,
      amountAlreadyMade: 5,
      notes: "n",
      components: [{ ingredient: "Onion", perPizza: 0.6, perBatchLbs: 3 }],
    });
    const source = mix({
      name: "S",
      components: [{ ingredient: "Onion", perPizza: 0.2 }],
    });
    expect(backfillMixFromMergedSources(target, [source])).toBeNull();
  });
});
