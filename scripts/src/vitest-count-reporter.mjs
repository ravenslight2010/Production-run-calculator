import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MAX_TEST_CASES = 100_000;
const MAX_SUMMARY_BYTES = 4096;

function isSafePackageName(value) {
  return typeof value === "string" && /^@workspace\/[a-z0-9-]{2,80}$/.test(value);
}

async function readPackageName() {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    );
    return isSafePackageName(manifest.name) ? manifest.name : null;
  } catch {
    return null;
  }
}

function countTestCases(testModules) {
  if (!Array.isArray(testModules) || testModules.length > MAX_TEST_CASES) {
    return null;
  }
  const totals = { total: 0, passed: 0, failed: 0, skipped: 0, notRun: 0 };
  for (const module of testModules) {
    if (typeof module?.children?.allTests !== "function") return null;
    for (const testCase of module.children.allTests()) {
      if (!testCase || typeof testCase.result !== "function") return null;
      totals.total += 1;
      if (totals.total > MAX_TEST_CASES) return null;
      const state = testCase?.result?.()?.state;
      if (state === "passed") totals.passed += 1;
      else if (state === "failed") totals.failed += 1;
      else if (state === "pending") totals.notRun += 1;
      else if (state === "skipped" && testCase.options?.mode === "todo") {
        totals.notRun += 1;
      } else if (state === "skipped") totals.skipped += 1;
      else return null;
    }
  }
  if (
    totals.total === 0 ||
    totals.total !==
      totals.passed + totals.failed + totals.skipped + totals.notRun
  ) {
    return null;
  }
  return totals;
}

export default class VitestCountOnlyReporter {
  async onTestRunEnd(
    testModules,
    unhandledErrors = [],
    reason = "passed",
  ) {
    const outputDirectory = process.env.TEST_RESULTS_VITEST_COUNTS_DIR;
    const runId = process.env.TEST_RESULTS_VITEST_RUN_ID;
    const sourceRevision =
      process.env.TEST_RESULTS_VITEST_SOURCE_REVISION?.toLowerCase();
    if (
      !Array.isArray(unhandledErrors) ||
      unhandledErrors.length > 0 ||
      !["passed", "failed"].includes(reason) ||
      typeof outputDirectory !== "string" ||
      !outputDirectory ||
      typeof runId !== "string" ||
      !/^[a-zA-Z0-9:._-]{1,200}$/.test(runId) ||
      typeof sourceRevision !== "string" ||
      !/^[a-f0-9]{40,64}$/.test(sourceRevision)
    ) {
      return;
    }
    const absoluteDirectory = resolve(outputDirectory);
    const relativeDirectory = relative(REPOSITORY_ROOT, absoluteDirectory);
    if (
      relativeDirectory === ".." ||
      relativeDirectory.startsWith(`..${sep}`)
    ) {
      return;
    }

    const totals = countTestCases(testModules);
    const packageName = await readPackageName();
    if (!totals || !packageName) return;
    const summary = {
      schemaVersion: 1,
      runner: "vitest",
      runId,
      sourceRevision,
      packageName,
      totals,
    };
    const contents = JSON.stringify(summary);
    if (Buffer.byteLength(contents, "utf8") > MAX_SUMMARY_BYTES) return;

    const packageSegment = packageName
      .slice("@workspace/".length)
      .replaceAll(/[^a-z0-9_-]/g, "-");
    try {
      await writeFile(
        resolve(absoluteDirectory, `${packageSegment}-${process.pid}.json`),
        contents,
        { flag: "wx" },
      );
    } catch {
      // Reporter evidence is optional and must never change the test outcome.
    }
  }
}
