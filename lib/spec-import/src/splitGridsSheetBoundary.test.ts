import { describe, expect, it } from "vitest";
import { gridsToPromptText, splitGridsForPrompt, type SheetGrid } from "./index";

// Locks the recipe-sheet boundary flush in splitGridsForPrompt: a sheet that
// carries "Recipe: …" blocks and fits a FRESH chunk but not the current
// chunk's remaining budget must start its own chunk instead of packing its
// head behind another sheet's rows. Mixed chunks where dense profile rows
// precede a recipe sheet's blocks made the model drop the recipe blocks'
// "Brand: flavor" target lines (recipes survived but silently detached from
// every profile). The flush is scoped to recipe sheets ONLY — flushing at
// every sheet boundary fragments block-less many-sheet workbooks (e.g. the
// schedule workbook) enough to exhaust maxChunks and drop MORE rows.

const row = (label: string, len: number): string[] => [label.padEnd(len, "x")];

function plainSheet(name: string, rowCount: number, rowLen: number): SheetGrid {
  return {
    name,
    rows: Array.from({ length: rowCount }, (_, i) => row(`${name}-r${i}-`, rowLen)),
  };
}

/** A sheet whose rows form "Recipe: …" blocks (header + ingredient rows). */
function recipeSheet(name: string, blockCount: number, rowLen: number): SheetGrid {
  const rows: string[][] = [];
  for (let b = 0; b < blockCount; b++) {
    rows.push([`Recipe: ${name} recipe ${b}`]);
    rows.push(row(`${name}-b${b}-ing1-`, rowLen));
    rows.push(row(`${name}-b${b}-ing2-`, rowLen));
  }
  return { name, rows };
}

describe("splitGridsForPrompt recipe-sheet boundary flush", () => {
  it("starts a whole recipe sheet on a fresh chunk when it cannot fit the current remainder", () => {
    const limits = { maxTotalChars: 400 };
    // Sheet A fills most of a chunk; the recipe sheet fits a fresh 400-char
    // chunk on its own but NOT behind A's rows.
    const a = plainSheet("Profiles", 5, 50); // ~255 chars + header
    const b = recipeSheet("Dough Recipes", 2, 40);
    const split = splitGridsForPrompt([a, b], limits, 32);
    expect(split.droppedRows).toBe(0);
    expect(split.chunks.length).toBe(2);
    // Each chunk holds exactly one sheet — the recipe sheet never trails the
    // profile rows.
    expect(split.chunks[0].map((s) => s.name)).toEqual(["Profiles"]);
    expect(split.chunks[1].map((s) => s.name)).toEqual(["Dough Recipes"]);
  });

  it("still packs small sheets together when they fit whole", () => {
    const limits = { maxTotalChars: 500 };
    const a = plainSheet("Profiles", 2, 40);
    const b = recipeSheet("Dough Recipes", 1, 40);
    const split = splitGridsForPrompt([a, b], limits, 32);
    expect(split.chunks.length).toBe(1);
    expect(split.chunks[0].map((s) => s.name)).toEqual(["Profiles", "Dough Recipes"]);
  });

  it("does NOT flush for block-less sheets — dense packing is preserved", () => {
    const limits = { maxTotalChars: 400 };
    // Both sheets are block-less; B's head may pack behind A's rows exactly as
    // before the flush existed, so many-sheet block-less workbooks do not
    // fragment into more chunks (and drop more rows at the maxChunks cap).
    const a = plainSheet("Day1", 5, 50);
    const b = plainSheet("Day2", 5, 50);
    const split = splitGridsForPrompt([a, b], limits, 32);
    expect(split.droppedRows).toBe(0);
    // First chunk must contain the head of B behind A (dense packing).
    expect(split.chunks[0].map((s) => s.name)).toContain("Day2");
  });

  it("many-sheet block-less workbooks keep dense packing and never drop rows within the cap", () => {
    // Representative of the huge schedule-style workbook: many sheets, no
    // "Recipe:" blocks. Dense packing must hold — the flush must not fragment
    // the plan into more chunks (which would push rows past maxChunks).
    const limits = { maxTotalChars: 400 };
    const sheets = Array.from({ length: 40 }, (_, i) => plainSheet(`Day${i}`, 4, 45));
    const dense = splitGridsForPrompt(sheets, limits, 64);
    // Upper bound for perfect dense packing: total chars / budget, plus slack
    // for per-sheet headers. If the flush ever applied to block-less sheets,
    // the plan would jump to ~one chunk per sheet (40), far above this bound.
    expect(dense.droppedRows).toBe(0);
    expect(dense.chunks.length).toBeLessThanOrEqual(24);
  });

  it("splits a sheet larger than one whole chunk by rows with no loss", () => {
    const limits = { maxTotalChars: 300 };
    const big = recipeSheet("Cheese Recipes", 10, 50);
    const split = splitGridsForPrompt([big], limits, 32);
    expect(split.droppedRows).toBe(0);
    expect(split.chunks.length).toBeGreaterThan(1);
    const totalRows = split.chunks.reduce(
      (n, chunk) => n + chunk.reduce((m, s) => m + s.rows.length, 0),
      0,
    );
    expect(totalRows).toBe(30);
    for (const chunk of split.chunks) {
      expect(gridsToPromptText(chunk, limits).length).toBeLessThanOrEqual(300 + 25);
    }
  });
});
