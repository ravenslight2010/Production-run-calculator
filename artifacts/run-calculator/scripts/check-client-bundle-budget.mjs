import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLIENT_BUNDLE_BUDGETS = {
  appShellBytes: 750_000,
  authenticatedStartupBytes: 2_070_000,
  homeChunkBytes: 950_000,
};

function staticChunkClosure(startFiles, byFile) {
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    const chunk = byFile.get(file);
    if (!chunk) {
      throw new Error(`Build manifest is missing imported chunk "${file}".`);
    }
    visited.add(file);
    for (const importedFile of chunk.imports ?? []) visit(importedFile);
  };
  for (const file of startFiles) visit(file);
  return visited;
}

function measureBytes(files, byFile, readChunkBytes) {
  return [...files].reduce((total, file) => {
    const chunk = byFile.get(file);
    const bytes = readChunkBytes ? readChunkBytes(file, chunk) : chunk?.bytes;
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`Build manifest is missing a valid byte count for "${file}".`);
    }
    return total + bytes;
  }, 0);
}

function assertWithinBudget(name, actual, limit) {
  if (actual > limit) {
    throw new Error(
      `${name} is ${actual.toLocaleString("en-US")} bytes; budget is ${limit.toLocaleString("en-US")} bytes.`,
    );
  }
}

export function checkClientBundleBudget(
  manifest,
  budgets = CLIENT_BUNDLE_BUDGETS,
  readChunkBytes,
) {
  const entries = Object.entries(manifest.chunks ?? {});
  const byFile = new Map(entries);
  const appEntries = entries.filter(([, chunk]) => chunk.isEntry);
  const homeEntries = entries.filter(([, chunk]) => chunk.name === "home");
  if (appEntries.length === 0 || homeEntries.length !== 1) {
    throw new Error("Build manifest must contain an application entry and exactly one Home entry.");
  }

  const appShellChunks = staticChunkClosure(
    appEntries.map(([file]) => file),
    byFile,
  );
  const authenticatedStartupChunks = staticChunkClosure(
    [...appEntries, ...homeEntries].map(([file]) => file),
    byFile,
  );
  const appShellBytes = measureBytes(appShellChunks, byFile, readChunkBytes);
  const authenticatedStartupBytes = measureBytes(
    authenticatedStartupChunks,
    byFile,
    readChunkBytes,
  );
  const homeChunkBytes = measureBytes(
    new Set(homeEntries.map(([file]) => file)),
    byFile,
    readChunkBytes,
  );

  assertWithinBudget("App-shell JavaScript", appShellBytes, budgets.appShellBytes);
  assertWithinBudget(
    "Authenticated startup JavaScript",
    authenticatedStartupBytes,
    budgets.authenticatedStartupBytes,
  );
  assertWithinBudget("Home chunk", homeChunkBytes, budgets.homeChunkBytes);

  return { appShellBytes, authenticatedStartupBytes, homeChunkBytes };
}

function runCli() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = path.resolve(
    scriptDir,
    "../dist/public/.vite/workbook-boundary-manifest.json",
  );
  const outputRoot = path.resolve(scriptDir, "../dist/public");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Build manifest not found at ${manifestPath}. Run the calculator build first.`);
  }
  const result = checkClientBundleBudget(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    CLIENT_BUNDLE_BUDGETS,
    (file) => {
      const outputPath = path.resolve(outputRoot, file);
      const relativePath = path.relative(outputRoot, outputPath);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error(`Build manifest contains an unsafe chunk path "${file}".`);
      }
      const stat = fs.statSync(outputPath);
      if (!stat.isFile()) {
        throw new Error(`Build manifest chunk "${file}" is not a regular file.`);
      }
      return stat.size;
    },
  );
  console.log(
    [
      "Client JavaScript budgets OK:",
      `app shell ${result.appShellBytes.toLocaleString("en-US")} / ${CLIENT_BUNDLE_BUDGETS.appShellBytes.toLocaleString("en-US")} bytes;`,
      `authenticated startup ${result.authenticatedStartupBytes.toLocaleString("en-US")} / ${CLIENT_BUNDLE_BUDGETS.authenticatedStartupBytes.toLocaleString("en-US")} bytes;`,
      `Home chunk ${result.homeChunkBytes.toLocaleString("en-US")} / ${CLIENT_BUNDLE_BUDGETS.homeChunkBytes.toLocaleString("en-US")} bytes.`,
    ].join(" "),
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
