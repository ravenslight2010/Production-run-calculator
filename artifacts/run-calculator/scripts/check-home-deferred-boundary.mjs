import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "@workspace/typescript-api-v6";
import { fileURLToPath } from "node:url";
import { VITE_CLIENT_RESOLVE_CONDITIONS } from "./vite-client-resolve-conditions.mjs";

export const DEFERRED_HOME_MODULE_SUFFIXES = [
  "/src/components/ExcelImportDialog.tsx",
  "/src/components/SpecImportDialog.tsx",
  "/src/components/PremixImportDialog.tsx",
  "/src/components/ShippingImportDialog.tsx",
  "/src/components/RecipeGuideImportDialog.tsx",
  "/src/components/CheeseImportDialog.tsx",
  "/src/components/ImportGoldLabCard.tsx",
  "/src/components/SetupContent.tsx",
  "/src/components/WarehouseTabContent.tsx",
  "/src/components/MixesTabContent.tsx",
  "/src/components/SummaryToolsContent.tsx",
  "/src/components/live-stations/LivePackagingTabContent.tsx",
  "/src/components/live-stations/LiveSauceTabContent.tsx",
  "/src/components/live-stations/LiveFrontlineTabContent.tsx",
  "/src/components/live-stations/LiveDoughTabContent.tsx",
  "/src/components/live-stations/LiveSetupRecipesTabContent.tsx",
  "/src/components/live-stations/LiveStoppagesTabContent.tsx",
  "/src/components/live-stations/LiveSummaryTabContent.tsx",
  "/src/components/LineMapDashboard.tsx",
  "/src/components/SetupProfileEditor.tsx",
  "/src/components/ScreenModeView.tsx",
  "/src/components/DataHealthWorkspace.tsx",
  "/src/components/DeferredManagementSurface.tsx",
  "/src/components/ImportHistoryPanel.tsx",
  "/src/components/ImportGoldLabCard.tsx",
  "/src/components/MixReconcilePanel.tsx",
  "/src/components/GlanceOverlay.tsx",
];

const DEFERRED_HOME_PANEL_NAMES = DEFERRED_HOME_MODULE_SUFFIXES.map((suffix) =>
  path.basename(suffix, ".tsx"),
);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, "../src");
const HOME_FILE = path.resolve(SOURCE_ROOT, "pages/home.tsx");
const WORKSPACE_ROOT = path.resolve(SOURCE_ROOT, "../../..");
const LIVE_RUN_FILE = path.resolve(
  SOURCE_ROOT,
  "components/live-stations/LiveRunTabContent.tsx",
);

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function isTypeOnlyExport(node) {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return (
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly)
  );
}

