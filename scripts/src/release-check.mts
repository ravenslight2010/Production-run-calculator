import { spawn } from "node:child_process";
import { access, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ReleaseStep = {
  label: string;
  args: string[];
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

const API_SHARD_TIMEOUT_MS = 4 * 60_000;
const API_SHARD_WARNING_MS = 3 * 60_000;
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
] as const;

const steps: ReleaseStep[] = [
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
    timeoutMs: 12 * 60_000,
  });
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

  console.log(
    `Release evidence verified: ${files.length} allowlisted file${
      files.length === 1 ? "" : "s"
    }.`,
  );
}

export function runStep(
  step: ReleaseStep,
): Promise<{ exitCode: number; elapsedMs: number; status: StepStatus }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("pnpm", step.args, {
      cwd: rootDir,
      env: { ...process.env, ...step.env },
      stdio: "inherit",
    });
    let settled = false;
    let warningTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number, status?: StepStatus): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (warningTimer) clearTimeout(warningTimer);
      const elapsedMs = Date.now() - startedAt;
      console.log(`${step.label} elapsed ${Math.round(elapsedMs / 1000)}s`);
      resolve({
        exitCode: code,
        elapsedMs,
        status: status ?? (code === 0 ? "PASS" : "FAIL"),
      });
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
        finish(1);
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
): string {
  const cleanStartPassed =
    results.find((result) => result.label === "clean-start smoke")?.status ===
    "PASS";
  const evidenceLink = (file: string, label: string): string =>
    availableEvidenceFiles.has(file)
      ? `- [${label}](${file})`
      : `- ${label}: not produced`;
  const lines = [
    "# Release Check Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    "",
    "## Gate results",
    "",
    "| Gate | Result | Elapsed |",
    "| --- | --- | ---: |",
    ...results.map(
      (result) =>
        `| ${result.label} | ${result.status} | ${Math.round(
          result.elapsedMs / 1000,
        )}s |`,
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
    "",
    "The browser result contains the retained web HTML response and the API health response observed through the web preview proxy.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function writeReleaseReport(results: ReleaseStepResult[]): Promise<string> {
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
    ),
    "utf8",
  );
  return `${releaseEvidenceDir}/release-check-report.md`;
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
  const results: Array<ReleaseStepResult & { passed: boolean }> = [];
  let failedGroup: string | undefined;

  for (const [index, step] of steps.entries()) {
    if (failedGroup !== undefined && step.group !== failedGroup) {
      break;
    }
    console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
    const { exitCode, elapsedMs, status } = await runStep(step);
    const passed = exitCode === 0;
    results.push({ label: step.label, passed, status, elapsedMs });
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
      console.log(`\nRelease report: ${await writeReleaseReport(results)}`);
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
    console.log(`\nRelease report: ${await writeReleaseReport(results)}`);
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
