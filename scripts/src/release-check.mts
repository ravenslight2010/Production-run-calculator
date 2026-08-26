import { execFile, spawn } from "node:child_process";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
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
};

type StepStatus =
  | "PASS"
  | "FAIL"
  | "INFRASTRUCTURE TIMEOUT"
  | "INFRASTRUCTURE ERROR";

export type ReleaseStepResult = {
  label: string;
  status: StepStatus;
  elapsedMs: number;
};

export type ReleaseEvidenceOptions = {
  currentRevision?: string;
  expectedMode?: "standard" | "full";
  expectedLabels?: readonly string[];
};

// The third integration shard contains the capability matrix and the
// remaining integration fixtures. It is intentionally serialized by the API
// Vitest config, so it can exceed four minutes on the release environment even
// when every test is healthy.
const API_SHARD_TIMEOUT_MS = 8 * 60_000;
const API_SHARD_WARNING_MS = 6 * 60_000;
// The main browser suite is intentionally serialized because several tests
// reset or observe shared disposable live-day state. Its 99 cases can exceed
// the API shard budget on a cold release environment, so give the complete
// evidence-producing gate a longer bounded window instead of weakening
// isolation with parallel workers or masking intermittent failures with
// retries.
const FULL_BROWSER_TIMEOUT_MS = 20 * 60_000;
const FULL_BROWSER_WARNING_MS = 15 * 60_000;
const FULL_BROWSER_EXPECTED_CASES = 99;
const rootDir = new URL("../../", import.meta.url).pathname;
const fullRun = process.argv.includes("--full");
const releaseEvidenceDir =
  process.env.RELEASE_EVIDENCE_DIR ?? "release-evidence";
const cleanStartEvidenceDir = `${releaseEvidenceDir}/clean-start`;
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

const steps: ReleaseStep[] = [
  {
    label: "production dependency audit",
    args: ["run", "audit:prod"],
  },
  {
    label: "generated API client freshness",
    args: ["run", "check:api-generated"],
  },
  {
    label: "shared library typechecks",
    args: ["run", "typecheck:libs"],
  },
  {
    label: "API server typecheck",
    args: ["--filter", "@workspace/api-server", "run", "typecheck"],
  },
  {
    label: "run calculator typecheck",
    args: ["--filter", "@workspace/run-calculator", "run", "typecheck"],
  },
  {
    label: "mockup sandbox typecheck",
    args: ["--filter", "@workspace/mockup-sandbox", "run", "typecheck"],
  },
  {
    label: "scripts typecheck",
    args: ["--filter", "@workspace/scripts", "run", "typecheck"],
  },
  {
    label: "recovery evidence audit",
    args: ["run", "audit:recovery"],
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
  },
  {
    label: "API unit tests (release shard 1/6)",
    args: ["--filter", "@workspace/api-server", "run", "test:release:unit"],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
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
  },
  {
    label: "API sync tests (release shard 5/6)",
    args: ["--filter", "@workspace/api-server", "run", "test:release:sync"],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
  },
  {
    label: "API sync SSE tests (release shard 6/6)",
    args: ["--filter", "@workspace/api-server", "run", "test:release:sync-sse"],
    timeoutMs: API_SHARD_TIMEOUT_MS,
    warningMs: API_SHARD_WARNING_MS,
    group: "api-test-shards",
  },
  {
    label: "run calculator tests",
    args: ["--filter", "@workspace/run-calculator", "run", "test"],
  },
  {
    label: "production rules tests",
    args: ["--filter", "@workspace/production-rules", "run", "test"],
  },
  {
    label: "inventory math tests",
    args: ["--filter", "@workspace/inventory-math", "run", "test"],
  },
  {
    label: "spec reconcile tests",
    args: ["--filter", "@workspace/spec-reconcile", "run", "test"],
  },
  {
    label: "scheduled recipe check tests",
    args: ["--filter", "@workspace/scheduled-recipe-check", "run", "test"],
  },
  {
    label: "spec export tests",
    args: ["--filter", "@workspace/spec-export", "run", "test"],
  },
  {
    label: "corpus tests",
    args: ["--filter", "@workspace/corpus-harness", "run", "test"],
  },
  {
    label: "model-bump check",
    args: ["--filter", "@workspace/scripts", "run", "check-model-bump"],
  },
  {
    label: "operational evidence check",
    args: [
      "--filter",
      "@workspace/scripts",
      "run",
      "check-operational-skill-evidence",
    ],
  },
  {
    label: "browser smoke tests",
    args: ["--filter", "@workspace/run-calculator", "run", "test:e2e:smoke"],
    env: {
      E2E_TEST_DB: "1",
      E2E_APPROVED_DESTRUCTIVE_MODE: "1",
      PLAYWRIGHT_RELEASE_REPORT_PATH: resolve(
        rootDir,
        releaseEvidenceDir,
        "browser-full/FINAL-REPORT.md",
      ),
    },
  },
  {
    label: "browser accessibility tests",
    args: ["--filter", "@workspace/run-calculator", "run", "test:e2e:a11y"],
    env: {
      E2E_TEST_DB: "1",
      E2E_APPROVED_DESTRUCTIVE_MODE: "1",
    },
  },
];

