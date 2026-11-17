// @vitest-environment node
//
// Opt-in, read-only audit of every workbook under attached_assets. This runs
// the web import preparation boundaries with saved pools/snapshots empty and
// AI requests disabled, then writes only minimized counts and source hashes.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({
    brands: [],
    flavorsByBrand: {},
    appTypes: [],
    pepTypes: [],
    cheeseIngredients: [],
    doughIngredients: [],
    sauceIngredients: [],
    sauceNames: [],
    dieTypes: [],
    doughNames: [],
    doughRecipes: [],
    sauceRecipes: [],
    cheeseRecipes: [],
  }),
  loadBrandFlavors: () => ({}),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  isNameDeleted: () => false,
  flavorNamespace: (brand: string) => `flavors:${brand}`,
}));
vi.mock("./savedSpecSheets", () => ({
  deriveSourceKey: (names: string[]) => names.join("|"),
  fetchSavedSpecSheets: async () => [],
  saveSpecSheet: async () => [],
  buildSpecSheetLabel: () => "Workbook audit",
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
  deleteSpecImportAliases: async () => {},
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: parseSpy,
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  ParseSpecAuthorizationError: class ParseSpecAuthorizationError extends Error {
    constructor() {
      super("AI parsing is not authorized");
      this.name = "ParseSpecAuthorizationError";
    }
  },
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => ({
    brandMatches: [],
    flavorMatches: [],
    ingredientMatches: [],
    appTypeMatches: [],
    pepTypeMatches: [],
  }),
}));
vi.mock("./premixMatch", () => ({
  requestMatchPremix: async () => ({ matches: [] }),
}));
vi.mock("./aiCorrections", () => ({
  saveAiCorrections: async () => {},
  logCorrectionWriteFailure: () => {},
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [],
  saveCheeseRecipes: async (items: unknown[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [],
  saveMixes: async (items: unknown[]) => items,
}));
vi.mock("./freezerPull", () => ({
  fetchFreezerPullItems: async () => [],
  saveFreezerPullItems: async (items: unknown[]) => items,
}));

import { prepareCheeseImport } from "./cheeseImport";
import { preparePremixImport } from "./premixImport";
import { prepareShippingImport } from "./shippingImport";
import { prepareDoughGuideImport } from "./recipeGuideImport";
import { prepareSpecImport } from "./specImport";
import { parseRunWorkbook } from "./utils/runExcel";

type ManifestFile = {
  path: string;
  bytes: number;
  sha256: string;
  contentGroup: string;
  duplicatePaths: string[];
  importer: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const evidenceDir = path.join(repoRoot, ".local/evidence/workbook-import-audit");
const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const statusCounts = (entries: Array<{ status: string }>) =>
  entries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    return counts;
  }, {});

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/not a valid|corrupt|cannot read|unsupported zip/.test(message)) return "READ_FAILURE";
  if (/no recognizable|doesn't look like|not found/.test(message)) return "NO_RECOGNIZED_CONTENT";
  return "PREPARATION_ERROR";
}

function summarizeSpec(prepared: Awaited<ReturnType<typeof prepareSpecImport>>) {
  const recipeRows = prepared.parsed.recipes.flatMap((recipe) => recipe.rows ?? []);
  const recipeRowsWithSource = recipeRows.filter((row) => row.sourceLocations?.length).length;
  const recipeUnitStates = prepared.parsed.recipes.reduce(
    (states, recipe) => {
      const key = recipe.rowsUnit ? "present" : "missing";
      states[key]++;
      return states;
    },
    { present: 0, missing: 0 },
  );
  return {
    profileCount: prepared.parsed.profiles.length,
    recipeCount: prepared.parsed.recipes.length,
    recipesByKind: prepared.parsed.recipes.reduce<Record<string, number>>((counts, recipe) => {
      counts[recipe.kind] = (counts[recipe.kind] ?? 0) + 1;
      return counts;
    }, {}),
    recipeRowCount: recipeRows.length,
    recipeRowsWithSourceCount: recipeRowsWithSource,
    recipeRowsMissingSourceCount: recipeRows.length - recipeRowsWithSource,
    recipesWithUnitCount: recipeUnitStates.present,
    recipesMissingUnitCount: recipeUnitStates.missing,
    unresolvedCount: prepared.unresolved?.length ?? 0,
    warningCount: prepared.parsed.warnings?.length ?? 0,
    sourceEvidenceCharacterCount: prepared.sourceEvidence?.sourceText.length ?? 0,
    incomplete: Boolean(prepared.unresolved?.length) ||
      (prepared.parsed.profiles.length === 0 && prepared.parsed.recipes.length === 0),
    aiFallbackUnsupported: Boolean(prepared.aiFallbackUnsupported),
  };
}

