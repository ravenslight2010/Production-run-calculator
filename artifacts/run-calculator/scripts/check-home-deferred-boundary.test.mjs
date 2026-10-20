import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkHomeDeferredSourceBoundary,
  checkHomeDeferredBoundary,
  DEFERRED_HOME_MODULE_SUFFIXES,
} from "./check-home-deferred-boundary.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function sourceHome() {
  return DEFERRED_HOME_MODULE_SUFFIXES.slice(0, 4)
    .map((suffix) => {
      const name = path.basename(suffix, ".tsx");
      return `const load${name} = () => import("../components/${name}");`;
    })
    .join("\n");
}

function validManifest() {
  return {
    chunks: {
      "assets/index.js": {
        name: "index",
        isEntry: true,
        imports: [],
        dynamicImports: ["assets/home.js"],
        modules: ["/repo/src/main.tsx"],
      },
      "assets/home.js": {
        name: "home",
        isDynamicEntry: true,
        imports: [],
        dynamicImports: ["assets/deferred-home-panels.js"],
        modules: ["/repo/src/pages/home.tsx"],
      },
      "assets/deferred-home-panels.js": {
        name: "deferredHomePanels",
        isDynamicEntry: true,
        imports: [],
        dynamicImports: [],
        modules: DEFERRED_HOME_MODULE_SUFFIXES.map((suffix) => `/repo${suffix}`),
      },
    },
  };
}

test("source keeps optional panels dynamically loaded and outside LiveRunTabContent static imports", () => {
  const homeSource = fs.readFileSync(
    path.resolve(scriptDir, "../src/pages/home.tsx"),
    "utf8",
  );
  const liveRunSource = fs.readFileSync(
    path.resolve(
      scriptDir,
      "../src/components/live-stations/LiveRunTabContent.tsx",
    ),
    "utf8",
  );

  const result = checkHomeDeferredSourceBoundary({ homeSource, liveRunSource });
  assert.equal(result.deferredHomePanels, 4);
});

test("source boundary rejects a deferred panel statically imported by LiveRunTabContent", () => {
  const liveRunSource =
    'import SetupContent from "../../components/SetupContent";';

  assert.throws(
    () =>
      checkHomeDeferredSourceBoundary({
        homeSource: sourceHome(),
        liveRunSource,
      }),
    /LiveRunTabContent statically imports deferred Home panel/,
  );
});

test("source boundary rejects removal of an existing Home dynamic loader", () => {
  const homeSource = sourceHome().replace(
    'const loadMixesTabContent = () => import("../components/MixesTabContent");\n',
    "",
  );

  assert.throws(
    () =>
      checkHomeDeferredSourceBoundary({
        homeSource,
        liveRunSource: "",
      }),
    /Home is missing dynamic imports for deferred panel/,
  );
});

test("accepts optional Home surfaces reachable only through a dynamic import", () => {
  const result = checkHomeDeferredBoundary(validManifest());
  assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
  assert.equal(result.eagerModuleCount, 2);
});

test("rejects a deferred Home surface in the opening static graph", () => {
  const manifest = validManifest();
  manifest.chunks["assets/index.js"].imports.push("assets/deferred-home-panels.js");

  assert.throws(
    () => checkHomeDeferredBoundary(manifest),
    /Deferred Home surfaces re-entered the opening static graph/,
  );
});

test("rejects a deferred Home surface statically imported by the routed Home entry", () => {
  const manifest = validManifest();
  manifest.chunks["assets/home.js"].imports.push("assets/deferred-home-panels.js");

  assert.throws(
    () => checkHomeDeferredBoundary(manifest),
    /Deferred Home surfaces re-entered the opening static graph/,
  );
});

test("rejects when a required deferred Home surface is missing from the build output", () => {
  const manifest = validManifest();
  manifest.chunks["assets/deferred-home-panels.js"].modules.pop();

  assert.throws(
    () => checkHomeDeferredBoundary(manifest),
    /Build manifest is missing deferred Home surface/,
  );
});

test("rejects Home surfaces not loaded through a dynamic import", () => {
  const manifest = validManifest();
  manifest.chunks["assets/deferred-home-panels.js"].dynamicImports = [];
  manifest.chunks["assets/home.js"].dynamicImports = [];

  assert.throws(
    () => checkHomeDeferredBoundary(manifest),
    /Home surface\(s\) are not reachable through a dynamic Home import/,
  );
});
