import test from "node:test";
import assert from "node:assert/strict";
import {
  checkHomeDeferredBoundary,
  DEFERRED_HOME_MODULE_SUFFIXES,
} from "./check-home-deferred-boundary.mjs";

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
