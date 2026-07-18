// mixFromCheeseRecipe — the "Move to Mixes" conversion for blends the spec
// importer misfiled under Cheese. Per-pizza oz carries over; per-BATCH lbs
// never does (mixes are per-pizza oz); brand/notes/enabled carry; first flavor
// becomes the mix flavor with extra flavors preserved in the notes.
import { describe, it, expect } from "vitest";

import { mixFromCheeseRecipe, cheeseComponentsHaveBatchLbs } from "./index";

describe("mixFromCheeseRecipe", () => {
  it("converts components to per-pizza oz and carries brand/flavor/notes", () => {
    const mix = mixFromCheeseRecipe({
      id: "cheese:spec:italian-beef-gravy-mauro-mur9488",
      name: "Italian Beef & Gravy",
      brand: "Mauro",
      flavors: ["Italian Beef & Giardiniera"],
      notes: "spec import",
      components: [
        { ingredient: "Italian Beef", lbs: 0, ozPerPizza: 3.5 },
        { ingredient: "Gravy", lbs: 0, ozPerPizza: 1.25 },
      ],
      enabled: true,
    });
    expect(mix).not.toBeNull();
    expect(mix!.name).toBe("Italian Beef & Gravy");
    expect(mix!.brand).toBe("Mauro");
    expect(mix!.flavor).toBe("Italian Beef & Giardiniera");
    expect(mix!.notes).toBe("spec import");
    expect(mix!.enabled).toBe(true);
    expect(mix!.components).toEqual([
      { ingredient: "Italian Beef", perPizza: 3.5 },
      { ingredient: "Gravy", perPizza: 1.25 },
    ]);
    // Blanks stay blank — a moved recipe never invents batch data.
    expect(mix!.batchSize).toBe(0);
    expect(mix!.daysEarly).toBe(0);
    expect(mix!.amountAlreadyMade).toBe(0);
  });

  it("mints an id in its own namespace (never collides with an existing mix id)", () => {
    const mix = mixFromCheeseRecipe({
      id: "abc123",
      name: "Some Blend",
      brand: "",
      flavors: [],
      components: [{ ingredient: "A", ozPerPizza: 1 }],
    });
    expect(mix!.id).toBe("mix:from-cheese:abc123");
  });

  it("keeps extra flavors in the notes (a Mix has ONE flavor)", () => {
    const mix = mixFromCheeseRecipe({
      id: "x",
      name: "Blend",
      brand: "B",
      flavors: ["First", "Second", "Third"],
      notes: "hand note",
      components: [{ ingredient: "A", ozPerPizza: 1 }],
    });
    expect(mix!.flavor).toBe("First");
    expect(mix!.notes).toBe("hand note — Also used on: Second, Third");
  });

  it("drops per-batch lbs (does NOT smuggle them into perBatchLbs)", () => {
    const mix = mixFromCheeseRecipe({
      id: "x",
      name: "Blend",
      brand: "",
      flavors: [],
      components: [{ ingredient: "A", lbs: 120, ozPerPizza: 0 }],
    });
    expect(mix!.components[0]).toEqual({ ingredient: "A", perPizza: 0 });
    expect(mix!.components[0]).not.toHaveProperty("perBatchLbs");
  });

  it("returns null for a nameless recipe and carries enabled=false", () => {
    expect(
      mixFromCheeseRecipe({ id: "x", name: "  ", brand: "", flavors: [], components: [] }),
    ).toBeNull();
    const off = mixFromCheeseRecipe({
      id: "x",
      name: "Blend",
      brand: "",
      flavors: [],
      components: [],
      enabled: false,
    });
    expect(off!.enabled).toBe(false);
  });
});

describe("cheeseComponentsHaveBatchLbs", () => {
  it("flags only components with lbs > 0", () => {
    expect(cheeseComponentsHaveBatchLbs([{ lbs: 0 }, {}])).toBe(false);
    expect(cheeseComponentsHaveBatchLbs([{ lbs: 0 }, { lbs: 40 }])).toBe(true);
    expect(cheeseComponentsHaveBatchLbs([])).toBe(false);
  });
});
