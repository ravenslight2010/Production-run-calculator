// Deterministic CI guard for the export → prompt-text → chunking path.
//
// The manual real-AI harness (scripts/src/verify-large-spec-import.mts) proved
// that the worst spec-import failure mode is SILENT: a cell longer than the
// importer's PROMPT_MAX_CELL_CHARS clamp gets sliced when the workbook is
// flattened for the AI prompt, and the trailing content (e.g. the last flavors
// of a "Brand: flavor, flavor…" targets row) simply disappears — no error,
// the AI just never sees it. That invariant is fully deterministic, so this
// test enforces it in normal vitest with zero AI/network:
//
//   1. Generate the same 30×8 factory-scale dataset the harness uses.
//   2. Render it through the REAL exporter (buildSpecExportGrids).
//   3. Chunk it with the REAL splitter (splitGridsForPrompt) and flatten each
//      chunk with the REAL prompt renderer (gridsToPromptText).
//   4. Assert zero string loss: every exported cell appears verbatim in the
//      flattened prompt text, no rows were dropped, and every brand/flavor
//      target and ingredient row survives.
//
// If the exporter ever emits a cell that the importer's clamp would truncate
// (the exact bug the harness caught with real AI calls), this test fails in CI
// before any model is involved.

import { describe, expect, it } from "vitest";
import {
  PROMPT_MAX_CELL_CHARS,
  gridsToPromptText,
  splitGridsForPrompt,
  type SheetGrid,
} from "@workspace/spec-import";
import {
  buildSpecExportGrids,
  type ExportProfile,
  type ExportRecipe,
  type SpecExportInput,
} from "./index";

// ── Dataset generator (mirrors scripts/src/verify-large-spec-import.mts) ─────
// Same deterministic names/sizes as the real-AI harness so a failure here is
// directly comparable to a harness run. 30 brands × 8 flavors = 240 profiles
// + 90 recipes — the verified full production scale.

const BRAND_WORDS_A = [
  "Golden", "Rustic", "Alpine", "Harbor", "Prairie", "Copper", "Summit", "Willow",
  "Cedar", "Ember", "Frontier", "Heritage", "Lakeside", "Maple", "Northern", "Orchard",
  "Pioneer", "Quarry", "Redstone", "Silverline", "Timber", "Union", "Valley", "Westport",
  "Yellowfield", "Zephyr", "Bluebird", "Crestwood", "Dockside", "Evergreen",
];
const BRAND_WORDS_B = [
  "Crust", "Hearth", "Stone", "Mills", "Kitchens", "Ovens", "Bakehouse", "Foods",
  "Provisions", "Pie", "Slice", "Table", "Harvest", "Pantry", "Fireside",
];
const FLAVOR_NAMES = [
  "Cheese", "Pepperoni", "Supreme", "Hawaiian", "Margherita", "Sausage", "Veggie",
  "BBQ Chicken",
];
const DIE_TYPES = ["Argus", "Mystic", "Round 12", "Thin 10", "Deep 9"];
const APP_TYPES = ["Shredded Mozzarella", "Provolone Blend", "Cheddar Mix"];
const PEP_TYPES = ["Standard Pepperoni", "Cup Char Pepperoni"];

const DOUGH_INGREDIENTS = ["Flour", "Water", "Yeast", "Salt", "Sugar", "Olive Oil"];
const SAUCE_INGREDIENTS = ["Tomato Paste", "Water", "Spice Blend", "Sugar", "Salt"];
const CHEESE_INGREDIENTS = ["Mozzarella", "Provolone", "Cheese Substitute"];

const BRAND_COUNT = 30;
const FLAVOR_COUNT = 8;
// The production importer caps a single file at DEFAULT_MAX_PROMPT_CHUNKS; the
// harness (and this test) raise the cap because they verify CHUNK SIZE, not
// the per-file call cap — nothing may be dropped at this dataset size.
const MAX_CHUNKS = 32;

function brandName(i: number): string {
  return `${BRAND_WORDS_A[i % BRAND_WORDS_A.length]} ${BRAND_WORDS_B[i % BRAND_WORDS_B.length]}`;
}

type Dataset = { input: SpecExportInput; brands: string[]; flavors: string[] };

