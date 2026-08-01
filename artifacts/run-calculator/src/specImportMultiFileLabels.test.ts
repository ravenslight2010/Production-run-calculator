// @vitest-environment node
//
// Multi-file spec-import WARNING LABELING tests (web + mobile parity).
//
// A multi-file import surfaces three kinds of per-file advisories: shortened
// cells (longer than the per-cell prompt clamp), data past the column cap, and
// files that failed to read entirely. Each must be prefixed with the ACTUAL
// picked filename so the review says WHICH workbook the problem lives in — a
// refactor could silently regress back to positional "File 2" labels or
// mislabel which file a warning belongs to. These tests feed
// prepareSpecImportMulti multiple workbooks (one truncated cell, one overflow
// row, one unreadable) with a names array and assert the note text carries the
// real filenames — plus the documented fallback: no names → "File N".
//
// The web module's network/storage collaborators are vi.mock'ed (the AI parse
// stub returns a fixed tiny parse; the match endpoint throws so linkParsed's
// fail-safe keeps the canonicalized parse). The mobile module lives behind a
// React Native import graph, so it is loaded via the strip-imports →
// transpileModule → temp-.mjs harness documented in
// .agents/memory/web-test-harness.md, with the REAL @workspace/spec-import /
// @workspace/spec-reconcile functions injected through globalThis so the
// labeling logic under test runs against the real note formatters.

import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { PROMPT_MAX_CELL_CHARS, type SheetGrid } from "@workspace/spec-import";
import * as specImportLib from "@workspace/spec-import";
import * as specReconcileLib from "@workspace/spec-reconcile";

// ---------------------------------------------------------------------------
// Web module mocks — every network/storage collaborator prepareSpecImportMulti
// touches. The AI parse returns one fixed profile (a non-empty pass, so the
// retry rule never re-invokes it); the AI matcher throws (linkParsed is
// documented fail-safe: the canonicalized parse is kept as-is).
// ---------------------------------------------------------------------------

const EMPTY_KNOWN = {
  brands: [] as string[],
  flavorsByBrand: {} as Record<string, string[]>,
  appTypes: [] as string[],
  pepTypes: [] as string[],
  cheeseIngredients: [] as string[],
  doughIngredients: [] as string[],
  sauceIngredients: [] as string[],
  dieTypes: [] as string[],
};

const AI_PARSE_RESULT = {
  profiles: [{ brand: "Acme", flavor: "Classic", applicators: [], pepperonis: [] }],
  recipes: [],
};

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({ ...EMPTY_KNOWN }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: () => ({ touchedProfiles: [], crustProfiles: [] }),
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  buildSpecSheetLabel: () => "",
  deriveSourceKey: () => "",
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: async () => ({
    profiles: [{ brand: "Acme", flavor: "Classic", applicators: [], pepperonis: [] }],
    recipes: [],
  }),
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: async () => {},
}));

import { prepareSpecImportMulti } from "./specImport";

// ---------------------------------------------------------------------------
// Workbook builders. The "broken" workbook is all-blank: readWorkbookGrids
// succeeds but splitGridsForPrompt yields zero chunks, so parseWorkbookCore
// throws — exactly the per-file failure path the skip note reports.
// ---------------------------------------------------------------------------

const LONG_CELL = "x".repeat(PROMPT_MAX_CELL_CHARS + 40);

function workbookBuffer(rows: string[][], sheetName = "Specs"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Workbook whose sheet "Specs" row 1 holds a cell longer than the prompt clamp. */
const truncatedBuffer = () => workbookBuffer([[LONG_CELL, "brand list"]]);

/** Workbook whose sheet "Specs" row 1 has a real cell past the 60-column cap. */
const overflowBuffer = () =>
  workbookBuffer([[...Array.from({ length: 60 }, () => "c"), "lost cell"]]);

/** Workbook that reads but has no readable content → per-file parse throws. */
const brokenBuffer = () => workbookBuffer([[""]], "Empty");

describe("web prepareSpecImportMulti — warning labels name the right file", () => {
  it("prefixes truncated/overflow warnings and the skip note with the real filenames", async () => {
    const prepared = await prepareSpecImportMulti(
      [truncatedBuffer(), overflowBuffer(), brokenBuffer()],
      undefined,
      ["Alpha.xlsx", "Beta.xlsx", "Broken.xlsx"],
    );

    const note = prepared.note ?? "";
    // Shortened-cell warning names the file that holds it (not the overflow file).
    expect(note).toContain("was shortened before reading");
    expect(note).toContain("Alpha.xlsx Specs row 1");
    // Past-column-60 warning names ITS file.
    expect(note).toContain("past column 60");
    expect(note).toContain("Beta.xlsx Specs row 1");
    // Unreadable file is skipped and named.
    expect(note).toContain("could not be read");
    expect(note).toContain("Broken.xlsx");
    // No positional labels leak through when real names were supplied.
    expect(note).not.toMatch(/File \d/);
  });

  it("keeps each warning tied to its OWN file (labels are not cross-assigned)", async () => {
    const prepared = await prepareSpecImportMulti(
      [truncatedBuffer(), overflowBuffer()],
      undefined,
      ["First.xlsx", "Second.xlsx"],
    );
    const note = prepared.note ?? "";
    // Split the combined note into its two advisories and check each names only its file.
    const truncatedLine = note.split("\n").find((l) => l.includes("shortened before reading")) ?? "";
    const overflowLine = note.split("\n").find((l) => l.includes("past column 60")) ?? "";
    expect(truncatedLine).toContain("First.xlsx Specs row 1");
    expect(truncatedLine).not.toContain("Second.xlsx");
    expect(overflowLine).toContain("Second.xlsx Specs row 1");
    expect(overflowLine).not.toContain("First.xlsx");
  });

  it("falls back to positional File N labels when no names are passed", async () => {
    const prepared = await prepareSpecImportMulti([
      truncatedBuffer(),
      overflowBuffer(),
      brokenBuffer(),
    ]);
    const note = prepared.note ?? "";
    expect(note).toContain("File 1 Specs row 1");
    expect(note).toContain("File 2 Specs row 1");
    expect(note).toContain("could not be read");
    expect(note).toContain("File 3");
  });

  it("blank/whitespace-only names also fall back to File N (per-file, not all-or-nothing)", async () => {
    const prepared = await prepareSpecImportMulti(
      [truncatedBuffer(), overflowBuffer()],
      undefined,
      ["  ", "Named.xlsx"],
    );
    const note = prepared.note ?? "";
    expect(note).toContain("File 1 Specs row 1");
    expect(note).toContain("Named.xlsx Specs row 1");
  });
});

