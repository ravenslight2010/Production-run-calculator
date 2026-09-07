// Deterministic CI guard for the export → real .xlsx → re-read path.
//
// The manual real-AI harness (artifacts/api-server/scripts/e2e-spec-roundtrip.ts)
// stresses the parse RULES (qualifier brands, size-in-brand names, shared
// targets) through an actual xlsx write→read plus a paid AI call. Its xlsx
// half is fully deterministic, so this test enforces it in normal vitest with
// zero AI/network: write the same representative dataset to a real .xlsx
// buffer with the same writer the apps use (xlsx aliased to @e965/xlsx), read
// it back exactly like the web importer does (sheet_to_json header:1,
// defval:"", blankrows:false, everything stringified), and assert the
// recovered SheetGrids match the exporter's output with zero loss.
//
// If sheet-name sanitization, cell formatting, or the xlsx write/read pipeline
// ever corrupts or drops a sheet, row, or cell, this fails in CI instead of
// only during a manual paid harness run.

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { SheetGrid } from "@workspace/spec-import";
import { buildSpecRecipeExportWorkbooks, type SpecExportInput } from "./index";

// ── Representative dataset (verbatim from the real-AI harness) ───────────────
// Deliberately stresses the parse rules: qualifier brands ("Basha's Original"
// vs "Basha's Ultra Thin Crust"), size-in-brand ("Lowes 7in"), a shared dough
// recipe with multiple targets, doughball weights, cheese applicator slots 1/2,
// diced pepperoni inside a cheese recipe, and decimals throughout.
const input: SpecExportInput = {
  profiles: [
    {
      brand: "Basha's Original",
      flavor: "Cheese",
      dieType: "Argus",
      sauceOzPerPizza: 3.5,
      applicators: [
        { type: "Mozzarella Shred", ozPerPizza: 4.25 },
        { type: "Provolone Blend", ozPerPizza: 1.5 },
      ],
      pepperonis: [],
      doughRecipeName: "Standard Dough",
      targetDoughballWeight: 19.5,
      sauceRecipeName: "Classic Pizza Sauce",
      cheeseRecipeNames: ["Cheese Blend A", "Cheese Blend B", undefined, undefined],
    },
    {
      brand: "Basha's Original",
      flavor: "Pepperoni",
      dieType: "Argus",
      sauceOzPerPizza: 3.5,
      applicators: [{ type: "Mozzarella Shred", ozPerPizza: 4 }],
      pepperonis: [{ type: "Cup Char Pepperoni", sticks: 2, ozPerPizza: 1.2 }],
      doughRecipeName: "Standard Dough",
      targetDoughballWeight: 19.5,
      sauceRecipeName: "Classic Pizza Sauce",
      cheeseRecipeNames: ["Cheese Blend A", undefined, undefined, undefined],
    },
    {
      brand: "Basha's Ultra Thin Crust",
      flavor: "Cheese",
      dieType: "Mystic",
      sauceOzPerPizza: 2.75,
      applicators: [{ type: "Mozzarella Shred", ozPerPizza: 3.6 }],
      pepperonis: [],
      doughRecipeName: "Thin Crust Dough",
      targetDoughballWeight: 11,
      sauceRecipeName: "Classic Pizza Sauce",
      cheeseRecipeNames: ["Cheese Blend A", undefined, undefined, undefined],
    },
    {
      brand: "Lowes 7in",
      flavor: "Supreme",
      dieType: "Argus",
      sauceOzPerPizza: 2.1,
      applicators: [
        { type: "Mozzarella Shred", ozPerPizza: 2.4 },
        { type: "Topping Mix", ozPerPizza: 1.1 },
      ],
      pepperonis: [{ type: "Standard Pepperoni", sticks: 1, ozPerPizza: 0.6 }],
      doughRecipeName: "Standard Dough",
      targetDoughballWeight: 19.5,
      sauceRecipeName: "Classic Pizza Sauce",
      cheeseRecipeNames: [undefined, "Cheese Blend B", undefined, undefined],
    },
  ],
  doughRecipes: [
    {
      name: "Standard Dough",
      rows: [
        { ingredient: "Flour", lbs: 500 },
        { ingredient: "Water", lbs: 300.5 },
        { ingredient: "Yeast", lbs: 5 },
        { ingredient: "Salt", lbs: 12 },
        { ingredient: "Sugar", lbs: 8 },
        { ingredient: "Soybean Oil", lbs: 20 },
      ],
    },
    {
      name: "Thin Crust Dough",
      rows: [
        { ingredient: "Flour", lbs: 450 },
        { ingredient: "Water", lbs: 240 },
        { ingredient: "Yeast", lbs: 3.5 },
        { ingredient: "Salt", lbs: 10 },
        { ingredient: "Dough Conditioner", lbs: 2.25 },
      ],
    },
  ],
  sauceRecipes: [
    {
      name: "Classic Pizza Sauce",
      rows: [
        { ingredient: "Tomato Paste", lbs: 120 },
        { ingredient: "Water", lbs: 80 },
        { ingredient: "Spice Blend", lbs: 6.5 },
        { ingredient: "Sugar", lbs: 4 },
      ],
    },
  ],
  cheeseRecipes: [
    {
      name: "Cheese Blend A",
      rows: [
        { ingredient: "Mozzarella", lbs: 400 },
        { ingredient: "Provolone", lbs: 100 },
      ],
    },
    {
      name: "Cheese Blend B",
      rows: [
        { ingredient: "Mozzarella", lbs: 300 },
        { ingredient: "Cheese Substitute", lbs: 150 },
        { ingredient: "Diced Pepperoni", lbs: 25 },
      ],
    },
  ],
};

