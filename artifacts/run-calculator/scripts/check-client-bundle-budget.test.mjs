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
    },
  };
}

test("documented production JavaScript limits match the enforced budgets", () => {
  const operations = [
    ["App-shell static graph", "appShellBytes"],
    ["Authenticated startup static graph", "authenticatedStartupBytes"],
    ["Home chunk", "homeChunkBytes"],
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

test("measures app-shell and authenticated startup without optional dynamic chunks", () => {
  assert.deepEqual(
    checkClientBundleBudget(validManifest(), {
      appShellBytes: 120,
      authenticatedStartupBytes: 170,
      homeChunkBytes: 50,
    }),
    {
      appShellBytes: 120,
      authenticatedStartupBytes: 170,
      homeChunkBytes: 50,
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
      {
        appShellBytes: 120,
        authenticatedStartupBytes: 170,
        homeChunkBytes: 50,
      },
      (file) => ({
        "assets/index.js": 100,
        "assets/shared.js": 20,
        "assets/home.js": 50,
      })[file],
    ),
    {
      appShellBytes: 120,
      authenticatedStartupBytes: 170,
      homeChunkBytes: 50,
    },
  );
});

test("fails when the app shell exceeds its byte budget", () => {
  assert.throws(
    () =>
      checkClientBundleBudget(validManifest(), {
        appShellBytes: 119,
        authenticatedStartupBytes: 170,
        homeChunkBytes: 50,
      }),
    /App-shell JavaScript is 120 bytes; budget is 119 bytes/,
  );
});

test("fails when authenticated startup exceeds its byte budget", () => {
  assert.throws(
    () =>
      checkClientBundleBudget(validManifest(), {
        appShellBytes: 120,
        authenticatedStartupBytes: 169,
        homeChunkBytes: 50,
      }),
    /Authenticated startup JavaScript is 170 bytes; budget is 169 bytes/,
  );
});

test("fails when the individual Home chunk exceeds its byte budget", () => {
  assert.throws(
    () =>
      checkClientBundleBudget(validManifest(), {
        appShellBytes: 120,
        authenticatedStartupBytes: 170,
        homeChunkBytes: 49,
      }),
    /Home chunk is 50 bytes; budget is 49 bytes/,
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
