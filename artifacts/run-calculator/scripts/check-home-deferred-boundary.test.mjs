import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkHomeDeferredSourceBoundary,
  checkHomeDeferredBoundary,
  DEFERRED_HOME_MODULE_SUFFIXES,
} from "./check-home-deferred-boundary.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function sourceHome(sourceRoot = path.resolve(scriptDir, "../src")) {
  const homeDirectory = path.join(sourceRoot, "pages");
  return DEFERRED_HOME_MODULE_SUFFIXES.map((suffix) => {
    const name = path.basename(suffix, ".tsx");
    const panelPath = path.resolve(sourceRoot, suffix.replace(/^\/src\//, ""));
    let specifier = path.relative(homeDirectory, panelPath).replaceAll("\\", "/");
    if (!specifier.startsWith(".")) specifier = `./${specifier}`;
    return `const load${name} = () => import("${specifier}");`;
  }).join("\n");
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

function createSourceFixture({ homeSource, helperSource, packageSource }) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "home-deferred-boundary-"));
  const sourceRoot = path.join(fixtureRoot, "src");
  const homeFilePath = path.join(sourceRoot, "pages/home.tsx");
  const liveRunFilePath = path.join(
    sourceRoot,
    "components/live-stations/LiveRunTabContent.tsx",
  );
  const helperFilePath = path.join(sourceRoot, "components/homeBridge.ts");
  fs.mkdirSync(path.dirname(homeFilePath), { recursive: true });
  fs.mkdirSync(path.dirname(liveRunFilePath), { recursive: true });
  fs.mkdirSync(path.dirname(helperFilePath), { recursive: true });
  fs.writeFileSync(liveRunFilePath, "");
  fs.writeFileSync(helperFilePath, helperSource);
  for (const suffix of DEFERRED_HOME_MODULE_SUFFIXES) {
    const panelPath = path.resolve(sourceRoot, suffix.replace(/^\/src\//, ""));
    fs.mkdirSync(path.dirname(panelPath), { recursive: true });
    fs.writeFileSync(panelPath, `export default function ${path.basename(panelPath, ".tsx")}() {}`);
  }
  if (packageSource !== undefined) {
    const packageRoot = path.join(fixtureRoot, "lib/home-bridge");
    fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@workspace/home-bridge",
        exports: { ".": "./src/index.ts" },
      }),
    );
    fs.writeFileSync(path.join(packageRoot, "src/index.ts"), packageSource);
  }
  const resolvedHomeSource =
    typeof homeSource === "function" ? homeSource(sourceRoot) : homeSource;
  fs.writeFileSync(homeFilePath, resolvedHomeSource);

  return {
    homeFilePath,
    homeSource: resolvedHomeSource,
    liveRunFilePath,
    liveRunSource: "",
    sourceRoot,
    workspaceRoot: fixtureRoot,
    cleanup: () => fs.rmSync(fixtureRoot, { recursive: true, force: true }),
  };
}

test("source keeps every optional panel dynamically loaded and outside the opening Home graph", () => {
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
  assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
});

for (const suffix of DEFERRED_HOME_MODULE_SUFFIXES) {
  const name = path.basename(suffix, ".tsx");

  for (const [sourceName, key, rootPath] of [
    ["Home", "homeSource", path.resolve(scriptDir, "../src/pages/home.tsx")],
    [
      "LiveRunTabContent",
      "liveRunSource",
      path.resolve(
        scriptDir,
        "../src/components/live-stations/LiveRunTabContent.tsx",
      ),
    ],
  ]) {
    const panelPath = path.resolve(
      scriptDir,
      `../src${suffix.replace("/src", "")}`,
    );
    const relativeSpecifier = path.relative(path.dirname(rootPath), panelPath);
    const specifier = relativeSpecifier.startsWith(".")
      ? relativeSpecifier
      : `./${relativeSpecifier}`;
    test(`source boundary rejects ${name} statically imported by ${sourceName}`, () => {
      assert.throws(
        () =>
          checkHomeDeferredSourceBoundary({
            homeSource:
              key === "homeSource"
                ? `import DeferredPanel from "${specifier}";\n${sourceHome()}`
                : sourceHome(),
            liveRunSource:
              key === "liveRunSource"
                ? `import DeferredPanel from "${specifier}";`
                : "",
          }),
        new RegExp(`${sourceName} statically imports deferred Home panel`),
      );
    });
  }
}

test("source boundary rejects removal of an existing Home dynamic loader", () => {
  const homeSource = sourceHome().replace(
    'const loadMixesTabContent = () => import("../components/MixesTabContent.tsx");',
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

test("source boundary rejects a deferred panel loaded by a side-effect static import", () => {
  assert.throws(
    () =>
      checkHomeDeferredSourceBoundary({
        homeSource: `import "../components/SetupContent";\n${sourceHome()}`,
        liveRunSource: "",
      }),
    /Home statically imports deferred Home panel/,
  );
});

test("source boundary rejects a deferred panel reached through an intermediate local import", () => {
  const fixture = createSourceFixture({
    homeSource: (sourceRoot) =>
      `import { bridge } from "../components/homeBridge";\n${sourceHome(sourceRoot)}`,
    helperSource: `import SetupContent from "./SetupContent";\nexport const bridge = SetupContent;`,
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Home statically imports deferred Home panel[\s\S]*Import chain: Home -> components\/homeBridge\.ts -> components\/SetupContent\.tsx/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("source boundary follows a deferred panel re-exported through a local workspace package", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: 'export { default as bridge } from "../../../src/components/SetupContent";',
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Home statically imports deferred Home panel[\s\S]*Import chain: Home -> \.\.\/lib\/home-bridge\/src\/index\.ts -> components\/SetupContent\.tsx/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("source boundary ignores third-party imports in a local workspace package", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: [
      'import "third-party-package";',
      'export type { SetupContentProps } from "../../../src/components/SetupContent";',
      'export const loadSetupContent = () => import("../../../src/components/SetupContent");',
      "export const bridge = true;",
    ].join("\n"),
  });

  try {
    const result = checkHomeDeferredSourceBoundary(fixture);
    assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
  } finally {
    fixture.cleanup();
  }
});

test("source boundary ignores type-only and dynamic imports in intermediate modules", () => {
  const fixture = createSourceFixture({
    homeSource: (sourceRoot) =>
      `import { loadSetupContent } from "../components/homeBridge";\n${sourceHome(sourceRoot)}`,
    helperSource: [
      'import type { SetupContentProps } from "./SetupContent";',
      'export { type SetupContentProps } from "./SetupContent";',
      'export const loadSetupContent = () => import("./SetupContent");',
    ].join("\n"),
  });

  try {
    const result = checkHomeDeferredSourceBoundary(fixture);
    assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
  } finally {
    fixture.cleanup();
  }
});

test("source boundary rejects a local dynamic panel missing from the deferred inventory", () => {
  const fixture = createSourceFixture({
    homeSource: (sourceRoot) =>
      `${sourceHome(sourceRoot)}\nconst loadUnregisteredPanel = () => import("../components/UnregisteredPanel");`,
    helperSource: "",
  });
  const unregisteredPanelPath = path.join(
    fixture.sourceRoot,
    "components/UnregisteredPanel.tsx",
  );
  fs.writeFileSync(
    unregisteredPanelPath,
    "export default function UnregisteredPanel() {}",
  );

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /local dynamic import\(s\) missing from the deferred panel inventory:[\s\S]*components\/UnregisteredPanel\.tsx/,
    );
  } finally {
    fixture.cleanup();
  }
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
