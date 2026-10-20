import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "artifacts/run-calculator/dist/public");
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

console.log(JSON.stringify({
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
}, null, 2));