function staticImportSpecifiers(source, filePath) {
  const specifiers = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause;
      if (!clause) {
        specifiers.push(statement.moduleSpecifier.text);
        continue;
      }
      if (clause.isTypeOnly) continue;
      const namedImports = clause.namedBindings;
      const isOnlyTypeSpecifiers =
        !clause.name &&
        namedImports &&
        ts.isNamedImports(namedImports) &&
        namedImports.elements.length > 0 &&
        namedImports.elements.every((element) => element.isTypeOnly);
      if (!isOnlyTypeSpecifiers) {
        specifiers.push(statement.moduleSpecifier.text);
      }
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !isTypeOnlyExport(statement)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function analyzeDynamicImports(source, filePath) {
  const specifiers = [];
  const nonLiteralLocations = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [argument] = node.arguments;
      if (
        argument &&
        (ts.isStringLiteral(argument) ||
          ts.isNoSubstitutionTemplateLiteral(argument))
      ) {
        specifiers.push(argument.text);
      } else {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        nonLiteralLocations.push(`line ${line + 1}, column ${character + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { specifiers, nonLiteralLocations };
}

function resolveSourceFile(basePath, specifier, readSource) {
  const supportedExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const extension = path.extname(basePath);
  if (extension && !supportedExtensions.includes(extension)) return null;

  const candidates = extension
    ? [basePath]
    : [
        basePath,
        ...supportedExtensions.map((candidateExtension) => `${basePath}${candidateExtension}`),
        ...supportedExtensions.map((candidateExtension) =>
          path.join(basePath, `index${candidateExtension}`),
        ),
      ];
  for (const candidate of candidates) {
    try {
      readSource(candidate);
      return candidate;
    } catch (error) {
      if (
        error?.code !== "ENOENT" &&
        error?.code !== "ENOTDIR" &&
        error?.code !== "EISDIR"
      ) {
        throw error;
      }
    }
  }
  throw new Error(
    `Unable to resolve local static import "${specifier}" from "${basePath}".`,
  );
}

const MAX_WORKSPACE_DISCOVERY_DETAIL_LENGTH = 400;

function workspaceDiscoveryContext(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  return {
    root,
    command: `pnpm --dir ${JSON.stringify(root)} --recursive list --json --depth -1`,
  };
}

function safeWorkspaceDiscoveryDetail(value) {
  const detail = String(value ?? "No additional details were provided.")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(token|password|secret|_auth)\s*([=:]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (detail.length <= MAX_WORKSPACE_DISCOVERY_DETAIL_LENGTH) return detail;
  return `${detail.slice(0, MAX_WORKSPACE_DISCOVERY_DETAIL_LENGTH - 1)}…`;
}

function workspaceDiscoveryError(workspaceRoot, detail) {
  const { root, command } = workspaceDiscoveryContext(workspaceRoot);
  return new Error(
    `Workspace package discovery failed.\n` +
      `Command: ${command}\n` +
      `Workspace root: ${root}\n` +
      `Action: Run the command above from the workspace root and check pnpm-workspace.yaml.\n` +
      `Details: ${safeWorkspaceDiscoveryDetail(detail)}`,
  );
}

function discoverWorkspacePackageDirectories(
  workspaceRoot,
  runWorkspaceList = (root) =>
    spawnSync(
      "pnpm",
      ["--dir", root, "--recursive", "list", "--json", "--depth", "-1"],
      { encoding: "utf8" },
    ),
) {
  const result = runWorkspaceList(workspaceRoot);
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message || result.stderr?.trim() || `exit status ${result.status}`;
    throw workspaceDiscoveryError(workspaceRoot, detail);
  }

  let packages;
  try {
    packages = JSON.parse(result.stdout);
    if (!Array.isArray(packages)) {
      throw new Error("pnpm workspace package listing must be a JSON array.");
    }
    if (packages.some((workspacePackage) => typeof workspacePackage?.path !== "string")) {
      throw new Error("pnpm workspace package listing contains an entry without a path.");
    }
  } catch (error) {
    throw workspaceDiscoveryError(
      workspaceRoot,
      `Invalid pnpm workspace package listing: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const root = path.resolve(workspaceRoot);
  return packages.map((workspacePackage) => {
    const packageDirectory = path.resolve(workspacePackage.path);
    const relativePath = path.relative(root, packageDirectory);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw workspaceDiscoveryError(
        workspaceRoot,
        `pnpm reported a workspace package outside the root: "${packageDirectory}".`,
      );
    }
    return packageDirectory;
  });
}

function workspacePackageRoot(
  packageName,
  workspaceRoot,
  readSource,
  workspacePackageDirectories,
) {
  const matches = [];
  for (const candidateDirectory of workspacePackageDirectories) {
    const manifestPath = path.join(candidateDirectory, "package.json");
    const manifest = JSON.parse(readSource(manifestPath));
    if (manifest.name === packageName) matches.push(candidateDirectory);
  }
  if (matches.length > 1) {
    const conflictingDirectories = matches
      .map((directory) => normalize(path.relative(workspaceRoot, directory)))
      .sort();
    throw new Error(
      `Workspace package "${packageName}" has multiple local manifests: ${conflictingDirectories.join(", ")}.`,
    );
  }
  return matches[0] ?? null;
}

function exportTarget(exportsField, exportKey) {
  const selectedExport =
    typeof exportsField === "string" || Array.isArray(exportsField)
      ? exportKey === "."
        ? exportsField
        : undefined
      : exportsField &&
          Object.keys(exportsField).some((key) => key.startsWith("."))
        ? exportsField[exportKey]
        : exportKey === "."
          ? exportsField
          : undefined;

  const selectRuntimeTarget = (value, conditions) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const target = selectRuntimeTarget(entry, conditions);
        if (target) return target;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    for (const [condition, branch] of Object.entries(value)) {
      if (condition !== "default" && !conditions.has(condition)) continue;
      const target = selectRuntimeTarget(branch, conditions);
      if (target) return target;
    }
    return null;
  };

  const selectForMode = (mode) => {
    const conditions = new Set([
      ...VITE_CLIENT_RESOLVE_CONDITIONS.filter(
        (condition) => condition !== "development|production",
      ),
      mode,
      "import",
      "default",
    ]);
    return selectRuntimeTarget(selectedExport, conditions);
  };

  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "development" || nodeEnv === "production") {
    return selectForMode(nodeEnv);
  }

  const developmentTarget = selectForMode("development");
  const productionTarget = selectForMode("production");
  if (developmentTarget !== productionTarget) {
    throw new Error(
      `Workspace package export "${exportKey}" resolves to different entries for Vite development and production conditions; set NODE_ENV to the build mode or use a mode-independent export.`,
    );
  }
  return productionTarget;
}

