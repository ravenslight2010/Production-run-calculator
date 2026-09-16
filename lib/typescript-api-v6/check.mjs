import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts, { TYPESCRIPT_API_V6_VERSION } from "./index.mjs";

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("typescript-api-v6/package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageDirectory, "../..");
const sourceExtension = /\.[cm]?[jt]sx?$/;
const ignoredDirectories = new Set([".git", "node_modules"]);
const directTypeScriptImport =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']typescript(?:\/[^"']+)?["']/;

export function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : sourceFiles(path.join(directory, entry.name));
    }
    return entry.isFile() && sourceExtension.test(entry.name)
      ? [path.join(directory, entry.name)]
      : [];
  });
}

export function checkTypeScriptApiBoundary({
  root = workspaceRoot,
  boundaryDirectory = packageDirectory,
  expectedVersion = TYPESCRIPT_API_V6_VERSION,
  packageVersion = packageJson.version,
  runtimeVersion = ts.version,
} = {}) {
  if (packageVersion !== expectedVersion) {
    throw new Error(
      `TypeScript 6 API package metadata drifted: expected ${expectedVersion}, resolved ${packageVersion}.`,
    );
  }

  if (runtimeVersion !== packageVersion) {
    throw new Error(
      `TypeScript 6 API runtime ${runtimeVersion} does not match package metadata ${packageVersion}.`,
    );
  }

  const bypasses = sourceFiles(root)
    .filter((filePath) => !filePath.startsWith(`${boundaryDirectory}${path.sep}`))
    .filter((filePath) =>
      directTypeScriptImport.test(fs.readFileSync(filePath, "utf8")),
    )
    .map((filePath) => path.relative(root, filePath));

  if (bypasses.length > 0) {
    throw new Error(
      [
        "Direct TypeScript JavaScript API imports bypass @workspace/typescript-api-v6:",
        ...bypasses.map((filePath) => `- ${filePath}`),
      ].join("\n"),
    );
  }

  return runtimeVersion;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const checkedVersion = checkTypeScriptApiBoundary();

  console.log(
    `TypeScript JavaScript API boundary: ${checkedVersion}; direct-import bypasses: 0`,
  );
}