describe("source-bound workbook preparation audit", () => {
  it.skipIf(process.env.WORKBOOK_AUDIT !== "1")(
    "prepares every distinct workbook through its existing web import boundary without applying data",
    async () => {
      parseSpy.mockReset();
      const manifestBytes = await readFile(path.join(evidenceDir, "manifest.json"));
      const shapeDocument = JSON.parse(
        (await readFile(path.join(evidenceDir, "workbook-shapes.json"))).toString("utf8"),
      ) as { workbooks: Array<Record<string, unknown>> };
      const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
        filenameCount: number;
        distinctSha256Count: number;
        files: ManifestFile[];
      };
      expect(manifest.filenameCount).toBe(89);
      expect(manifest.distinctSha256Count).toBe(55);

      const representatives = new Map<string, ManifestFile>();
      for (const entry of manifest.files) {
        const key = `${entry.sha256}\u0000${entry.importer}`;
        if (!representatives.has(key)) representatives.set(key, entry);
      }

      const results: Array<Record<string, unknown>> = [];
      for (const entry of representatives.values()) {
        const absolutePath = path.join(repoRoot, entry.path);
        const bytes = new Uint8Array(await readFile(absolutePath));
        expect(sha256(bytes)).toBe(entry.sha256);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const sourceName = path.basename(entry.path);
        const result: Record<string, unknown> = {
          sha256: entry.sha256,
          importer: entry.importer,
          representativePath: entry.path,
          duplicatePaths: entry.duplicatePaths,
          byteCount: bytes.byteLength,
          status: "PASS",
        };

        try {
          if (entry.importer.startsWith("spec-import:") ||
              entry.importer.startsWith("spec-recipe-import:")) {
            const prepared = await prepareSpecImport(buffer, sourceName, undefined, {
              allowAi: false,
              includeSourcePreview: false,
            });
            const output = summarizeSpec(prepared);
            result.output = output;
            const counts = output as ReturnType<typeof summarizeSpec>;
            result.status = counts.unresolvedCount > 0
              ? (counts.profileCount + counts.recipeCount > 0 ? "PARTIAL_NEEDS_AI" : "NEEDS_AI")
              : (counts.profileCount + counts.recipeCount > 0
                ? "COMPLETE_DETERMINISTIC"
                : "EMPTY");
          } else if (entry.importer === "cheese-workbook-import") {
            const prepared = await prepareCheeseImport([buffer], undefined, [sourceName]);
            result.output = {
              recipeCount: prepared.recipes.length,
              componentRowCount: prepared.recipes.reduce(
                (sum, recipe) => sum + recipe.components.length,
                0,
              ),
              recipesWithSourceCount: Object.keys(prepared.sourceByRecipeId ?? {}).length,
              notePresent: Boolean(prepared.note),
            };
            result.status = prepared.recipes.length > 0 ? "COMPLETE_DETERMINISTIC" : "EMPTY";
          } else if (entry.importer === "premix-workbook-import") {
            const prepared = await preparePremixImport([buffer], undefined, [sourceName]);
            result.output = {
              mixCount: prepared.mixes.length,
              sourceMixCount: prepared.sourceMixes?.length ?? prepared.mixes.length,
              componentRowCount: prepared.mixes.reduce(
                (sum, mix) => sum + (mix.components?.length ?? 0),
                0,
              ),
              mixesWithSourceCount: Object.keys(prepared.sourceByMixId ?? {}).length,
              notePresent: Boolean(prepared.note),
            };
            result.status = prepared.mixes.length > 0 ? "COMPLETE_DETERMINISTIC" : "EMPTY";
          } else if (entry.importer === "shipping-guide-import") {
            const prepared = await prepareShippingImport(buffer, sourceName);
            result.output = {
              candidateCount: prepared.candidates.length,
              sourceRowsWithLocations: prepared.candidates.filter(
                (candidate) => Boolean(candidate.sourceCell),
              ).length,
            };
            result.status = prepared.candidates.length > 0
              ? "COMPLETE_DETERMINISTIC"
              : "EMPTY";
          } else if (entry.importer === "dough-recipe-guide-import") {
            const prepared = await prepareDoughGuideImport(buffer, [], sourceName);
            result.output = {
              candidateCount: prepared.candidates.length,
              rowsWithSource: prepared.candidates.filter(
                (candidate) => Boolean(candidate.sourceCell),
              ).length,
            };
            result.status = prepared.candidates.length > 0
              ? "COMPLETE_DETERMINISTIC"
              : "EMPTY";
          } else if (entry.importer === "schedule-import") {
            const prepared = parseRunWorkbook(buffer, sourceName);
            result.output = {
              scheduleRowCount: prepared.rows.length,
              errorCount: prepared.errors.length,
              multiDay: Boolean(prepared.multiDay),
            };
            result.status = prepared.rows.length > 0
              ? (prepared.errors.length > 0 ? "PARTIAL_WITH_ERRORS" : "COMPLETE_DETERMINISTIC")
              : "EMPTY";
          } else {
            result.status = "UNSUPPORTED_CLASSIFICATION";
          }
        } catch (error) {
          result.status = "FAIL";
          result.failureCode = safeFailureCode(error);
          result.failureType = error instanceof Error ? error.name : typeof error;
          if (error instanceof Error) {
            const missingExport = error.message.match(
              /No "([^"]+)" export (?:is )?defined on the "([^"]+)" mock/,
            );
            if (missingExport) {
              result.failureCode = "AUDIT_MOCK_MISSING_EXPORT";
              result.missingMockExport = missingExport[1];
              result.missingMockModule = missingExport[2];
            }
          }
          result.failureFrame = error instanceof Error
            ? error.stack?.split("\n").find((line) => line.trim().startsWith("at "))
                ?.trim()
                .replace(/\(.+\/workspace\//, "(workspace/")
                .replace(/.+\/workspace\//, "workspace/")
            : undefined;
        }
        results.push(result);
      }

      expect(parseSpy).not.toHaveBeenCalled();
      const byContent = new Map<string, Record<string, unknown>>();
      for (const result of results) {
        const hash = String(result.sha256);
        if (!byContent.has(hash)) byContent.set(hash, result);
      }
      const shapeByHash = new Map(
        shapeDocument.workbooks.map((shape) => [String(shape.sha256), shape]),
      );
      const files = manifest.files.map((entry) => {
        const result = results.find((candidate) =>
          candidate.sha256 === entry.sha256 && candidate.importer === entry.importer);
        return {
          path: entry.path,
          sha256: entry.sha256,
          importer: entry.importer,
          status: result?.status ?? "MISSING_PREPARATION",
          sourceBackedShape: shapeByHash.get(entry.sha256) ?? null,
          output: result?.output ?? null,
          failureCode: result?.failureCode ?? null,
        };
      });
      const evidence = {
        format: "workbook-preparation-audit",
        formatVersion: 1,
        capturedAt: new Date().toISOString(),
        source: {
          gitRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          manifestSha256: sha256(manifestBytes),
          fileCount: manifest.filenameCount,
          distinctContentCount: manifest.distinctSha256Count,
          distinctImporterRuns: representatives.size,
          preparationSource: "current web importer preparation functions; AI disabled; no commit/apply functions invoked",
        },
        counts: {
          files: files.length,
          uniqueContents: byContent.size,
          importerRuns: results.length,
          status: statusCounts(results.map((result) => ({
            status: String(result.status),
          }))),
        },
        importerRuns: results,
        files,
      };
      const sourceEvidence = {
        source: evidence.source,
        counts: evidence.counts,
        entries: files,
      };
      const failureEntries = files
        .filter((file) => file.status !== "COMPLETE_DETERMINISTIC")
        .map((file) => ({
          path: file.path,
          sha256: file.sha256,
          importer: file.importer,
          status: file.status,
          failureCode: file.failureCode,
          nextAction: file.status === "NEEDS_AI" || file.status === "PARTIAL_NEEDS_AI"
            ? "Run the separately authorized, paced AI fallback and review source-backed fields."
            : "Inspect the existing importer against this workbook's source-backed structure.",
        }));
      await writeFile(
        path.join(evidenceDir, "preparation.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
      await writeFile(
        path.join(evidenceDir, "matrix.json"),
        `${JSON.stringify(sourceEvidence, null, 2)}\n`,
      );
      await writeFile(
        path.join(evidenceDir, "failure-ledger.json"),
        `${JSON.stringify(failureEntries, null, 2)}\n`,
      );
      await writeFile(
        path.join(evidenceDir, "stage-counts.json"),
        `${JSON.stringify({
          ...evidence.counts,
          manifestFilenameCount: manifest.filenameCount,
          manifestDistinctContentCount: manifest.distinctSha256Count,
          distinctImporterRuns: representatives.size,
          aiProviderCalls: parseSpy.mock.calls.length,
          aiProviderStatus: "NOT_RUN_BY_DESIGN",
        }, null, 2)}\n`,
      );
      expect(files).toHaveLength(89);
      expect(results).toHaveLength(representatives.size);
    },
    180_000,
  );
});
