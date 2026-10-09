// @vitest-environment node
//
// Source evidence belongs to the exact source that a manager reviewed, and
// only to the final spec Apply request. These tests cover fresh, cached,
// multi-file, and text-based reviews plus incomplete and over-limit sources.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  gridsToPromptText,
  parseDeterministicSpecWorkbook,
  PROMPT_MAX_CELL_CHARS,
  splitGridsForPrompt,
  type ParsedSpecImport,
} from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

const {
  parseSpy,
  fetchSheetsSpy,
  saveSheetSpy,
  projectSpy,
  adoptSpy,
  fetchNamedSpy,
} = vi.hoisted(() => ({
  parseSpy: vi.fn(async () => ({
    profiles: [{
      brand: "Acme",
      flavor: "Classic",
      applicators: [],
      pepperonis: [],
    }],
    recipes: [],
  })),
  fetchSheetsSpy: vi.fn(async () => [] as unknown[]),
  saveSheetSpy: vi.fn(async () => {}),
  projectSpy: vi.fn(),
  adoptSpy: vi.fn(),
  fetchNamedSpy: vi.fn(async () => [] as unknown[]),
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({
    brands: [],
    flavorsByBrand: {},
    appTypes: [],
    pepTypes: [],
    cheeseIngredients: [],
    doughIngredients: [],
    sauceIngredients: [],
    dieTypes: [],
    doughRecipes: [],
    sauceRecipes: [],
    cheeseRecipes: [],
    sauceNames: [],
  }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  isNameDeleted: () => false,
  flavorNamespace: (brand: string) => `flavors:${brand}`,
  applySpecImport: () => ({ touchedProfiles: [], crustProfiles: [] }),
  projectSpecImport: projectSpy,
  adoptSpecImportProjection: adoptSpy,
  loadCurrentFormulaRecipes: () => [],
}));

vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
  deleteSpecImportAliases: async () => {},
}));

vi.mock("./savedSpecSheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./savedSpecSheets")>();
  return {
    ...actual,
    saveSpecSheet: saveSheetSpy,
    fetchSavedSpecSheets: fetchSheetsSpy,
    buildSpecSheetLabel: () => "Reviewed spec",
    loadCurrentReconcileRecipes: () => [],
  };
});

vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: parseSpy,
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));

vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in source-evidence tests");
  },
}));
vi.mock("./mergeSuggest", () => ({ fetchMergeAliases: async () => [] }));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: async () => {},
  logCorrectionWriteFailure: () => {},
}));
vi.mock("./profileServerSync", () => ({
  canonicalProfileKey: (brand: string, flavor: string) =>
    `${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`,
  flushProfileQueueStrict: async () => {},
  markProfileForceEdited: () => {},
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: fetchNamedSpy,
  saveNamedRecipes: async (_kind: string, items: unknown[]) => items,
  addNamedRecipesToServerIfAbsent: async () => ({ added: 0, updated: 0, items: [] }),
}));
vi.mock("./dieLineDefaultsServer", () => ({
  fetchDieLineDefaults: async () => [],
  toOverridesMap: () => ({}),
}));

import {
  commitSpecImport,
  hashSpecImportSource,
  prepareSpecImport,
  prepareSpecImportFromText,
  prepareSpecImportMulti,
  prepareSpecImportMultiWithAi,
  prepareSpecImportWithAi,
  readWorkbookGrids,
  SPEC_PARSE_VERSION,
  type SpecImportPrepared,
} from "./specImport";
import { deriveSourceKey } from "./savedSpecSheets";

function workbookBuffer(rows: string[][], sheetName = "Specs"): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function formulaWorkbookBuffer(
  savedResult?: number,
  formula = "1/2",
  brand = "Acme",
  flavor = "Classic",
): ArrayBuffer {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Die Type", "Sauce oz/pizza"],
    [brand, flavor, "12 inch", ""],
  ]);
  worksheet.D2 = {
    t: "n",
    f: formula,
    ...(savedResult !== undefined ? { v: savedResult } : {}),
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Profiles");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function fixtureParse(extra: Record<string, unknown> = {}): ParsedSpecImport {
  return {
    profiles: [{
      brand: "Acme",
      flavor: "Classic",
      applicators: [],
      pepperonis: [],
    }],
    recipes: [],
    ...extra,
  };
}

