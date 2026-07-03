import { describe, it, expect } from "vitest";
import {
  parsePremixWorkbook,
  groundPremix,
  splitPremixName,
  premixId,
  premixToMix,
  sanitizePremixMatches,
  applyPremixMatches,
  summarizePremixImport,
  buildPremixCandidates,
  rematchPremixCandidate,
  mergePremixIntoMixes,
  type PremixKnown,
  type SheetGrid,
} from "./index";

// Single-block tab modeled on the real "Bobos Deluxe" sheet (ingredient col 0).
const BOBOS: SheetGrid = {
  name: "Bobos Deluxe",
  rows: [
    ["Bobo's Deluxe Veggie Mix", "", "", "# OF MIXES"],
    ["", "Per Pizza", "Per Batch", "1"],
    ["Red Onion, FR Strips", "0.4", "20.7"],
    ["Red Peppers", "0.82", "42.435"],
    ["Green Peppers", "0.82", "42.435"],
    ["1/8 Green Pepper", "", "10"],
    ["Basil", "0.06", "3.105"],
    ["Bacon", "0.75", "38.8125"],
    ["TOTAL", "2.85", "147.4875"],
    ["Max Batches at a time", "", "1.69"],
    ["TOTAL CASES NEEDED", "60"],
  ],
};

// Two horizontal blocks on one tab, modeled on "Hannaford Tikka Masala Mix".
// Note the "Pert Pizza" typo in the second block's header.
const HANNAFORD: SheetGrid = {
  name: "Hannaford Tikka Masala Mix",
  rows: [
    ["", "Hannaford White Fajita Mix", "", "", "# OF MIXES", "", "Hannaford Chicken Masala Mix", "", "", "#OF MIXES"],
    ["", "", "Per Pizza", "Per Batch", "9", "", "", "Pert Pizza", "Per Batch", "9"],
    ["", "White Onion Strips, Blanched", "0.375", "15.525", "", "", "Chicken, Diced\r\nc&f - 001mpdc40", "2", "82.8"],
    ["", "1/8 onion", "", "5", "", "", "Masala Sauce", "0.07", "2.898"],
    ["", "Green Pepper Strips, Blanched", "0.375", "15.525", "", "", "Total", "2.07", "85.698"],
    ["", "1/8 green pepper", "", "5"],
    ["", "Red Pepper Strips, Blanched", "0.375", "15.525"],
    ["", "Yellow Pepper Strips, Blanched", "0.375", "15.525"],
    ["", "Total", "1.5", "62.0999"],
  ],
};

// Name + pull-note share one cell (real "Bobos Breakfast" shape).
const BREAKFAST: SheetGrid = {
  name: "Bobos Breakfast",
  rows: [
    ["***Pull 3 Days Early***\r\nScrambled Egg Mix", "", "", "# OF MIXES"],
    ["", "Per Pizza", "Per Batch", "1"],
    ["Egg", "0.5", "25"],
    ["TOTAL", "0.5", "25"],
  ],
};

// "PULL OLD MIX 2 DAYS PRIOR" note in its own cell below the table.
const SPINACH: SheetGrid = {
  name: "Lowes Spinach",
  rows: [
    ["Lowes Spinach Mix", "", "", ""],
    ["", "Per Pizza", "Per Batch", ""],
    ["Spinach", "0.3", "12"],
    ["Total", "0.3", "12"],
    ["***PULL OLD MIX 2 DAYS PRIOR***", "", ""],
  ],
};

