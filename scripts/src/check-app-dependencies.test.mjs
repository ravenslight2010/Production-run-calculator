import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  auditRootPackage,
  auditDependencyUsage,
  auditPackage,
  discoverWorkspacePackages,
  main,
} from "./check-app-dependencies.mjs";

function sourceImport(specifier) {
  return ["import", JSON.stringify(specifier), ";"].join(" ");
}

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
        content:
          'import { defineConfig } from "vite";\nplugins: ["@vitejs/plugin-react"];',
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
    peerPackages: new Map([["@axe-core/playwright", new Set(["axe-core"])]]),
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
      scripts: { check: "tsc --version && tsc --help" },
    },
    files: [
      { path: "src/z-compiler.mjs", content: "tsc --version" },
      { path: "src/a-compiler.mjs", content: "tsc --help && tsc --version" },
    ],
    binPackages: new Map([
      ["tsc", new Set(["typescript-native", "typescript"])],
    ]),
  });

  assert.deepEqual(result.unused, ["typescript", "typescript-native"]);
  assert.deepEqual(result.ambiguousBinaries, [
    {
      name: "tsc",
      providers: ["typescript", "typescript-native"],
      locations: [
        "package.json#scripts.check",
        "src/a-compiler.mjs",
        "src/z-compiler.mjs",
      ],
    },
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
    await mkdir(join(rootPath, "scripts"), { recursive: true });
    await writeFile(
      join(rootPath, "scripts/audit.mjs"),
      "shared-tool --version",
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
        'ambiguous binary "shared-tool" (provided by tool-one, tool-two; found in package.json#scripts.check, scripts/audit.mjs); not counted as dependency use.',
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
      ["artifacts/api", "lib/core", "lib/integrations/adapter", "scripts"],
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("strict mode passes when selected packages declare their imports", async () => {
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

test("strict mode fails on unused selected-package dependencies, while report-only passes", async () => {
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
    JSON.stringify({
      name: "strict-audit-root",
      scripts: {},
      devDependencies: {},
    }),
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
    {
      directory: "artifacts/api-server",
      name: "@workspace/api-server",
      manifest: {
        dependencies: { "api-server-runtime": "1.0.0" },
        devDependencies: { "api-server-test-tool": "1.0.0" },
        optionalDependencies: { "api-server-optional-tool": "1.0.0" },
      },
    },
    {
      directory: "lib/api-client-react",
      name: "@workspace/api-client-react",
      manifest: {
        dependencies: { "api-client-runtime": "1.0.0" },
        peerDependencies: { "api-client-peer": "1.0.0" },
      },
    },
  ];

  for (const { directory, name, dependencies, manifest = {} } of packages) {
    const packagePath = join(rootPath, directory);
    await mkdir(join(packagePath, "src"), { recursive: true });
    const packageManifest = {
      ...manifest,
      name,
      ...(dependencies ? { dependencies } : {}),
    };
    await writeFile(
      join(packagePath, "package.json"),
      JSON.stringify({ ...packageManifest, scripts: {} }),
    );
    const declaredNames = [
      ...Object.keys(packageManifest.dependencies ?? {}),
      ...Object.keys(packageManifest.devDependencies ?? {}),
      ...Object.keys(packageManifest.optionalDependencies ?? {}),
      ...Object.keys(packageManifest.peerDependencies ?? {}),
    ];
    const importNames = declaredNames
      .filter((dependency) => dependency !== "unused-package")
      .map(sourceImport)
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
        content: [
          'import "./local.js"; import fs from "node:fs"; import "https://example.com/mod.js";',
          'import "@/local-alias.js";',
        ].join("\n"),
      },
    ],
  });

  assert.deepEqual(result.unused, ["unused-package"]);
  assert.deepEqual(result.ambiguousBinaries, []);
});

test("reports undeclared external imports but excludes declared and workspace-owned packages", () => {
  const result = auditDependencyUsage({
    manifest: {
      dependencies: {
        "declared-package": "1.0.0",
        "@scope/declared-plugin": "1.0.0",
      },
      peerDependencies: { "peer-package": "1.0.0" },
      scripts: {},
    },
    files: [
      {
        path: "src/main.ts",
        content: [
          sourceImport("declared-package/subpath"),
          sourceImport("peer-package"),
          sourceImport("missing-package/subpath"),
          sourceImport("@scope/missing-package/subpath"),
          sourceImport("node:test"),
          sourceImport("fs/promises"),
          sourceImport("./local.js"),
          sourceImport("@workspace/internal-package"),
          sourceImport("https://example.com/module.js"),
          sourceImport("reuse existing recipe"),
          sourceImport("${importedFile}"),
        ].join("\n"),
      },
      {
        path: "src/theme.css",
        content:
          '@plugin "@scope/declared-plugin"; @plugin "@scope/missing-plugin";',
      },
    ],
  });

  assert.deepEqual(result.undeclaredImports, [
    { name: "@scope/missing-package", path: "src/main.ts" },
    { name: "@scope/missing-plugin", path: "src/theme.css" },
    { name: "missing-package", path: "src/main.ts" },
  ]);
});

test("strict mode catches API imports available only from root or sibling installs", async () => {
  const rootPath = await makeStrictAuditFixture({
    calculatorDependencies: { react: "1.0.0" },
    mockupDependencies: { vite: "1.0.0" },
  });
  const originalWarn = console.warn;
  const warnings = [];
  try {
    const apiServerPath = join(rootPath, "artifacts/api-server");
    const apiClientPath = join(rootPath, "lib/api-client-react");
    await writeFile(
      join(apiServerPath, "src/main.js"),
      [
        sourceImport("root-hoisted-api-package"),
        sourceImport("sibling-hoisted-api-package"),
      ].join("\n"),
    );
    await writeFile(
      join(apiClientPath, "src/main.js"),
      sourceImport("root-hoisted-client-package"),
    );

    await writeFile(
      join(rootPath, "package.json"),
      JSON.stringify({
        name: "strict-audit-root",
        dependencies: {
          "root-hoisted-api-package": "1.0.0",
          "root-hoisted-client-package": "1.0.0",
        },
        scripts: {},
      }),
    );
    const siblingPath = join(rootPath, "artifacts/neighbor-app");
    await mkdir(join(siblingPath, "src"), { recursive: true });
    await writeFile(
      join(siblingPath, "package.json"),
      JSON.stringify({
        name: "@workspace/neighbor-app",
        dependencies: { "sibling-hoisted-api-package": "1.0.0" },
        scripts: {},
      }),
    );
    await writeFile(
      join(siblingPath, "src/main.js"),
      sourceImport("sibling-hoisted-api-package"),
    );
    for (const packageName of [
      "root-hoisted-api-package",
      "sibling-hoisted-api-package",
      "root-hoisted-client-package",
    ]) {
      const installedPath = join(rootPath, "node_modules", packageName);
      await mkdir(installedPath, { recursive: true });
      await writeFile(
        join(installedPath, "package.json"),
        JSON.stringify({ name: packageName }),
      );
    }

    const apiServerResult = await auditPackage(apiServerPath);
    assert.deepEqual(apiServerResult.undeclaredImports, [
      { name: "root-hoisted-api-package", path: "src/main.js" },
      { name: "sibling-hoisted-api-package", path: "src/main.js" },
    ]);
    const apiClientResult = await auditPackage(apiClientPath);
    assert.deepEqual(apiClientResult.undeclaredImports, [
      { name: "root-hoisted-client-package", path: "src/main.js" },
    ]);

    console.warn = (...args) => warnings.push(args.join(" "));
    assert.equal(await main(rootPath), 0);
    assert.equal(await main(rootPath, { strict: true }), 1);
  } finally {
    console.warn = originalWarn;
    await rm(rootPath, { recursive: true, force: true });
  }

  assert.ok(
    warnings.some((warning) =>
      warning.includes(
        "@workspace/api-server: external package imports not declared by this package (strict check failed)",
      ),
    ),
  );
  assert.ok(
    warnings.some((warning) => warning.includes("root-hoisted-api-package")),
  );
  assert.ok(
    warnings.some((warning) => warning.includes("sibling-hoisted-api-package")),
  );
  assert.ok(
    warnings.some((warning) =>
      warning.includes(
        "@workspace/api-client-react: external package imports not declared by this package (strict check failed)",
      ),
    ),
  );
  assert.ok(
    warnings.some((warning) => warning.includes("root-hoisted-client-package")),
  );
});