function resolveWorkspaceSource(
  specifier,
  workspaceRoot,
  readSource,
  getWorkspacePackageDirectories,
) {
  const match = specifier.match(/^(@workspace\/[^/]+)(\/.*)?$/);
  if (!match) return null;
  const [, packageName, packageSubpath = ""] = match;
  const packageRoot = workspacePackageRoot(
    packageName,
    workspaceRoot,
    readSource,
    getWorkspacePackageDirectories(),
  );
  if (!packageRoot) {
    throw new Error(`Unable to find local workspace package "${packageName}".`);
  }

  const manifestPath = path.join(packageRoot, "package.json");
  const manifest = JSON.parse(readSource(manifestPath));
  const exportKey = packageSubpath ? `.${packageSubpath}` : ".";
  const target = exportTarget(manifest.exports, exportKey);
  if (!target || !target.startsWith("./")) {
    throw new Error(
      `Workspace package "${packageName}" does not export a local source entry for "${exportKey}".`,
    );
  }

  const targetPath = path.resolve(packageRoot, target);
  const relativeTarget = path.relative(packageRoot, targetPath);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error(
      `Workspace package "${packageName}" export "${exportKey}" escapes its package directory.`,
    );
  }
  return resolveSourceFile(targetPath, specifier, readSource);
}

function resolveLocalSource(
  specifier,
  importerPath,
  sourceRoot,
  workspaceRoot,
  readSource,
  includeWorkspacePackages = true,
  getWorkspacePackageDirectories,
) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  let basePath;
  if (cleanSpecifier.startsWith("@/")) {
    basePath = path.resolve(sourceRoot, cleanSpecifier.slice(2));
  } else if (cleanSpecifier.startsWith(".")) {
    basePath = path.resolve(path.dirname(importerPath), cleanSpecifier);
  } else {
    return includeWorkspacePackages
      ? resolveWorkspaceSource(
          cleanSpecifier,
          workspaceRoot,
          readSource,
          getWorkspacePackageDirectories,
        )
      : null;
  }

  return resolveSourceFile(basePath, specifier, readSource);
}

