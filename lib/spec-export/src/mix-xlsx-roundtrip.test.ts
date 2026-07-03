// Deterministic CI guard for the SECOND export format: the premix "Mixes"
// workbook (buildMixExportGrids) → real .xlsx write → read → the real
// @workspace/premix-import parser → Mix objects.
//
// Unlike the spec/recipe workbook (whose importer needs AI), the premix
// importer is FULLY deterministic — parsing, name grounding (alias → exact →
// fuzzy), and Mix conversion never touch the network. So the entire
// export → re-import loop can be asserted here with zero AI: a regression in
// the premix layout (name row position, "Per Pizza" anchor, Total row,
// "Pull N Days Early" note, tab-name brand/flavor grounding, sheet-name
// dedupe) fails in CI instead of silently corrupting a manager's re-import.

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Mix } from "@workspace/mixes";
import { normalizeMix } from "@workspace/mixes";
import {
  buildPremixCandidates,
  groundPremix,
  parsePremixWorkbook,
  premixId,
  premixToMix,
  type PremixKnown,
  type SheetGrid,
} from "@workspace/premix-import";
import { buildMixExportGrids } from "./index";

// ── Known lists (what the app would supply at import time) ───────────────────
// Includes qualifier brands ("Basha's Original" vs "Basha's Ultra Thin Crust")
// so the longest-prefix brand split is exercised, plus every component
// ingredient so grounding maps names exactly.

const known: PremixKnown = {
  brands: ["Bobo's", "Basha's Original", "Basha's Ultra Thin Crust", "Lowes 7in"],
  flavorsByBrand: {
    "Bobo's": ["Deluxe", "Cheese"],
    "Basha's Ultra Thin Crust": ["Cheese"],
    "Lowes 7in": ["Supreme"],
  },
  ingredients: [
    "Green Peppers",
    "Onions",
    "Mushrooms",
    "Sausage Crumble",
    "Spice Blend",
    "Diced Pepperoni",
    "Mozzarella",
    "Provolone",
    "Herb Blend",
    "Olive Oil",
  ],
};

// ── Original mixes (what a manager exports) ──────────────────────────────────
// Deliberately stresses the round-trip:
//  * name carries the brand + a "… Veggie Mix" suffix (name-based grounding)
//  * name carries NO brand at all (tab-name grounding, incl. a qualifier brand
//    and a size-in-brand name "Lowes 7in")
//  * "Pull N Days Early" notes (daysEarly 2 and 3)
//  * decimals in perPizza and batchSize, a flat 0-per-pizza component,
//    and a batchSize of 0 (pounds-only mix)
//  * TWO mixes on the same product → duplicate tab name → " (2)" dedupe

function mkMix(raw: Omit<Mix, "id" | "amountAlreadyMade" | "enabled">): Mix {
  const mix = normalizeMix({
    ...raw,
    id: premixId(raw),
    amountAlreadyMade: 0,
    enabled: true,
  });
  if (!mix) throw new Error(`test fixture mix failed to normalize: ${raw.name}`);
  return mix;
}

const originals: Mix[] = [
  mkMix({
    name: "Bobo's Deluxe Veggie Mix",
    brand: "Bobo's",
    flavor: "Deluxe",
    batchSize: 62.5,
    daysEarly: 0,
    components: [
      { ingredient: "Green Peppers", perPizza: 0.35 },
      { ingredient: "Onions", perPizza: 0.4 },
      { ingredient: "Mushrooms", perPizza: 0.25 },
    ],
  }),
  mkMix({
    name: "Topping Blend",
    brand: "Lowes 7in",
    flavor: "Supreme",
    batchSize: 40,
    daysEarly: 3,
    notes: "Pull 3 Days Early",
    components: [
      { ingredient: "Sausage Crumble", perPizza: 0.6 },
      { ingredient: "Diced Pepperoni", perPizza: 0.45 },
      // Flat per-batch addition: the sheet leaves "Per Pizza" at 0.
      { ingredient: "Spice Blend", perPizza: 0 },
    ],
  }),
  mkMix({
    name: "Ultra Cheese Blend",
    brand: "Basha's Ultra Thin Crust",
    flavor: "Cheese",
    batchSize: 55.25,
    daysEarly: 2,
    notes: "Pull 2 Days Early",
    components: [
      { ingredient: "Mozzarella", perPizza: 3.6 },
      { ingredient: "Provolone", perPizza: 0.9 },
    ],
  }),
  mkMix({
    // Same product as the first mix → its tab name collides and gets " (2)".
    // The name itself carries brand + known flavor so grounding still resolves.
    name: "Bobo's Deluxe Mix",
    brand: "Bobo's",
    flavor: "Deluxe",
    batchSize: 0, // pounds-only mix (batch count not applicable)
    daysEarly: 0,
    components: [
      { ingredient: "Herb Blend", perPizza: 0.1 },
      { ingredient: "Olive Oil", perPizza: 0.05 },
    ],
  }),
];

// ── xlsx write/read halves (verbatim from the app glue / spec round-trip) ────

function writeWorkbook(grids: ReadonlyArray<SheetGrid>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const g of grids) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g.rows), g.name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
}

