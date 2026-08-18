// @vitest-environment node
//
// Premix-import junk-file guard tests (web + mobile parity). Mirrors
// specImportJunkFileGuard.test.ts for the PREMIX importer.
//
// The xlsx reader does NOT throw on garbage bytes — a renamed PDF, an image,
// or random binary happily "reads" as one junk-text sheet. Without a pre-check
// that junk would flow into the deterministic premix parser (and potentially
// the AI name-matcher) and produce a confusing empty/garbled review instead of
// a clear per-file skip message. These tests prove both premix prepare paths
// reject a junk file BEFORE any parse/AI-matcher work, reusing the shared
// gridSanityIssue pre-check from @workspace/spec-import (same wording and
// thresholds as the spec importer — no forked heuristics):
//   * multi-file: the "could not be read … skipped: <name>" note names the
//     junk file while good files still import, and the AI matcher only ever
//     sees names from the good files;
//   * single/all-junk: a plain-language "doesn't look like a spreadsheet"
//     error with ZERO AI-matcher calls.
//
// The web module's network/storage collaborators are vi.mock'ed with a
// CALL-COUNTING AI matcher stub. The mobile module is loaded via the
// strip-imports → transpileModule → temp-.mjs harness documented in
// .agents/memory/web-test-harness.md (same pattern as
// specImportJunkFileGuard.test.ts), with the REAL @workspace/premix-import +
// @workspace/spec-import functions injected so the real gridSanityIssue runs
// inside the mobile glue.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import type { SheetGrid } from "@workspace/spec-import";
import * as specImportLib from "@workspace/spec-import";
import * as premixImportLib from "@workspace/premix-import";
import * as freezerPullLib from "@workspace/freezer-pull";

// ---------------------------------------------------------------------------
// Web module mocks — the AI matcher stub counts its calls so we can assert
// junk files never reach it.
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

const { matchSpy } = vi.hoisted(() => ({
  matchSpy: vi.fn(async () => ({ matches: [] })),
}));

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
vi.mock("./mixes", () => ({
  fetchMixes: async () => [],
  saveMixes: async () => {},
}));
vi.mock("./premixMatch", () => ({
  requestMatchPremix: matchSpy,
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: async () => {},
}));
vi.mock("./savedPremixSheets", () => ({
  savePremixSheet: async () => {},
  buildPremixSheetLabel: () => "",
  deriveSourceKey: () => "",
}));
// ./specImport is imported only for readWorkbookGrids (real xlsx reading), but
// loading the real module would drag in its own collaborators — mock the rest
// of them the same way specImportJunkFileGuard.test.ts does.
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: async () => ({ profiles: [], recipes: [] }),

  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  buildSpecSheetLabel: () => "",
  deriveSourceKey: () => "",
  loadCurrentReconcileRecipes: () => [],
}));

import { preparePremixImport } from "./premixImport";

// ---------------------------------------------------------------------------
// Buffers. The junk ones are exactly what a wrong-type pick produces: the
// xlsx reader accepts them and emits one sheet of binary-soup text.
// ---------------------------------------------------------------------------

function workbookBuffer(rows: string[][], sheetName = "Premix"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Rows forming one recognizable premix block (name → header → rows → Total). */
const GOOD_PREMIX_ROWS: string[][] = [
  ["Pepperoni Blend", "", ""],
  ["Ingredient", "Per Pizza", "Per Batch"],
  ["Pepperoni", "0.5", "100"],
  ["Romano", "0.1", "20"],
  ["Total", "", "120"],
];

/** A legit tiny premix workbook (real text → passes the sanity check). */
const goodBuffer = () => workbookBuffer(GOOD_PREMIX_ROWS);

/** Deterministic pseudo-random binary — a "renamed .bin" pick. */
function randomBinaryBuffer(): ArrayBuffer {
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 97 + 13) % 256;
  return bytes.buffer;
}

/** A PDF header followed by binary body — a renamed-PDF pick. */
function fakePdfBuffer(): ArrayBuffer {
  const head = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n";
  const headBytes = Array.from(head, (c) => c.charCodeAt(0));
  const body: number[] = [];
  for (let i = 0; i < 1200; i++) body.push([0x00, 0x01, 0x02, 0xff, 0xfe][i % 5]);
  return new Uint8Array([...headBytes, ...body]).buffer;
}

// ---------------------------------------------------------------------------
// Web prepare path.
// ---------------------------------------------------------------------------

beforeEach(() => {
  matchSpy.mockClear();
});

describe("web premix import — junk files are skipped BEFORE parse/AI-matcher", () => {
  it("surfaces the skip note with the junk filenames while good files import", async () => {
    const prepared = await preparePremixImport(
      [randomBinaryBuffer(), goodBuffer(), fakePdfBuffer()],
      undefined,
      ["notes.bin", "Good.xlsx", "renamed.pdf"],
    );

    const note = prepared.note ?? "";
    expect(note).toContain("could not be read");
    expect(note).toContain("notes.bin");
    expect(note).toContain("renamed.pdf");
    expect(note).not.toContain("Good.xlsx");
    // The good file's premix block still made it to review.
    expect(prepared.candidates.map((c) => c.mix.name)).toContain("Pepperoni Blend");
    // The AI matcher only ever saw the good file's unresolved product name —
    // no junk-soup names leaked into the prompt.
    expect(matchSpy).toHaveBeenCalledTimes(1);
    const arg = matchSpy.mock.calls[0]?.[0] as { unmatchedNames: string[] } | undefined;
    expect(arg?.unmatchedNames).toEqual(["Pepperoni Blend"]);
  });

  it("throws a plain-language error (no review) when EVERY picked file is junk, with zero AI calls", async () => {
    await expect(
      preparePremixImport([randomBinaryBuffer(), fakePdfBuffer()], undefined, [
        "a.bin",
        "b.pdf",
      ]),
    ).rejects.toThrow(/doesn't look like a spreadsheet/);
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it("rejects a single junk pick with the plain-language message pre-AI", async () => {
    await expect(preparePremixImport([randomBinaryBuffer()])).rejects.toThrow(
      /doesn't look like a spreadsheet/,
    );
    expect(matchSpy).not.toHaveBeenCalled();
  });
});