describe("parsePremixWorkbook", () => {
  it("parses a single-block tab with sheet-exact quantities", () => {
    const [mix, ...rest] = parsePremixWorkbook([BOBOS]);
    expect(rest).toHaveLength(0);
    expect(mix.name).toBe("Bobo's Deluxe Veggie Mix");
    expect(mix.sheetName).toBe("Bobos Deluxe");
    expect(mix.batchSize).toBe(147.4875);
    expect(mix.components).toHaveLength(6);
    const onion = mix.components.find((c) => c.ingredient === "Red Onion, FR Strips");
    expect(onion?.perPizza).toBe(0.4);
    expect(onion?.perBatch).toBe(20.7);
    // A blank "Per Pizza" flat add keeps perPizza 0 but is still listed.
    const flat = mix.components.find((c) => c.ingredient === "1/8 Green Pepper");
    expect(flat?.perPizza).toBe(0);
    expect(flat?.perBatch).toBe(10);
  });

  it("parses two horizontal blocks on one tab (incl. the 'Pert Pizza' typo)", () => {
    const mixes = parsePremixWorkbook([HANNAFORD]);
    expect(mixes.map((m) => m.name)).toEqual([
      "Hannaford White Fajita Mix",
      "Hannaford Chicken Masala Mix",
    ]);
    const fajita = mixes[0];
    expect(fajita.batchSize).toBe(62.0999);
    expect(fajita.components).toHaveLength(6);

    const masala = mixes[1];
    expect(masala.batchSize).toBe(85.698);
    expect(masala.components).toHaveLength(2);
    // Multi-line ingredient cell collapses to its first line.
    expect(masala.components[0].ingredient).toBe("Chicken, Diced");
    expect(masala.components[0].perPizza).toBe(2);
  });

  it("extracts a days-early note that shares the name cell", () => {
    const [mix] = parsePremixWorkbook([BREAKFAST]);
    expect(mix.name).toBe("Scrambled Egg Mix");
    expect(mix.daysEarly).toBe(3);
    expect(mix.notes).toBe("Pull 3 Days Early");
  });

  it("extracts a 'DAYS PRIOR' note in its own cell", () => {
    const [mix] = parsePremixWorkbook([SPINACH]);
    expect(mix.daysEarly).toBe(2);
    expect(mix.notes).toBe("PULL OLD MIX 2 DAYS PRIOR");
  });

  it("defaults days-early to 0 when there is no note", () => {
    const [mix] = parsePremixWorkbook([BOBOS]);
    expect(mix.daysEarly).toBe(0);
    expect(mix.notes).toBeUndefined();
  });
});

const KNOWN: PremixKnown = {
  brands: ["Bobo's", "Hannaford"],
  flavorsByBrand: { "Bobo's": ["Deluxe"], Hannaford: ["White Fajita"] },
  ingredients: ["Red Onion, FR Strips", "Bacon"],
};

describe("name grounding", () => {
  it("splits a name on the longest known brand prefix and strips the Mix suffix", () => {
    expect(splitPremixName("Bobo's Deluxe Veggie Mix", "Bobos Deluxe", KNOWN.brands)).toEqual({
      brand: "Bobo's",
      flavor: "Deluxe",
    });
  });

  it("returns empty brand when nothing matches (goes to AI)", () => {
    const r = splitPremixName("Mystery Topping Mix", "Mystery", []);
    expect(r.brand).toBe("");
    expect(r.flavor).toBe("Mystery");
  });

  it("grounds brand/flavor against known lists", () => {
    const [parsed] = parsePremixWorkbook([BOBOS]);
    const g = groundPremix(parsed, KNOWN, []);
    expect(g.mix.brand).toBe("Bobo's");
    expect(g.mix.flavor).toBe("Deluxe");
    expect(g.productResolved).toBe(true);
  });

  it("marks unresolved products for the AI matcher", () => {
    const parsed = parsePremixWorkbook([SPINACH])[0];
    const g = groundPremix(parsed, KNOWN, []);
    expect(g.productResolved).toBe(false);
  });
});

describe("AI match sanitizer", () => {
  it("keeps known brands and drops hallucinated ones", () => {
    const raw = {
      matches: [
        { name: "Bobo's Deluxe Veggie Mix", brand: "Bobo's", flavor: "Deluxe" },
        { name: "Ghost Mix", brand: "Totally Made Up Brand XYZ", flavor: "Nope" },
      ],
    };
    const out = sanitizePremixMatches(raw, KNOWN);
    expect(out).toEqual([{ name: "Bobo's Deluxe Veggie Mix", brand: "Bobo's", flavor: "Deluxe" }]);
  });

  it("never throws on garbage input", () => {
    expect(sanitizePremixMatches(null, KNOWN)).toEqual([]);
    expect(sanitizePremixMatches({ matches: "nope" }, KNOWN)).toEqual([]);
  });

  it("applies matches onto parsed mixes by name", () => {
    const parsed = parsePremixWorkbook([SPINACH]);
    const applied = applyPremixMatches(parsed, [
      { name: "Lowes Spinach Mix", brand: "Lowes", flavor: "Spinach" },
    ]);
    expect(applied[0].brand).toBe("Lowes");
    expect(applied[0].flavor).toBe("Spinach");
  });
});