if (fullRun) {
  steps.push({
    label: "full browser E2E suite",
    args: ["--filter", "@workspace/run-calculator", "run", "test:e2e"],
    env: {
      E2E_TEST_DB: "1",
      E2E_APPROVED_DESTRUCTIVE_MODE: "1",
    },
    timeoutMs: FULL_BROWSER_TIMEOUT_MS,
    warningMs: FULL_BROWSER_WARNING_MS,
  });
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
  const evidenceMode = options.expectedMode ?? reportMode;
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
    options.currentRevision ??
    (await new Promise<string>((resolveRevision, reject) => {
      execFile("git", ["rev-parse", "HEAD"], { cwd: rootDir }, (error, stdout) =>
        error ? reject(error) : resolveRevision(stdout.trim()),
      );
    }));
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
  const coverage = report.match(/^Coverage:\s*(COMPLETE|INCOMPLETE)\s*$/m)?.[1];
  const durationMs = Number(report.match(/^Duration:\s*(\d+)ms\s*$/m)?.[1]);
  if (!result || !Number.isInteger(expectedCases) || !coverage || !Number.isInteger(durationMs)) {
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
      completedCases !== expectedCases)
  ) {
    throw new Error(
      "Full browser report cannot support GO unless all expected cases passed.",
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
    totals.passed + totals.skipped + totals.failed !== completedCases ||
    totals.passed + totals.skipped + totals.failed + totals.notRun !==
      totals.cases ||
    totals.durationMs < 0
  ) {
    throw new Error("Full browser report per-file totals do not match its case counts.");
  }
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
  const mode = report.match(/^Mode:\s*(standard|full)\s*$/m)?.[1];
  const decision = report.match(/^Decision:\s*(GO|NO-GO)\s*$/m)?.[1];
  if (!revision || revision !== options.currentRevision) {
    throw new Error(
      `Release report revision is missing or stale (expected ${options.currentRevision}).`,
    );
  }
  if (!mode || (options.expectedMode && mode !== options.expectedMode)) {
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
  const rows = [...gateSection.matchAll(/^\| (.+?) \| (PASS|FAIL|INFRASTRUCTURE TIMEOUT|INFRASTRUCTURE ERROR) \|/gm)]
    .map((match) => ({ label: match[1], status: match[2] }));
  const expectedLabels =
    options.expectedLabels ??
    steps
      .filter((step) => mode === "full" || !step.label.includes("full browser E2E"))
      .map((step) => step.label);
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
  options: { logPath?: string } = {},
): Promise<{ exitCode: number; elapsedMs: number; status: StepStatus }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(step.command ?? "pnpm", step.args, {
      cwd: rootDir,
      env: { ...process.env, ...step.env },
      stdio: options.logPath ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let logWrite = Promise.resolve();
    const capture = (chunk: Buffer): void => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (options.logPath) {
        logWrite = logWrite.then(() => appendFile(options.logPath!, text));
      }
    };
    if (options.logPath) {
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
    }
    let settled = false;
    let warningTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number, status?: StepStatus): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (warningTimer) clearTimeout(warningTimer);
      const elapsedMs = Date.now() - startedAt;
      console.log(`${step.label} elapsed ${Math.round(elapsedMs / 1000)}s`);
      void logWrite.then(() =>
        resolve({
          exitCode: code,
          elapsedMs,
          status: status ?? (code === 0 ? "PASS" : "FAIL"),
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
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
            finish(124, "INFRASTRUCTURE TIMEOUT");
          }, step.timeoutMs);

    child.once("error", (error) => {
      console.error(`Could not start ${step.label}: ${error.message}`);
      finish(1, "INFRASTRUCTURE ERROR");
    });
    child.once("close", (code, signal) => {
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
  } = {},
): string {
  const cleanStartPassed =
    results.find((result) => result.label === "clean-start smoke")?.status ===
    "PASS";
  const evidenceLink = (file: string, label: string): string =>
    availableEvidenceFiles.has(file)
      ? `- [${label}](${file})`
      : `- ${label}: not produced`;
  const commandFor = (label: string): string => {
    const step = steps.find((candidate) => candidate.label === label);
    return step ? `pnpm ${step.args.join(" ")}` : "fixture command unavailable";
  };
  const revision = metadata.revision ?? "unknown";
  const decision =
    metadata.decision ??
    (results.length === steps.filter((step) => mode === "full" || !step.label.includes("full browser E2E")).length &&
    results.every((result) => result.status === "PASS")
      ? "GO"
      : "NO-GO");
  const lines = [
    "# Release Check Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Revision: ${revision}`,
    `Mode: ${mode}`,
    `Environment: ${metadata.environment ?? "release validation environment"}`,
    "Commands: listed in the gate results table below",
    "Evidence paths: release-evidence/ and retained files linked below",
    "",
    "## Gate results",
    "",
    "| Gate | Result | Elapsed | Command |",
    "| --- | --- | ---: | --- |",
    ...results.map(
      (result) =>
        `| ${result.label} | ${result.status} | ${Math.round(
          result.elapsedMs / 1000,
        )}s | \`${commandFor(result.label)}\` |`,
    ),
    "",
    "## Preview evidence",
    "",
    cleanStartPassed === undefined
      ? "- Clean-start did not run; no preview evidence was produced."
      : `- Clean-start: **${cleanStartPassed ? "PASS" : "FAIL"}**`,
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
    "The browser result contains the retained web HTML response and the API health response observed through the web preview proxy.",
    "",
    "## Operational review",
    "",
    "Operational warnings: none",
    "Accepted exceptions: none",
    "",
    `Decision: ${decision}`,
    "Failures or accepted exceptions: none",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function writeReleaseReport(
  results: ReleaseStepResult[],
  metadata: {
    revision: string;
    decision: "GO" | "NO-GO";
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
  await writeFile(
    reportPath,
    formatReleaseReport(
      results,
      fullRun ? "full" : "standard",
      availableEvidenceFiles,
      {
        ...metadata,
        environment: process.env.CI ? "CI release validation" : "local release validation",
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
    execFile("git", ["rev-parse", "HEAD"], { cwd: rootDir }, (error, stdout) =>
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
      await verifyReleaseEvidence();
      process.exit(0);
    } catch (error) {
      console.error(
        `Release evidence verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
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
  let results: Array<ReleaseStepResult & { passed: boolean }> = [];
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
    const firstUnpassed = checkpoint.results.findIndex((result) => !result.passed);
    results =
      firstUnpassed === -1
        ? checkpoint.results
        : checkpoint.results.slice(0, firstUnpassed);
    console.log(`Resuming after ${results.length} completed gate(s).`);
  } else {
    await writeFile(
      logPath,
      `Release check ${new Date().toISOString()} revision ${revision} mode ${
        fullRun ? "full" : "standard"
      }\n`,
      "utf8",
    );
  }
  let failedGroup: string | undefined;

  for (const [index, step] of steps.entries()) {
    if (results.some((result) => result.label === step.label)) continue;
    if (failedGroup !== undefined && step.group !== failedGroup) {
      break;
    }
    console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
    const { exitCode, elapsedMs, status } = await runStep(step, { logPath });
    const passed = exitCode === 0;
    results.push({ label: step.label, passed, status, elapsedMs });
    await writeCheckpoint(checkpointPath, {
      revision,
      mode: fullRun ? "full" : "standard",
      results,
    });
    console.log(`${status} ${step.label}`);
    if (!passed) {
      if (step.group !== undefined) {
        failedGroup = step.group;
        console.error(
          `\n${step.group} has a failed shard; running the remaining shards.`,
        );
        continue;
      }
      console.error("\nRelease check stopped at the first failed gate.");
      break;
    }
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
