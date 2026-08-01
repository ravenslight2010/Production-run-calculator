// @vitest-environment node
//
// Junk-file guard tests (web + mobile parity).
//
// The xlsx reader does NOT throw on garbage bytes — a renamed PDF, an image,
// or random binary happily "reads" as one junk-text sheet. Without a pre-check
// that junk would burn an AI parse call and produce a garbled review instead
// of a clear per-file skip message. These tests prove:
//   1. gridSanityIssue (the shared cheap pre-check) flags binary junk and
//      empty grids but passes real text content, and
//   2. both prepare paths reject a junk file BEFORE the AI parse call — in the
//      multi-file path the existing "could not be read … skipped: <name>"
//      note names the junk file while good files still import.
//
// The web module's network/storage collaborators are vi.mock'ed with a
// CALL-COUNTING AI parse stub so the "no AI call burned on junk" claim is
// asserted directly. The mobile module is loaded via the strip-imports →
// transpileModule → temp-.mjs harness documented in
// .agents/memory/web-test-harness.md (same pattern as
// specImportMultiFileLabels.test.ts), with the REAL @workspace/spec-import
// functions injected so the real gridSanityIssue runs inside the mobile glue.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import {
  gridSanityIssue,
  GRID_SANITY_EMPTY_MESSAGE,
  GRID_SANITY_JUNK_MESSAGE,
  type SheetGrid,
} from "@workspace/spec-import";
import * as specImportLib from "@workspace/spec-import";
import * as specReconcileLib from "@workspace/spec-reconcile";

// ---------------------------------------------------------------------------
// Web module mocks — same shape as specImportMultiFileLabels.test.ts, but the
// AI parse stub counts its calls so we can assert junk files never reach it.
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

const { parseSpy } = vi.hoisted(() => ({
  parseSpy: vi.fn(async () => ({
    profiles: [{ brand: "Acme", flavor: "Classic", applicators: [], pepperonis: [] }],
    recipes: [],
  })),
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
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  buildSpecSheetLabel: () => "",
  deriveSourceKey: () => "",
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: parseSpy,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: async () => {},
}));

import { prepareSpecImport, prepareSpecImportMulti } from "./specImport";

// ---------------------------------------------------------------------------
// Buffers. The junk ones are exactly what a wrong-type pick produces: the
// xlsx reader accepts them and emits one sheet of binary-soup text.
// ---------------------------------------------------------------------------

function workbookBuffer(rows: string[][], sheetName = "Specs"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** A legit tiny spec workbook (real text → passes the sanity check). */
const goodBuffer = () =>
  workbookBuffer([
    ["Brand", "Flavor", "Cases"],
    ["Acme", "Classic", "120"],
  ]);

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
// The shared pre-check itself (pure).
// ---------------------------------------------------------------------------

describe("gridSanityIssue — cheap junk detection", () => {
  it("passes real spreadsheet text (any language, numbers-only, small CSVs)", () => {
    expect(
      gridSanityIssue([
        { name: "Specs", rows: [["Brand", "Flavor"], ["Acme", "Classic Pepperoni"]] },
      ]),
    ).toBeNull();
    expect(
      gridSanityIssue([{ name: "S", rows: [["1200", "34.5", "77"], ["9", "8", "7"]] }]),
    ).toBeNull();
    expect(
      gridSanityIssue([{ name: "S", rows: [["品牌", "口味"], ["测试", "经典香肠比萨"]] }]),
    ).toBeNull();
  });

  it("does not misflag a tiny legit sheet (below the heuristic sample floor)", () => {
    expect(gridSanityIssue([{ name: "S", rows: [["a", "b"]] }])).toBeNull();
  });

  it("flags all-blank grids as empty", () => {
    expect(gridSanityIssue([])).toBe(GRID_SANITY_EMPTY_MESSAGE);
    expect(gridSanityIssue([{ name: "Empty", rows: [["", "  "], [""]] }])).toBe(
      GRID_SANITY_EMPTY_MESSAGE,
    );
  });

  it("flags control-character soup (random binary read as text)", () => {
    let junk = "";
    for (let i = 0; i < 600; i++) junk += String.fromCharCode((i * 97 + 13) % 256);
    expect(gridSanityIssue([{ name: "Sheet1", rows: [[junk]] }])).toBe(
      GRID_SANITY_JUNK_MESSAGE,
    );
  });

  it("flags symbol soup with no control chars (image bytes in the printable range)", () => {
    // 0xAB ("«") repeated — printable latin-1, but nothing word-like.
    expect(
      gridSanityIssue([{ name: "Sheet1", rows: [["\u00ff\u00d8" + "\u00ab".repeat(500)]] }]),
    ).toBe(GRID_SANITY_JUNK_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// Web prepare paths.
// ---------------------------------------------------------------------------

beforeEach(() => {
  parseSpy.mockClear();
});

describe("web multi-file import — junk files are skipped BEFORE the AI call", () => {
  it("surfaces the skip note with the junk filenames and never calls the AI on them", async () => {
    const prepared = await prepareSpecImportMulti(
      [randomBinaryBuffer(), goodBuffer(), fakePdfBuffer()],
      undefined,
      ["notes.bin", "Good.xlsx", "renamed.pdf"],
    );

    const note = prepared.note ?? "";
    expect(note).toContain("could not be read");
    expect(note).toContain("notes.bin");
    expect(note).toContain("renamed.pdf");
    expect(note).not.toContain("Good.xlsx");
    // The good file still imported.
    expect(prepared.parsed.profiles.map((p) => `${p.brand}/${p.flavor}`)).toContain(
      "Acme/Classic",
    );
    // Exactly one AI parse call — for the good file only. Junk never burns one.
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it("throws (no review) when EVERY picked file is junk, with zero AI calls", async () => {
    await expect(
      prepareSpecImportMulti([randomBinaryBuffer(), fakePdfBuffer()], undefined, [
        "a.bin",
        "b.pdf",
      ]),
    ).rejects.toThrow(/doesn't look like a spreadsheet/);
    expect(parseSpy).not.toHaveBeenCalled();
  });
});

describe("web single-file import — junk throws a plain-language error pre-AI", () => {
  it("rejects a junk pick without an AI call", async () => {
    await expect(prepareSpecImport(randomBinaryBuffer())).rejects.toThrow(
      /doesn't look like a spreadsheet/,
    );
    expect(parseSpy).not.toHaveBeenCalled();
  });
});

