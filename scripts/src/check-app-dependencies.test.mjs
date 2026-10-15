import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  auditRootPackage,
  auditDependencyUsage,
  discoverWorkspacePackages,
  main,
} from "./check-app-dependencies.mjs";

test("reports a direct dependency that has no source, config, or script use", () => {
  const result = auditDependencyUsage({
    manifest: {
      dependencies: { "unused-package": "1.0.0" },
      scripts: {},
    },
    files: [{ path: "src/main.ts", content: 'import React from "react";' }],
  });

  assert.deepEqual(result.unused, ["unused-package"]);
  assert.deepEqual(result.ambiguousBinaries, []);
});

test("recognizes imports, plugin config references, type packages, and CLI scripts", () => {
  const result = auditDependencyUsage({
    manifest: {
      devDependencies: {
        "@types/node": "1.0.0",
        "@vitejs/plugin-react": "1.0.0",
        playwright: "1.0.0",
        vite: "1.0.0",
      },
      scripts: { test: "playwright test" },
    },
    files: [
      {
        path: "vite.config.ts",
        content: 'import { defineConfig } from "vite";\nplugins: ["@vitejs/plugin-react"];',
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: { types: ["node", "vite/client"] },
        }),
      },
    ],
    binPackages: new Map([["playwright", new Set(["playwright"])]]),
  });

  assert.deepEqual(result.unused, []);
  assert.deepEqual(result.ambiguousBinaries, []);
});

test("recognizes CSS plugins and the peer dependencies of used packages", () => {
  const result = auditDependencyUsage({
    manifest: {
      devDependencies: {
        "@axe-core/playwright": "1.0.0",
        "@tailwindcss/typography": "1.0.0",
        "axe-core": "1.0.0",
      },
      scripts: {},
    },
    files: [
      {
        path: "src/accessibility.test.ts",
        content: 'import AxeBuilder from "@axe-core/playwright";',
      },
      {
        path: "src/index.css",
        content: '@plugin "@tailwindcss/typography";',
      },
    ],
    peerPackages: new Map([
      ["@axe-core/playwright", new Set(["axe-core"])],
    ]),
  });

  assert.deepEqual(result.unused, []);
  assert.deepEqual(result.ambiguousBinaries, []);
});

test("recognizes valid non-import uses through CLI binaries and type declarations", () => {
  const result = auditDependencyUsage({
    manifest: {
      devDependencies: {
        "@types/node": "1.0.0",
        "@workspace/fixture-lib": "workspace:*",
        "toolchain-package": "1.0.0",
        "test-runner": "1.0.0",
        "unused-package": "1.0.0",
        "workflow-linter": "1.0.0",
      },
      scripts: { test: "test-runner run" },
    },
    files: [
      {
        path: "src/check-toolchain.mjs",
        content: 'packageInfo("toolchain-package");',
      },
      {
        path: "src/check-workflows.sh",
        content: "workflow-linter .github/workflows/*.yml",
      },
      {
        path: "src/run-related-test.mts",
        content:
          'const args = ["--filter", "@workspace/fixture-lib", "run", "test"];',
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({ compilerOptions: { types: ["node"] } }),
      },
    ],
    binPackages: new Map([
      ["test-runner", new Set(["test-runner"])],
      ["workflow-linter", new Set(["workflow-linter"])],
    ]),
  });

  assert.deepEqual(result.unused, ["unused-package"]);
  assert.deepEqual(result.ambiguousBinaries, []);
});

test("attributes package-qualified binary paths to the named dependency only", () => {
  const result = auditDependencyUsage({
    manifest: {
      devDependencies: {
        "typescript-native": "7.0.0",
        typescript: "6.0.0",
      },
      scripts: {},
    },
    files: [
      {
        path: "src/check-compiler.mjs",
        content: 'resolve(root, "node_modules/typescript-native/bin/tsc");',
      },
    ],
    binPackages: new Map([
      ["tsc", new Set(["typescript-native", "typescript"])],
    ]),
  });

  assert.deepEqual(result.unused, ["typescript"]);
  assert.deepEqual(result.ambiguousBinaries, []);
});

test("reports a bare binary with multiple direct providers as ambiguous", () => {
  const result = auditDependencyUsage({
    manifest: {
      devDependencies: {
        "typescript-native": "7.0.0",
        typescript: "6.0.0",
      },
      scripts: { check: "tsc --version" },
    },
    files: [],
    binPackages: new Map([
      ["tsc", new Set(["typescript-native", "typescript"])],
    ]),
  });

  assert.deepEqual(result.unused, ["typescript", "typescript-native"]);
  assert.deepEqual(result.ambiguousBinaries, [
    { name: "tsc", providers: ["typescript", "typescript-native"] },
  ]);
});

test("prints ambiguous binary providers in the dependency audit report", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "ambiguous-binary-audit-"));
  const warnings = [];
  const originalWarn = console.warn;
  try {
    await writeFile(
      join(rootPath, "package.json"),
      JSON.stringify({
        name: "ambiguous-audit-root",
        scripts: { check: "shared-tool" },
        devDependencies: { "tool-one": "1.0.0", "tool-two": "1.0.0" },
      }),
    );
    for (const packageName of ["tool-one", "tool-two"]) {
      const packagePath = join(rootPath, "node_modules", packageName);
      await mkdir(packagePath, { recursive: true });
      await writeFile(
        join(packagePath, "package.json"),
        JSON.stringify({
          name: packageName,
          bin: { "shared-tool": "cli.js" },
        }),
      );
    }

    console.warn = (...args) => warnings.push(args.join(" "));
    assert.equal(await main(rootPath), 0);
  } finally {
    console.warn = originalWarn;
    await rm(rootPath, { recursive: true, force: true });
  }

  assert.ok(
    warnings.some((warning) =>
      warning.includes(
        'ambiguous binary "shared-tool" (provided by tool-one, tool-two); not counted as dependency use.',
      ),
    ),
  );
});

