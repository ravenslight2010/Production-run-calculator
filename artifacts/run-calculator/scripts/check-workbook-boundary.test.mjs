import test from "node:test";
import assert from "node:assert/strict";
import { checkWorkbookBoundary } from "./check-workbook-boundary.mjs";

function validManifest() {
  return {
    chunks: {
      "assets/index.js": {
        name: "index",
        isEntry: true,
        imports: [],
        dynamicImports: ["assets/home.js"],
        modules: ["index.html", "/repo/src/main.tsx"],
      },
      "assets/home.js": {
        name: "home",
        isDynamicEntry: true,
        imports: ["assets/index.js"],
        dynamicImports: [
          "assets/specImport.js",
          "assets/ExcelImportDialog.js",
          "assets/SpecImportDialog.js",
          "assets/CheeseImportDialog.js",
        ],
        modules: ["/repo/src/pages/home.tsx"],
      },
      "assets/specImport.js": {
        name: "specImport",
        isDynamicEntry: true,
        modules: [
          "/repo/node_modules/.pnpm/@e965+xlsx@0.20.3/node_modules/@e965/xlsx/xlsx.mjs",
          "/repo/src/utils/runExcel.ts",
          "/repo/src/specImport.ts",
          "/repo/src/specExport.ts",
          "/repo/src/premixImport.ts",
          "/repo/src/shippingImport.ts",
          "/repo/src/recipeGuideImport.ts",
          "/repo/src/cheeseImport.ts",
        ],
      },
      "assets/ExcelImportDialog.js": {
        name: "ExcelImportDialog",
        isDynamicEntry: true,
        modules: [
          "/repo/src/components/ExcelImportDialog.tsx",
          "/repo/src/components/PremixImportDialog.tsx",
          "/repo/src/components/ShippingImportDialog.tsx",
          "/repo/src/components/RecipeGuideImportDialog.tsx",
        ],
      },
      "assets/SpecImportDialog.js": {
        name: "SpecImportDialog",
        isDynamicEntry: true,
        modules: ["/repo/src/components/SpecImportDialog.tsx"],
      },
      "assets/CheeseImportDialog.js": {
        name: "CheeseImportDialog",
        isDynamicEntry: true,
        modules: ["/repo/src/components/CheeseImportDialog.tsx"],
      },
    },
  };
}

test("accepts workbook features reachable only through dynamic imports", () => {
  assert.doesNotThrow(() => checkWorkbookBoundary(validManifest()));
});

test("rejects a workbook orchestrator in the opening static graph", () => {
  const manifest = validManifest();
  manifest.chunks["assets/home.js"].imports.push("assets/specImport.js");
  assert.throws(
    () => checkWorkbookBoundary(manifest),
    /Workbook feature modules re-entered the opening application graph/,
  );
});

test("rejects an import dialog in the opening static graph", () => {
  const manifest = validManifest();
  manifest.chunks["assets/home.js"].imports.push("assets/ExcelImportDialog.js");
  assert.throws(
    () => checkWorkbookBoundary(manifest),
    /Workbook feature modules re-entered the opening application graph/,
  );
});

test("checks Home even when the router loads it as a dynamic entry", () => {
  const manifest = validManifest();
  manifest.chunks["assets/home.js"].modules.push("/repo/src/specImport.ts");
  assert.throws(
    () => checkWorkbookBoundary(manifest),
    /Workbook feature modules re-entered the opening application graph/,
  );
});

test("fails closed when a required deferred entry disappears", () => {
  const manifest = validManifest();
  delete manifest.chunks["assets/CheeseImportDialog.js"];
  assert.throws(() => checkWorkbookBoundary(manifest), /required deferred workbook entry/);
});