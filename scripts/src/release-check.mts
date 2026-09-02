import { execFile, spawn } from "node:child_process";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

export type ReleaseStep = {
  label: string;
  args: string[];
  command?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  warningMs?: number;
  group?: string;
  /**
   * Steps in the same stage share a dependency barrier. Steps without an
   * explicit stage retain the historical one-step-at-a-time behavior; this is
   * also useful for the small fixture used by the resume integration test.
   */
  stage?: string;
  /** Optional per-stage limit, used to keep stateful browser work serial. */
  concurrencyLimit?: number;
};

export type StepStatus =
  | "PASS"
  | "FAIL"
  | "INFRASTRUCTURE TIMEOUT"
  | "INFRASTRUCTURE ERROR"
  | "NOT REACHED";

export type ReleaseStepResult = {
  label: string;
  status: StepStatus;
  elapsedMs: number;
};

export type ReleaseStageTiming = {
  stage: string;
  elapsedMs: number;
};

export type ReleaseTiming = {
  totalElapsedMs: number;
  stages: readonly ReleaseStageTiming[];
};

export type ReleaseEvidenceOptions = {
  currentRevision?: string;
  expectedMode?: "standard" | "full";
  expectedLabels?: readonly string[];
};

export type BrowserDurationRegression = {
  file: string;
  baselineDurationMs: number;
  durationMs: number;
  increaseMs: number;
  increasePercent: number;
};

// The third integration shard contains the capability matrix and the
// remaining integration fixtures. It is serialized inside its own Vitest
// process, so it can exceed four minutes on the release environment even when
// every test is healthy.
export const API_SHARD_TIMEOUT_MS = 8 * 60_000;
export const API_SHARD_WARNING_MS = 6 * 60_000;
export const RELEASE_CHECK_DEFAULT_CONCURRENCY = 4;
export const RELEASE_CHECK_API_CONCURRENCY = 2;
// The main browser suite is intentionally serialized because several tests
// reset or observe shared disposable live-day state. Its 113 cases can exceed
// the API shard budget on a cold release environment, so give the complete
// evidence-producing gate a longer bounded window instead of weakening
// isolation with parallel workers or masking intermittent failures with
// retries.
const FULL_BROWSER_TIMEOUT_MS = 30 * 60_000;
const FULL_BROWSER_WARNING_MS = 25 * 60_000;
const FULL_BROWSER_EXPECTED_CASES = 113;
const FULL_BROWSER_GATE_LABEL = "full browser E2E suite";
const rootDir = new URL("../../", import.meta.url).pathname;
const STATEFUL_RELEASE_LOCK_DIR =
  "/tmp/run-calculator-release-stateful-gates.lock";
const STATEFUL_RELEASE_LOCK_STALE_MS = 60 * 60_000;
const fullRun = process.argv.includes("--full");

