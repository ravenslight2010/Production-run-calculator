import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const orvalRequire = createRequire(require.resolve("orval"));
const packageInfo = (name, resolver = require) => {
  const entry = resolver.resolve(name);
  let directory = dirname(entry);
  while (true) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      const metadata = JSON.parse(readFileSync(candidate, "utf8"));
      if (metadata.name === name)
        return { entry, metadata, packagePath: candidate };
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not locate package metadata for ${name}.`);
    }
    directory = parent;
  }
};

const typeDoc = packageInfo("typedoc", orvalRequire);
const markdown = packageInfo("typedoc-plugin-markdown", orvalRequire);
const coverage = packageInfo("typedoc-plugin-coverage", orvalRequire);
const typescript = packageInfo("typescript");

for (const [name, actual, expected] of [
  ["typedoc", typeDoc.metadata.version, "0.28.20"],
  ["typedoc-plugin-markdown", markdown.metadata.version, "4.13.0"],
  ["typedoc-plugin-coverage", coverage.metadata.version, "4.0.3"],
  ["typescript", typescript.metadata.version, "6.0.3"],
]) {
  if (actual !== expected) {
    throw new Error(
      `${name} must remain pinned to ${expected} for the TypeDoc compatibility lane; found ${actual}.`,
    );
  }
}

for (const [name, metadata] of [
  ["typedoc-plugin-markdown", markdown],
  ["typedoc-plugin-coverage", coverage],
]) {
  if (metadata.metadata.peerDependencies?.typedoc !== "0.28.x") {
    throw new Error(
      `${name} does not declare the expected TypeDoc 0.28.x peer range.`,
    );
  }
}

const typeDocPeer = typeDoc.metadata.peerDependencies?.typescript ?? "";
if (!typeDocPeer.includes("6.0.x") || typeDocPeer.includes("7.0.x")) {
  throw new Error(
    `TypeDoc's supported TypeScript peer range changed unexpectedly: ${typeDocPeer}`,
  );
}

const typeDocBin = join(
  dirname(typeDoc.packagePath),
  typeof typeDoc.metadata.bin === "string"
    ? typeDoc.metadata.bin
    : typeDoc.metadata.bin.typedoc,
);
const smokeRoot = mkdtempSync(join(tmpdir(), "workspace-typedoc-smoke-"));
try {
  const source = join(smokeRoot, "index.ts");
  const tsconfig = join(smokeRoot, "tsconfig.json");
  const output = join(smokeRoot, "docs");
  writeFileSync(source, "export interface SmokeContract { ok: boolean; }\n");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
      },
      include: ["index.ts"],
    }),
  );
  execFileSync(
    process.execPath,
    [
      typeDocBin,
      "--entryPoints",
      source,
      "--entryPointStrategy",
      "expand",
      "--tsconfig",
      tsconfig,
      "--out",
      output,
      "--plugin",
      markdown.entry,
      "--plugin",
      coverage.entry,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}

console.log(
  `TypeDoc ${typeDoc.metadata.version} and both plugins smoke-tested with TypeScript ${typescript.metadata.version}.`,
);