test("discovers first-party artifact, library, integration, and scripts packages", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "dependency-audit-"));
  try {
    for (const directory of [
      "artifacts/api/package.json",
      "lib/core/package.json",
      "lib/integrations/adapter/package.json",
      "scripts/package.json",
      "unrelated/package.json",
    ]) {
      const filePath = join(rootPath, directory);
      await mkdir(join(filePath, ".."), { recursive: true });
      await writeFile(filePath, JSON.stringify({ name: directory }));
    }

    const packagePaths = await discoverWorkspacePackages(rootPath);
    assert.deepEqual(
      packagePaths.map((path) => path.slice(rootPath.length + 1)),
      [
        "artifacts/api",
        "lib/core",
        "lib/integrations/adapter",
        "scripts",
      ],
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("strict mode passes when calculator and mockup manifests have no unused dependencies", async () => {
  const rootPath = await makeStrictAuditFixture({
    calculatorDependencies: { react: "1.0.0" },
    mockupDependencies: { vite: "1.0.0" },
  });
  try {
    assert.equal(await main(rootPath, { strict: true }), 0);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("strict mode fails on unused calculator or mockup dependencies, while report-only passes", async () => {
  const rootPath = await makeStrictAuditFixture({
    calculatorDependencies: { react: "1.0.0" },
    mockupDependencies: { vite: "1.0.0", "unused-package": "1.0.0" },
  });
  try {
    assert.equal(await main(rootPath), 0);
    assert.equal(await main(rootPath, { strict: true }), 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

async function makeStrictAuditFixture({
  calculatorDependencies,
  mockupDependencies,
}) {
  const rootPath = await mkdtemp(join(tmpdir(), "strict-dependency-audit-"));
  await writeFile(
    join(rootPath, "package.json"),
    JSON.stringify({ name: "strict-audit-root", scripts: {}, devDependencies: {} }),
  );
  const packages = [
    {
      directory: "artifacts/run-calculator",
      name: "@workspace/run-calculator",
      dependencies: calculatorDependencies,
    },
    {
      directory: "artifacts/mockup-sandbox",
      name: "@workspace/mockup-sandbox",
      dependencies: mockupDependencies,
    },
  ];

  for (const { directory, name, dependencies } of packages) {
    const packagePath = join(rootPath, directory);
    await mkdir(join(packagePath, "src"), { recursive: true });
    await writeFile(
      join(packagePath, "package.json"),
      JSON.stringify({ name, dependencies, scripts: {} }),
    );
    const importNames = Object.keys(dependencies)
      .filter((dependency) => dependency !== "unused-package")
      .map((dependency) => `import "${dependency}";`)
      .join("\n");
    await writeFile(join(packagePath, "src/main.js"), importNames);
  }

  return rootPath;
}
test("audits root scripts and workspace tooling without retaining unused declarations", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "root-dependency-audit-"));
  try {
    await mkdir(join(rootPath, "scripts"), { recursive: true });
    await mkdir(join(rootPath, "lib/api-spec"), { recursive: true });
    await mkdir(join(rootPath, ".vscode"), { recursive: true });
    await mkdir(join(rootPath, "node_modules/root-script-tool"), {
      recursive: true,
    });
    await writeFile(
      join(rootPath, "package.json"),
      JSON.stringify({
        name: "workspace",
        scripts: { check: "root-script-tool verify" },
        devDependencies: {
          "root-script-tool": "1.0.0",
          "typescript-native": "7.0.0",
          prettier: "3.0.0",
          "unused-root-tool": "1.0.0",
        },
      }),
    );
    await writeFile(
      join(rootPath, "node_modules/root-script-tool/package.json"),
      JSON.stringify({
        name: "root-script-tool",
        bin: { "root-script-tool": "cli.js" },
      }),
    );
    await writeFile(
      join(rootPath, "scripts/check-compiler.mjs"),
      'const compiler = resolve(root, "node_modules/typescript-native/bin/tsc");',
    );
    await writeFile(
      join(rootPath, ".vscode/settings.json"),
      JSON.stringify({ "typescript.tsdk": "node_modules/typescript/lib" }),
    );
    await writeFile(
      join(rootPath, "lib/api-spec/orval.config.ts"),
      "export default { output: { prettier: true } };",
    );

    const result = await auditRootPackage(rootPath);
    assert.equal(result.packageName, "workspace");
    assert.deepEqual(result.unused, ["unused-root-tool"]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
test("does not mistake relative, Node built-in, or URL imports for dependencies", () => {
  const result = auditDependencyUsage({
    manifest: {
      dependencies: { "unused-package": "1.0.0" },
      scripts: {},
    },
    files: [
      {
        path: "src/main.ts",
        content:
          'import "./local.js"; import fs from "node:fs"; import "https://example.com/mod.js";',
      },
    ],
  });

  assert.deepEqual(result.unused, ["unused-package"]);
  assert.deepEqual(result.ambiguousBinaries, []);
});