export function checkHomeDeferredSourceBoundary({
  homeSource,
  liveRunSource,
  homeFilePath = HOME_FILE,
  liveRunFilePath = LIVE_RUN_FILE,
  sourceRoot = SOURCE_ROOT,
  workspaceRoot = WORKSPACE_ROOT,
  readSource = (filePath) => fs.readFileSync(filePath, "utf8"),
  runWorkspaceList,
}) {
  let workspacePackageDirectories;
  const getWorkspacePackageDirectories = () => {
    workspacePackageDirectories ??= discoverWorkspacePackageDirectories(
      workspaceRoot,
      runWorkspaceList,
    );
    return workspacePackageDirectories;
  };
  const roots = [
    ["Home", homeFilePath, homeSource],
    ["LiveRunTabContent", liveRunFilePath, liveRunSource],
  ];

  const deferredPaths = new Map(
    DEFERRED_HOME_MODULE_SUFFIXES.map((suffix, index) => [
      normalize(path.resolve(sourceRoot, `.${suffix.replace("/src", "")}`)),
      DEFERRED_HOME_PANEL_NAMES[index],
    ]),
  );
  const dynamicImportPaths = new Set();
  const rootPaths = new Set(
    roots.map(([, filePath]) => normalize(path.resolve(filePath))),
  );
  const sourceRootPath = path.resolve(sourceRoot);
  const isLocalSourcePath = (filePath) => {
    const relativePath = path.relative(sourceRootPath, filePath);
    return (
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    );
  };
  const collectDynamicImports = (
    sourceName,
    filePath,
    source,
    importChain,
    isHelper,
  ) => {
    const { specifiers, nonLiteralLocations } = analyzeDynamicImports(
      source,
      filePath,
    );
    if (nonLiteralLocations.length > 0) {
      const sourceLabel = isHelper
        ? `${sourceName} helper ${normalize(path.relative(sourceRootPath, filePath))}`
        : sourceName;
      const chain =
        importChain.length > 0
          ? `\nImport chain: ${[sourceName, ...importChain].join(" -> ")}`
          : "";
      throw new Error(
        `${sourceLabel} has runtime dynamic import(s) with a non-literal specifier that the Home startup guard cannot inspect:\n` +
          `${nonLiteralLocations.map((location) => `- ${location}`).join("\n")}\n` +
          `Use a string literal or no-substitution template literal for each dynamic import specifier.${chain}`,
      );
    }
    for (const specifier of specifiers) {
      const importedPath = resolveLocalSource(
        specifier,
        filePath,
        sourceRoot,
        workspaceRoot,
        readSource,
        false,
        getWorkspacePackageDirectories,
      );
      if (importedPath) {
        dynamicImportPaths.add(normalize(path.resolve(importedPath)));
      }
    }
  };

  for (const [sourceName, filePath, source] of roots) {
    collectDynamicImports(sourceName, filePath, source, [], false);
  }

  const unregisteredDynamicImports = [...dynamicImportPaths].filter(
    (importedPath) => !deferredPaths.has(importedPath),
  );
  if (unregisteredDynamicImports.length > 0) {
    throw new Error(
      `Home has local dynamic import(s) missing from the deferred panel inventory:\n${unregisteredDynamicImports
        .map((importedPath) => `- ${path.relative(sourceRoot, importedPath)}`)
        .join("\n")}`,
    );
  }

  const visited = new Set();
  const visit = (sourceName, filePath, source, importChain) => {
    const normalizedPath = normalize(path.resolve(filePath));
    if (visited.has(normalizedPath)) return;
    visited.add(normalizedPath);

    if (isLocalSourcePath(normalizedPath) && !rootPaths.has(normalizedPath)) {
      collectDynamicImports(
        sourceName,
        normalizedPath,
        source,
        importChain,
        true,
      );
    }

    for (const specifier of staticImportSpecifiers(source, normalizedPath)) {
      const importedPath = resolveLocalSource(
        specifier,
        normalizedPath,
        sourceRoot,
        workspaceRoot,
        readSource,
        true,
        getWorkspacePackageDirectories,
      );
      if (!importedPath) continue;

      const normalizedImportPath = normalize(path.resolve(importedPath));
      const deferredPanel = deferredPaths.get(normalizedImportPath);
      const nextChain = [...importChain, path.relative(sourceRoot, normalizedImportPath)];
      if (deferredPanel) {
        throw new Error(
          `${sourceName} statically imports deferred Home panel(s):\n- ${deferredPanel}\n` +
            `Import chain: ${[sourceName, ...nextChain].join(" -> ")}`,
        );
      }
      visit(
        sourceName,
        normalizedImportPath,
        readSource(normalizedImportPath),
        nextChain,
      );
    }
  };

  for (const [sourceName, filePath, source] of roots) {
    visit(sourceName, filePath, source, []);
  }

  const missingLoaders = [...deferredPaths.entries()]
    .filter(([modulePath]) => !dynamicImportPaths.has(modulePath))
    .map(([, name]) => name);
  if (missingLoaders.length > 0) {
    throw new Error(
      `Home is missing dynamic imports for deferred panel(s):\n${missingLoaders
        .map((name) => `- ${name}`)
        .join("\n")}`,
    );
  }

  return { deferredHomePanels: DEFERRED_HOME_PANEL_NAMES.length };
}