describe("conversion + summary", () => {
  it("produces a stable deterministic id for re-import upserts", () => {
    const [parsed] = parsePremixWorkbook([BOBOS]);
    const g = groundPremix(parsed, KNOWN, []);
    const a = premixId(g.mix);
    const b = premixId(g.mix);
    expect(a).toBe(b);
    expect(a).toBe("premix-bobo-s-deluxe-bobo-s-deluxe-veggie-mix");
  });

  it("converts to a normalized Mix carrying per-pizza weights", () => {
    const [parsed] = parsePremixWorkbook([BOBOS]);
    const mix = premixToMix(groundPremix(parsed, KNOWN, []).mix)!;
    expect(mix).not.toBeNull();
    expect(mix.batchSize).toBe(147.4875);
    expect(mix.components.find((c) => c.ingredient === "Bacon")?.perPizza).toBe(0.75);
    expect(mix.enabled).toBe(true);
  });

  it("counts new vs updated and merges by id", () => {
    const mixes = parsePremixWorkbook([HANNAFORD]).map(
      (p) => premixToMix(groundPremix(p, KNOWN, []).mix)!,
    );
    const existingIds = new Set([mixes[0].id]);
    const summary = summarizePremixImport(mixes, (id) => existingIds.has(id));
    expect(summary).toEqual({ total: 2, created: 1, updated: 1 });

    const merged = mergePremixIntoMixes([mixes[0]], mixes);
    expect(merged).toHaveLength(2);
  });

  it("merge keeps on-hand amount, enabled flag, and custom notes the sheet cannot carry", () => {
    const mixes = parsePremixWorkbook([HANNAFORD]).map(
      (p) => premixToMix(groundPremix(p, KNOWN, []).mix)!,
    );
    const existing = {
      ...mixes[0],
      amountAlreadyMade: 75.5,
      enabled: false,
      notes: "Mix cold\nPull 9 Days Early", // stale pull line + custom note
    };
    const merged = mergePremixIntoMixes([existing], mixes);
    const updated = merged.find((m) => m.id === mixes[0].id)!;
    // Sheet-less fields survive the re-import...
    expect(updated.amountAlreadyMade).toBe(75.5);
    expect(updated.enabled).toBe(false);
    // ...custom note lines are kept, while the pull-note line follows the
    // IMPORT (stale "9 days" line replaced by whatever the sheet now says).
    const importedPull = (mixes[0].notes ?? "").trim();
    expect(updated.notes).toBe(
      importedPull ? `Mix cold\n${importedPull}` : "Mix cold",
    );
    // Sheet-carried fields still come from the import.
    expect(updated.batchSize).toBe(mixes[0].batchSize);
    expect(updated.components).toEqual(mixes[0].components);
  });

  it("builds per-mix review candidates tagged new vs update", () => {
    const mixes = parsePremixWorkbook([HANNAFORD]).map(
      (p) => premixToMix(groundPremix(p, KNOWN, []).mix)!,
    );
    const existingIds = new Set([mixes[0].id]);
    const candidates = buildPremixCandidates(mixes, (id) => existingIds.has(id));
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({ mix: mixes[0], status: "update" });
    expect(candidates[1]).toEqual({ mix: mixes[1], status: "new" });
  });

  it("re-matches a candidate to a new product, rebuilding id + status", () => {
    const [parsed] = parsePremixWorkbook([BOBOS]);
    const mix = premixToMix(groundPremix(parsed, KNOWN, []).mix)!;
    const candidate = { mix, status: "new" as const };

    // Re-point to a known brand+flavor; id is rebuilt and quantities untouched.
    const expectedId = premixId({ brand: "Bobos", flavor: "Deluxe", name: mix.name });
    const rematched = rematchPremixCandidate(candidate, "Bobos", "Deluxe", (id) =>
      id === expectedId,
    );
    expect(rematched.mix.brand).toBe("Bobos");
    expect(rematched.mix.flavor).toBe("Deluxe");
    expect(rematched.mix.id).toBe(expectedId);
    expect(rematched.mix.batchSize).toBe(mix.batchSize);
    expect(rematched.mix.components).toEqual(mix.components);
    // The rebuilt id now matches an existing mix → flips to "update".
    expect(rematched.status).toBe("update");

    // Re-pointing to an unknown id stays "new".
    const stillNew = rematchPremixCandidate(candidate, "Bobos", "Deluxe", () => false);
    expect(stillNew.status).toBe("new");
  });
});
