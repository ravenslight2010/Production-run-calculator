import assert from "node:assert/strict";
import test from "node:test";
import { auditDependencyUsage } from "./check-app-dependencies.mjs";

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