function visitChunks(startFiles, byFile, includeDynamicImports) {
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const chunk = byFile.get(file);
    if (!chunk) {
      throw new Error(`Build manifest is missing imported chunk "${file}".`);
    }
    const imports = [
      ...(chunk.imports ?? []),
      ...(includeDynamicImports ? chunk.dynamicImports ?? [] : []),
    ];
    for (const importedFile of imports) visit(importedFile);
  };
  for (const file of startFiles) visit(file);
  return visited;
}

export function checkHomeDeferredBoundary(manifest) {
  const entries = Object.entries(manifest.chunks ?? {});
  const byFile = new Map(entries);
  const roots = entries.filter(
    ([, chunk]) => chunk.isEntry || chunk.name === "home",
  );
  const homeEntries = entries.filter(([, chunk]) => chunk.name === "home");
  if (roots.length === 0 || homeEntries.length === 0) {
    throw new Error("Build manifest must contain both an application entry and a Home entry.");
  }

  const eagerChunks = visitChunks(roots.map(([file]) => file), byFile, false);
  const eagerModules = new Set(
    [...eagerChunks].flatMap((file) =>
      (byFile.get(file)?.modules ?? []).map(normalize),
    ),
  );
  const deferredChunks = visitChunks(
    homeEntries.flatMap(([, chunk]) => chunk.dynamicImports ?? []),
    byFile,
    true,
  );
  const deferredModules = new Set(
    [...deferredChunks].flatMap((file) =>
      (byFile.get(file)?.modules ?? []).map(normalize),
    ),
  );
  const allModules = new Set(
    entries.flatMap(([, chunk]) => (chunk.modules ?? []).map(normalize)),
  );

  const leaked = DEFERRED_HOME_MODULE_SUFFIXES.filter((suffix) =>
    [...eagerModules].some((source) => source.endsWith(suffix)),
  );
  if (leaked.length > 0) {
    throw new Error(
      `Deferred Home surfaces re-entered the opening static graph:\n${leaked
        .map((suffix) => `- ${suffix}`)
        .join("\n")}`,
    );
  }

  const missing = DEFERRED_HOME_MODULE_SUFFIXES.filter(
    (suffix) => ![...allModules].some((source) => source.endsWith(suffix)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Build manifest is missing deferred Home surface(s):\n${missing
        .map((suffix) => `- ${suffix}`)
        .join("\n")}`,
    );
  }

  const notDeferred = DEFERRED_HOME_MODULE_SUFFIXES.filter(
    (suffix) => ![...deferredModules].some((source) => source.endsWith(suffix)),
  );
  if (notDeferred.length > 0) {
    throw new Error(
      `Home surface(s) are not reachable through a dynamic Home import:\n${notDeferred
        .map((suffix) => `- ${suffix}`)
        .join("\n")}`,
    );
  }

  return {
    eagerModuleCount: eagerModules.size,
    deferredHomePanels: DEFERRED_HOME_MODULE_SUFFIXES.length,
  };
}

function runCli() {
  const sourceResult = checkHomeDeferredSourceBoundary({
    homeSource: fs.readFileSync(HOME_FILE, "utf8"),
    liveRunSource: fs.readFileSync(LIVE_RUN_FILE, "utf8"),
  });
  const manifestPath = path.resolve(
    SCRIPT_DIR,
    "../dist/public/.vite/workbook-boundary-manifest.json",
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Build manifest not found at ${manifestPath}. Run the calculator build first.`);
  }
  const result = checkHomeDeferredBoundary(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
  );
  console.log(
    `Home source boundary OK: ${sourceResult.deferredHomePanels} optional surfaces are statically inventoried.`,
  );
  console.log(
    `Home boundary OK: ${result.eagerModuleCount} opening modules; ${result.deferredHomePanels} optional surfaces are deferred.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
