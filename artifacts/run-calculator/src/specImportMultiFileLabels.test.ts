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

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

// ---------------------------------------------------------------------------
// Mobile parity — load the RN-bound module via the strip-imports harness.
// The prelude wires the REAL shared-lib functions (so the real note formatters
// run) and stubs only the network/storage glue, mirroring the web mocks above.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(here, "../../../_archived/mobile/context/specImport.ts");

const MOBILE_PRELUDE = `
const {
  applyNameMatches, canonicalize, collectMatchCandidates, collectSpecAliases,
  crossFillSpecImport, extractEmbeddedApplicatorBlends, findOverflowColumnRows,
  findTruncatedCells, formatOverflowColumnsNote, formatTruncatedCellsNote,
  gridSanityIssue, gridsToPromptText, mergeParsedSpecImports, recipeTargets,
  resolveRetriedParsePass, shouldRetryParsePass, splitGridsForPrompt,
  summarizeSpecImport, canonicalizeSpecImportCheeseRecipeNames,
  dedupeSpecImportCheeseRecipes, linkSpecImportCheeseToExisting,
  linkSpecImportNamedRecipesToExisting, linkSpecImportDieTypesToExisting,
} = globalThis.__SPEC_IMPORT_LIB__;
const { reconcileSpecWithRecipes, toReconcileRecipes } = globalThis.__SPEC_RECONCILE_LIB__;
const {
  requestParseSpecSheet, requestMatchImport, fetchSpecImportAliases,
  saveSpecImportAliases, saveSpecSheet, buildSpecSheetLabel, saveAiCorrections,
} = globalThis.__SPEC_IMPORT_STUBS__;
const XLSX = {};
`;

interface MobileSpecImportModule {
  prepareSpecImportMulti: (
    gridsList: SheetGrid[][],
    store: unknown,
    onProgress?: (done: number, total: number) => void,
    names?: string[],
  ) => Promise<{ note?: string }>;
}

let mobileTempFile: string | null = null;
let mobile: MobileSpecImportModule;

async function loadMobileSpecImport(): Promise<MobileSpecImportModule> {
  const ts = (await import("typescript")).default;
  const raw = fs.readFileSync(MOBILE_FILE, "utf8");
  const withoutImports = raw.replace(/import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g, "");
  const source = MOBILE_PRELUDE + withoutImports;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  });
  const out = path.join(
    os.tmpdir(),
    `specImportMulti.mobile.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  mobileTempFile = out;
  return (await import(pathToFileURL(out).href)) as MobileSpecImportModule;
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>).__SPEC_IMPORT_LIB__ = specImportLib;
  (globalThis as Record<string, unknown>).__SPEC_RECONCILE_LIB__ = specReconcileLib;
  (globalThis as Record<string, unknown>).__SPEC_IMPORT_STUBS__ = {
    requestParseSpecSheet: async () => ({
      profiles: AI_PARSE_RESULT.profiles.map((p) => ({ ...p })),
      recipes: [],
    }),
    requestMatchImport: async () => {
      throw new Error("no AI matcher in tests");
    },
    fetchSpecImportAliases: async () => [],
    saveSpecImportAliases: async () => {},
    saveSpecSheet: async () => {},
    buildSpecSheetLabel: () => "",
    saveAiCorrections: async () => {},
  };
  mobile = await loadMobileSpecImport();
});

afterAll(() => {
  if (mobileTempFile && fs.existsSync(mobileTempFile)) fs.rmSync(mobileTempFile);
  delete (globalThis as Record<string, unknown>).__SPEC_IMPORT_LIB__;
  delete (globalThis as Record<string, unknown>).__SPEC_RECONCILE_LIB__;
  delete (globalThis as Record<string, unknown>).__SPEC_IMPORT_STUBS__;
});

const mobileStore = () => ({
  known: { ...EMPTY_KNOWN },
  currentRecipes: [],
  profileExists: () => false,
  recipeExists: () => false,
  apply: () => {},
});

const truncatedGrids = (): SheetGrid[] => [{ name: "Specs", rows: [[LONG_CELL, "brand list"]] }];
const overflowGrids = (): SheetGrid[] => [
  { name: "Specs", rows: [[...Array.from({ length: 60 }, () => "c"), "lost cell"]] },
];
// All-blank grid: splitGridsForPrompt yields zero chunks → per-file parse throws.
const brokenGrids = (): SheetGrid[] => [{ name: "Empty", rows: [[""]] }];

describe("mobile prepareSpecImportMulti — warning labels name the right file (parity)", () => {
  it("prefixes truncated/overflow warnings and the skip note with the real filenames", async () => {
    const prepared = await mobile.prepareSpecImportMulti(
      [truncatedGrids(), overflowGrids(), brokenGrids()],
      mobileStore(),
      undefined,
      ["Alpha.xlsx", "Beta.xlsx", "Broken.xlsx"],
    );
    const note = prepared.note ?? "";
    expect(note).toContain("was shortened before reading");
    expect(note).toContain("Alpha.xlsx Specs row 1");
    expect(note).toContain("past column 60");
    expect(note).toContain("Beta.xlsx Specs row 1");
    expect(note).toContain("could not be read");
    expect(note).toContain("Broken.xlsx");
    expect(note).not.toMatch(/File \d/);
  });

  it("keeps each warning tied to its OWN file", async () => {
    const prepared = await mobile.prepareSpecImportMulti(
      [truncatedGrids(), overflowGrids()],
      mobileStore(),
      undefined,
      ["First.xlsx", "Second.xlsx"],
    );
    const note = prepared.note ?? "";
    const truncatedLine = note.split("\n").find((l) => l.includes("shortened before reading")) ?? "";
    const overflowLine = note.split("\n").find((l) => l.includes("past column 60")) ?? "";
    expect(truncatedLine).toContain("First.xlsx Specs row 1");
    expect(truncatedLine).not.toContain("Second.xlsx");
    expect(overflowLine).toContain("Second.xlsx Specs row 1");
    expect(overflowLine).not.toContain("First.xlsx");
  });

  it("falls back to positional File N labels when no names are passed", async () => {
    const prepared = await mobile.prepareSpecImportMulti(
      [truncatedGrids(), overflowGrids(), brokenGrids()],
      mobileStore(),
    );
    const note = prepared.note ?? "";
    expect(note).toContain("File 1 Specs row 1");
    expect(note).toContain("File 2 Specs row 1");
    expect(note).toContain("could not be read");
    expect(note).toContain("File 3");
  });
});