function buildDataset(brandCount: number, flavorCount: number): Dataset {
  const brands = Array.from({ length: brandCount }, (_, i) => brandName(i));
  const flavors = FLAVOR_NAMES.slice(0, flavorCount);
  const profiles: ExportProfile[] = [];
  const doughRecipes: ExportRecipe[] = [];
  const sauceRecipes: ExportRecipe[] = [];
  const cheeseRecipes: ExportRecipe[] = [];

  brands.forEach((brand, bi) => {
    const doughName = `${brand} Dough`;
    const sauceName = `${brand} Sauce`;
    const cheeseName = `${brand} Cheese Blend`;
    doughRecipes.push({
      name: doughName,
      rows: DOUGH_INGREDIENTS.map((ingredient, ri) => ({
        ingredient,
        lbs: 10 + bi + ri * 2.5,
      })),
    });
    sauceRecipes.push({
      name: sauceName,
      rows: SAUCE_INGREDIENTS.map((ingredient, ri) => ({
        ingredient,
        lbs: 5 + bi + ri * 1.5,
      })),
    });
    cheeseRecipes.push({
      name: cheeseName,
      rows: CHEESE_INGREDIENTS.map((ingredient, ri) => ({
        ingredient,
        lbs: 20 + bi + ri * 3,
      })),
    });
    flavors.forEach((flavor, fi) => {
      profiles.push({
        brand,
        flavor,
        dieType: DIE_TYPES[(bi + fi) % DIE_TYPES.length],
        sauceOzPerPizza: 3 + ((bi + fi) % 4) * 0.5,
        applicators: [
          { type: APP_TYPES[(bi + fi) % APP_TYPES.length], ozPerPizza: 6 + (fi % 3) * 0.5 },
        ],
        pepperonis:
          fi % 2 === 1
            ? [{ type: PEP_TYPES[bi % PEP_TYPES.length], sticks: 2 + (fi % 2), ozPerPizza: 1.5 }]
            : [],
        doughRecipeName: doughName,
        targetDoughballWeight: 14 + (bi % 5),
        sauceRecipeName: sauceName,
        cheeseRecipeNames: [cheeseName],
      });
    });
  });

  return {
    input: { profiles, doughRecipes, sauceRecipes, cheeseRecipes },
    brands,
    flavors,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a cell the same way gridsToPromptText's cleanRowCells does
 * (whitespace collapse + trim) WITHOUT the length clamp — the whole point is
 * to prove the clamp never has anything to cut. */
const normCell = (c: string): string => (c ?? "").toString().replace(/\s+/g, " ").trim();

/** Count non-empty rows after the prompt path's row cleaning (empty rows and
 * rows of only empty cells are skipped by both the renderer and the splitter). */
function countCleanRows(grids: ReadonlyArray<SheetGrid>): number {
  let n = 0;
  for (const g of grids) {
    for (const row of g.rows) {
      if (row.some((c) => normCell(c) !== "")) n += 1;
    }
  }
  return n;
}

function flattenChunks(chunks: SheetGrid[][]): string {
  return chunks.map((chunk) => gridsToPromptText(chunk)).join("\n");
}

// ── The guard ────────────────────────────────────────────────────────────────

describe("large export survives the prompt-text/chunking path with zero string loss", () => {
  const dataset = buildDataset(BRAND_COUNT, FLAVOR_COUNT);
  const grids = buildSpecExportGrids(dataset.input, {
    profiles: true,
    dough: true,
    sauce: true,
    cheese: true,
  });
  const split = splitGridsForPrompt(grids, {}, MAX_CHUNKS);
  const promptText = flattenChunks(split.chunks);
  const promptLines = promptText.split("\n");

  it("generates the full harness-scale dataset", () => {
    expect(dataset.input.profiles).toHaveLength(BRAND_COUNT * FLAVOR_COUNT);
    expect(grids.length).toBeGreaterThanOrEqual(4);
    // Sanity: the workbook is genuinely oversized for a single prompt chunk,
    // otherwise this test wouldn't exercise the chunking path at all.
    expect(split.chunks.length).toBeGreaterThan(1);
  });

  it("drops zero rows when chunked", () => {
    expect(split.droppedRows).toBe(0);
    // Every cleaned non-empty exported row lands in exactly one chunk.
    const rowsInChunks = split.chunks.reduce(
      (a, chunk) => a + chunk.reduce((b, sheet) => b + countCleanRows([sheet]), 0),
      0,
    );
    expect(rowsInChunks).toBe(countCleanRows(grids));
  });

  it("never hits the renderer's total-size truncation", () => {
    expect(promptText).not.toContain("… (truncated)");
  });

  it("emits no cell longer than the importer's per-cell clamp", () => {
    // THE invariant behind the original truncation bug: any exporter cell over
    // PROMPT_MAX_CELL_CHARS is silently sliced by gridsToPromptText, and the
    // AI never sees the tail. The exporter must wrap long lines (e.g.
    // "Brand: flavor, flavor…" target rows) under the clamp instead.
    const offenders: string[] = [];
    for (const g of grids) {
      for (const row of g.rows) {
        for (const cell of row) {
          const s = normCell(cell);
          if (s.length > PROMPT_MAX_CELL_CHARS) offenders.push(`${g.name}: "${s}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every exported cell verbatim in the flattened prompt text", () => {
    const missing: string[] = [];
    for (const g of grids) {
      for (const row of g.rows) {
        for (const cell of row) {
          const s = normCell(cell);
          if (s !== "" && !promptText.includes(s)) missing.push(`${g.name}: "${s}"`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps every brand/flavor profile row identifiable", () => {
    const missing: string[] = [];
    for (const p of dataset.input.profiles) {
      const found = promptLines.some(
        (line) => line.startsWith(`${p.brand}\t${p.flavor}\t`) || line.startsWith(`${p.brand}\t${p.flavor}`),
      );
      if (!found) missing.push(`${p.brand} / ${p.flavor}`);
    }
    expect(missing).toEqual([]);
  });

  it("keeps every recipe header, ingredient row, and brand/flavor target", () => {
    const failures: string[] = [];
    const allRecipes: Array<{ kind: string; recipe: ExportRecipe }> = [
      ...dataset.input.doughRecipes.map((recipe) => ({ kind: "dough", recipe })),
      ...dataset.input.sauceRecipes.map((recipe) => ({ kind: "sauce", recipe })),
      ...dataset.input.cheeseRecipes.map((recipe) => ({ kind: "cheese", recipe })),
    ];
    for (const { kind, recipe } of allRecipes) {
      if (!promptText.includes(`Recipe: ${recipe.name}`)) {
        failures.push(`MISSING RECIPE HEADER: [${kind}] ${recipe.name}`);
      }
      for (const row of recipe.rows) {
        const line = `${row.ingredient}\t${row.lbs}`;
        if (!promptText.includes(line)) {
          failures.push(`MISSING ROW: [${kind}] ${recipe.name} → ${line}`);
        }
      }
      // Targets: every flavor of the owning brand must appear in some
      // "<Brand>: …" target line (the exporter wraps long target sets into
      // multiple rows — the union across lines must cover all flavors). This
      // is exactly what the truncation bug lost: the trailing flavors of an
      // 8-flavor brand ("Veggie", "BBQ Chicken") vanished from the clipped cell.
      const brand = recipe.name.replace(/ (Dough|Sauce|Cheese Blend)$/i, "");
      const targeted = new Set<string>();
      for (const line of promptLines) {
        if (!line.startsWith(`${brand}: `)) continue;
        for (const f of line.slice(brand.length + 2).split(",")) {
          targeted.add(f.trim().toLowerCase());
        }
      }
      for (const flavor of dataset.flavors) {
        if (!targeted.has(flavor.toLowerCase())) {
          failures.push(`MISSING TARGET: [${kind}] ${recipe.name} → ${brand} / ${flavor}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("negative control: the verbatim check DOES catch a clamped cell", () => {
    // Prove the guard detects the failure mode it exists for: an over-clamp
    // cell must come out of gridsToPromptText missing its tail.
    const longCell = `Example Brand: ${FLAVOR_NAMES.join(", ")}, ${FLAVOR_NAMES.join(", ")}`;
    expect(longCell.length).toBeGreaterThan(PROMPT_MAX_CELL_CHARS);
    const text = gridsToPromptText([{ name: "Control", rows: [[longCell]] }]);
    expect(text).not.toContain(longCell);
    expect(text).toContain(longCell.slice(0, PROMPT_MAX_CELL_CHARS));
  });
});
