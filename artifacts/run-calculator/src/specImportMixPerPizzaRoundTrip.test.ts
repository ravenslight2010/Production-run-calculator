// @vitest-environment jsdom
//
// End-to-end pipeline test: spec-sheet import → perPizza values survive all
// stages → buildMixPlan shows non-zero "Pull For Mix" lbs.
//
// Task #637 confirmed the math path (applyMixPerPizza + buildMixPlan) at the
// unit level in prior work. This file exercises the FULL import pipeline:
//
//   collectSpecImportMixes
//     → specMixDraftToMix
//       → addSpecMixesIfAbsent
//         → (fillSpecMixTags)
//           → applyMixPerPizza
//             → buildMixPlan  ← must show non-zero lbs
//
// The key invariant: row.lbs in a parsed recipe carries the sheet's per-pizza
// ounce amounts (long-standing parser quirk documented in collectSpecImportMixes).
// These oz values must survive every stage so the Mixes tab can display real
// pound totals when a scheduled run is selected as the make-day.

import { describe, it, expect } from "vitest";
import { collectSpecImportMixes } from "@workspace/spec-import";
import { specMixDraftToMix } from "@workspace/premix-import";
import {
  addSpecMixesIfAbsent,
  fillSpecMixTags,
  applyMixPerPizza,
  buildMixPlan,
  normalizeMixes,
  type Mix,
} from "@workspace/mixes";
import type { ParsedSpecImport } from "@workspace/spec-import";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate what the AI parser produces for a mix-like recipe on a spec sheet.
 *  row.lbs = per-pizza oz (documented parser quirk). */
