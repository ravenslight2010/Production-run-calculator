import { spawn } from "node:child_process";

type Step = {
  label: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
};

const rootDir = new URL("../../", import.meta.url).pathname;
const fullRun = process.argv.includes("--full");

const steps: Step[] = [
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
    },
  },
  {
    label: "API server tests",
    args: ["--filter", "@workspace/api-server", "run", "test"],
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
  console.log("");
  console.log(
    "The full browser suite requires a disposable isolated test database.",
  );
}

function runStep(step: Step): Promise<number> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("pnpm", step.args, {
      cwd: rootDir,
      env: { ...process.env, ...step.env },
      stdio: "inherit",
    });
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      console.log(
        `${step.label} elapsed ${Math.round((Date.now() - startedAt) / 1000)}s`,
      );
      resolve(code);
    };
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
            finish(124);
          }, step.timeoutMs);

    child.once("error", (error) => {
      console.error(`Could not start ${step.label}: ${error.message}`);
      finish(1);
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

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

console.log(`Release check started (${fullRun ? "full" : "standard"} mode).`);
const results: Array<{ label: string; passed: boolean }> = [];

for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
  const exitCode = await runStep(step);
  const passed = exitCode === 0;
  results.push({ label: step.label, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${step.label}`);
  if (!passed) {
    console.error("\nRelease check stopped at the first failed gate.");
    break;
  }
}

console.log("\nRelease check summary:");
for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${result.label}`);
}

if (
  results.length === steps.length &&
  results.every((result) => result.passed)
) {
  console.log("\nRelease check passed. Ready for final publish review.");
  process.exit(0);
}

process.exit(1);