import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { fingerprintSource, SOURCE_POLICY } from "../../scripts/src/build-source-files.mjs";
import { sourceFixture } from "../../scripts/src/fixtures/build-identity-fixture.mjs";
import { measureHomeOpeningGraph } from "./measure-home-opening-graph.mjs";

const expectedBuildId = "app-build:12345678-1234-1234-1234-123456789abc";
const otherBuildId = "app-build:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const panelNames = [
  "SetupContent",
  "WarehouseTabContent",
  "MixesTabContent",
  "SummaryToolsContent",
];

function createFixture(t, { buildId = expectedBuildId, includeBuildIdentity = true } = {}) {
  const repoRoot = sourceFixture(t);

  const outputDir = path.join(repoRoot, "artifacts/run-calculator/dist/public");
  const viteDir = path.join(outputDir, ".vite");
  const expectedDir = path.join(repoRoot, ".local/build-identity");
  fs.mkdirSync(viteDir, { recursive: true });
  fs.mkdirSync(expectedDir, { recursive: true });
  fs.writeFileSync(
    path.join(expectedDir, "expected-source.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "prepared-build-source",
      appBuildId: expectedBuildId,
      sourcePolicy: SOURCE_POLICY,
      sourceFingerprintSha256: fingerprintSource(repoRoot).sourceFingerprintSha256,
      gitRevision: null,
      gitBinding: "unavailable",
      preparedAt: "2026-10-21T06:18:48.202Z",
      mode: "publish",
    }),
  );
  if (includeBuildIdentity) {
    fs.writeFileSync(path.join(outputDir, "app-build.json"), JSON.stringify({ buildId }));
  }

  const chunks = {
    "assets/index.js": {
      name: "index",
      isEntry: true,
      imports: ["assets/shared.js"],
    },
    "assets/shared.js": {
      name: "shared",
      imports: [],
    },
    "assets/home.js": {
      name: "home",
      isDynamicEntry: true,
      imports: [],
      dynamicImports: panelNames.map((name) => `assets/${name}.js`),
    },
  };
  for (const name of panelNames) {
    chunks[`assets/${name}.js`] = {
      name,
      isDynamicEntry: true,
      imports: [],
    };
  }
  fs.writeFileSync(
    path.join(viteDir, "workbook-boundary-manifest.json"),
    JSON.stringify({ chunks }),
  );

  const assets = {
    "assets/index.js": "application-entry",
    "assets/shared.js": "shared-static-module",
    "assets/home.js": "home-module",
    ...Object.fromEntries(panelNames.map((name) => [`assets/${name}.js`, name])),
    "assets/styles.css": "body { color: red; }",
  };
  for (const [file, contents] of Object.entries(assets)) {
    const target = path.join(outputDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  fs.writeFileSync(path.join(outputDir, "index.html"), '<link href="./assets/styles.css">');
  return { repoRoot, assets };
}

test("measures a build whose generated identity matches the prepared source identity", (t) => {
  const { repoRoot, assets } = createFixture(t);

  const result = measureHomeOpeningGraph(repoRoot);

  assert.equal(result.openingJavaScript.chunkCount, 3);
  assert.equal(result.openingJavaScript.rawBytes, Buffer.byteLength(
    assets["assets/index.js"] + assets["assets/shared.js"] + assets["assets/home.js"],
  ));
  assert.equal(result.openingCss.assetCount, 1);
  assert.equal(result.openingCss.gzipBytes, gzipSync(assets["assets/styles.css"]).length);
  assert.equal(
    result.openingJavaScriptAndCss.gzipBytes,
    ["assets/index.js", "assets/shared.js", "assets/home.js", "assets/styles.css"]
      .reduce((total, file) => total + gzipSync(assets[file]).length, 0),
  );
  assert.deepEqual(
    result.deferredPanels.map((panel) => panel.loadedByHomeDynamicImport),
    [true, true, true, true],
  );
  assert.deepEqual(
    result.deferredPanels.map((panel) => panel.inOpeningStaticGraph),
    [false, false, false, false],
  );
});

test("rejects a missing generated web build identity before measuring assets", (t) => {
  const { repoRoot } = createFixture(t, { includeBuildIdentity: false });
  fs.rmSync(
    path.join(repoRoot, "artifacts/run-calculator/dist/public/.vite/workbook-boundary-manifest.json"),
  );

  assert.throws(
    () => measureHomeOpeningGraph(repoRoot),
    /Generated web build identity is missing or unreadable/,
  );
});

test("rejects a generated web build identity that differs from the prepared source", (t) => {
  const { repoRoot } = createFixture(t, { buildId: otherBuildId });
  fs.rmSync(
    path.join(repoRoot, "artifacts/run-calculator/dist/public/.vite/workbook-boundary-manifest.json"),
  );

  assert.throws(
    () => measureHomeOpeningGraph(repoRoot),
    /Generated web build is stale or mismatched/,
  );
});

test("rejects a prepared source identity that no longer matches current source", (t) => {
  const { repoRoot } = createFixture(t);
  fs.writeFileSync(
    path.join(repoRoot, "artifacts/run-calculator/src/main.ts"),
    "export const changedAfterPreparation = true;\n",
  );

  assert.throws(
    () => measureHomeOpeningGraph(repoRoot),
    /Prepared source identity is stale for the current source/,
  );
});
