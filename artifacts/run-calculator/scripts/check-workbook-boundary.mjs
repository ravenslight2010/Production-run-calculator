import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_EAGER_SOURCE = [
  /(^|\/)src\/(?:utils\/runExcel|specImport|specExport|premixImport|shippingImport|recipeGuideImport|cheeseImport)\.[cm]?[jt]sx?$/,
  /(^|\/)src\/components\/(?:Excel|Spec|Premix|Shipping|RecipeGuide|Cheese)ImportDialog\.[cm]?[jt]sx?$/,
  /(^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?xlsx\//,
];

const REQUIRED_DEFERRED_SOURCE = [
  /(^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@e965\/)?xlsx\/.*xlsx\.[cm]?js$/,
  /(^|\/)src\/utils\/runExcel\.tsx?$/,
  /(^|\/)src\/specImport\.tsx?$/,
  /(^|\/)src\/specExport\.tsx?$/,
  /(^|\/)src\/premixImport\.tsx?$/,
  /(^|\/)src\/shippingImport\.tsx?$/,
  /(^|\/)src\/recipeGuideImport\.tsx?$/,
  /(^|\/)src\/cheeseImport\.tsx?$/,
  /(^|\/)src\/components\/ExcelImportDialog\.tsx$/,
  /(^|\/)src\/components\/SpecImportDialog\.tsx$/,
  /(^|\/)src\/components\/PremixImportDialog\.tsx$/,
  /(^|\/)src\/components\/ShippingImportDialog\.tsx$/,
  /(^|\/)src\/components\/RecipeGuideImportDialog\.tsx$/,
  /(^|\/)src\/components\/CheeseImportDialog\.tsx$/,
];

function normalize(value) {
  return value.replaceAll("\\", "/");
}

export function checkWorkbookBoundary(manifest) {
  const entries = Object.entries(manifest.chunks ?? {});
  const byFile = new Map(entries);
  const roots = entries.filter(([, chunk]) => chunk.isEntry || chunk.name === "home");
  if (roots.length === 0) throw new Error("Build manifest has no application or Home entry.");

  const eager = new Set();
  const visit = (file, chunk) => {
    if (eager.has(file)) return;
    eager.add(file);
    for (const importedFile of chunk.imports ?? []) {
      const imported = byFile.get(importedFile);
      if (!imported) {
        throw new Error(`Build manifest is missing static import "${importedFile}" from "${file}".`);
      }
      visit(importedFile, imported);
    }
  };
  for (const [file, chunk] of roots) visit(file, chunk);

  const leaked = [...eager].flatMap((file) =>
    (byFile.get(file)?.modules ?? [])
      .map(normalize)
      .filter((source) => FORBIDDEN_EAGER_SOURCE.some((pattern) => pattern.test(source))),
  );
  if (leaked.length > 0) {
    throw new Error(
      `Workbook feature modules re-entered the opening application graph:\n${leaked
        .map((source) => `- ${source}`)
        .join("\n")}`,
    );
  }

  const sources = entries.flatMap(([, chunk]) => (chunk.modules ?? []).map(normalize));
  const missingDeferred = REQUIRED_DEFERRED_SOURCE.filter(
    (pattern) => !sources.some((source) => pattern.test(source)),
  );
  if (missingDeferred.length > 0) {
    throw new Error(
      `Build manifest is missing ${missingDeferred.length} required deferred workbook entry point(s).`,
    );
  }

  const eagerModuleCount = [...eager].reduce(
    (count, file) => count + (byFile.get(file)?.modules?.length ?? 0),
    0,
  );
  return { eagerModules: eagerModuleCount, deferredWorkbookEntries: REQUIRED_DEFERRED_SOURCE.length };
}

function runCli() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = path.resolve(scriptDir, "../dist/public/.vite/workbook-boundary-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Build manifest not found at ${manifestPath}. Run the calculator build first.`);
  }
  const result = checkWorkbookBoundary(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  console.log(
    `Workbook boundary OK: ${result.eagerModules} opening modules; ${result.deferredWorkbookEntries} deferred entry points verified.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}