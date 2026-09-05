import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const rootDir = new URL("../../", import.meta.url).pathname;
const startupTimeoutMs = parseDuration(
  process.env.STARTUP_FAILURE_TIMEOUT_MS ?? "60000",
  "STARTUP_FAILURE_TIMEOUT_MS",
);
const pollIntervalMs = 200;
const outputLimit = 12_000;
const responseLimit = 4_000;
const evidenceDir = resolve(
  rootDir,
  process.env.STARTUP_FAILURE_EVIDENCE_DIR ?? "release-evidence/startup-failures",
);
const stages = ["database_schema", "seed_roles", "data_heals"] as const;
type FailureStage = (typeof stages)[number];

type Scenario = {
  stage: FailureStage;
  port: number;
  child: ChildProcess;
  output: string;
  startupOutput: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

type ScenarioEvidence = {
  stage: FailureStage;
  port: number;
  readyz: {
    status: number;
    body: string;
  };
  processAliveAfterProbe: boolean;
  startupLog: string;
  passed: boolean;
  error?: string;
};

const scenarios: Scenario[] = [];
const evidence: ScenarioEvidence[] = [];
let cleaningUp = false;

function parseDuration(value: string, variable: string): number {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1_000) {
    throw new Error(
      `${variable} must be an integer of at least 1000ms; received "${value}"`,
    );
  }
  return duration;
}

function portFor(stageIndex: number): number {
  const base = Number(process.env.STARTUP_FAILURE_API_PORT ?? "18083");
  const port = base + stageIndex;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`STARTUP_FAILURE_API_PORT produced an invalid port: ${port}`);
  }
  return port;
}

function appendOutput(scenario: Scenario, chunk: Buffer | string): void {
  scenario.output = `${scenario.output}${chunk.toString()}`.slice(-outputLimit);
  if (
    !scenario.startupOutput &&
    scenario.output.includes(expectedErrorCode(scenario.stage))
  ) {
    scenario.startupOutput = scenario.output;
  }
}

function startScenario(stage: FailureStage, port: number): Scenario {
  const child = spawn(
    "pnpm",
    ["--filter", "@workspace/api-server", "run", "dev"],
    {
      cwd: rootDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // The failpoints run before the first query. This fallback lets the
        // verifier exercise startup deterministically without requiring a live
        // database, while the API's db module still receives a valid URL.
        DATABASE_URL:
          process.env.DATABASE_URL ?? "postgresql://127.0.0.1:1/startup-test",
        NODE_ENV: "development",
        PORT: String(port),
        STARTUP_TEST_MODE: "true",
        STARTUP_TEST_FAILURE_STAGE: stage,
        STARTUP_TEST_DATABASE_READY: "true",
      },
    },
  );

  const scenario: Scenario = {
    stage,
    port,
    child,
    output: "",
    startupOutput: "",
    exited: Promise.resolve({ code: null, signal: null }),
  };
  scenario.exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  child.stdout?.on("data", (chunk: Buffer) => appendOutput(scenario, chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendOutput(scenario, chunk));
  child.once("error", (error) =>
    appendOutput(scenario, `\nprocess error: ${error.message}\n`),
  );
  scenarios.push(scenario);
  return scenario;
}