// ── xlsx write/read halves (verbatim from the harness / app glue) ────────────

/** Write grids to a real .xlsx buffer exactly like the web/mobile exporters. */
function writeWorkbook(grids: ReadonlyArray<SheetGrid>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const g of grids) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g.rows), g.name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
}

/** Re-read a workbook buffer exactly like the web importer does. */
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

// ── Normalization ────────────────────────────────────────────────────────────
// The importer reads with blankrows:false (spacer rows vanish) and sheet_to_json
// pads every row to the sheet's column range with defval:"". Neither is data
// loss, so compare grids in a canonical form: drop fully-empty rows and strip
// trailing empty cells per row. Everything else must match EXACTLY.

function canonical(grids: ReadonlyArray<SheetGrid>): SheetGrid[] {
  return grids.map((g) => ({
    name: g.name,
    rows: g.rows
      .map((row) => {
        const cells = row.map((c) => (c == null ? "" : String(c)));
        let end = cells.length;
        while (end > 0 && cells[end - 1] === "") end--;
        return cells.slice(0, end);
      })
      .filter((row) => row.length > 0),
  }));
}

// ── The guard ────────────────────────────────────────────────────────────────

describe("spec export survives a real .xlsx write→read round-trip with zero loss", () => {
  const workbooks = buildSpecRecipeExportWorkbooks(input);
  const recovered = workbooks.map((workbook) => ({
    kind: workbook.kind,
    grids: readWorkbook(writeWorkbook(workbook.grids)),
  }));

  it("exports four independent spec/recipe workbooks with grouped sheets", () => {
    expect(workbooks.map((workbook) => workbook.kind)).toEqual(["specs", "dough", "sauce", "cheese"]);
    expect(workbooks.find((workbook) => workbook.kind === "specs")?.grids.map((g) => g.name)).toEqual([
      "Basha's Original",
      "Basha's Ultra Thin Crust",
      "Lowes 7in",
    ]);
    expect(workbooks.find((workbook) => workbook.kind === "dough")?.grids).toHaveLength(2);
    expect(workbooks.find((workbook) => workbook.kind === "sauce")?.grids).toHaveLength(1);
    expect(workbooks.find((workbook) => workbook.kind === "cheese")?.grids).toHaveLength(3);
  });

  it("recovers every workbook's rows and cells exactly", () => {
    for (const workbook of workbooks) {
      const roundTripped = recovered.find((item) => item.kind === workbook.kind)?.grids ?? [];
      expect(canonical(roundTripped)).toEqual(canonical(workbook.grids));
    }
  });

  it("keeps the tricky parse-rule shapes intact at the grid level", () => {
    const allRecovered = recovered.flatMap((workbook) => workbook.grids);
    const canon = canonical(allRecovered);
    const flat = canon.flatMap((g) => g.rows.map((r) => r.join("\t")));
    // Qualifier brands stay distinct (no prefix collapse in any cell).
    expect(
      flat.filter((l) => l.startsWith("Basha's Original\t")).length,
    ).toBe(2);
    expect(
      flat.filter((l) => l.startsWith("Basha's Ultra Thin Crust\t")).length,
    ).toBe(1);
    // Size-in-brand survives verbatim (no "7in" number coercion).
    expect(flat.some((l) => l.startsWith("Lowes 7in\tSupreme\t"))).toBe(true);
    // Shared recipes keep ALL their brand targets.
    const doughLines = canon
      .filter((g) => g.name.includes("Dough"))
      .flatMap((g) => g.rows.map((r) => r.join("\t")));
    expect(doughLines).toContain("Basha's Original: Cheese, Pepperoni");
    expect(doughLines).toContain("Lowes 7in: Supreme");
    const sauceLines = canon
      .filter((g) => g.name.includes("Sauce"))
      .flatMap((g) => g.rows.map((r) => r.join("\t")));
    expect(sauceLines).toContain("Basha's Ultra Thin Crust: Cheese");
    // Doughball weight + applicator-slot metadata rows survive.
    expect(doughLines).toContain("Target Doughball Weight (oz)\t19.5");
    expect(doughLines).toContain("Target Doughball Weight (oz)\t11");
    const cheeseLines = recovered
      .find((workbook) => workbook.kind === "cheese")!
      .grids.flatMap((g) => g.rows.map((r) => r.join("\t")));
    expect(cheeseLines).toContain("Applicator Slot\t1");
    expect(cheeseLines).toContain("Applicator Slot\t2");
    // Decimal ingredient weights come back as the same shortest-exact strings.
    expect(doughLines).toContain("Water\t300.5");
    expect(doughLines).toContain("Dough Conditioner\t2.25");
    expect(cheeseLines).toContain("Diced Pepperoni\t25");
  });

  it("negative control: the strict compare DOES catch a lost cell", () => {
    const sauce = workbooks.find((workbook) => workbook.kind === "sauce")!;
    const recoveredSauce = recovered.find((workbook) => workbook.kind === "sauce")!.grids;
    const tampered = recoveredSauce.map((g) =>
      ({ ...g, rows: g.rows.filter((r) => r[0] !== "Spice Blend") }),
    );
    expect(canonical(tampered)).not.toEqual(canonical(sauce.grids));
  });
});