function readWorkbook(data: Uint8Array): SheetGrid[] {
  const wb = XLSX.read(data, { type: "buffer" });
  const grids: SheetGrid[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    }) as unknown[][];
    grids.push({
      name,
      rows: rows.map((r) =>
        Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : [],
      ),
    });
  }
  return grids;
}

/** Run recovered grids through the full deterministic import pipeline. */
function importMixes(grids: ReadonlyArray<SheetGrid>): {
  mixes: Mix[];
  allResolved: boolean;
} {
  const parsed = parsePremixWorkbook(grids);
  const grounded = parsed.map((p) => groundPremix(p, known, []));
  const mixes = grounded
    .map((g) => premixToMix(g.mix))
    .filter((m): m is Mix => m !== null);
  return { mixes, allResolved: grounded.every((g) => g.productResolved) };
}

/** The fields the task guards: everything a re-import must recover exactly. */
function projection(m: Mix) {
  return {
    id: m.id,
    name: m.name,
    brand: m.brand,
    flavor: m.flavor,
    batchSize: m.batchSize,
    daysEarly: m.daysEarly,
    components: m.components,
  };
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

// ── The guard ────────────────────────────────────────────────────────────────

describe("mix export survives a real .xlsx round-trip through the premix importer", () => {
  const exported = buildMixExportGrids(originals);
  const recoveredGrids = readWorkbook(writeWorkbook(exported));
  const { mixes: recovered, allResolved } = importMixes(recoveredGrids);

  it("exports one tab per mix, grounded on the product, with duplicate tabs deduped", () => {
    expect(recoveredGrids.map((g) => g.name)).toEqual([
      "Bobo's Deluxe",
      "Lowes 7in Supreme",
      "Basha's Ultra Thin Crust Cheese",
      "Bobo's Deluxe (2)",
    ]);
  });

  it("recovers every mix with no data loss (name, product, components, batchSize, daysEarly)", () => {
    expect(recovered).toHaveLength(originals.length);
    // Grounding must resolve every brand+flavor deterministically — an
    // exported sheet must NEVER need the AI matcher on re-import.
    expect(allResolved).toBe(true);
    expect(recovered.map(projection).sort(byId)).toEqual(
      originals.map(projection).sort(byId),
    );
  });

  it("re-imports as updates of the same mixes (stable ids, no duplicates)", () => {
    const existingIds = new Set(originals.map((m) => m.id));
    const candidates = buildPremixCandidates(recovered, (id) => existingIds.has(id));
    expect(candidates.map((c) => c.status)).toEqual(
      originals.map(() => "update" as const),
    );
  });

  it("recovers the Pull-N-Days-Early note as the notes field", () => {
    const byName = new Map(recovered.map((m) => [m.name, m]));
    expect(byName.get("Topping Blend")?.notes).toBe("Pull 3 Days Early");
    expect(byName.get("Ultra Cheese Blend")?.notes).toBe("Pull 2 Days Early");
    expect(byName.get("Bobo's Deluxe Veggie Mix")?.notes).toBeUndefined();
  });

  it("negative control: layout regressions ARE caught by this guard", () => {
    // Mangle the "Per Pizza" anchor on one tab → that mix vanishes entirely.
    const noAnchor = recoveredGrids.map((g) =>
      g.name === "Lowes 7in Supreme"
        ? {
            name: g.name,
            rows: g.rows.map((r) => r.map((c) => (c === "Per Pizza" ? "PP" : c))),
          }
        : g,
    );
    expect(importMixes(noAnchor).mixes).toHaveLength(originals.length - 1);

    // Mangle the "Total" row label → that mix's batchSize is lost.
    const noTotal = recoveredGrids.map((g) =>
      g.name === "Basha's Ultra Thin Crust Cheese"
        ? {
            name: g.name,
            rows: g.rows.map((r) => (r[0] === "Total" ? ["Subtotal", ...r.slice(1)] : r)),
          }
        : g,
    );
    const lostTotal = importMixes(noTotal).mixes.find((m) => m.name === "Ultra Cheese Blend");
    expect(lostTotal?.batchSize).toBe(0);
    expect(lostTotal?.batchSize).not.toBe(55.25);

    // Drop the pull note → daysEarly is lost.
    const noNote = recoveredGrids.map((g) =>
      g.name === "Lowes 7in Supreme"
        ? { name: g.name, rows: g.rows.filter((r) => !/pull/i.test(r[0] ?? "")) }
        : g,
    );
    const lostNote = importMixes(noNote).mixes.find((m) => m.name === "Topping Blend");
    expect(lostNote?.daysEarly).toBe(0);

    // Mangle the tab name AND strip the brand from the mix name → grounding
    // can no longer resolve the product deterministically.
    const noGrounding = recoveredGrids.map((g) =>
      g.name === "Bobo's Deluxe (2)"
        ? {
            name: "Sheet9",
            rows: g.rows.map((r) =>
              r.map((c) => (c === "Bobo's Deluxe Mix" ? "Mystery Mix" : c)),
            ),
          }
        : g,
    );
    expect(importMixes(noGrounding).allResolved).toBe(false);
  });
});