async function acquireStatefulReleaseLock(): Promise<() => Promise<void>> {
  let announcedWait = false;
  const owner = `${process.pid}-${Date.now()}`;
  for (;;) {
    try {
      await mkdir(STATEFUL_RELEASE_LOCK_DIR);
      await writeFile(
        resolve(STATEFUL_RELEASE_LOCK_DIR, "owner"),
        `${owner}\n`,
        "utf8",
      );
      if (announcedWait) {
        console.log("Acquired shared stateful release-gate lock.");
      }
      return async () => {
        const currentOwner = await readFile(
          resolve(STATEFUL_RELEASE_LOCK_DIR, "owner"),
          "utf8",
        ).catch(() => "");
        if (currentOwner.trim() === owner) {
          await rm(STATEFUL_RELEASE_LOCK_DIR, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lock = await lstat(STATEFUL_RELEASE_LOCK_DIR).catch(
        () => undefined,
      );
      if (
        lock &&
        Date.now() - lock.mtimeMs > STATEFUL_RELEASE_LOCK_STALE_MS
      ) {
        await rm(STATEFUL_RELEASE_LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (!announcedWait) {
        console.log(
          "Another release check is running stateful gates; waiting to preserve database and port isolation.",
        );
        announcedWait = true;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    }
  }
}
function cliOptionValue(option: string): string | undefined {
  const inlineValue = process.argv.find((argument) =>
    argument.startsWith(`${option}=`),
  );
  if (inlineValue !== undefined) return inlineValue.slice(option.length + 1);
  const optionIndex = process.argv.indexOf(option);
  const value = optionIndex === -1 ? undefined : process.argv[optionIndex + 1];
  return value !== undefined && !value.startsWith("--") ? value : undefined;
}

const evidenceDirArgument = cliOptionValue("--evidence-dir");
export function defaultReleaseEvidenceDir(mode: "standard" | "full"): string {
  return mode === "full" ? "release-evidence-full" : "release-evidence";
}

export function resolveReleaseEvidenceDir(
  mode: "standard" | "full",
  configuredDir = process.env.RELEASE_EVIDENCE_DIR,
): string {
  return configuredDir ?? defaultReleaseEvidenceDir(mode);
}

const releaseEvidenceDir = resolveReleaseEvidenceDir(
  fullRun ? "full" : "standard",
  evidenceDirArgument ?? process.env.RELEASE_EVIDENCE_DIR,
);
const cleanStartEvidenceDir = `${releaseEvidenceDir}/clean-start`;
const fullBrowserReportPath = resolve(
  rootDir,
  releaseEvidenceDir,
  "browser-full/FINAL-REPORT.md",
);
export const RELEASE_EVIDENCE_ALLOWLIST = [
  "release-check-report.md",
  "clean-start/clean-start-evidence.json",
  "clean-start/browser-result.json",
  "clean-start/preview-home.png",
  "clean-start/startup-api.log",
  "clean-start/startup-web.log",
  "clean-start/startup-mockup.log",
  "browser-full/FINAL-REPORT.md",
  "release-check.log",
  "release-check-state.json",
] as const;

export const RELEASE_CHECK_API_SHARD_STEPS: readonly ReleaseStep[] = [
  {
    label: "API unit tests (release shard 1/6)",
    args: ["--filter", "@workspace/api-server", "run", "test:release:unit"],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
    stage: "release-tests",
  },
  {
    label: "API integration tests (release shard 2/6)",
    args: [
      "--filter",
      "@workspace/api-server",
      "run",
      "test:release:integration:1",
    ],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
    stage: "release-tests",
  },
  {
    label: "API integration tests (release shard 3/6)",
    args: [
      "--filter",
      "@workspace/api-server",
      "run",
      "test:release:integration:2",
    ],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
    stage: "release-tests",
  },
  {
    label: "API integration tests (release shard 4/6)",
    args: [
      "--filter",
      "@workspace/api-server",
      "run",
      "test:release:integration:3",
    ],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
    stage: "release-tests",
  },
  {
    label: "API sync tests (release shard 5/6)",
    args: ["--filter", "@workspace/api-server", "run", "test:release:sync"],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
    stage: "release-tests",
  },
  {
    label: "API sync SSE tests (release shard 6/6)",
    args: ["--filter", "@workspace/api-server", "run", "test:release:sync-sse"],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
    stage: "release-tests",
  },
] as const;

const steps: ReleaseStep[] = [
  {
    label: "production dependency audit",
    args: ["run", "audit:prod"],
    stage: "prerequisites",
  },
  {
    label: "generated API client freshness",
    args: ["run", "check:api-generated"],
    stage: "prerequisites",
  },
  {
    label: "shared library typechecks",
    args: ["run", "typecheck:libs"],
    stage: "shared-output",
  },
  {
    label: "API server typecheck",
    args: ["--filter", "@workspace/api-server", "run", "typecheck"],
    stage: "consumer-typechecks",
  },
  {
    label: "run calculator typecheck",
    args: ["--filter", "@workspace/run-calculator", "run", "typecheck"],
    stage: "consumer-typechecks",
  },
  {
    label: "mockup sandbox typecheck",
    args: ["--filter", "@workspace/mockup-sandbox", "run", "typecheck"],
    stage: "consumer-typechecks",
  },
  {
    label: "scripts typecheck",
    args: ["--filter", "@workspace/scripts", "run", "typecheck"],
    stage: "consumer-typechecks",
  },
  {
    label: "recovery evidence audit",
    args: ["run", "audit:recovery"],
    stage: "prerequisites",
  },
  {
    label: "clean-start smoke",
    args: ["run", "check:clean-start"],
    env: {
      CLEAN_START_API_PORT: "18081",
      CLEAN_START_WEB_PORT: "18082",
      CLEAN_START_MOCKUP_PORT: "18180",
      CLEAN_START_EVIDENCE_DIR: cleanStartEvidenceDir,
    },
    stage: "clean-start",
    concurrencyLimit: 1,
  },
  ...RELEASE_CHECK_API_SHARD_STEPS,
  {
    label: "run calculator tests",
    args: ["--filter", "@workspace/run-calculator", "run", "test"],
    stage: "release-tests",
  },
  {
    label: "production rules tests",
    args: ["--filter", "@workspace/production-rules", "run", "test"],
    stage: "release-tests",
  },
  {
    label: "inventory math tests",
    args: ["--filter", "@workspace/inventory-math", "run", "test"],
    stage: "release-tests",
  },
  {
    label: "spec reconcile tests",
    args: ["--filter", "@workspace/spec-reconcile", "run", "test"],
    stage: "release-tests",
  },
  {
    label: "spec import tests",
    args: ["--filter", "@workspace/spec-import", "run", "test"],
    stage: "release-tests",
  },
  {
    label: "scheduled recipe check tests",
    args: ["--filter", "@workspace/scheduled-recipe-check", "run", "test"],
    stage: "release-tests",
  },
  {
    label: "spec export tests",
    args: ["--filter", "@workspace/spec-export", "run", "test"],
    stage: "release-tests",
  },
  {
    label: "corpus tests",
    args: ["--filter", "@workspace/corpus-harness", "run", "test"],
    stage: "release-tests",
  },
  {
    label: "model-bump check",
    args: ["--filter", "@workspace/scripts", "run", "check-model-bump"],
    stage: "release-tests",
  },
  {
    label: "operational evidence check",
    args: [
      "--filter",
      "@workspace/scripts",
      "run",
      "check-operational-skill-evidence",
    ],
    stage: "release-tests",
  },
  {
    label: "browser smoke tests",
    args: ["--filter", "@workspace/run-calculator", "run", "test:e2e:smoke"],
    env: {
      E2E_TEST_DB: "1",
      E2E_APPROVED_DESTRUCTIVE_MODE: "1",
      PLAYWRIGHT_RELEASE_REPORT_PATH: fullBrowserReportPath,
    },
    stage: "browser-smoke",
    concurrencyLimit: 1,
  },
  {
    label: "browser accessibility tests",
    args: ["--filter", "@workspace/run-calculator", "run", "test:e2e:a11y"],
    env: {
      E2E_TEST_DB: "1",
      E2E_APPROVED_DESTRUCTIVE_MODE: "1",
      PLAYWRIGHT_RELEASE_REPORT_PATH: fullBrowserReportPath,
    },
    stage: "browser-accessibility",
    concurrencyLimit: 1,
  },
];

if (fullRun) {
  steps.push({
    label: FULL_BROWSER_GATE_LABEL,
    args: ["--filter", "@workspace/run-calculator", "run", "test:e2e"],
    env: {
      E2E_TEST_DB: "1",
      E2E_APPROVED_DESTRUCTIVE_MODE: "1",
      PLAYWRIGHT_RELEASE_REPORT_PATH: fullBrowserReportPath,
    },
    timeoutMs: FULL_BROWSER_TIMEOUT_MS,
    warningMs: FULL_BROWSER_WARNING_MS,
    stage: "browser-full",
    concurrencyLimit: 1,
  });
}

export function releaseGateLabelsForMode(
  mode: "standard" | "full",
): string[] {
  const labels = steps
    .filter((step) =>
      mode === "full" || step.label !== FULL_BROWSER_GATE_LABEL
    )
    .map((step) => step.label);
  // A verifier can be pointed at a full evidence directory without starting
  // this process with --full. Derive the contract from the report's mode, not
  // from the command that happened to launch verification.
  if (
    mode === "full"
    && process.env.RELEASE_CHECK_FIXTURE_STEPS === undefined
    && !labels.includes(FULL_BROWSER_GATE_LABEL)
  ) {
    labels.push(FULL_BROWSER_GATE_LABEL);
  }
  return labels;
}

// The disposable resume integration test supplies a tiny step list so it can
// exercise the real process/checkpoint boundary without running the release
// suite itself. This is intentionally an undocumented test hook rather than a
// production configuration surface.
const fixtureSteps = process.env.RELEASE_CHECK_FIXTURE_STEPS;
if (fixtureSteps !== undefined) {
  try {
    const parsed = JSON.parse(fixtureSteps) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (step) =>
          typeof step !== "object" ||
          step === null ||
          typeof (step as { label?: unknown }).label !== "string" ||
          !Array.isArray((step as { args?: unknown }).args),
      )
    ) {
      throw new Error("fixture steps must be an array of release steps");
    }
    steps.splice(0, steps.length, ...(parsed as ReleaseStep[]));
  } catch (error) {
    throw new Error(
      `Invalid RELEASE_CHECK_FIXTURE_STEPS: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function releaseStepStage(step: ReleaseStep, index: number): string {
  return step.stage ?? `serial-${index}`;
}

export function releaseConcurrencyLimit(
  step: ReleaseStep,
  configuredLimit = RELEASE_CHECK_DEFAULT_CONCURRENCY,
): number {
  if (step.concurrencyLimit !== undefined) {
    return Math.max(1, Math.floor(step.concurrencyLimit));
  }
  if (step.group === "api-test-shards") {
    return Math.min(configuredLimit, RELEASE_CHECK_API_CONCURRENCY);
  }
  return configuredLimit;
}

function configuredReleaseConcurrency(): number {
  const configured = process.env.RELEASE_CHECK_MAX_CONCURRENCY;
  if (configured === undefined || configured.trim() === "") {
    return RELEASE_CHECK_DEFAULT_CONCURRENCY;
  }
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1 || value > 16) {
    throw new Error(
      `RELEASE_CHECK_MAX_CONCURRENCY must be an integer from 1 to 16 (received ${configured}).`,
    );
  }
  return value;
}

function printHelp(): void {
  console.log("Usage:");
  console.log("  pnpm run release:check       Safe standard release gates");
  console.log(
    "  pnpm run release:check:full  Standard gates plus full browser E2E",
  );
  console.log(
    "  pnpm run release:check -- --verify-evidence  Verify retained evidence files",
  );
  console.log(
    "  pnpm run release:check:full -- --verify-evidence  Verify full retained evidence files",
  );
  console.log(
    "  pnpm --filter @workspace/scripts run check:release-evidence -- --evidence-dir <directory>  Verify a selected evidence directory (mode is read from its report)",
  );
  console.log(
    "  pnpm run release:check -- --resume       Resume the current revision's incomplete run",
  );
  console.log(
    "  pnpm --filter @workspace/scripts run check:release-evidence  Verify retained evidence files",
  );
  console.log("");
  console.log(
    "The full browser suite requires a disposable isolated test database.",
  );
  console.log(
    "The API test gate runs six bounded shards; sync SSE tests run separately.",
  );
  console.log(
    `Parallel release stages use at most ${RELEASE_CHECK_DEFAULT_CONCURRENCY} children by default; API/database shards are capped at ${RELEASE_CHECK_API_CONCURRENCY}. Set RELEASE_CHECK_MAX_CONCURRENCY=1 for constrained local environments.`,
  );
}

async function listEvidenceFiles(
  directory: string,
  prefix = "",
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listEvidenceFiles(absolutePath, relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

export async function verifyReleaseEvidence(
  evidenceRoot = resolve(rootDir, releaseEvidenceDir),
  options: ReleaseEvidenceOptions = {},
): Promise<void> {
  const expected = new Set<string>(RELEASE_EVIDENCE_ALLOWLIST);
  const unexpected: string[] = [];

  let files: string[];
  try {
    files = await listEvidenceFiles(evidenceRoot);
  } catch (error) {
    throw new Error(
      `Could not read release evidence directory ${evidenceRoot}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  for (const file of files) {
    const filePath = resolve(evidenceRoot, file);
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink() || !stats.isFile() || !expected.has(file)) {
      unexpected.push(file);
    }
  }

  if (!files.includes("release-check-report.md")) {
    unexpected.push("release-check-report.md (missing)");
  }

  if (unexpected.length > 0) {
    throw new Error(
      [
        "Release evidence contains files outside its allowlist:",
        ...unexpected.map((file) => `- ${file}`),
        `Allowed files: ${RELEASE_EVIDENCE_ALLOWLIST.join(", ")}`,
      ].join("\n"),
    );
  }
  const reportPath = resolve(evidenceRoot, "release-check-report.md");
  const report = await readFile(reportPath, "utf8");
  const reportMode = report.match(/^Mode:\s*(standard|full)\s*$/m)?.[1] as
    | "standard"
    | "full"
    | undefined;
  if (reportMode === undefined) {
    throw new Error(
      "Release report mode is missing or invalid; regenerate the report or point the verifier at a retained standard/full evidence directory.",
    );
  }
  if (options.expectedMode !== undefined && reportMode !== options.expectedMode) {
    throw new Error(
      [
        `Evidence directory contains a ${reportMode} report, but ${options.expectedMode} verification was requested.`,
        `Use ${reportMode === "full" ? "--full" : "standard mode"} for this directory, or point the verifier at a ${options.expectedMode} evidence directory.`,
      ].join(" "),
    );
  }
  const evidenceMode = reportMode;
  const requiredEvidence = [
    ...RELEASE_EVIDENCE_ALLOWLIST.filter((file) =>
      file.startsWith("clean-start/"),
    ),
    ...(evidenceMode === "full"
      ? ["browser-full/FINAL-REPORT.md" as const]
      : []),
  ];
  const missingEvidence = requiredEvidence.filter((file) => !files.includes(file));
  if (missingEvidence.length > 0) {
    throw new Error(
      `Required release evidence is missing:\n${missingEvidence
        .map((file) => `- ${file}`)
        .join("\n")}`,
    );
  }
  const emptyEvidence: string[] = [];
  for (const file of requiredEvidence) {
    const stats = await lstat(resolve(evidenceRoot, file));
    if (stats.size === 0) emptyEvidence.push(file);
  }
  if (emptyEvidence.length > 0) {
    throw new Error(
      `Required release evidence is empty:\n${emptyEvidence
        .map((file) => `- ${file}`)
        .join("\n")}`,
    );
  }
  const revision =
    options.currentRevision ?? (await currentRevision());
  validateReleaseReport(report, {
    currentRevision: revision,
    expectedMode: options.expectedMode,
    expectedLabels: options.expectedLabels,
  });
  if (evidenceMode === "full") {
    const browserReport = await readFile(
      resolve(evidenceRoot, "browser-full/FINAL-REPORT.md"),
      "utf8",
    );
    validateFullBrowserReport(browserReport, {
      currentRevision: revision,
      requirePass: /^Decision:\s*GO\s*$/m.test(report),
    });
  }

  console.log(
    `Release evidence verified: ${files.length} allowlisted file${
      files.length === 1 ? "" : "s"
    }.`,
  );
}

export function validateFullBrowserReport(
  report: string,
  options: { currentRevision: string; requirePass?: boolean },
): void {
  const revision = report.match(/^Revision:\s*(\S+)\s*$/m)?.[1];
  if (!revision || revision !== options.currentRevision) {
    throw new Error(
      `Full browser report revision is missing or stale (expected ${options.currentRevision}).`,
    );
  }

  const result = report.match(/^Result:\s*(PASS|FAIL|TIMEDOUT|INTERRUPTED)\s*$/m)?.[1];
  const expectedCases = Number(
    report.match(/^Expected cases:\s*(\d+)\s*$/m)?.[1],
  );
  const enumeratedCases = Number(
    report.match(/^Enumerated cases:\s*(\d+)\s*$/m)?.[1],
  );
  const completedCases = Number(
    report.match(/^Completed cases:\s*(\d+)\s*$/m)?.[1],
  );
  const passedCases = Number(report.match(/^Passed cases:\s*(\d+)\s*$/m)?.[1]);
  const skippedCases = Number(report.match(/^Skipped cases:\s*(\d+)\s*$/m)?.[1]);
  const failedCases = Number(report.match(/^Failed cases:\s*(\d+)\s*$/m)?.[1]);
  const notRunCases = Number(report.match(/^Not-run cases:\s*(\d+)\s*$/m)?.[1]);
  const coverage = report.match(/^Coverage:\s*(COMPLETE|INCOMPLETE)\s*$/m)?.[1];
  const durationMs = Number(report.match(/^Duration:\s*(\d+)ms\s*$/m)?.[1]);
  if (
    !result
    || !Number.isInteger(expectedCases)
    || !Number.isInteger(passedCases)
    || !Number.isInteger(skippedCases)
    || !Number.isInteger(failedCases)
    || !Number.isInteger(notRunCases)
    || !coverage
    || !Number.isInteger(durationMs)
  ) {
    throw new Error(
      "Full browser report is malformed: result, case counts, coverage, and duration are required.",
    );
  }
  if (expectedCases !== FULL_BROWSER_EXPECTED_CASES) {
    throw new Error(
      `Full browser report has unexpected coverage contract (expected ${FULL_BROWSER_EXPECTED_CASES} cases).`,
    );
  }
  if (
    !Number.isInteger(enumeratedCases) ||
    enumeratedCases !== FULL_BROWSER_EXPECTED_CASES ||
    !Number.isInteger(completedCases) ||
    completedCases < 0 ||
    completedCases > enumeratedCases
  ) {
    throw new Error(
      "Full browser report has incomplete or invalid enumerated/completed case counts.",
    );
  }
  if (
    options.requirePass &&
    (result !== "PASS" ||
      coverage !== "COMPLETE" ||
      completedCases !== expectedCases ||
      failedCases !== 0 ||
      notRunCases !== 0 ||
      passedCases + skippedCases !== expectedCases)
  ) {
    throw new Error(
      "Full browser report cannot support GO unless every expected case passed or was explicitly skipped.",
    );
  }

  const durationSection = report.split("## Per-file duration\n\n")[1];
  if (!durationSection) {
    throw new Error("Full browser report is malformed: per-file durations are required.");
  }
  const rows = [
    ...durationSection.matchAll(
      /^\| `([^`]+)` \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)ms \|$/gm,
    ),
  ].map((match) => ({
    cases: Number(match[2]),
    completed: Number(match[3]),
    passed: Number(match[4]),
    skipped: Number(match[5]),
    failed: Number(match[6]),
    notRun: Number(match[7]),
    durationMs: Number(match[8]),
  }));
  if (rows.length === 0) {
    throw new Error("Full browser report is malformed: no per-file durations found.");
  }
  const totals = rows.reduce(
    (total, row) => ({
      cases: total.cases + row.cases,
      completed: total.completed + row.completed,
      passed: total.passed + row.passed,
      skipped: total.skipped + row.skipped,
      failed: total.failed + row.failed,
      notRun: total.notRun + row.notRun,
      durationMs: total.durationMs + row.durationMs,
    }),
    {
      cases: 0,
      completed: 0,
      passed: 0,
      skipped: 0,
      failed: 0,
      notRun: 0,
      durationMs: 0,
    },
  );
  if (
    totals.cases !== enumeratedCases ||
    totals.completed !== completedCases ||
    totals.passed !== passedCases ||
    totals.skipped !== skippedCases ||
    totals.failed !== failedCases ||
    totals.notRun !== notRunCases ||
    totals.passed + totals.skipped + totals.failed !== completedCases ||
    totals.passed + totals.skipped + totals.failed + totals.notRun !==
      totals.cases ||
    totals.durationMs < 0
  ) {
    throw new Error("Full browser report per-file totals do not match its case counts.");
  }
}

export function parseBrowserDurationRegressions(
  report: string,
): BrowserDurationRegression[] {
  const comparisonSection = report
    .split("## Historical duration comparison\n\n")[1]
    ?.split("\n## ")[0];
  if (!comparisonSection || /Baseline: unavailable/.test(comparisonSection)) {
    return [];
  }

  return [
    ...comparisonSection.matchAll(
      /^\| `([^`]+)` \| (\d+)ms \| (\d+)ms \| \+(\d+)ms \(\+([\d.]+)%\) \|$/gm,
    ),
  ].map((match) => ({
    file: match[1],
    baselineDurationMs: Number(match[2]),
    durationMs: Number(match[3]),
    increaseMs: Number(match[4]),
    increasePercent: Number(match[5]),
  }));
}

export function validateReleaseReport(
  report: string,
  options: {
    currentRevision: string;
    expectedMode?: "standard" | "full";
    expectedLabels?: readonly string[];
  },
): void {
  const revision = report.match(/^Revision:\s*(\S+)\s*$/m)?.[1];
  const mode = report.match(/^Mode:\s*(standard|full)\s*$/m)?.[1] as
    | "standard"
    | "full"
    | undefined;
  const decision = report.match(/^Decision:\s*(GO|NO-GO)\s*$/m)?.[1];
  if (!revision || revision !== options.currentRevision) {
    throw new Error(
      `Release report revision is missing or stale (expected ${options.currentRevision}).`,
    );
  }
  if (!mode || (options.expectedMode && mode !== options.expectedMode)) {
    if (mode && options.expectedMode && mode !== options.expectedMode) {
      throw new Error(
        `Release report is ${mode} mode, but ${options.expectedMode} mode was requested; use the matching verifier mode or evidence directory.`,
      );
    }
    throw new Error(
      `Release report mode is missing or inconsistent (expected ${
        options.expectedMode ?? "standard or full"
      }).`,
    );
  }
  if (!decision) {
    throw new Error("Release report is malformed: missing GO/NO-GO decision.");
  }

  const gateSection = report.split("## Gate results\n\n")[1]?.split("\n## ")[0];
  if (!gateSection) {
    throw new Error("Release report is malformed: missing gate results.");
  }
  const rows = [...gateSection.matchAll(/^\| (.+?) \| (PASS|FAIL|INFRASTRUCTURE TIMEOUT|INFRASTRUCTURE ERROR|NOT REACHED) \|/gm)]
    .map((match) => ({ label: match[1], status: match[2] }));
  const expectedLabels =
    options.expectedLabels ??
    releaseGateLabelsForMode(mode);
  const labels = new Set(rows.map((row) => row.label));
  const missing = expectedLabels.filter((label) => !labels.has(label));
  if (missing.length > 0) {
    throw new Error(
      `Release report is incomplete; missing gate results: ${missing.join(", ")}`,
    );
  }
  if (decision === "GO") {
    const nonPass = rows.filter((row) => row.status !== "PASS");
    if (nonPass.length > 0 || rows.length !== expectedLabels.length) {
      throw new Error(
        "Release report cannot record GO unless every applicable gate is PASS.",
      );
    }
    if (!/^Operational warnings:\s*none\s*$/m.test(report)) {
      throw new Error(
        "Release report cannot record GO without an explicit operational-warnings answer.",
      );
    }
    if (!/^Accepted exceptions:\s*none\s*$/m.test(report)) {
      throw new Error(
        "Release report cannot record GO with undocumented or unbounded exceptions.",
      );
    }
  }
  if (
    !/^Environment:\s*.+$/m.test(report) ||
    !/^Commands:\s*.+$/m.test(report) ||
    !/^Evidence paths:\s*.+$/m.test(report)
  ) {
    throw new Error(
      "Release report is malformed: environment, commands, and evidence paths are required.",
    );
  }
  const exceptions = report.match(/^Accepted exceptions:\s*(.+)$/m)?.[1];
  if (!exceptions) {
    throw new Error("Release report is malformed: accepted exceptions are required.");
  }
  if (exceptions.toLowerCase() !== "none") {
    for (const field of ["Exception owner:", "Exception next action:", "Exception expiry:"]) {
      if (!new RegExp(`^${field.replace(":", "\\:")}\\s*.+$`, "m").test(report)) {
        throw new Error(
          `Accepted exceptions must include a bounded owner, next action, and expiry (${field}).`,
        );
      }
    }
  }
}

export function runStep(
  step: ReleaseStep,
  options: {
    logPath?: string;
    signal?: AbortSignal;
    deferLog?: boolean;
    onOutput?: (text: string) => void;
  } = {},
): Promise<{
  exitCode: number;
  elapsedMs: number;
  status: StepStatus;
  output?: string;
}> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(step.command ?? "pnpm", step.args, {
      cwd: rootDir,
      env: { ...process.env, ...step.env },
      detached: process.platform !== "win32",
      stdio: options.logPath ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let logWrite = Promise.resolve();
    let capturedOutput = "";
    const capture = (chunk: Buffer): void => {
      const text = chunk.toString();
      capturedOutput += text;
      process.stdout.write(text);
      options.onOutput?.(text);
      if (options.logPath && !options.deferLog) {
        logWrite = logWrite.then(() => appendFile(options.logPath!, text));
      }
    };
    if (options.logPath) {
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
    }
    let settled = false;
    let warningTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    let forcedResult:
      | { exitCode: number; status: StepStatus }
      | undefined;
    const killTree = (signal: NodeJS.Signals): void => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process group may already be gone. Fall back to the direct
          // child so callers still wait for its close event before continuing.
        }
      }
      child.kill(signal);
    };
    const stopTree = (
      exitCode: number,
      status: StepStatus,
    ): void => {
      if (forcedResult) return;
      forcedResult = { exitCode, status };
      killTree("SIGTERM");
      killTimer = setTimeout(() => killTree("SIGKILL"), 5_000);
      killTimer.unref();
    };
    const finish = (code: number, status?: StepStatus): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (warningTimer) clearTimeout(warningTimer);
      if (killTimer) clearTimeout(killTimer);
      if (abortHandler) {
        options.signal?.removeEventListener("abort", abortHandler);
      }
      const elapsedMs = Date.now() - startedAt;
      console.log(`${step.label} elapsed ${Math.round(elapsedMs / 1000)}s`);
      void logWrite.then(() =>
        resolve({
          exitCode: code,
          elapsedMs,
          status: status ?? (code === 0 ? "PASS" : "FAIL"),
          output: capturedOutput,
        }),
      );
    };
    const warningMs =
      step.warningMs !== undefined && step.timeoutMs !== undefined
        ? Math.min(step.warningMs, step.timeoutMs)
        : step.warningMs;
    if (warningMs !== undefined) {
      warningTimer = setTimeout(() => {
        console.warn(
          `WARNING: ${step.label} is approaching its ${Math.round(
            (step.timeoutMs ?? warningMs) / 60_000,
          )} minute timeout (elapsed ${Math.round(
            (Date.now() - startedAt) / 1000,
          )}s).`,
        );
      }, warningMs);
    }
    const timer =
      step.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            console.error(
              `${step.label} exceeded its ${Math.round(
                step.timeoutMs! / 60_000,
              )} minute timeout`,
            );
            stopTree(124, "INFRASTRUCTURE TIMEOUT");
          }, step.timeoutMs);

    abortHandler = () => {
      console.error(`${step.label} interrupted by the release runner`);
      stopTree(1, "INFRASTRUCTURE ERROR");
    };
    if (options.signal?.aborted) {
      abortHandler();
    } else {
      options.signal?.addEventListener("abort", abortHandler, { once: true });
    }

    child.once("error", (error) => {
      console.error(`Could not start ${step.label}: ${error.message}`);
      finish(1, "INFRASTRUCTURE ERROR");
    });
    child.once("close", (code, signal) => {
      if (forcedResult) {
        finish(forcedResult.exitCode, forcedResult.status);
        return;
      }
      if (signal) {
        console.error(`${step.label} stopped by ${signal}`);
        // A signal means the runner or operating environment stopped the
        // child (for example an external cancellation or resource limit).
        // Keep this distinct from a test process that exits non-zero so the
        // release report does not misclassify infrastructure as a product
        // regression.
        finish(1, "INFRASTRUCTURE ERROR");
        return;
      }
      finish(code ?? 1);
    });
  });
}