function specImportWithMix(
  mixName: string,
  brand: string,
  flavor: string,
  components: Array<{ ingredient: string; ozPerPizza: number }>,
): ParsedSpecImport {
  return {
    profiles: [
      {
        brand,
        flavor,
        applicators: [{ type: "Mix", ozPerPizza: 3 }],
        pepperonis: [],
      },
    ],
    recipes: [
      {
        kind: "cheese",
        name: mixName,
        brand,
        flavor,
        app: 1,
        // row.lbs carries per-pizza OUNCES (parser quirk documented in
        // collectSpecImportMixes — the same field the cheese collector uses).
        rows: components.map(({ ingredient, ozPerPizza }) => ({
          ingredient,
          lbs: ozPerPizza,
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Stage 1: collectSpecImportMixes extracts perPizza from row.lbs
// ---------------------------------------------------------------------------

describe("collectSpecImportMixes: perPizza comes from row.lbs", () => {
  it("surfaces per-pizza oz from the spec sheet rows under the perPizza field", () => {
    const parsed = specImportWithMix("White Fajita Mix", "Aldo's", "Fajita", [
      { ingredient: "Monterey Jack", ozPerPizza: 2.5 },
      { ingredient: "Green Peppers", ozPerPizza: 0.8 },
    ]);
    const userMixes = new Set<string>();
    const drafts = collectSpecImportMixes(parsed, userMixes);
    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    expect(draft.name).toBe("White Fajita Mix");
    expect(draft.brand).toBe("Aldo's");
    expect(draft.flavor).toBe("Fajita");
    expect(draft.components).toEqual([
      { ingredient: "Monterey Jack", perPizza: 2.5 },
      { ingredient: "Green Peppers", perPizza: 0.8 },
    ]);
  });

  it("skips an all-zero mix instead of creating a permanent pool stub", () => {
    // A spec sheet that lists ingredient names but no amounts is only a
    // reference to a mix. The matching premix workbook (or an explicit manager
    // entry) supplies the master-data formula later.
    const parsed = specImportWithMix("Ranch Mix", "Aldo's", "Ranch", [
      { ingredient: "Ranch Sauce", ozPerPizza: 0 },
      { ingredient: "Spices", ozPerPizza: 0 },
    ]);
    const drafts = collectSpecImportMixes(parsed, new Set());
    expect(drafts).toEqual([]);
  });

  it("skips single-ingredient cheese-kind recipes (not a mix)", () => {
    // A one-row recipe must NOT route to mixes regardless of the name.
    const parsed = specImportWithMix("Aldo's Mix", "Aldo's", "Classic", [
      { ingredient: "Mozzarella", ozPerPizza: 3.0 },
    ]);
    const drafts = collectSpecImportMixes(parsed, new Set());
    // Single-ingredient → should not be collected as a mix.
    expect(drafts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stage 2: specMixDraftToMix preserves perPizza on Mix components
// ---------------------------------------------------------------------------

describe("specMixDraftToMix: perPizza survives conversion to Mix", () => {
  it("carries non-zero perPizza oz onto the Mix components", () => {
    const mix = specMixDraftToMix({
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      components: [
        { ingredient: "Monterey Jack", perPizza: 2.5 },
        { ingredient: "Green Peppers", perPizza: 0.8 },
      ],
    });
    expect(mix).not.toBeNull();
    expect(mix!.components).toEqual([
      { ingredient: "Monterey Jack", perPizza: 2.5 },
      { ingredient: "Green Peppers", perPizza: 0.8 },
    ]);
    expect(mix!.batchSize).toBe(0); // spec sheets can't express batch size
    expect(mix!.brand).toBe("Aldo's");
    expect(mix!.flavor).toBe("Fajita");
  });

  it("zero-oz components remain zero (no silent inflation)", () => {
    const mix = specMixDraftToMix({
      name: "Plain Mix",
      brand: "Acme",
      flavor: "",
      components: [{ ingredient: "Onions", perPizza: 0 }],
    });
    expect(mix!.components[0].perPizza).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stage 3: addSpecMixesIfAbsent keeps perPizza on newly added mixes
// ---------------------------------------------------------------------------

describe("addSpecMixesIfAbsent: new mixes enter pool with perPizza intact", () => {
  it("adds a mix with its perPizza values preserved (no zero-out on add)", () => {
    const candidate = specMixDraftToMix({
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      components: [
        { ingredient: "Monterey Jack", perPizza: 2.5 },
        { ingredient: "Green Peppers", perPizza: 0.8 },
      ],
    })!;
    const { merged, added } = addSpecMixesIfAbsent([], [candidate]);
    expect(added).toBe(1);
    expect(merged).toHaveLength(1);
    expect(merged[0].components[0].perPizza).toBe(2.5);
    expect(merged[0].components[1].perPizza).toBe(0.8);
  });

  it("updates an existing mix's components without duplicating it (dedup by loose name)", () => {
    const existing: Mix = {
      id: "white-fajita-mix",
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      batchSize: 40,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [
        { ingredient: "Monterey Jack", perPizza: 2.5 },
        { ingredient: "Green Peppers", perPizza: 0.8 },
      ],
      enabled: true,
    };
    const candidate = specMixDraftToMix({
      name: "white fajita mix", // loose-key match
      brand: "Aldo's",
      flavor: "Fajita",
      components: [{ ingredient: "Monterey Jack", perPizza: 9.9 }],
    })!;
    const { merged, added, updated } = addSpecMixesIfAbsent([existing], [candidate]);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(merged).toHaveLength(1);
    expect(merged[0].components).toEqual([{ ingredient: "Monterey Jack", perPizza: 9.9 }]);
  });
});

// ---------------------------------------------------------------------------
// Stage 4: applyMixPerPizza backfills zero-perPizza slots from import
// ---------------------------------------------------------------------------

describe("applyMixPerPizza: backfills perPizza=0 slots from spec import batch", () => {
  it("fills in perPizza=0 components from the spec import candidates", () => {
    // Simulates a mix that existed in the pool with components but perPizza=0
    // (e.g. added from a prior spec sheet without amounts, or from the old
    // addSpecMixesIfAbsent path that didn't carry oz). A fresh import with
    // amounts should fill those in.
    const existingMix: Mix = {
      id: "premix-aldos-fajita-white-fajita-mix",
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      batchSize: 0,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [
        { ingredient: "Monterey Jack", perPizza: 0 },
        { ingredient: "Green Peppers", perPizza: 0 },
      ],
      enabled: true,
    };
    const candidate = specMixDraftToMix({
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      components: [
        { ingredient: "Monterey Jack", perPizza: 2.5 },
        { ingredient: "Green Peppers", perPizza: 0.8 },
      ],
    })!;
    const { next, updated } = applyMixPerPizza([existingMix], [candidate]);
    expect(updated).toBe(1);
    expect(next[0].components[0].perPizza).toBe(2.5);
    expect(next[0].components[1].perPizza).toBe(0.8);
  });

  it("overwrites a nonzero perPizza with the spec value (spec wins on re-import)", () => {
    const existingMix: Mix = {
      id: "premix-aldos-fajita-white-fajita-mix",
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      batchSize: 40,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [{ ingredient: "Monterey Jack", perPizza: 3.0 }],
      enabled: true,
    };
    const candidate = specMixDraftToMix({
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      components: [{ ingredient: "Monterey Jack", perPizza: 9.9 }],
    })!;
    const { next, updated } = applyMixPerPizza([existingMix], [candidate]);
    expect(updated).toBe(1);
    expect(next[0].components[0].perPizza).toBe(9.9); // spec value wins
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: spec import → buildMixPlan shows non-zero lbs
// ---------------------------------------------------------------------------

describe("Full pipeline: spec import perPizza → buildMixPlan non-zero lbs", () => {
  const TODAY = "2026-08-15";

  it("produces non-zero Pull For Mix lbs when a spec import carries per-pizza oz amounts", () => {
    // Simulate a spec sheet with mix amounts.
    const parsed = specImportWithMix("White Fajita Mix", "Aldo's", "Fajita", [
      { ingredient: "Monterey Jack", ozPerPizza: 2.0 },  // 2 oz / pizza
      { ingredient: "Green Peppers", ozPerPizza: 0.5 },  // 0.5 oz / pizza
    ]);
    const userMixNames = new Set<string>();

    // Stage 1: collect mix drafts from the parsed spec
    const drafts = collectSpecImportMixes(parsed, userMixNames);
    expect(drafts).toHaveLength(1);

    // Stage 2: convert drafts → Mix objects
    const candidates = drafts
      .map((d) => specMixDraftToMix(d))
      .filter((m): m is Mix => m != null);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].components[0].perPizza).toBe(2.0); // oz survived

    // Stage 3: add to empty pool
    const { merged, added } = addSpecMixesIfAbsent([], candidates);
    expect(added).toBe(1);

    // Stage 4: fillSpecMixTags (no-op here — mix already has brand)
    const { next: tagged } = fillSpecMixTags(merged, candidates);

    // Stage 5: applyMixPerPizza (no-op here — newly added mix has non-zero perPizza)
    const { next: finalMixes } = applyMixPerPizza(tagged, candidates);
    expect(finalMixes[0].components[0].perPizza).toBe(2.0);
    expect(finalMixes[0].components[1].perPizza).toBe(0.5);

    // Stage 6: buildMixPlan for a scheduled run of 800 pizzas
    // Expected component lbs: Monterey Jack = 2.0 * 800 / 16 = 100 lbs
    //                         Green Peppers = 0.5 * 800 / 16 = 25 lbs
    //                         componentLbs  = 125 lbs
    // buildMixPlan adds a 15% waste buffer + 20 lb startup buffer:
    //   totalLbs = 125 * 1.15 + 20 = 163.75 lbs
    const plan = buildMixPlan({
      runs: [{ date: TODAY, brand: "Aldo's", flavor: "Fajita", pizzas: 800, cases: 80 }],
      mixes: finalMixes,
      today: TODAY,
    });
    expect(plan).toHaveLength(1);
    const entry = plan[0].runs[0].mixes[0];
    expect(entry.totalLbs).toBeCloseTo(163.75);
    expect(entry.remainingLbs).toBeCloseTo(163.75);
    expect(entry.components).toEqual([
      { ingredient: "Monterey Jack", lbs: 100 },
      { ingredient: "Green Peppers", lbs: 25 },
    ]);
  });

  it("does not create a mix when the spec sheet carried no oz amounts", () => {
    // A spec sheet that lists only ingredient names without amounts is a
    // profile/name reference, not enough data for a factory-wide Mix record.
    // The manager can import the premix workbook or add the mix explicitly.
    const parsed = specImportWithMix("Ranch Mix", "Acme", "Ranch", [
      { ingredient: "Ranch Sauce", ozPerPizza: 0 },
      { ingredient: "Spices", ozPerPizza: 0 },
    ]);
    const drafts = collectSpecImportMixes(parsed, new Set());

    expect(drafts).toEqual([]);
  });

  it("saveMixes round-trip: applyMixPerPizza on re-fetch preserves the values from the first import", () => {
    // Simulates the re-fetch scenario: after a spec import saves mixes to the
    // server, a subsequent fetchMixes + buildMixPlan call should show the same
    // non-zero values (i.e. the server stored them correctly, not zeroed them).
    // We can't hit a real server here; instead we verify that the Mix objects
    // produced by the pipeline (which are what saveMixes sends to the server
    // and the server echoes back after normalizeMix) have the correct perPizza.

    const candidate = specMixDraftToMix({
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      components: [
        { ingredient: "Monterey Jack", perPizza: 2.0 },
        { ingredient: "Green Peppers", perPizza: 0.5 },
      ],
    })!;
    const { merged } = addSpecMixesIfAbsent([], [candidate]);
    const { next: savedMixes } = applyMixPerPizza(merged, [candidate]);

    // Simulate the server round-trip: the server normalizes + stores + returns
    // the same structure. normalizeMix is used server-side for validation.
    // It must NOT zero out valid perPizza values.
    const { normalizeMixes } = require("@workspace/mixes");
    // Build what the server would store/return: JSON-round-trip then normalize.
    // (The server runs normalizeMix on every upsert before persisting + echoing.)
    const serverEchoed = normalizeMixes(JSON.parse(JSON.stringify(savedMixes)));
    expect(serverEchoed[0].components[0].perPizza).toBe(2.0);
    expect(serverEchoed[0].components[1].perPizza).toBe(0.5);

    // buildMixPlan on the server-echoed mixes should still show non-zero lbs.
    // totalLbs = componentLbs * 1.15 + 20 = 125 * 1.15 + 20 = 163.75
    const plan = buildMixPlan({
      runs: [{ date: TODAY, brand: "Aldo's", flavor: "Fajita", pizzas: 800, cases: 80 }],
      mixes: serverEchoed,
      today: TODAY,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].runs[0].mixes[0].totalLbs).toBeCloseTo(163.75);
  });

  it("mix from a prior premix import gets its perPizza refreshed by a subsequent spec import (spec wins)", () => {
    // SPEC-WINS: a subsequent spec import overwrites stored perPizza values
    // with the sheet's positive amounts — a prior bad value must not survive
    // a correcting re-import. Zero/absent spec values still never zero.
    const existingFromPremixImport: Mix = {
      id: "premix-aldos-fajita-white-fajita-mix",
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      batchSize: 50,
      daysEarly: 0,
      amountAlreadyMade: 0,
      components: [
        { ingredient: "Monterey Jack", perPizza: 3.0 }, // real premix value
        { ingredient: "Green Peppers", perPizza: 1.0 }, // real premix value
      ],
      enabled: true,
    };

    // New spec sheet has DIFFERENT (lower) amounts — they take over.
    const candidate = specMixDraftToMix({
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      components: [
        { ingredient: "Monterey Jack", perPizza: 1.0 },
        { ingredient: "Green Peppers", perPizza: 0.2 },
      ],
    })!;

    // addSpecMixesIfAbsent: existing mix name → components replaced (spec wins).
    const { merged, added, updated: addUpdated } = addSpecMixesIfAbsent([existingFromPremixImport], [candidate]);
    expect(added).toBe(0);
    expect(addUpdated).toBe(1);
    expect(merged).toHaveLength(1);

    // The component replacement already applied the spec values, so this
    // narrower perPizza refresh does no additional work.
    const { next: finalMixes, updated } = applyMixPerPizza(merged, [candidate]);
    expect(updated).toBe(0);
    expect(finalMixes[0].components[0].perPizza).toBe(1.0); // spec wins
    expect(finalMixes[0].components[1].perPizza).toBe(0.2); // spec wins

    // buildMixPlan reflects the sheet's values.
    // Component lbs: 1.0 * 800 / 16 = 50; 0.2 * 800 / 16 = 10; componentLbs = 60
    // totalLbs = 60 * 1.15 + 20 = 89 (waste buffer + startup buffer applied)
    const plan = buildMixPlan({
      runs: [{ date: TODAY, brand: "Aldo's", flavor: "Fajita", pizzas: 800, cases: 80 }],
      mixes: finalMixes,
      today: TODAY,
    });
    expect(plan).toHaveLength(1);
    const entry = plan[0].runs[0].mixes[0];
    expect(entry.totalLbs).toBeCloseTo(89);
    expect(entry.components[0].lbs).toBeCloseTo(50);
    expect(entry.components[1].lbs).toBeCloseTo(10);
  });

  it("mix newly added from spec import with oz amounts: re-import detects it as existing (no duplicate, no clobber)", () => {
    // After the FIRST import adds the mix with perPizza values, a SECOND
    // import of the same sheet should not duplicate the mix — addSpecMixesIfAbsent
    // deduplicates by loose name — and applyMixPerPizza leaves nonzero values
    // untouched. End result: same mix, same non-zero lbs.
    const candidate = specMixDraftToMix({
      name: "White Fajita Mix",
      brand: "Aldo's",
      flavor: "Fajita",
      components: [
        { ingredient: "Monterey Jack", perPizza: 2.0 },
        { ingredient: "Green Peppers", perPizza: 0.5 },
      ],
    })!;

    // First import
    const { merged: afterFirst } = addSpecMixesIfAbsent([], [candidate]);
    const { next: afterFirstOz } = applyMixPerPizza(afterFirst, [candidate]);
    expect(afterFirstOz).toHaveLength(1);
    expect(afterFirstOz[0].components[0].perPizza).toBe(2.0);

    // Second import (same candidate)
    const { merged: afterSecond, added } = addSpecMixesIfAbsent(afterFirstOz, [candidate]);
    expect(added).toBe(0); // no new mix added — dup detected
    const { next: afterSecondOz } = applyMixPerPizza(afterSecond, [candidate]);
    expect(afterSecondOz).toHaveLength(1);
    expect(afterSecondOz[0].components[0].perPizza).toBe(2.0); // still correct

    const plan = buildMixPlan({
      runs: [{ date: TODAY, brand: "Aldo's", flavor: "Fajita", pizzas: 800, cases: 80 }],
      mixes: afterSecondOz,
      today: TODAY,
    });
    expect(plan).toHaveLength(1);
    // totalLbs = componentLbs * 1.15 + 20 = 125 * 1.15 + 20 = 163.75
    expect(plan[0].runs[0].mixes[0].totalLbs).toBeCloseTo(163.75);
  });
});
