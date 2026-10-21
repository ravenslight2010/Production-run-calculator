import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  assertSourceUnchanged,
  readBoundedJson,
  validateSourceRecord,
} from "../../scripts/src/build-source-identity.mjs";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readIdentity(file, description) {
  try {
    return readBoundedJson(file);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`${description} is missing or unreadable.${detail}`);
  }
}

export function verifyGeneratedBuildIdentity(repoRoot, outputDir) {
  const expectedFile = path.join(repoRoot, ".local/build-identity/expected-source.json");
  const generatedFile = path.join(outputDir, "app-build.json");
  const expected = validateSourceRecord(readIdentity(expectedFile, "Prepared source identity"));
  try {
    assertSourceUnchanged(repoRoot, expected);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(
      "Prepared source identity is stale for the current source. " +
      "Run pnpm run publish:ready before measuring." + detail,
    );
  }
  const generated = readIdentity(generatedFile, "Generated web build identity");
  if (!generated || typeof generated !== "object" || Array.isArray(generated) ||
      typeof generated.buildId !== "string" || generated.buildId.length === 0) {
    throw new Error(
      "Generated web build identity is missing a valid buildId in app-build.json.",
    );
  }
  if (generated.buildId !== expected.appBuildId) {
    throw new Error(
      `Generated web build is stale or mismatched: app-build.json has ${generated.buildId}, ` +
      `but the prepared source identity expects ${expected.appBuildId}. ` +
      "Run pnpm run publish:ready before measuring.",
    );
  }
}

export function measureHomeOpeningGraph(repoRoot = defaultRepoRoot) {
  const outputDir = path.join(repoRoot, "artifacts/run-calculator/dist/public");
  verifyGeneratedBuildIdentity(repoRoot, outputDir);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(outputDir, ".vite/workbook-boundary-manifest.json"),
    "utf8",
  ));
  const chunks = Object.entries(manifest.chunks ?? {});
  const byFile = new Map(chunks);
  const roots = chunks.filter(([, chunk]) => chunk.isEntry || chunk.name === "home");

  if (!roots.some(([, chunk]) => chunk.isEntry) || !roots.some(([, chunk]) => chunk.name === "home")) {
    throw new Error("Matching build manifest must contain both application and Home entries.");
  }

  function measure(file) {
    const bytes = fs.readFileSync(path.join(outputDir, file));
    return { file, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  }

  function traverseStaticGraph() {
    const visited = new Set();
    const visit = (file) => {
      if (visited.has(file)) return;
      const chunk = byFile.get(file);
      if (!chunk) throw new Error(`Build manifest is missing imported chunk ${file}.`);
      visited.add(file);
      for (const imported of chunk.imports ?? []) visit(imported);
    };
    for (const [file] of roots) visit(file);
    return visited;
  }

  const openingFiles = traverseStaticGraph();
  const opening = [...openingFiles].map(measure);
  const openingTotal = opening.reduce(
    (total, asset) => ({
      rawBytes: total.rawBytes + asset.rawBytes,
      gzipBytes: total.gzipBytes + asset.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  );

  const homeEntry = roots.find(([, chunk]) => chunk.name === "home");
  const panelNames = [
    "SetupContent",
    "WarehouseTabContent",
    "MixesTabContent",
    "SummaryToolsContent",
  ];
  const panels = panelNames.map((name) => {
    const entry = chunks.find(([, chunk]) => chunk.name === name);
    if (!entry) throw new Error(`Build manifest is missing deferred panel ${name}.`);
    const [file, chunk] = entry;
    return {
      name,
      ...measure(file),
      inOpeningStaticGraph: openingFiles.has(file),
      loadedByHomeDynamicImport: homeEntry[1].dynamicImports?.includes(file) ?? false,
    };
  });

  const cssFiles = new Set();
  const html = fs.readFileSync(path.join(outputDir, "index.html"), "utf8");
  for (const [, href] of html.matchAll(/href=["']([^"']+\.css)["']/g)) {
    const file = href.replace(/^\.?\//, "");
    if (!file.startsWith("../") && !path.isAbsolute(file)) cssFiles.add(file);
  }
  const css = [...cssFiles].map(measure);
  const cssTotal = css.reduce(
    (total, asset) => ({
      rawBytes: total.rawBytes + asset.rawBytes,
      gzipBytes: total.gzipBytes + asset.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  );

  return {
    openingRoots: roots.map(([file, chunk]) => ({ file, name: chunk.name ?? null })),
    openingJavaScript: {
      chunkCount: opening.length,
      ...openingTotal,
    },
    openingCss: { assetCount: css.length, ...cssTotal },
    openingJavaScriptAndCss: {
      rawBytes: openingTotal.rawBytes + cssTotal.rawBytes,
      gzipBytes: openingTotal.gzipBytes + cssTotal.gzipBytes,
    },
    deferredPanels: panels,
    deferredPanelTotals: panels.reduce(
      (total, panel) => ({
        rawBytes: total.rawBytes + panel.rawBytes,
        gzipBytes: total.gzipBytes + panel.gzipBytes,
      }),
      { rawBytes: 0, gzipBytes: 0 },
    ),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(measureHomeOpeningGraph(), null, 2));
}
