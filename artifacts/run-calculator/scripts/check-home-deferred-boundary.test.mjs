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
  runPnpmWorkspaceList,
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

function createSourceFixture({
  homeSource,
  helperSource,
  packageSource,
  workspacePatterns = ["lib/*"],
  packageLocations = packageSource === undefined ? [] : ["lib/home-bridge"],
  packageNames = {},
  packageSources = {},
  packageExports,
  browserPackageSource,
  runWorkspaceList,
}) {
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
  fs.writeFileSync(
    path.join(fixtureRoot, "package.json"),
    JSON.stringify({ name: "home-deferred-boundary-fixture", private: true }),
  );
  fs.writeFileSync(
    path.join(fixtureRoot, "pnpm-workspace.yaml"),
    `packages:\n${workspacePatterns.map((pattern) => `  - "${pattern}"`).join("\n")}\n`,
  );
  fs.writeFileSync(liveRunFilePath, "");
  fs.writeFileSync(helperFilePath, helperSource);
  for (const suffix of DEFERRED_HOME_MODULE_SUFFIXES) {
    const panelPath = path.resolve(sourceRoot, suffix.replace(/^\/src\//, ""));
    fs.mkdirSync(path.dirname(panelPath), { recursive: true });
    fs.writeFileSync(panelPath, `export default function ${path.basename(panelPath, ".tsx")}() {}`);
  }
  for (const packageLocation of packageLocations) {
    const packageRoot = path.join(fixtureRoot, packageLocation);
    fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: packageNames[packageLocation] ?? "@workspace/home-bridge",
        exports: packageExports ?? { ".": "./src/index.ts" },
      }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "src/index.ts"),
      packageSources[packageLocation] ?? packageSource ?? "",
    );
    if (browserPackageSource !== undefined) {
      fs.writeFileSync(path.join(packageRoot, "browser.ts"), browserPackageSource);
    }
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
    runWorkspaceList,
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

for (const [sourceName, key] of [
  ["Home", "homeSource"],
  ["LiveRunTabContent", "liveRunSource"],
]) {
  test(`source boundary rejects a computed runtime dynamic import in ${sourceName}`, () => {
    assert.throws(
      () =>
        checkHomeDeferredSourceBoundary({
          homeSource:
            key === "homeSource"
              ? `${sourceHome()}\nconst loadPanel = (panel) => import(panel);`
              : sourceHome(),
          liveRunSource:
            key === "liveRunSource"
              ? `const loadPanel = (panel) => import(panel);`
              : "",
        }),
      new RegExp(
        `${sourceName} has runtime dynamic import\\(s\\) with a non-literal specifier[\\s\\S]*line \\d+, column \\d+[\\s\\S]*Use a string literal or no-substitution template literal`,
      ),
    );
  });
}

test("source boundary ignores TypeScript import-type syntax", () => {
  const fixture = createSourceFixture({
    homeSource: (sourceRoot) =>
      `${sourceHome(sourceRoot)}\ntype UnregisteredPanel = import("../components/UnregisteredPanel").default;`,
    helperSource: "",
  });
  fs.writeFileSync(
    path.join(fixture.sourceRoot, "components/UnregisteredPanel.tsx"),
    "export default function UnregisteredPanel() {}",
  );

  try {
    const result = checkHomeDeferredSourceBoundary(fixture);
    assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
  } finally {
    fixture.cleanup();
  }
});

test("source boundary keeps literal package dynamic imports outside local panel inventory", () => {
  const result = checkHomeDeferredSourceBoundary({
    homeSource: `${sourceHome()}\nconst loadExternal = () => import("@workspace/home-bridge");`,
    liveRunSource: "",
  });
  assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
});

test("source boundary accepts a no-substitution template literal for a local panel", () => {
  const homeSource = sourceHome().replace(
    'import("../components/SetupContent")',
    "import(`../components/SetupContent`)",
  );
  const result = checkHomeDeferredSourceBoundary({
    homeSource,
    liveRunSource: "",
  });
  assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
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

test("source boundary follows the browser-selected workspace package export", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    packageExports: {
      ".": {
        browser: "./browser.ts",
        default: "./src/index.ts",
      },
    },
    browserPackageSource:
      'export { default as bridge } from "../../src/components/SetupContent";',
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Home statically imports deferred Home panel[\s\S]*Import chain: Home -> \.\.\/lib\/home-bridge\/browser\.ts -> components\/SetupContent\.tsx/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("source boundary rejects a workspace package export that resolves outside its package", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    packageExports: { ".": "./../outside.ts" },
  });
  fs.writeFileSync(
    path.join(fixture.workspaceRoot, "lib/outside.ts"),
    "export const bridge = true;",
  );

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Workspace package "@workspace\/home-bridge" export "\." escapes its package directory\./,
    );
  } finally {
    fixture.cleanup();
  }
});