async function renderedSource(buffer: ArrayBuffer): Promise<string> {
  const { chunks, droppedRows } = splitGridsForPrompt(await readWorkbookGrids(buffer));
  expect(droppedRows).toBe(0);
  return chunks.map((chunk) => gridsToPromptText(chunk)).join("\n\n");
}

async function installApplyFetch(): Promise<ReturnType<typeof vi.fn>> {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const match = String(input).match(/\/import-operations\/([^/]+)\/apply$/);
    if (!match) throw new Error(`Unexpected import operation URL: ${String(input)}`);
    const operationId = decodeURIComponent(match[1]);
    return new Response(JSON.stringify({
      operation: {
        operationId,
        status: "applied",
        result: {},
        resultHash: "source-evidence-result",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

async function expectAppliedEvidence(
  prepared: SpecImportPrepared,
  expectedText: string | undefined,
  operationId: string,
): Promise<void> {
  const fetchSpy = await installApplyFetch();
  await commitSpecImport(prepared, undefined, undefined, operationId);

  expect(fetchSpy).toHaveBeenCalledOnce();
  const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as Record<string, any>;
  expect(body.importType).toBe("spec");
  if (expectedText === undefined) {
    expect(body).not.toHaveProperty("sourceEvidence");
  } else {
    expect(body.sourceEvidence).toEqual({
      sourceText: expectedText,
      parseVersion: SPEC_PARSE_VERSION,
    });
  }
  expect(body.changes).not.toHaveProperty("sourceEvidence");
  expect(body).not.toHaveProperty("sourcePreviewCells");

  // Reusable snapshots contain the parsed import only, never one-time evidence
  // or review-only cell text.
  expect(prepared.parsed).not.toHaveProperty("sourceEvidence");
  const savedParse = saveSheetSpy.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;
  expect(savedParse).toBeDefined();
  expect(savedParse).not.toHaveProperty("sourceEvidence");
  expect(savedParse).not.toHaveProperty("sourcePreviewCells");
}

beforeEach(() => {
  parseSpy.mockClear();
  fetchSheetsSpy.mockReset().mockResolvedValue([]);
  saveSheetSpy.mockClear();
  projectSpy.mockReset().mockImplementation((parsed: ParsedSpecImport) => {
    const touchedProfiles = parsed.profiles.map(({ brand, flavor }) => ({ brand, flavor }));
    return {
      touchedProfiles,
      crustProfiles: [],
      nameCorrections: [],
      profileRows: touchedProfiles.map(({ brand, flavor }) => ({
        key: `${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`,
        brand,
        flavor,
        values: { brand, flavor },
        crustValues: {},
      })),
    };
  });
  adoptSpy.mockClear();
  fetchNamedSpy.mockReset().mockResolvedValue([]);
  vi.unstubAllGlobals();
});

describe("spec Apply source evidence", () => {
  it("attaches current workbook locations to deterministic values without an AI parse", async () => {
    const buffer = workbookBuffer(
      [
        ["Brand", "Flavor", "Die Type", "Sauce oz/pizza"],
        ["Acme", "Classic", "12 inch", "0.5"],
      ],
      "Profiles",
    );

    const prepared = await prepareSpecImport(buffer, "spec.xlsx");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.parsed.profiles[0].sourceLocations).toMatchObject({
      brand: [{ file: "spec.xlsx", sheet: "Profiles", cell: "A2" }],
      flavor: [{ file: "spec.xlsx", sheet: "Profiles", cell: "B2" }],
      dieType: [{ file: "spec.xlsx", sheet: "Profiles", cell: "C2" }],
      sauceOzPerPizza: [{ file: "spec.xlsx", sheet: "Profiles", cell: "D2" }],
    });
    expect(prepared.sourcePreviewCells).toContainEqual({
      file: "spec.xlsx",
      sheet: "Profiles",
      cell: "A2",
      value: "Acme",
    });
    expect(prepared.sourcePreviewCells).toContainEqual({
      file: "spec.xlsx",
      sheet: "Profiles",
      cell: "D2",
      value: "0.5",
    });
    const typedCell = prepared.sourcePreviewCells?.find((cell) => cell.cell === "D2");
    expect(typedCell).not.toHaveProperty("formula");
    expect(typedCell).not.toHaveProperty("savedResult");
    const expected = await renderedSource(buffer);
    await expectAppliedEvidence(prepared, expected, "import-spec-preview-memory-0001");
  });

  it("shows a formula and saved result only in the active review", async () => {
    const prepared = await prepareSpecImport(formulaWorkbookBuffer(0.5), "formula.xlsx");
    const formulaCell = prepared.sourcePreviewCells?.find((cell) => cell.cell === "D2");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(formulaCell).toMatchObject({
      file: "formula.xlsx",
      sheet: "Profiles",
      cell: "D2",
      value: "0.5",
      formula: "1/2",
      hasSavedResult: true,
      savedResult: "0.5",
    });
    expect(prepared.sourceEvidence?.sourceText).not.toContain("1/2");
    expect(prepared.sourceEvidence?.sourceText).not.toContain("0.5");

    const fetchSpy = await installApplyFetch();
    await commitSpecImport(prepared, undefined, undefined, "import-spec-formula-review-only");
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as Record<string, any>;
    expect(body.sourceEvidence.sourceText).not.toContain("1/2");
    expect(body.sourceEvidence.sourceText).not.toContain("0.5");
    expect(body).not.toHaveProperty("sourcePreviewCells");
    expect(prepared.parsed).not.toHaveProperty("sourcePreviewCells");
    const savedParse = saveSheetSpy.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(savedParse).not.toHaveProperty("sourcePreviewCells");
  });

  it("keeps formula previews scoped to each workbook and excludes formula results from Apply evidence", async () => {
    const first = formulaWorkbookBuffer(0.5, "1/2", "Acme", "Classic");
    const second = formulaWorkbookBuffer(0.75, "3/4", "Beta", "Spicy");
    const names = ["first-formula.xlsx", "second-formula.xlsx"];
    const prepared = await prepareSpecImportMulti(
      [first, second],
      undefined,
      names,
    );

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.sourcePreviewCells?.filter((cell) => cell.cell === "D2")).toEqual([
      {
        file: names[0],
        sheet: "Profiles",
        cell: "D2",
        value: "0.5",
        formula: "1/2",
        hasSavedResult: true,
        savedResult: "0.5",
      },
      {
        file: names[1],
        sheet: "Profiles",
        cell: "D2",
        value: "0.75",
        formula: "3/4",
        hasSavedResult: true,
        savedResult: "0.75",
      },
    ]);

    const expected = [
      await renderedSource(formulaWorkbookBuffer(undefined, "1/2", "Acme", "Classic")),
      await renderedSource(formulaWorkbookBuffer(undefined, "3/4", "Beta", "Spicy")),
    ].join("\n\n");
    expect(prepared.sourceEvidence?.sourceText).toBe(expected);
    for (const formulaDetail of ["1/2", "0.5", "3/4", "0.75"]) {
      expect(prepared.sourceEvidence?.sourceText).not.toContain(formulaDetail);
    }
    await expectAppliedEvidence(prepared, expected, "import-spec-multi-formula-review-only");
  });

  it("does not invent or cite a result when a formula has no saved workbook result", async () => {
    const buffer = formulaWorkbookBuffer();
    const grids = await readWorkbookGrids(buffer);
    const prepared = await prepareSpecImport(buffer, "formula-without-result.xlsx");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(grids[0].rows[1][3]).toBe("");
    expect(prepared.parsed.profiles[0].sauceOzPerPizza).toBeUndefined();
    expect(prepared.sourcePreviewCells?.some((cell) => cell.cell === "D2")).toBe(false);
    expect(prepared.sourceEvidence?.sourceText).not.toContain("1/2");
  });

  it("builds exact source-cell previews for each workbook in a multi-file review", async () => {
    const first = workbookBuffer(
      [["Brand", "Flavor"], ["Acme", "Classic"]],
      "Profiles",
    );
    const second = workbookBuffer(
      [["Brand", "Flavor"], ["Beta", "Spicy"]],
      "Products",
    );
    const prepared = await prepareSpecImportMulti(
      [first, second],
      undefined,
      ["first.xlsx", "second.xlsx"],
    );

    expect(prepared.sourcePreviewCells).toContainEqual({
      file: "first.xlsx",
      sheet: "Profiles",
      cell: "A2",
      value: "Acme",
    });
    expect(prepared.sourcePreviewCells).toContainEqual({
      file: "second.xlsx",
      sheet: "Products",
      cell: "A2",
      value: "Beta",
    });
  });

  it("keeps real Excel row numbers when the workbook reader encounters blank rows", async () => {
    const worksheet: XLSX.WorkSheet = {
      B2: { t: "s", v: "Brand" },
      C2: { t: "s", v: "Flavor" },
      B4: { t: "s", v: "Acme" },
      C4: { t: "s", v: "Classic" },
      "!ref": "B2:C4",
    };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Profiles");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const grids = await readWorkbookGrids(bytes);
    const result = parseDeterministicSpecWorkbook(grids);

    expect(grids[0].rows).toHaveLength(4);
    expect(result.parsed.profiles[0].sourceLocations).toMatchObject({
      brand: [{ sheet: "Profiles", cell: "B4" }],
      flavor: [{ sheet: "Profiles", cell: "C4" }],
    });
  });

  it("carries the current single-file source only on the final Apply", async () => {
    const buffer = workbookBuffer([["raw source", "single-file marker"]]);
    const prepared = await prepareSpecImportWithAi(buffer, "single.xlsx");
    const expected = "=== SHEET: Specs ===\nraw source\tsingle-file marker";

    expect(prepared.sourceEvidence?.sourceText).toBe(expected);
    await expectAppliedEvidence(prepared, expected, "import-spec-single-source-0001");
  });

  it("combines each selected workbook in a fresh multi-file review", async () => {
    const first = workbookBuffer([["raw source", "first marker"]], "First");
    const second = workbookBuffer([["raw source", "second marker"]], "Second");
    const prepared = await prepareSpecImportMultiWithAi(
      [first, second],
      undefined,
      ["first.xlsx", "second.xlsx"],
    );
    const expected = [
      "=== SHEET: First ===\nraw source\tfirst marker",
      "=== SHEET: Second ===\nraw source\tsecond marker",
    ].join("\n\n");

    expect(prepared.sourceEvidence?.sourceText).toBe(expected);
    await expectAppliedEvidence(prepared, expected, "import-spec-multi-source-0001");
  });

  it("uses current bytes, not snapshot contents, for a cached single-file parse", async () => {
    const buffer = workbookBuffer([["current source", "cached marker"]]);
    const names = ["cached.xlsx"];
    const hash = await hashSpecImportSource([buffer]);
    fetchSheetsSpy.mockResolvedValue([{
      id: 1,
      label: "old snapshot",
      sourceKey: deriveSourceKey(names),
      sourceHash: hash,
      createdAt: 100,
      data: fixtureParse({
        sourceEvidence: { sourceText: "STALE SNAPSHOT TEXT", parseVersion: SPEC_PARSE_VERSION },
      }),
    }]);

    const prepared = await prepareSpecImportWithAi(buffer, names[0]);
    const expected = "=== SHEET: Specs ===\ncurrent source\tcached marker";

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.sourceEvidence?.sourceText).toBe(expected);
    await expectAppliedEvidence(prepared, expected, "import-spec-cached-single-0001");
  });

  it("rebuilds cached multi-file evidence from the selected workbooks", async () => {
    const first = workbookBuffer([["current source", "first cached marker"]], "First");
    const second = workbookBuffer([["current source", "second cached marker"]], "Second");
    const names = ["cached-first.xlsx", "cached-second.xlsx"];
    const hash = await hashSpecImportSource([first, second]);
    fetchSheetsSpy.mockResolvedValue([{
      id: 2,
      label: "old batch snapshot",
      sourceKey: deriveSourceKey(names),
      sourceHash: hash,
      createdAt: 100,
      data: fixtureParse({
        sourceEvidence: { sourceText: "STALE BATCH SNAPSHOT", parseVersion: SPEC_PARSE_VERSION },
      }),
    }]);

    const prepared = await prepareSpecImportMultiWithAi(
      [first, second],
      undefined,
      names,
    );
    const expected = [
      "=== SHEET: First ===\ncurrent source\tfirst cached marker",
      "=== SHEET: Second ===\ncurrent source\tsecond cached marker",
    ].join("\n\n");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.sourceEvidence?.sourceText).toBe(expected);
    await expectAppliedEvidence(prepared, expected, "import-spec-cached-multi-0001");
  });

  it("retains text-based review input through the generated workbook", async () => {
    const prepared = await prepareSpecImportFromText(
      "raw text\tphoto marker",
      "photo.txt",
    );
    const expected = "=== SHEET: Photographed spec sheets ===\nraw text\tphoto marker";

    expect(prepared.sourceEvidence?.sourceText).toBe(expected);
    expect(prepared.sourcePreviewCells).toBeUndefined();
    await expectAppliedEvidence(prepared, expected, "import-spec-text-source-0001");
  });

  it("omits evidence when any file in the reviewed batch is skipped", async () => {
    const goodFile = workbookBuffer([["complete file", "first marker"]], "First");
    // The XLSX reader throws on an empty byte buffer, before source evidence
    // can be added to the per-file list.
    const unreadableFile = new ArrayBuffer(0);
    const prepared = await prepareSpecImportMultiWithAi(
      [goodFile, unreadableFile],
      undefined,
      ["good.xlsx", "unreadable.xlsx"],
    );

    expect(prepared.note).toMatch(/could not be read/i);
    expect(prepared.sourceEvidence).toBeUndefined();
    await expectAppliedEvidence(prepared, undefined, "import-spec-partial-multi-0001");
  });

  it("accepts a source just below the text limit and omits one just above it", async () => {
    const buildRows = (rowCount: number) => Array.from({ length: rowCount }, (_, index) => [
      `row-${String(index).padStart(4, "0")}`.padEnd(110, "x"),
    ]);
    const nearLimitBuffer = workbookBuffer(buildRows(890));
    const overLimitBuffer = workbookBuffer(buildRows(920));
    const nearLimitText = await renderedSource(nearLimitBuffer);
    const overLimitText = await renderedSource(overLimitBuffer);

    expect(nearLimitText.length).toBeGreaterThan(99_000);
    expect(nearLimitText.length).toBeLessThanOrEqual(100_000);
    expect(overLimitText.length).toBeGreaterThan(100_000);

    const nearLimitPrepared = await prepareSpecImport(nearLimitBuffer);
    expect(nearLimitPrepared.sourceEvidence?.sourceText).toBe(nearLimitText);
    const overLimitPrepared = await prepareSpecImport(overLimitBuffer);
    expect(overLimitPrepared.sourceEvidence).toBeUndefined();
  });

  it("omits a cell whose tail was truncated before parsing", async () => {
    const buffer = workbookBuffer([["x".repeat(PROMPT_MAX_CELL_CHARS + 1)]]);
    const prepared = await prepareSpecImportWithAi(buffer, "truncated.xlsx");

    expect(prepared.note).toMatch(/shortened before reading/i);
    expect(prepared.sourceEvidence).toBeUndefined();
    await expectAppliedEvidence(prepared, undefined, "import-spec-truncated-source-0001");
  });

  it("enforces the UTF-8 byte cap independently of the character cap", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => [
      `${String(index).padStart(4, "0")}${"é".repeat(56)}`,
    ]);
    const buffer = workbookBuffer(rows);
    const expected = await renderedSource(buffer);

    expect(expected.length).toBeLessThan(100_000);
    expect(new TextEncoder().encode(expected).byteLength).toBeGreaterThan(100 * 1024);
    const prepared = await prepareSpecImport(buffer);

    expect(prepared.sourceEvidence).toBeUndefined();
  });
});