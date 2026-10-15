#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const WORKSPACE_PACKAGE_ROOTS = ["artifacts", "lib"];
const STRICT_PACKAGE_NAMES = new Set([
  "@workspace/api-client-react",
  "@workspace/api-server",
  "@workspace/run-calculator",
  "@workspace/mockup-sandbox",
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".mjs",
  ".mts",
  ".scss",
  ".sh",
  ".ts",
  ".tsx",
  ".toml",
  ".py",
  ".yaml",
  ".yml",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const NODE_BUILTINS = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "").split("/")[0]),
);

const IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s*)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']/g,
];

function packageNameFromSpecifier(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("node:") ||
    /^[a-z][a-z\d+.-]*:/i.test(specifier)
  ) {
    return null;
  }

  const parts = specifier.split("/");
  const name = specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];

  if (
    !/^@[a-z\d][a-z\d._~-]*\/[a-z\d][a-z\d._~-]*$|^[a-z\d][a-z\d._~-]*$/i.test(
      name,
    )
  ) {
    return null;
  }

  return NODE_BUILTINS.has(name) ? null : name;
}

function typePackageNamesForImport(importName) {
  if (importName.startsWith("@types/")) return [];
  if (importName.startsWith("@")) {
    const [scope, name] = importName.slice(1).split("/");
    return name ? [`@types/${scope}__${name}`] : [];
  }
  return [`@types/${importName}`];
}

function isConfigurationFile(path) {
  const name = basename(path);
  return (
    name.includes(".config.") ||
    /(?:^|[-.])toolchain(?:[-.]|$)/i.test(name) ||
    /^(?:vite|vitest|playwright|postcss|tailwind|eslint|prettier|babel|webpack|rollup|jest)\./i.test(
      name,
    )
  );
}

function addTypeConfigUsage(path, source, dependencies, used) {
  if (!path.endsWith(".json")) return;

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return;
  }

  const types = parsed?.compilerOptions?.types;
  if (!Array.isArray(types)) return;

  for (const typeName of types) {
    const candidate = typeName.startsWith("@types/")
      ? typeName
      : `@types/${typeName.split("/")[0]}`;
    if (dependencies.has(candidate)) used.add(candidate);
  }
}

function addScriptUsage(
  scripts,
  binPackages,
  dependencies,
  used,
  ambiguousBinaries,
) {
  const scriptEntries = Object.entries(scripts ?? {});
  for (const [scriptName, scriptText] of scriptEntries) {
    collectBinaryUsage(
      scriptText,
      binPackages,
      dependencies,
      used,
      ambiguousBinaries,
      `package.json#scripts.${scriptName}`,
    );
  }
  const scriptText = scriptEntries.map(([, source]) => source).join("\n");
  collectImports(scriptText, dependencies, used);
  collectPackageResolutionReferences(scriptText, dependencies, used);
}