test("source boundary rejects exports with mode-dependent source entries when NODE_ENV is unset", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    packageExports: {
      ".": {
        development: "./src/index.ts",
        production: "./browser.ts",
      },
    },
    browserPackageSource: "export const bridge = true;",
  });
  const originalNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /different entries for Vite development and production conditions/,
    );
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    fixture.cleanup();
  }
});

test("source boundary does not scan dynamic imports inside workspace package exports", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: [
      // Use a declared external package: the audit scans literal fixture imports too.
      'import "react";',
      'export type { SetupContentProps } from "../../../../../../src/components/SetupContent";',
      'export const loadSetupContent = () => import("../../../../../../src/components/SetupContent");',
      "export const loadPanel = (panel) => import(panel);",
      "export const bridge = true;",
    ].join("\n"),
    workspacePatterns: ["modules/**/packages/*"],
    packageLocations: ["modules/team/tooling/packages/home-bridge"],
  });

  try {
    const result = checkHomeDeferredSourceBoundary(fixture);
    assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
  } finally {
    fixture.cleanup();
  }
});

test("source boundary discovers packages under nested pnpm workspace patterns", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: [
      // Use a declared external package: the audit scans literal fixture imports too.
      'import "react";',
      'export { default as bridge } from "../../../../../../src/components/SetupContent";',
    ].join("\n"),
    workspacePatterns: ["modules/**/packages/*"],
    packageLocations: ["modules/team/tooling/packages/home-bridge"],
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Home statically imports deferred Home panel[\s\S]*modules\/team\/tooling\/packages\/home-bridge\/src\/index\.ts/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("source boundary clearly rejects unresolved local workspace package names", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/missing-package";\n${sourceHome()}`,
    helperSource: "",
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Unable to find local workspace package "@workspace\/missing-package"/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("source boundary resolves a longer workspace package name without matching its prefix", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge-extra";\n${sourceHome()}`,
    helperSource: "",
    packageSource:
      'export { default as bridge } from "../../../src/components/SetupContent";',
    packageLocations: ["lib/home-bridge", "lib/home-bridge-extra"],
    packageNames: {
      "lib/home-bridge-extra": "@workspace/home-bridge-extra",
    },
    packageSources: {
      "lib/home-bridge-extra": "export const bridge = true;",
    },
  });

  try {
    const result = checkHomeDeferredSourceBoundary(fixture);
    assert.equal(result.deferredHomePanels, DEFERRED_HOME_MODULE_SUFFIXES.length);
  } finally {
    fixture.cleanup();
  }
});

