import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  auditDependencyUsage,
  discoverWorkspacePackages,
} from "./check-app-dependencies.mjs";

test("reports a direct dependency that has no source, config, or script use", () => {
  const unused = auditDependencyUsage({
    manifest: {
      dependencies: { "unused-package": "1.0.0" },
      scripts: {},
    },
    files: [{ path: "src/main.ts", content: 'import React from "react";' }],
  });

  assert.deepEqual(unused, ["unused-package"]);
});

test("recognizes imports, plugin config references, type packages, and CLI scripts", () => {
  const unused = auditDependencyUsage({
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

  assert.deepEqual(unused, []);
});

test("recognizes CSS plugins and the peer dependencies of used packages", () => {
  const unused = auditDependencyUsage({
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

  assert.deepEqual(unused, []);
});

test("recognizes valid non-import uses through CLI binaries and type declarations", () => {
  const unused = auditDependencyUsage({
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

  assert.deepEqual(unused, ["unused-package"]);
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

test("does not mistake relative, Node built-in, or URL imports for dependencies", () => {
  const unused = auditDependencyUsage({
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

  assert.deepEqual(unused, ["unused-package"]);
});
