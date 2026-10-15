import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFERRED_HOME_MODULE_SUFFIXES = [
  "/src/components/SetupContent.tsx",
  "/src/components/WarehouseTabContent.tsx",
  "/src/components/MixesTabContent.tsx",
  "/src/components/SummaryToolsContent.tsx",
  "/src/components/live-stations/LivePackagingTabContent.tsx",
  "/src/components/live-stations/LiveSauceTabContent.tsx",
  "/src/components/live-stations/LiveFrontlineTabContent.tsx",
  "/src/components/live-stations/LiveDoughTabContent.tsx",
  "/src/components/live-stations/LiveSetupRecipesTabContent.tsx",
  "/src/components/live-stations/LiveStoppagesTabContent.tsx",
  "/src/components/live-stations/LiveSummaryTabContent.tsx",
];

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function visitChunks(startFiles, byFile, includeDynamicImports) {
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const chunk = byFile.get(file);
    if (!chunk) {
      throw new Error(`Build manifest is missing imported chunk "${file}".`);
    }
    const imports = [
      ...(chunk.imports ?? []),
      ...(includeDynamicImports ? chunk.dynamicImports ?? [] : []),
    ];
    for (const importedFile of imports) visit(importedFile);
  };
  for (const file of startFiles) visit(file);
  return visited;
}

export function checkHomeDeferredBoundary(manifest) {
  const entries = Object.entries(manifest.chunks ?? {});
  const byFile = new Map(entries);
  const roots = entries.filter(
    ([, chunk]) => chunk.isEntry || chunk.name === "home",
  );
  const homeEntries = entries.filter(([, chunk]) => chunk.name === "home");
  if (roots.length === 0 || homeEntries.length === 0) {
    throw new Error("Build manifest must contain both an application entry and a Home entry.");
  }

  const eagerChunks = visitChunks(roots.map(([file]) => file), byFile, false);
  const eagerModules = new Set(
    [...eagerChunks].flatMap((file) =>
      (byFile.get(file)?.modules ?? []).map(normalize),
    ),
  );
  const deferredChunks = visitChunks(
    homeEntries.flatMap(([, chunk]) => chunk.dynamicImports ?? []),
    byFile,
    true,
  );
  const deferredModules = new Set(
    [...deferredChunks].flatMap((file) =>
      (byFile.get(file)?.modules ?? []).map(normalize),
    ),
  );
  const allModules = new Set(
    entries.flatMap(([, chunk]) => (chunk.modules ?? []).map(normalize)),
  );

  const leaked = DEFERRED_HOME_MODULE_SUFFIXES.filter((suffix) =>
    [...eagerModules].some((source) => source.endsWith(suffix)),
  );
  if (leaked.length > 0) {
    throw new Error(
      `Workflow-only Home panels re-entered the opening static graph:\n${leaked
        .map((suffix) => `- ${suffix}`)
        .join("\n")}`,
    );
  }

  const missing = DEFERRED_HOME_MODULE_SUFFIXES.filter(
    (suffix) => ![...allModules].some((source) => source.endsWith(suffix)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Build manifest is missing deferred Home panel(s):\n${missing
        .map((suffix) => `- ${suffix}`)
        .join("\n")}`,
    );
  }

  const notDeferred = DEFERRED_HOME_MODULE_SUFFIXES.filter(
    (suffix) => ![...deferredModules].some((source) => source.endsWith(suffix)),
  );
  if (notDeferred.length > 0) {
    throw new Error(
      `Home panel(s) are not reachable through a dynamic Home import:\n${notDeferred
        .map((suffix) => `- ${suffix}`)
        .join("\n")}`,
    );
  }

  return {
    eagerModuleCount: eagerModules.size,
    deferredHomePanels: DEFERRED_HOME_MODULE_SUFFIXES.length,
  };
}

function runCli() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = path.resolve(
    scriptDir,
    "../dist/public/.vite/workbook-boundary-manifest.json",
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Build manifest not found at ${manifestPath}. Run the calculator build first.`);
  }
  const result = checkHomeDeferredBoundary(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
  );
  console.log(
    `Home boundary OK: ${result.eagerModuleCount} opening modules; ${result.deferredHomePanels} workflow-only panels are deferred.`,
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