function collectNodeModulesPathRanges(source) {
  const ranges = [];
  const nodeModulesPath = /\bnode_modules\/((?:@[^/\\\s"'`]+\/)?[^/\\\s"'`]+)/g;
  for (const match of source.matchAll(nodeModulesPath)) {
    const start = match.index;
    const pathStart = start + match[0].length;
    const pathRemainder = source.slice(pathStart);
    const pathEnd = pathRemainder.search(/[\s"'`]/);
    ranges.push([start, pathEnd === -1 ? source.length : pathStart + pathEnd]);
  }
  return ranges;
}

function collectBinaryUsage(
  source,
  binPackages,
  dependencies,
  used,
  ambiguousBinaries,
  location,
) {
  const nodeModulesPathRanges = collectNodeModulesPathRanges(source);
  for (const [binName, packages] of binPackages) {
    const escaped = binName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const binaryReference = new RegExp(
      `(^|[^\\w.-])(${escaped})(?=$|[^\\w.-])`,
      "gm",
    );
    const matchingLines = new Set();
    for (const match of source.matchAll(binaryReference)) {
      const binaryStart = match.index + match[1].length;
      if (
        nodeModulesPathRanges.some(
          ([start, end]) => binaryStart >= start && binaryStart < end,
        )
      ) {
        continue;
      }
      matchingLines.add(source.slice(0, binaryStart).split("\n").length);
    }
    if (matchingLines.size === 0) continue;

    const providers = [...packages]
      .filter((packageName) => dependencies.has(packageName))
      .sort((left, right) => left.localeCompare(right));
    if (providers.length === 1) {
      used.add(providers[0]);
    } else if (providers.length > 1) {
      const ambiguous = ambiguousBinaries.get(binName) ?? {
        providers,
        scriptLocations: new Set(),
        sourceLines: new Map(),
      };
      if (location?.startsWith("package.json#scripts.")) {
        ambiguous.scriptLocations.add(location);
      } else if (location) {
        const lines = ambiguous.sourceLines.get(location) ?? new Set();
        for (const line of matchingLines) lines.add(line);
        ambiguous.sourceLines.set(location, lines);
      }
      ambiguousBinaries.set(binName, ambiguous);
    }
  }
}

function collectImports(source, dependencies, used) {
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const imported = packageNameFromSpecifier(match[1]);
      if (imported && dependencies.has(imported)) used.add(imported);

      if (imported) {
        for (const typesPackage of typePackageNamesForImport(imported)) {
          if (dependencies.has(typesPackage)) used.add(typesPackage);
        }
      }
    }
  }
}

function collectUndeclaredImports(source, declaredDependencies, path, found) {
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const imported = packageNameFromSpecifier(match[1]);
      if (
        !imported ||
        imported.startsWith("@workspace/") ||
        declaredDependencies.has(imported)
      ) {
        continue;
      }
      found.set(`${path}\0${imported}`, { name: imported, path });
    }
  }

  if (!/\.(?:css|scss)$/.test(path)) return;

  const pluginReference =
    /@(?:plugin|import|source|config|reference)\s+(?:url\()?\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pluginReference)) {
    const imported = packageNameFromSpecifier(match[1]);
    if (
      !imported ||
      imported.startsWith("@workspace/") ||
      declaredDependencies.has(imported)
    ) {
      continue;
    }
    found.set(`${path}\0${imported}`, { name: imported, path });
  }
}

function collectCssPluginReferences(path, source, dependencies, used) {
  if (!/\.(?:css|scss)$/.test(path)) return;

  const pluginReference =
    /@(?:plugin|import|source|config|reference)\s+(?:url\()?\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pluginReference)) {
    const imported = packageNameFromSpecifier(match[1]);
    if (imported && dependencies.has(imported)) used.add(imported);
  }
}

function collectPeerDependencyUsage(used, peerPackages, dependencies) {
  const queue = [...used];
  while (queue.length > 0) {
    const packageName = queue.pop();
    for (const peer of peerPackages.get(packageName) ?? []) {
      if (dependencies.has(peer) && !used.has(peer)) {
        used.add(peer);
        queue.push(peer);
      }
    }
  }
}

function collectConfigurationStringReferences(
  path,
  source,
  dependencies,
  used,
) {
  if (!isConfigurationFile(path)) return;

  for (const packageName of dependencies) {
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^\\w@/-])${escaped}(?=$|[^\\w@/-])`).test(source)) {
      used.add(packageName);
    }
  }
}

function collectPackageResolutionReferences(source, dependencies, used) {
  const resolutionCall =
    /\b(?:packageInfo|require\.resolve|import\.meta\.resolve|(?:vi|jest)\.mock)\s*\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(resolutionCall)) {
    const resolvedPackage = packageNameFromSpecifier(match[1]);
    if (resolvedPackage && dependencies.has(resolvedPackage)) {
      used.add(resolvedPackage);
    }
  }

  const nodeModulesPath = /\bnode_modules\/((?:@[^/\\\s"'`]+\/)?[^/\\\s"'`]+)/g;
  for (const match of source.matchAll(nodeModulesPath)) {
    if (dependencies.has(match[1])) used.add(match[1]);
  }
}