test("source boundary does not resolve an absent full workspace package name by prefix", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge-extra";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Unable to find local workspace package "@workspace\/home-bridge-extra"/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("source boundary clearly rejects ambiguous local workspace package names", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    workspacePatterns: ["modules/**/packages/*"],
    packageLocations: [
      "modules/one/packages/home-bridge",
      "modules/two/packages/home-bridge",
    ],
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Workspace package "@workspace\/home-bridge" has multiple local manifests: modules\/one\/packages\/home-bridge, modules\/two\/packages\/home-bridge/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("source boundary identifies a workspace package manifest with invalid JSON", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    // Exercise our manifest parser, independently of whether the installed
    // pnpm rejects this deliberately corrupt fixture during discovery first.
    runWorkspaceList: (workspaceRoot) => ({
      status: 0,
      stdout: JSON.stringify([
        { path: path.join(workspaceRoot, "lib/home-bridge") },
      ]),
    }),
  });
  const manifestPath = path.join(
    fixture.workspaceRoot,
    "lib/home-bridge/package.json",
  );
  fs.writeFileSync(manifestPath, '{"name":');

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      (error) => {
        assert.equal(
          error.message,
          `Invalid workspace package manifest at "${manifestPath}": invalid JSON.`,
        );
        return true;
      },
    );
  } finally {
    fixture.cleanup();
  }
});

for (const [label, manifest] of [
  ["missing", { exports: { ".": "./src/index.ts" } }],
  ["non-string", { name: null, exports: { ".": "./src/index.ts" } }],
]) {
  test(`source boundary identifies a workspace package manifest with a ${label} name`, () => {
    const fixture = createSourceFixture({
      homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
      helperSource: "",
      packageSource: "export const bridge = true;",
      runWorkspaceList: (workspaceRoot) => ({
        status: 0,
        stdout: JSON.stringify([
          { path: path.join(workspaceRoot, "lib/home-bridge") },
        ]),
      }),
    });
    const manifestPath = path.join(
      fixture.workspaceRoot,
      "lib/home-bridge/package.json",
    );
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    try {
      assert.throws(
        () => checkHomeDeferredSourceBoundary(fixture),
        (error) => {
          assert.equal(
            error.message,
            `Invalid workspace package manifest at "${manifestPath}": expected "name" to be a string.`,
          );
          return true;
        },
      );
    } finally {
      fixture.cleanup();
    }
  });
}

test("workspace listing process failures include command context and bounded details", () => {
  let invokedWithRoot;
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    runWorkspaceList: (workspaceRoot) => {
      invokedWithRoot = workspaceRoot;
      return {
        status: 1,
        stderr:
          "\u001b[31mhttps://user:password@example.test/error\u001b[0m " +
          "x".repeat(5000),
      };
    },
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      (error) => {
        assert.match(error.message, /Workspace package discovery failed\./);
        assert.match(error.message, /Command: pnpm --dir "/);
        assert.match(error.message, /--recursive list --json --depth -1/);
        assert.match(error.message, new RegExp(`Workspace root: ${fixture.workspaceRoot}`));
        const details = error.message.match(/Details: (.*)$/)?.[1];
        assert.ok(details);
        assert.equal(details.length, 400);
        assert.match(details, /^https:\/\/\[redacted\]@example\.test\/error x+/);
        assert.ok(!details.includes("user:password"));
        return true;
      },
    );
    assert.equal(invokedWithRoot, fixture.workspaceRoot);
  } finally {
    fixture.cleanup();
  }
});

test("workspace listing launch failures include the actionable command context", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    runWorkspaceList: () => ({
      error: Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" }),
      status: null,
      stderr: "",
    }),
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      (error) => {
        assert.match(error.message, /Workspace package discovery failed\./);
        assert.match(error.message, /Command: pnpm --dir "/);
        assert.match(error.message, /Workspace root:/);
        assert.match(
          error.message,
          /Action: Run the command above from the workspace root and check pnpm-workspace\.yaml\./,
        );
        assert.match(error.message, /Details: spawn pnpm ENOENT/);
        return true;
      },
    );
  } finally {
    fixture.cleanup();
  }
});

test("workspace listing timeouts include command context and bounded safe details", () => {
  const timeoutMessage = "spawnSync pnpm ETIMEDOUT";
  const timeoutStderr =
    "\u001b[31mhttps://user:password@example.test/error\u001b[0m " +
    "x".repeat(5000);
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    runWorkspaceList: (workspaceRoot) =>
      runPnpmWorkspaceList(workspaceRoot, (command, args, options) => {
        assert.equal(command, "pnpm");
        assert.deepEqual(args, [
          "--dir",
          workspaceRoot,
          "--recursive",
          "list",
          "--json",
          "--depth",
          "-1",
        ]);
        assert.equal(options.timeout, 30_000);
        assert.equal(options.encoding, "utf8");
        return {
          error: Object.assign(new Error(timeoutMessage), { code: "ETIMEDOUT" }),
          status: null,
          stderr: timeoutStderr,
        };
      }),
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      (error) => {
        assert.match(error.message, /Workspace package discovery failed\./);
        assert.match(error.message, /Command: pnpm --dir "/);
        assert.match(error.message, /--recursive list --json --depth -1/);
        assert.match(error.message, new RegExp(`Workspace root: ${fixture.workspaceRoot}`));
        assert.match(error.message, /Failure: pnpm workspace listing timed out after 30000ms\./);
        const details = error.message.match(/Details: (.*)$/)?.[1];
        assert.ok(details);
        assert.equal(details.length, 400);
        assert.match(
          details,
          /^spawnSync pnpm ETIMEDOUT; https:\/\/\[redacted\]@example\.test\/error x+/,
        );
        assert.ok(!details.includes("user:password"));
        return true;
      },
    );
  } finally {
    fixture.cleanup();
  }
});

test("malformed workspace listing output includes command context and root", () => {
  let invokedWithRoot;
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    runWorkspaceList: (workspaceRoot) => {
      invokedWithRoot = workspaceRoot;
      return { status: 0, stdout: "not-json" };
    },
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      (error) => {
        assert.match(error.message, /Workspace package discovery failed\./);
        assert.match(error.message, /Command: pnpm --dir "/);
        assert.match(error.message, /--recursive list --json --depth -1/);
        assert.match(error.message, new RegExp(`Workspace root: ${fixture.workspaceRoot}`));
        assert.match(error.message, /Details: Invalid pnpm workspace package listing:/);
        return true;
      },
    );
    assert.equal(invokedWithRoot, fixture.workspaceRoot);
  } finally {
    fixture.cleanup();
  }
});

test("workspace listing rejects valid JSON with an invalid package-list shape", () => {
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    runWorkspaceList: () => ({ status: 0, stdout: JSON.stringify([{ name: "missing-path" }]) }),
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      (error) => {
        assert.match(error.message, /Workspace package discovery failed\./);
        assert.match(error.message, new RegExp(`Workspace root: ${fixture.workspaceRoot}`));
        assert.match(
          error.message,
          /Details: Invalid pnpm workspace package listing: pnpm workspace package listing contains an entry without a path\./,
        );
        return true;
      },
    );
  } finally {
    fixture.cleanup();
  }
});

test("workspace listing rejects package folders outside the root before reading manifests", () => {
  const reportedFolder = path.resolve(
    os.tmpdir(),
    "outside-home-workspace",
    "home-bridge",
  );
  const manifestReads = [];
  let workspaceListCalls = 0;
  const fixture = createSourceFixture({
    homeSource: `import { bridge } from "@workspace/home-bridge";\n${sourceHome()}`,
    helperSource: "",
    packageSource: "export const bridge = true;",
    runWorkspaceList: () => {
      workspaceListCalls += 1;
      return {
        status: 0,
        stdout: JSON.stringify([{ path: reportedFolder }]),
      };
    },
  });

  try {
    assert.throws(
      () =>
        checkHomeDeferredSourceBoundary({
          ...fixture,
          readSource: (filePath) => {
            if (path.basename(filePath) === "package.json") {
              manifestReads.push(filePath);
            }
            return fs.readFileSync(filePath, "utf8");
          },
        }),
      (error) => {
        assert.match(error.message, /Workspace package discovery failed\./);
        assert.match(error.message, /Command: pnpm --dir "/);
        assert.match(error.message, /--recursive list --json --depth -1/);
        assert.match(error.message, new RegExp(`Workspace root: ${fixture.workspaceRoot}`));
        const details = error.message.match(/Details: (.*)$/)?.[1];
        assert.ok(details);
        assert.ok(details.length <= 400);
        assert.match(details, /pnpm reported a workspace package outside the root:/);
        assert.ok(details.includes(reportedFolder));
        return true;
      },
    );
    assert.equal(workspaceListCalls, 1);
    assert.deepEqual(manifestReads, []);
  } finally {
    fixture.cleanup();
  }
});

test("source boundary inventories helper dynamic imports and ignores import-type syntax", () => {
  const fixture = createSourceFixture({
    homeSource: (sourceRoot) =>
      `import { loadSetupContent } from "../components/homeBridge";\n${sourceHome(sourceRoot).replace(
        'const loadSetupContent = () => import("../components/SetupContent.tsx");',
        "",
      )}`,
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

test("source boundary rejects a computed runtime dynamic import in a local helper", () => {
  const fixture = createSourceFixture({
    homeSource: (sourceRoot) =>
      `import { loadPanel } from "../components/homeBridge";\n${sourceHome(sourceRoot)}`,
    helperSource: "export const loadPanel = (panel) => import(panel);",
  });

  try {
    assert.throws(
      () => checkHomeDeferredSourceBoundary(fixture),
      /Home helper components\/homeBridge\.ts has runtime dynamic import\(s\) with a non-literal specifier[\s\S]*line 1, column \d+[\s\S]*Use a string literal or no-substitution template literal[\s\S]*Import chain: Home -> components\/homeBridge\.ts/,
    );
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
