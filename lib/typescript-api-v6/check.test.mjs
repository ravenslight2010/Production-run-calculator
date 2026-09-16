import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { checkTypeScriptApiBoundary } from "./check.mjs";

const temporaryDirectories = [];
const directPackageName = `type${"script"}`;
const boundaryPackageName = `@workspace/type${"script"}-api-v6`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typescript-api-v6-check-"));
  temporaryDirectories.push(root);

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  return root;
}

function check(root, versions = {}) {
  return checkTypeScriptApiBoundary({
    root,
    boundaryDirectory: path.join(root, "lib", "typescript-api-v6"),
    expectedVersion: "6.0.3",
    packageVersion: "6.0.3",
    runtimeVersion: "6.0.3",
    ...versions,
  });
}

for (const [name, source] of [
  ["static import", `import ts from "${directPackageName}";`],
  ["dynamic import", `const ts = await import("${directPackageName}");`],
  ["CommonJS require", `const ts = require("${directPackageName}");`],
  [
    "TypeScript import assignment",
    `import ts = require("${directPackageName}");`,
  ],
]) {
  test(`rejects a direct ${name}`, () => {
    const root = fixture({ "src/consumer.ts": source });

    assert.throws(
      () => check(root),
      (error) => {
        assert.match(
          error.message,
          /Direct TypeScript JavaScript API imports bypass/,
        );
        assert.match(error.message, /- src\/consumer\.ts/);
        return true;
      },
    );
  });
}

test("accepts imports through the workspace boundary", () => {
  const root = fixture({
    "src/static.ts": `import ts from "${boundaryPackageName}";`,
    "src/dynamic.ts": `const ts = await import("${boundaryPackageName}");`,
    "src/commonjs.cjs": `const ts = require("${boundaryPackageName}");`,
  });

  assert.equal(check(root), "6.0.3");
});

test("ignores dependency and VCS directories", () => {
  const directImport = `import ts from "${directPackageName}";`;
  const root = fixture({
    "node_modules/dependency/index.js": directImport,
    ".git/hooks/example.ts": directImport,
    "src/consumer.ts": `import ts from "${boundaryPackageName}";`,
  });

  assert.equal(check(root), "6.0.3");
});

test("reports package metadata drift clearly", () => {
  const root = fixture({});

  assert.throws(
    () => check(root, { packageVersion: "6.0.4" }),
    /package metadata drifted: expected 6\.0\.3, resolved 6\.0\.4/,
  );
});

test("reports runtime and package metadata mismatches clearly", () => {
  const root = fixture({});

  assert.throws(
    () => check(root, { runtimeVersion: "6.0.2" }),
    /runtime 6\.0\.2 does not match package metadata 6\.0\.3/,
  );
});