function collectWorkspaceFilterReferences(source, dependencies, used) {
  for (const packageName of dependencies) {
    if (!packageName.startsWith("@workspace/")) continue;
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filterReference = new RegExp(
      `(?:--filter\\s+|["']--filter["']\\s*,\\s*["'])${escaped}(?=$|[^\\w.-])`,
    );
    if (filterReference.test(source)) used.add(packageName);
  }
}

async function walkSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...(await walkSourceFiles(join(directory, entry.name))));
      }
      continue;
    }

    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (SOURCE_EXTENSIONS.has(extension) && entry.name !== "package.json") {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

async function readInstalledDependencyFacts(artifactPath, dependencyNames) {
  const binPackages = new Map();
  const peerPackages = new Map();
  for (const dependencyName of dependencyNames) {
    const packagePath = join(
      artifactPath,
      "node_modules",
      dependencyName,
      "package.json",
    );
    let packageInfo;
    try {
      packageInfo = JSON.parse(await readFile(packagePath, "utf8"));
    } catch {
      continue;
    }

    const directPeers = Object.keys(packageInfo.peerDependencies ?? {}).filter(
      (peer) => dependencyNames.includes(peer),
    );
    peerPackages.set(dependencyName, new Set(directPeers));

    const entries =
      typeof packageInfo.bin === "string"
        ? [[packageInfo.name?.split("/").at(-1), packageInfo.bin]]
        : Object.entries(packageInfo.bin ?? {});
    for (const [binName] of entries) {
      if (!binName) continue;
      const packages = binPackages.get(binName) ?? new Set();
      packages.add(dependencyName);
      binPackages.set(binName, packages);
    }
  }
  return { binPackages, peerPackages };
}

async function readPackageFiles(packagePath, sourcePaths) {
  const manifest = JSON.parse(
    await readFile(join(packagePath, "package.json"), "utf8"),
  );
  const files = await Promise.all(
    sourcePaths.map(async (path) => ({
      path: relative(packagePath, path).split(sep).join("/"),
      content: await readFile(path, "utf8"),
    })),
  );
  const dependencyNames = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
  const { binPackages, peerPackages } = await readInstalledDependencyFacts(
    packagePath,
    dependencyNames,
  );

  return {
    packageName: manifest.name,
    ...auditDependencyUsage({
      manifest,
      files,
      binPackages,
      peerPackages,
    }),
  };
}

export function auditDependencyUsage({
  manifest,
  files,
  binPackages = new Map(),
  peerPackages = new Map(),
}) {
  const dependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const declaredDependencies = new Set([
    ...dependencies,
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const used = new Set();
  const ambiguousBinaries = new Map();
  const undeclaredImports = new Map();

  addScriptUsage(
    manifest.scripts,
    binPackages,
    dependencies,
    used,
    ambiguousBinaries,
  );

  for (const file of files) {
    collectImports(file.content, dependencies, used);
    collectUndeclaredImports(
      file.content,
      declaredDependencies,
      file.path,
      undeclaredImports,
    );
    collectBinaryUsage(
      file.content,
      binPackages,
      dependencies,
      used,
      ambiguousBinaries,
      file.path,
    );
    addTypeConfigUsage(file.path, file.content, dependencies, used);
    collectCssPluginReferences(file.path, file.content, dependencies, used);
    collectConfigurationStringReferences(
      file.path,
      file.content,
      dependencies,
      used,
    );
    collectPackageResolutionReferences(file.content, dependencies, used);
    collectWorkspaceFilterReferences(file.content, dependencies, used);
  }

  collectPeerDependencyUsage(used, peerPackages, dependencies);

  return {
    unused: [...dependencies]
      .filter((dependency) => !used.has(dependency))
      .sort((left, right) => left.localeCompare(right)),
    undeclaredImports: [...undeclaredImports.values()].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.path.localeCompare(right.path),
    ),
    ambiguousBinaries: [...ambiguousBinaries]
      .map(([name, { providers, scriptLocations, sourceLines }]) => ({
        name,
        providers,
        locations: [
          ...scriptLocations,
          ...[...sourceLines].flatMap(([path, lines]) =>
            [...lines]
              .sort((left, right) => left - right)
              .map((line) => `${path}:${line}`),
          ),
        ].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function auditPackage(artifactPath) {
  const sourcePaths = await walkSourceFiles(artifactPath);
  return readPackageFiles(artifactPath, sourcePaths);
}

async function rootToolingSourceFiles(rootPath) {
  const files = [];
  const rootEntries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (
      entry.isFile() &&
      (entry.name === "pnpm-workspace.yaml" ||
        /^tsconfig(?:\..+)?\.json$/u.test(entry.name))
    ) {
      files.push(join(rootPath, entry.name));
    }
  }

  for (const directory of [".vscode", "scripts", "lib/api-spec"]) {
    const directoryPath = join(rootPath, directory);
    try {
      files.push(...(await walkSourceFiles(directoryPath)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return files;
}

export async function auditRootPackage(rootPath = ROOT) {
  return readPackageFiles(rootPath, await rootToolingSourceFiles(rootPath));
}

async function packageDirectoriesUnder(rootPath, parentDirectory) {
  const parentPath = join(rootPath, parentDirectory);
  let entries;
  try {
    entries = await readdir(parentPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const directories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePath = join(parentPath, entry.name);
    try {
      await readFile(join(packagePath, "package.json"), "utf8");
      directories.push(packagePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return directories;
}

export async function discoverWorkspacePackages(rootPath = ROOT) {
  const packagePaths = [];
  for (const packageRoot of WORKSPACE_PACKAGE_ROOTS) {
    packagePaths.push(
      ...(await packageDirectoriesUnder(rootPath, packageRoot)),
    );
  }
  packagePaths.push(
    ...(await packageDirectoriesUnder(rootPath, "lib/integrations")),
  );

  const scriptsPath = join(rootPath, "scripts");
  try {
    await readFile(join(scriptsPath, "package.json"), "utf8");
    packagePaths.push(scriptsPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return packagePaths.sort((left, right) => left.localeCompare(right));
}

export async function main(rootPath = ROOT, { strict = false } = {}) {
  const packagePaths = await discoverWorkspacePackages(rootPath);
  const [rootResult, ...workspaceResults] = await Promise.all([
    auditRootPackage(rootPath),
    ...packagePaths.map((packagePath) => auditPackage(packagePath)),
  ]);
  const results = [rootResult, ...workspaceResults];
  console.log(
    `Audited the root manifest and ${workspaceResults.length} first-party workspace packages.`,
  );
  let exitCode = 0;
  for (const result of results) {
    const enforce = strict && STRICT_PACKAGE_NAMES.has(result.packageName);
    for (const { name, providers, locations } of result.ambiguousBinaries) {
      console.warn(
        `${result.packageName}: ambiguous binary "${name}" (provided by ${providers.join(", ")}; found in ${locations.join(", ")}); not counted as dependency use.`,
      );
    }
    if (
      STRICT_PACKAGE_NAMES.has(result.packageName) &&
      result.undeclaredImports.length > 0
    ) {
      console.warn(
        `${result.packageName}: external package imports not declared by this package${enforce ? " (strict check failed)" : " (review only)"}:`,
      );
      for (const { name, path } of result.undeclaredImports) {
        console.warn(`  - ${path}: ${name}`);
      }
      if (enforce) exitCode = 1;
    }
    if (result.unused.length === 0) {
      console.log(
        `${result.packageName}: all direct dependencies are referenced.`,
      );
      continue;
    }
    console.warn(
      `${result.packageName}: direct dependencies with no detected source/config/script use${enforce ? " (strict check failed)" : " (review only)"}:`,
    );
    for (const dependency of result.unused) console.warn(`  - ${dependency}`);
    if (enforce) exitCode = 1;
  }
  return exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--strict")) {
    console.error(
      "App dependency audit accepts only the optional --strict flag.",
    );
    process.exitCode = 1;
  } else {
    main(ROOT, { strict: args.includes("--strict") })
      .then((exitCode) => {
        process.exitCode = exitCode;
      })
      .catch((error) => {
        console.error(
          `App dependency audit failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exitCode = 1;
      });
  }
}