async function managedExit(
  scenario: Scenario,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | undefined> {
  return Promise.race([scenario.exited, delay(0).then(() => undefined)]);
}

function expectedErrorCode(stage: FailureStage): string {
  return `${stage}_failed`;
}

function containsUnsafeEvidence(text: string): boolean {
  return (
    /(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/\S+/i.test(text) ||
    /^\s*at\s+.+$/m.test(text) ||
    /\b(?:authorization|cookie|password|secret|token|api[_-]?key)\b/i.test(text) ||
    /\b(?:request|payload)\s*[:=]/i.test(text)
  );
}

function sanitizeLog(text: string): string {
  if (containsUnsafeEvidence(text)) {
    return "[startup output redacted after unsafe evidence was detected]";
  }
  return text.slice(-outputLimit);
}

async function checkScenario(scenario: Scenario): Promise<ScenarioEvidence> {
  const deadline = Date.now() + startupTimeoutMs;
  const expectedCode = expectedErrorCode(scenario.stage);
  let lastError = "no response";
  let readyz = { status: 0, body: "" };

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${scenario.port}/api/readyz`, {
        signal: AbortSignal.timeout(5_000),
      });
      readyz = {
        status: response.status,
        body: (await response.text()).slice(0, responseLimit),
      };
      const payload = JSON.parse(readyz.body) as {
        status?: string;
        checks?: Record<string, string>;
      };
      const processAlive = !(await managedExit(scenario));
      const failure =
        readyz.status !== 503
          ? `expected /api/readyz HTTP 503, received ${readyz.status}`
          : payload.status !== "degraded"
            ? `expected readiness status=degraded, received ${payload.status ?? "missing"}`
            : payload.checks?.startup !== "error"
              ? "expected checks.startup=error"
              : payload.checks?.database !== "pending" ||
                  payload.checks?.dependencies !== "pending"
                ? "expected database and dependencies checks to remain pending"
                : !processAlive
                  ? "process exited before the not-ready response could be observed"
                  : containsUnsafeEvidence(`${readyz.body}\n${scenario.startupOutput || scenario.output}`)
                    ? "startup health evidence contained sensitive or stack-trace content"
                    : !scenario.startupOutput.includes(expectedCode)
                      ? `startup log did not contain safe errorCode=${expectedCode}`
                      : undefined;

      const result: ScenarioEvidence = {
        stage: scenario.stage,
        port: scenario.port,
        readyz: {
          status: readyz.status,
          body: containsUnsafeEvidence(readyz.body)
            ? "[health response redacted after unsafe evidence was detected]"
            : readyz.body,
        },
        processAliveAfterProbe: processAlive,
        startupLog: sanitizeLog(scenario.startupOutput || scenario.output),
        passed: !failure,
        ...(failure ? { error: failure } : {}),
      };
      if (!failure) return result;
      lastError = failure;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    const exited = await managedExit(scenario);
    if (exited) {
      throw new Error(
        `${scenario.stage} process exited before readiness was proven (code=${exited.code}, signal=${exited.signal}).`,
      );
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `${scenario.stage} readiness check timed out after ${startupTimeoutMs}ms: ${lastError}`,
  );
}

async function stopScenario(scenario: Scenario): Promise<void> {
  const pid = scenario.child.pid;
  if (!pid || scenario.child.exitCode !== null) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  await Promise.race([scenario.exited, delay(5_000)]);
  if (scenario.child.exitCode === null) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

async function cleanup(): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  await Promise.all(scenarios.slice().reverse().map(stopScenario));
}

async function writeEvidence(): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    resolve(evidenceDir, "startup-failure-evidence.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scenarios: evidence,
        allPassed:
          evidence.length === stages.length && evidence.every((item) => item.passed),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  console.log(`Startup failure smoke: stages=${stages.join(", ")}`);
  for (const [stageIndex, stage] of stages.entries()) {
    const scenario = startScenario(stage, portFor(stageIndex));
    try {
      const result = await checkScenario(scenario);
      evidence.push(result);
      if (!result.passed) {
        throw new Error(`${stage} did not preserve safe not-ready behavior: ${result.error}`);
      }
      console.log(
        `PASS ${stage}: /api/readyz stayed at 503 while the process remained alive`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      evidence.push({
        stage,
        port: scenario.port,
        readyz: { status: 0, body: "" },
        processAliveAfterProbe: !(await managedExit(scenario)),
        startupLog: sanitizeLog(scenario.startupOutput || scenario.output),
        passed: false,
        error: message,
      });
      throw error;
    } finally {
      await stopScenario(scenario);
    }
  }
}

process.once("SIGINT", () => void cleanup().finally(() => process.exit(130)));
process.once("SIGTERM", () => void cleanup().finally(() => process.exit(143)));

try {
  await main();
} catch (error) {
  console.error(
    `FAIL startup failure smoke: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
} finally {
  try {
    await writeEvidence();
    console.log(
      `Evidence retained: ${resolve(evidenceDir, "startup-failure-evidence.json")}`,
    );
  } catch (error) {
    console.error(
      `FAIL startup failure evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
  await cleanup();
}