import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkClientBundleBudget,
  CLIENT_BUNDLE_BUDGETS,
} from "./check-client-bundle-budget.mjs";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const performanceBudgets = fs.readFileSync(
  path.join(packageDir, "docs/performance-budgets.md"),
  "utf8",
);

function validManifest() {
  return {
    chunks: {
      "assets/index.js": {
        name: "index",
        isEntry: true,
        bytes: 100,
        imports: ["assets/shared.js"],
        dynamicImports: ["assets/home.js"],
      },
      "assets/shared.js": {
        name: "shared",
        bytes: 20,
        imports: [],
      },
      "assets/home.js": {
        name: "home",
        isDynamicEntry: true,
        bytes: 50,
        imports: ["assets/index.js"],
        dynamicImports: ["assets/optional.js"],
      },
      "assets/optional.js": {
        name: "optional",
        isDynamicEntry: true,
        bytes: 10_000,
        imports: [],
      },
      "assets/inventory.js": {
        name: "InventoryTab",
        isDynamicEntry: true,
        bytes: 20,
        imports: ["assets/shared.js"],
        dynamicImports: ["assets/heic.js"],
      },
      "assets/heic.js": {
        name: "heic2any",
        isDynamicEntry: true,
        bytes: 1_300,
        imports: ["assets/shared.js"],
      },
      "assets/qc.js": {
        name: "QcWorkflowTab",
        isDynamicEntry: true,
        bytes: 30,
        imports: ["assets/shared.js"],
        dynamicImports: [
          "assets/qc-allergen.js",
          "assets/qc-import.js",
          "assets/qc-recipe.js",
          "assets/qc-planning.js",
          "assets/qc-intelligence.js",
        ],
      },
      "assets/qc-allergen.js": {
        name: "QcAllergenActivityReport",
        isDynamicEntry: true,
        bytes: 1_000,
        imports: [],
      },
      "assets/qc-import.js": {
        name: "QcImportReview",
        isDynamicEntry: true,
        bytes: 1_000,
        imports: [],
      },
      "assets/qc-recipe.js": {
        name: "QcRecipeReview",
        isDynamicEntry: true,
        bytes: 1_000,
        imports: [],
      },
      "assets/qc-planning.js": {
        name: "QcPlanningView",
        isDynamicEntry: true,
        bytes: 1_000,
        imports: [],
      },
      "assets/qc-intelligence.js": {
        name: "QcIntelligenceReport",
        isDynamicEntry: true,
        bytes: 1_000,
        imports: [],
      },
    },
  };
}

function testBudgets(overrides = {}) {
  return {
    appShellBytes: 120,
    authenticatedStartupBytes: 170,
    homeChunkBytes: 50,
    qcFirstUseBytes: 30,
    heicConverterBytes: 1_300,
    ...overrides,
  };
}

test("documented production JavaScript limits match the enforced budgets", () => {
  const operations = [
    ["App-shell static graph", "appShellBytes"],
    ["Authenticated startup static graph", "authenticatedStartupBytes"],
    ["Home chunk", "homeChunkBytes"],
    ["QC first-use static graph", "qcFirstUseBytes"],
    ["HEIC converter chunk", "heicConverterBytes"],
  ];
  for (const [label, key] of operations) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = performanceBudgets.match(
      new RegExp(`^\\| ${escapedLabel} \\| ([\\d,]+) bytes \\|$`, "m"),
    );
    assert.ok(match, `performance-budgets.md must document the ${label} limit.`);
    assert.equal(
      Number(match[1].replaceAll(",", "")),
      CLIENT_BUNDLE_BUDGETS[key],
      `${label} documentation must match CLIENT_BUNDLE_BUDGETS.${key}.`,
    );
  }
});

test("measures startup and optional first-use graphs separately", () => {
  assert.deepEqual(
    checkClientBundleBudget(validManifest(), testBudgets()),
    {
      appShellBytes: 120,
      authenticatedStartupBytes: 170,
      homeChunkBytes: 50,
      qcFirstUseBytes: 30,
      heicConverterBytes: 1_300,
    },
  );
});

test("uses emitted file sizes rather than estimated manifest byte counts", () => {
  const manifest = validManifest();
  manifest.chunks["assets/index.js"].bytes = 1;
  manifest.chunks["assets/shared.js"].bytes = 1;
  manifest.chunks["assets/home.js"].bytes = 1;
  assert.deepEqual(
    checkClientBundleBudget(
      manifest,
      testBudgets(),
      (file) => ({
        "assets/index.js": 100,
        "assets/shared.js": 20,
        "assets/home.js": 50,
        "assets/qc.js": 30,
        "assets/heic.js": 1_300,
      })[file],
    ),
    {
      appShellBytes: 120,
      authenticatedStartupBytes: 170,
      homeChunkBytes: 50,
      qcFirstUseBytes: 30,
      heicConverterBytes: 1_300,
    },
  );
});

test("fails when the app shell exceeds its byte budget", () => {
  assert.throws(
    () =>
      checkClientBundleBudget(validManifest(), testBudgets({ appShellBytes: 119 })),
    /App-shell JavaScript is 120 bytes; budget is 119 bytes/,
  );
});

test("fails when authenticated startup exceeds its byte budget", () => {
  assert.throws(
    () =>
      checkClientBundleBudget(validManifest(), testBudgets({ authenticatedStartupBytes: 169 })),
    /Authenticated startup JavaScript is 170 bytes; budget is 169 bytes/,
  );
});

test("fails when the individual Home chunk exceeds its byte budget", () => {
  assert.throws(
    () =>
      checkClientBundleBudget(validManifest(), testBudgets({ homeChunkBytes: 49 })),
    /Home chunk is 50 bytes; budget is 49 bytes/,
  );
});

test("fails when the QC first-use graph exceeds its feature budget", () => {
  assert.throws(
    () => checkClientBundleBudget(validManifest(), testBudgets({ qcFirstUseBytes: 29 })),
    /QC first-use JavaScript is 30 bytes; budget is 29 bytes/,
  );
});

test("fails when the HEIC converter exceeds its feature budget", () => {
  assert.throws(
    () => checkClientBundleBudget(validManifest(), testBudgets({ heicConverterBytes: 1_299 })),
    /HEIC converter JavaScript is 1,300 bytes; budget is 1,299 bytes/,
  );
});

test("fails when a QC report is moved back into the initial QC graph", () => {
  const manifest = validManifest();
  manifest.chunks["assets/qc.js"].imports.push("assets/qc-intelligence.js");
  assert.throws(
    () => checkClientBundleBudget(manifest, testBudgets()),
    /QC panel "QcIntelligenceReport" must remain a separately loaded dynamic entry/,
  );
});

test("fails closed when a reachable chunk has no byte count", () => {
  const manifest = validManifest();
  delete manifest.chunks["assets/shared.js"].bytes;
  assert.throws(
    () => checkClientBundleBudget(manifest),
    /Build manifest is missing a valid byte count for "assets\/shared.js"/,
  );
});

test("fails closed when the Home entry is missing", () => {
  const manifest = validManifest();
  delete manifest.chunks["assets/home.js"];
  assert.throws(
    () => checkClientBundleBudget(manifest),
    /exactly one Home entry/,
  );
});
