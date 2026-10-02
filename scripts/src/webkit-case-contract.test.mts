import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertWebKitCompatibilityCaseIdentityContract,
  assertWebKitCaseIdentityContract,
  WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES,
  WEBKIT_EXPECTED_CASE_IDENTITIES,
} from "./webkit-case-contract.mts";

type PlaywrightListSuite = {
  title: string;
  file?: string;
  specs?: Array<{
    file: string;
    title: string;
    tests: Array<{ projectName: string }>;
  }>;
  suites?: PlaywrightListSuite[];
};

function collectWebKitCaseIdentities(
  suites: PlaywrightListSuite[],
  projectNames: ReadonlySet<string>,
  includeProjectName: boolean,
): string[] {
  const identities: string[] = [];

  function visit(
    currentSuites: PlaywrightListSuite[],
    parentTitlePath: string[],
  ): void {
    for (const suite of currentSuites) {
      const titlePath =
        suite.file && suite.title === suite.file
          ? parentTitlePath
          : [...parentTitlePath, suite.title];

      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
          if (!projectNames.has(test.projectName)) continue;
          identities.push(
            `artifacts/run-calculator/e2e/${spec.file.replaceAll("\\", "/")} :: ${[
              ...titlePath,
              ...(includeProjectName ? [test.projectName] : []),
              spec.title,
            ].join(" › ")}`,
          );
        }
      }

      visit(suite.suites ?? [], titlePath);
    }
  }

  visit(suites, []);
  return identities.sort();
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const discoveryJson = execFileSync(
  "pnpm",
  [
    "--filter",
    "@workspace/run-calculator",
    "exec",
    "playwright",
    "test",
    "--config",
    "playwright.webkit.config.ts",
    "--list",
    "--reporter=json",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PLAYWRIGHT_BASE_URL: "http://127.0.0.1:18082",
      PLAYWRIGHT_API_BASE_URL: "http://127.0.0.1:18081",
    },
    maxBuffer: 30 * 1024 * 1024,
  },
);
const discoveryReport = JSON.parse(discoveryJson) as {
  config: { projects: Array<{ name: string }> };
  errors: Array<{ message: string }>;
  suites: PlaywrightListSuite[];
};

assert.deepEqual(
  discoveryReport.errors,
  [],
  "the authoritative WebKit Playwright config must discover without errors",
);
assert.deepEqual(
  discoveryReport.config.projects.map((project) => project.name),
  ["webkit"],
  "the WebKit identity inventory must come from the dedicated release project, not Chromium",
);

const discoveredIdentities = collectWebKitCaseIdentities(
  discoveryReport.suites,
  new Set(["webkit"]),
  false,
);
assert.equal(WEBKIT_EXPECTED_CASE_IDENTITIES.length, 3);
assert.equal(
  new Set(WEBKIT_EXPECTED_CASE_IDENTITIES).size,
  WEBKIT_EXPECTED_CASE_IDENTITIES.length,
  "the reviewed WebKit identity inventory must not contain duplicates",
);
assert.doesNotThrow(() =>
  assertWebKitCaseIdentityContract(discoveredIdentities),
);

const addedIdentity =
  "artifacts/run-calculator/e2e/new-webkit.spec.ts :: new WebKit release case";
assert.throws(
  () =>
    assertWebKitCaseIdentityContract([
      ...WEBKIT_EXPECTED_CASE_IDENTITIES,
      addedIdentity,
    ]),
  /Added identities[\s\S]*\+ artifacts\/run-calculator\/e2e\/new-webkit\.spec\.ts :: new WebKit release case/,
  "an added WebKit case must be listed for review",
);
assert.throws(
  () =>
    assertWebKitCaseIdentityContract(
      WEBKIT_EXPECTED_CASE_IDENTITIES.slice(1),
    ),
  /Removed identities/,
  "a removed WebKit case must be listed for review",
);
assert.throws(
  () =>
    assertWebKitCaseIdentityContract([
      ...WEBKIT_EXPECTED_CASE_IDENTITIES.slice(1),
      addedIdentity,
    ]),
  /Added identities[\s\S]*Removed identities/,
  "a same-count WebKit substitution must report both identities",
);
assert.throws(
  () =>
    assertWebKitCaseIdentityContract([
      ...WEBKIT_EXPECTED_CASE_IDENTITIES,
      WEBKIT_EXPECTED_CASE_IDENTITIES[0]!,
    ]),
  /Duplicate discovered identities: 1/,
  "duplicate WebKit discoveries must be reported",
);

const compatibilityJson = execFileSync(
  "pnpm",
  [
    "--filter",
    "@workspace/run-calculator",
    "exec",
    "playwright",
    "test",
    "--config",
    "playwright.compatibility.config.ts",
    "--list",
    "--reporter=json",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PLAYWRIGHT_BASE_URL: "http://127.0.0.1:18082",
      PLAYWRIGHT_API_BASE_URL: "http://127.0.0.1:18081",
    },
    maxBuffer: 30 * 1024 * 1024,
  },
);
const compatibilityReport = JSON.parse(compatibilityJson) as {
  config: { projects: Array<{ name: string }> };
  errors: Array<{ message: string }>;
  suites: PlaywrightListSuite[];
};
assert.deepEqual(
  compatibilityReport.errors,
  [],
  "the authoritative compatibility Playwright config must discover without errors",
);
const webkitCompatibilityProjects = compatibilityReport.config.projects
  .map((project) => project.name)
  .filter((name) => name.endsWith("-webkit"))
  .sort();
assert.deepEqual(
  webkitCompatibilityProjects,
  ["phone-webkit", "tablet-webkit"],
  "the compatibility inventory must cover only the phone and tablet WebKit projects",
);
const compatibilityIdentities = collectWebKitCaseIdentities(
  compatibilityReport.suites,
  new Set(webkitCompatibilityProjects),
  true,
);
assert.equal(WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES.length, 4);
assert.equal(
  new Set(WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES).size,
  WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES.length,
  "the reviewed WebKit compatibility identity inventory must not contain duplicates",
);
assert.doesNotThrow(() =>
  assertWebKitCompatibilityCaseIdentityContract(compatibilityIdentities),
);

const addedCompatibilityIdentity =
  "artifacts/run-calculator/e2e/new-webkit.spec.ts :: phone-webkit › new compatibility case";
assert.throws(
  () =>
    assertWebKitCompatibilityCaseIdentityContract([
      ...WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES,
      addedCompatibilityIdentity,
    ]),
  /Added identities[\s\S]*\+ artifacts\/run-calculator\/e2e\/new-webkit\.spec\.ts :: phone-webkit › new compatibility case/,
  "an added compatibility case must be listed for review",
);
assert.throws(
  () =>
    assertWebKitCompatibilityCaseIdentityContract(
      WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES.slice(1),
    ),
  /Removed identities/,
  "a removed compatibility case must be listed for review",
);
assert.throws(
  () =>
    assertWebKitCompatibilityCaseIdentityContract([
      ...WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES.slice(1),
      addedCompatibilityIdentity,
    ]),
  /Added identities[\s\S]*Removed identities/,
  "a same-count compatibility substitution must report both identities",
);

console.log(
  "WebKit release and compatibility identity contracts passed (authoritative configs, project separation, additions, removals, substitutions).",
);