export function formatReleaseReport(
  results: ReleaseStepResult[],
  mode: "standard" | "full" = fullRun ? "full" : "standard",
  availableEvidenceFiles: ReadonlySet<string> = new Set(),
  metadata: {
    revision?: string;
    environment?: string;
    decision?: "GO" | "NO-GO";
    browserDurationRegressions?: readonly BrowserDurationRegression[];
    expectedLabels?: readonly string[];
    timing?: ReleaseTiming;
  } = {},
): string {
  const evidenceLink = (file: string, label: string): string =>
    availableEvidenceFiles.has(file)
      ? `- [${label}](${file})`
      : `- ${label}: not produced`;
  const commandFor = (label: string): string => {
    const step = steps.find((candidate) => candidate.label === label);
    return step ? `pnpm ${step.args.join(" ")}` : "fixture command unavailable";
  };
  const releaseLabels = releaseGateLabelsForMode(mode);
  const expectedLabels =
    metadata.expectedLabels ??
    (results.length > 0 &&
    results.every((result) => releaseLabels.includes(result.label))
      ? releaseLabels
      : results.map((result) => result.label));
  const resultByLabel = new Map(
    results.map((result) => [result.label, result] as const),
  );
  const orderedResults: ReleaseStepResult[] = expectedLabels.map(
    (label) =>
      resultByLabel.get(label) ?? {
        label,
        status: "NOT REACHED",
        elapsedMs: 0,
      },
  );
  const failed = orderedResults.filter((result) => result.status === "FAIL");
  const interrupted = orderedResults.filter((result) =>
    result.status.startsWith("INFRASTRUCTURE"),
  );
  const notReached = orderedResults.filter(
    (result) => result.status === "NOT REACHED",
  );
  const cleanStartResult = orderedResults.find(
    (result) => result.label === "clean-start smoke",
  );
  const summarize = (items: readonly ReleaseStepResult[]): string =>
    items.length === 0
      ? "none"
      : items.map((item) => `${item.label} (${item.status})`).join("; ");
  const revision = metadata.revision ?? "unknown";
  const decision =
    metadata.decision ??
    (results.length === steps.filter((step) => mode === "full" || !step.label.includes("full browser E2E")).length &&
    results.every((result) => result.status === "PASS")
      ? "GO"
      : "NO-GO");
  const timing = metadata.timing;
  const timingLines =
    timing === undefined
      ? ["Timing: unavailable", ""]
      : [
          `Total wall-clock: ${Math.round(timing.totalElapsedMs / 1000)}s`,
          "",
          "| Stage | Wall-clock |",
          "| --- | ---: |",
          ...timing.stages.map(
            (stage) =>
              `| ${stage.stage} | ${Math.round(stage.elapsedMs / 1000)}s |`,
          ),
          "",
        ];
  const lines = [
    "# Release Check Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Revision: ${revision}`,
    `Mode: ${mode}`,
    `Environment: ${metadata.environment ?? "release validation environment"}`,
    "Commands: listed in the gate results table below",
    `Evidence paths: ${releaseEvidenceDir}/ and retained files linked below`,
    "",
    "## Gate results",
    "",
    "| Gate | Result | Elapsed | Command |",
    "| --- | --- | ---: | --- |",
    ...orderedResults.map(
      (result) =>
        `| ${result.label} | ${result.status} | ${Math.round(
          result.elapsedMs / 1000,
        )}s | \`${commandFor(result.label)}\` |`,
    ),
    "",
    "## Timing",
    "",
    ...timingLines,
    "## Preview evidence",
    "",
    cleanStartResult === undefined || cleanStartResult.status === "NOT REACHED"
      ? "- Clean-start did not run; no preview evidence was produced."
      : `- Clean-start: **${
          cleanStartResult.status === "PASS" ? "PASS" : "FAIL"
        }**`,
    evidenceLink(
      "clean-start/clean-start-evidence.json",
      "Clean-start evidence",
    ),
    evidenceLink("clean-start/browser-result.json", "Proxied browser result"),
    evidenceLink("clean-start/preview-home.png", "Preview screenshot"),
    evidenceLink("clean-start/startup-api.log", "API startup log"),
    evidenceLink("clean-start/startup-web.log", "Web startup log"),
    evidenceLink("clean-start/startup-mockup.log", "Mockup startup log"),
    evidenceLink("browser-full/FINAL-REPORT.md", "Full browser report"),
    "",
    "## Browser duration review",
    "",
    ...(metadata.browserDurationRegressions === undefined
      ? [
          "Not evaluated in this release mode.",
          "",
        ]
      : metadata.browserDurationRegressions.length === 0
        ? [
            "No meaningful per-file duration regressions detected.",
            "",
          ]
        : [
            "ALERT: meaningful per-file duration regressions detected:",
            ...metadata.browserDurationRegressions.map(
              (regression) =>
                `- \`${regression.file}\`: +${Math.round(
                  regression.increaseMs,
                )}ms (+${regression.increasePercent.toFixed(
                  1,
                )}%), from ${Math.round(
                  regression.baselineDurationMs,
                )}ms to ${Math.round(regression.durationMs)}ms`,
            ),
            "",
          ]),
    "The browser result contains the retained web HTML response and the API health response observed through the web preview proxy.",
    "",
    "## Operational review",
    "",
    "Operational warnings: none",
    `Failures or accepted exceptions: ${summarize(failed)}`,
    `Interrupted gates: ${summarize(interrupted)}`,
    `Not-reached gates: ${summarize(notReached)}`,
    "Accepted exceptions: none",
    "",
    `Decision: ${decision}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function writeReleaseReport(
  results: ReleaseStepResult[],
  metadata: {
    revision: string;
    decision: "GO" | "NO-GO";
    expectedLabels?: readonly string[];
    timing?: ReleaseTiming;
  },
): Promise<string> {
  const reportPath = resolve(
    rootDir,
    releaseEvidenceDir,
    "release-check-report.md",
  );
  await mkdir(resolve(rootDir, releaseEvidenceDir), { recursive: true });
  const cleanStartEvidenceFiles = RELEASE_EVIDENCE_ALLOWLIST.filter((file) =>
    file.startsWith("clean-start/"),
  );
  const availableEvidenceFiles = new Set<string>(
    (
      await Promise.all(
        cleanStartEvidenceFiles.map(async (file) => {
          try {
            await access(resolve(rootDir, releaseEvidenceDir, file));
            return file;
          } catch {
            return undefined;
          }
        }),
      )
    ).filter(
      (file): file is (typeof RELEASE_EVIDENCE_ALLOWLIST)[number] =>
        file !== undefined,
    ),
  );
  try {
    await access(
      resolve(rootDir, releaseEvidenceDir, "browser-full/FINAL-REPORT.md"),
    );
    availableEvidenceFiles.add("browser-full/FINAL-REPORT.md");
  } catch {
    // Full browser evidence validation below reports a missing file when the
    // full release decision requires it.
  }
  let browserDurationRegressions: BrowserDurationRegression[] | undefined;
  if (fullRun) {
    try {
      const browserReport = await readFile(
        resolve(rootDir, releaseEvidenceDir, "browser-full/FINAL-REPORT.md"),
        "utf8",
      );
      const browserRevision = browserReport.match(/^Revision:\s*(\S+)\s*$/m)?.[1];
      if (browserRevision === metadata.revision) {
        browserDurationRegressions = parseBrowserDurationRegressions(
          browserReport,
        );
      }
    } catch {
      // Full browser evidence validation below remains responsible for
      // reporting a missing or unreadable report.
    }
  }
  await writeFile(
    reportPath,
    formatReleaseReport(
      results,
      fullRun ? "full" : "standard",
      availableEvidenceFiles,
      {
        ...metadata,
        environment: process.env.CI ? "CI release validation" : "local release validation",
        browserDurationRegressions,
        timing: metadata.timing,
      },
    ),
    "utf8",
  );
  return `${releaseEvidenceDir}/release-check-report.md`;
}

type ReleaseCheckpoint = {
  revision: string;
  mode: "standard" | "full";
  results: Array<ReleaseStepResult & { passed: boolean }>;
  timing?: ReleaseTiming;
};

const STALE_CHECKPOINT_MESSAGE =
  "Checkpoint revision or release mode is stale. Rerun without --resume to create a fresh checkpoint.";
const DAMAGED_CHECKPOINT_MESSAGE =
  "Release checkpoint is malformed or unreadable. Rerun without --resume to create a fresh checkpoint.";

async function writeCheckpoint(
  checkpointPath: string,
  checkpoint: ReleaseCheckpoint,
): Promise<void> {
  await writeFile(
    checkpointPath,
    `${JSON.stringify(
      { ...checkpoint, updatedAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function upsertReleaseResult(
  results: Array<ReleaseStepResult & { passed: boolean }>,
  result: ReleaseStepResult & { passed: boolean },
): Array<ReleaseStepResult & { passed: boolean }> {
  const next = new Map(results.map((item) => [item.label, item] as const));
  next.set(result.label, result);
  return steps
    .map((step) => next.get(step.label))
    .filter(
      (item): item is ReleaseStepResult & { passed: boolean } =>
        item !== undefined,
    );
}

function upsertStageTiming(
  timings: readonly ReleaseStageTiming[],
  timing: ReleaseStageTiming,
): ReleaseStageTiming[] {
  return [
    ...timings.filter((existing) => existing.stage !== timing.stage),
    timing,
  ];
}

async function readCheckpoint(
  checkpointPath: string,
  revision: string,
): Promise<ReleaseCheckpoint | undefined> {
  try {
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as
      | Partial<ReleaseCheckpoint>
      | null;
    if (checkpoint === null || typeof checkpoint !== "object") {
      throw new Error(DAMAGED_CHECKPOINT_MESSAGE);
    }
    if (
      checkpoint.revision !== revision ||
      checkpoint.mode !== (fullRun ? "full" : "standard") ||
      !Array.isArray(checkpoint.results)
    ) {
      throw new Error(STALE_CHECKPOINT_MESSAGE);
    }
    return checkpoint as ReleaseCheckpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (
      error instanceof Error &&
      (error.message === STALE_CHECKPOINT_MESSAGE ||
        error.message === DAMAGED_CHECKPOINT_MESSAGE)
    ) {
      throw error;
    }
    throw new Error(DAMAGED_CHECKPOINT_MESSAGE);
  }
}

async function currentRevision(): Promise<string> {
  return new Promise((resolveRevision, reject) => {
    execFile(
      "git",
      [
        "log",
        "-1",
        "--format=%H",
        "--",
        ".",
        ":(exclude)release-evidence",
        ":(exclude)release-evidence/**",
        ":(exclude)release-evidence-full",
        ":(exclude)release-evidence-full/**",
      ],
      { cwd: rootDir },
      (error, stdout) =>
        error ? reject(error) : resolveRevision(stdout.trim()),
    );
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (process.argv.includes("--verify-evidence")) {
    try {
      await verifyReleaseEvidence(undefined, {
        expectedMode: fullRun ? "full" : undefined,
      });
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Release evidence verification failed: ${message}`);
      console.error(
        "Next action: regenerate matching evidence at the current revision, then rerun verification.",
      );
      process.exit(1);
    }
  }

  console.log(`Release check started (${fullRun ? "full" : "standard"} mode).`);
  let revision: string;
  try {
    revision = await currentRevision();
  } catch (error) {
    console.error(
      `Could not determine current revision: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
  const evidenceRoot = resolve(rootDir, releaseEvidenceDir);
  const checkpointPath = resolve(evidenceRoot, "release-check-state.json");
  const logPath = resolve(evidenceRoot, "release-check.log");
  await mkdir(evidenceRoot, { recursive: true });
  const resume = process.argv.includes("--resume");
  let concurrencyLimit: number;
  try {
    concurrencyLimit = configuredReleaseConcurrency();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  let results: Array<ReleaseStepResult & { passed: boolean }> = [];
  let stageTimings: ReleaseStageTiming[] = [];
  if (resume) {
    let checkpoint: ReleaseCheckpoint | undefined;
    try {
      checkpoint = await readCheckpoint(checkpointPath, revision);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message.replace(/^Cannot resume release check:\s*/, ""));
      process.exit(1);
    }
    if (!checkpoint) {
      console.error("No incomplete release checkpoint exists for this revision.");
      process.exit(1);
    }
    results = checkpoint.results.reduce(
      (current, result) => upsertReleaseResult(current, result),
      [],
    );
    stageTimings = checkpoint.timing?.stages
      ? [...checkpoint.timing.stages]
      : [];
    console.log(
      `Resuming after ${
        results.filter((result) => result.passed).length
      } completed gate(s).`,
    );
  } else {
    await writeFile(
      logPath,
      `Release check ${new Date().toISOString()} revision ${revision} mode ${
        fullRun ? "full" : "standard"
      }\n`,
      "utf8",
    );
  }
  let releaseStatefulLock: (() => Promise<void>) | undefined;
  let checkpointWrite = Promise.resolve();
  const persistCheckpoint = (): Promise<void> => {
    checkpointWrite = checkpointWrite.then(() =>
      writeCheckpoint(checkpointPath, {
        revision,
        mode: fullRun ? "full" : "standard",
        results,
        timing: {
          totalElapsedMs: stageTimings.reduce(
            (total, stage) => total + stage.elapsedMs,
            0,
          ),
          stages: stageTimings,
        },
      }),
    );
    return checkpointWrite;
  };
  const interruptionController = new AbortController();
  let interruptedBySignal = false;
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (interruptedBySignal) return;
    interruptedBySignal = true;
    console.error(`\nRelease check interrupted by ${signal}; saving checkpoint.`);
    interruptionController.abort();
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    const stages = new Map<string, Array<{ step: ReleaseStep; index: number }>>();
    for (const [index, step] of steps.entries()) {
      const stage = releaseStepStage(step, index);
      const stageSteps = stages.get(stage) ?? [];
      stageSteps.push({ step, index });
      stages.set(stage, stageSteps);
    }

    for (const [stage, stageSteps] of stages) {
      if (interruptedBySignal) break;
      const completed = new Set(
        results.filter((result) => result.passed).map((result) => result.label),
      );
      const pending = stageSteps.filter(({ step }) => !completed.has(step.label));
      if (pending.length === 0) continue;

      if (
        stageSteps.some(
          ({ step }) =>
            step.label === "clean-start smoke" ||
            step.label.startsWith("browser "),
        ) &&
        !releaseStatefulLock
      ) {
        releaseStatefulLock = await acquireStatefulReleaseLock();
      }

      const stageStartedAt = Date.now();
      const stageHasApiShards = stageSteps.some(
        ({ step }) => step.group === "api-test-shards",
      );
      const stageLimit = Math.min(
        concurrencyLimit,
        ...stageSteps.map(
          ({ step }) => step.concurrencyLimit ?? concurrencyLimit,
        ),
      );
      const apiLimit = Math.min(
        concurrencyLimit,
        RELEASE_CHECK_API_CONCURRENCY,
        ...stageSteps
          .filter(({ step }) => step.group === "api-test-shards")
          .map(({ step }) =>
            releaseConcurrencyLimit(step, concurrencyLimit),
          ),
      );
      console.log(
        `\nStage ${stage}: ${pending.length} gate${
          pending.length === 1 ? "" : "s"
        } (max ${stageLimit} concurrent${
          stageHasApiShards ? `; API/database max ${apiLimit}` : ""
        }).`,
      );
      const active = new Set<Promise<void>>();
      const waiting = [...pending];
      const stageLogs = new Map<string, string>();
      let apiActive = 0;
      const launchAvailable = (): void => {
        if (interruptedBySignal) return;
        while (waiting.length > 0 && active.size < stageLimit) {
          const nextIndex = waiting.findIndex(
            ({ step }) =>
              step.group !== "api-test-shards" ||
              apiActive < apiLimit,
          );
          if (nextIndex === -1) return;
          const [{ step, index }] = waiting.splice(nextIndex, 1);
          if (step.group === "api-test-shards") apiActive += 1;
          console.log(`[${index + 1}/${steps.length}] ${step.label}`);
          let task: Promise<void>;
          task = (async () => {
            const effectiveStep =
              step.label === FULL_BROWSER_GATE_LABEL
                ? {
                    ...step,
                    env: { ...step.env, RELEASE_REVISION: revision },
                  }
                : step;
            let result: ReleaseStepResult & { passed: boolean };
            try {
              const { exitCode, elapsedMs, status, output } = await runStep(
                effectiveStep,
                {
                  logPath,
                  signal: interruptionController.signal,
                  deferLog: true,
                },
              );
              stageLogs.set(step.label, output ?? "");
              result = {
                label: step.label,
                passed: exitCode === 0,
                status,
                elapsedMs,
              };
            } catch (error) {
              console.error(
                `Could not complete ${step.label}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              result = {
                label: step.label,
                passed: false,
                status: "INFRASTRUCTURE ERROR",
                elapsedMs: 0,
              };
              stageLogs.set(step.label, "");
            }
            results = upsertReleaseResult(results, result);
            await persistCheckpoint();
            console.log(`${result.status} ${step.label}`);
          })().finally(() => {
            active.delete(task);
            if (step.group === "api-test-shards") apiActive -= 1;
          });
          active.add(task);
        }
      };

      while (!interruptedBySignal && (waiting.length > 0 || active.size > 0)) {
        launchAvailable();
        if (active.size > 0) {
          await Promise.race(active);
        }
      }
      while (active.size > 0) {
        await Promise.race(active);
      }
      for (const { step } of stageSteps) {
        const output = stageLogs.get(step.label);
        if (output !== undefined) {
          await appendFile(logPath, `\n[${step.label}]\n${output}`);
        }
      }
      if (interruptedBySignal) {
        for (const { step } of waiting) {
          const notReached: ReleaseStepResult & { passed: boolean } = {
            label: step.label,
            passed: false,
            status: "NOT REACHED",
            elapsedMs: 0,
          };
          results = upsertReleaseResult(results, notReached);
          await persistCheckpoint();
        }
      }
      await checkpointWrite;

      stageTimings = upsertStageTiming(stageTimings, {
        stage,
        elapsedMs: Date.now() - stageStartedAt,
      });
      await persistCheckpoint();
      const stageResults = results.filter(({ label }) =>
        stageSteps.some(({ step }) => step.label === label),
      );
      if (stageResults.some((result) => !result.passed)) {
        console.error(
          `\n${stage} has a failed gate; later stages were not started.`,
        );
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
    await releaseStatefulLock?.();
  }

  console.log("\nRelease check summary:");
  for (const result of results) {
    console.log(
      `${result.status} ${result.label} (${Math.round(
        result.elapsedMs / 1000,
      )}s)`,
    );
  }
  const apiShardResults = results.filter((result) =>
    result.label.includes("(release shard"),
  );
  if (apiShardResults.length > 0) {
    const passedApiShards = apiShardResults.filter(
      (result) => result.passed,
    ).length;
    console.log(
      `API release shards: ${passedApiShards}/${apiShardResults.length} passed.`,
    );
  }

  if (
    results.length === steps.length &&
    results.every((result) => result.passed)
  ) {
    try {
      const reportPath = await writeReleaseReport(results, {
        revision,
        decision: "GO",
        expectedLabels: releaseGateLabelsForMode(fullRun ? "full" : "standard"),
        timing: {
          totalElapsedMs: stageTimings.reduce(
            (total, stage) => total + stage.elapsedMs,
            0,
          ),
          stages: stageTimings,
        },
      });
      await verifyReleaseEvidence(resolve(rootDir, releaseEvidenceDir), {
        currentRevision: revision,
        expectedMode: fullRun ? "full" : "standard",
      });
      await writeFile(checkpointPath, "", "utf8");
      console.log(`\nRelease report: ${reportPath}`);
    } catch (error) {
      console.error(
        `Could not write release report: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }
    console.log("\nRelease check passed. Ready for final publish review.");
    process.exit(0);
  }

  try {
    console.log(
      `\nRelease report: ${await writeReleaseReport(results, {
        revision,
        decision: "NO-GO",
        expectedLabels: releaseGateLabelsForMode(fullRun ? "full" : "standard"),
        timing: {
          totalElapsedMs: stageTimings.reduce(
            (total, stage) => total + stage.elapsedMs,
            0,
          ),
          stages: stageTimings,
        },
      })}`,
    );
  } catch (error) {
    console.error(
      `Could not write release report: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
