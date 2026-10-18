import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertDisposableBrowserDatabase } from "./prepare-isolated-browser-database.mjs";
import { isConfirmedProductionRuntime } from "./production-runtime.mjs";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const databaseCommandTimeoutMs = 30_000;
const schemaPushTimeoutMs = 2 * 60_000;
const unitTestTimeoutMs = 7 * 60_000;
const API_UNIT_COUNT_REPORTER_PATH = resolve(
  workspaceRoot,
  "scripts/src/vitest-count-reporter.mjs",
);

type IsolationTarget = {
  adminUrl: URL;
  applicationUrl: string;
  databaseName: string;
};

let activeChild: ChildProcess | undefined;
let receivedSignal: NodeJS.Signals | undefined;
let signalKillTimer: NodeJS.Timeout | undefined;

function vitestCountReporterArgs(
  environment: NodeJS.ProcessEnv,
): string[] {
  if (
    !environment.TEST_RESULTS_VITEST_COUNTS_DIR?.trim() ||
    !environment.TEST_RESULTS_VITEST_RUN_ID?.trim() ||
    !/^[a-zA-Z0-9:._-]{1,200}$/.test(
      environment.TEST_RESULTS_VITEST_RUN_ID.trim(),
    ) ||
    !environment.TEST_RESULTS_VITEST_SOURCE_REVISION?.trim() ||
    !/^[a-f0-9]{40,64}$/i.test(
      environment.TEST_RESULTS_VITEST_SOURCE_REVISION.trim(),
    )
  ) {
    return [];
  }
  return [
    "--reporter=default",
    `--reporter=${API_UNIT_COUNT_REPORTER_PATH}`,
  ];
}

function signalProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The child may already have exited.
    }
  }
}

function handleSignal(signal: NodeJS.Signals): void {
  if (receivedSignal !== undefined) return;
  receivedSignal = signal;
  if (!activeChild) return;
  signalProcessGroup(activeChild, signal);
  signalKillTimer = setTimeout(() => {
    if (activeChild) signalProcessGroup(activeChild, "SIGKILL");
  }, 5_000);
}

function isolationTarget(
  environment: NodeJS.ProcessEnv,
): IsolationTarget {
  if (environment.NODE_ENV !== "test") {
    throw new Error("API unit database isolation requires NODE_ENV=test.");
  }
  if (
    environment.E2E_TEST_DB !== "1"
    || environment.E2E_APPROVED_DESTRUCTIVE_MODE !== "1"
  ) {
    throw new Error(
      "API unit database isolation requires E2E_TEST_DB=1 and " +
        "E2E_APPROVED_DESTRUCTIVE_MODE=1.",
    );
  }
  if (isConfirmedProductionRuntime(environment)) {
    throw new Error(
      "Refusing to create an API unit database from a confirmed production runtime.",
    );
  }

  const adminUrl = assertDisposableBrowserDatabase(environment);
  const databaseName =
    `api_unit_test_${Date.now()}_${randomUUID().replaceAll("-", "")}`;
  const applicationUrl = new URL(adminUrl.toString());
  applicationUrl.pathname = `/${databaseName}`;
  assertDisposableBrowserDatabase({
    ...environment,
    DATABASE_URL: applicationUrl.toString(),
  });

  return {
    adminUrl,
    applicationUrl: applicationUrl.toString(),
    databaseName,
  };
}

function quoteGeneratedIdentifier(identifier: string): string {
  if (!/^api_unit_test_[a-z0-9_]+$/u.test(identifier)) {
    throw new Error("Generated API unit database name is invalid.");
  }
  return `"${identifier}"`;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9]{5}$/u.test(code)
    ? code
    : undefined;
}

async function runCommand(
  label: string,
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  if (receivedSignal !== undefined) {
    throw new Error(`${label} was not started because ${receivedSignal} was received.`);
  }

  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      detached: true,
      env: environment,
      stdio: "inherit",
    });
    activeChild = child;
    let settled = false;
    let timedOut = false;
    let timeoutKillTimer: NodeJS.Timeout | undefined;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (timeoutKillTimer) clearTimeout(timeoutKillTimer);
      if (signalKillTimer) {
        clearTimeout(signalKillTimer);
        signalKillTimer = undefined;
      }
      if (activeChild === child) activeChild = undefined;
      if (error) rejectCommand(error);
      else resolveCommand();
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalProcessGroup(child, "SIGTERM");
      timeoutKillTimer = setTimeout(
        () => signalProcessGroup(child, "SIGKILL"),
        5_000,
      );
    }, timeoutMs);

    child.once("error", () => {
      finish(new Error(`${label} could not be started.`));
    });
    child.once("close", (code, signal) => {
      if (timedOut) {
        finish(new Error(`${label} timed out after ${timeoutMs}ms.`));
      } else if (receivedSignal !== undefined) {
        finish(new Error(`${label} was interrupted by ${receivedSignal}.`));
      } else if (code !== 0) {
        finish(
          new Error(
            `${label} exited with ${code === null ? signal ?? "unknown status" : `code ${code}`}.`,
          ),
        );
      } else {
        finish();
      }
    });
  });
}

async function runIsolatedApiUnitTests(): Promise<void> {
  let failure = false;
  let databaseMayExist = false;
  let target: IsolationTarget | undefined;
  let adminPool: Pool | undefined;

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  try {
    target = isolationTarget(process.env);
    quoteGeneratedIdentifier(target.databaseName);
    adminPool = new Pool({
      connectionString: target.adminUrl.toString(),
      connectionTimeoutMillis: 10_000,
      max: 1,
      statement_timeout: databaseCommandTimeoutMs,
    });
    adminPool.on("error", () => {
      console.error(
        "API unit database administrator connection failed; connection details omitted.",
      );
    });

    console.log(
      `Creating disposable API unit database ${target.databaseName}.`,
    );
    databaseMayExist = true;
    try {
      await adminPool.query({
        text: `CREATE DATABASE ${quoteGeneratedIdentifier(target.databaseName)}`,
      });
    } catch (error) {
      const code = postgresErrorCode(error);
      throw new Error(
        `Could not create the disposable API unit database${code ? ` (PostgreSQL ${code})` : ""}.`,
      );
    }

    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: target.applicationUrl,
      NODE_ENV: "test",
    };
    console.log("Applying the canonical schema to the disposable API unit database.");
    await runCommand(
      "API unit database schema push",
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      childEnvironment,
      schemaPushTimeoutMs,
    );
    await runCommand(
      "API unit tests",
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "vitest",
        "run",
        "--exclude",
        "**/*.integration.test.ts",
        ...vitestCountReporterArgs(childEnvironment),
      ],
      childEnvironment,
      unitTestTimeoutMs,
    );
  } catch (error) {
    failure = true;
    console.error(
      error instanceof Error
        ? `API unit database isolation failed: ${error.message}`
        : "API unit database isolation failed with an unknown error.",
    );
  } finally {
    if (databaseMayExist && target && adminPool) {
      try {
        await adminPool.query({
          text: `DROP DATABASE IF EXISTS ${quoteGeneratedIdentifier(target.databaseName)} WITH (FORCE)`,
        });
        console.log(
          `Removed disposable API unit database ${target.databaseName}.`,
        );
      } catch (error) {
        failure = true;
        const code = postgresErrorCode(error);
        console.error(
          `Could not remove disposable API unit database ${target.databaseName}${code ? ` (PostgreSQL ${code})` : ""}; manual cleanup may be required.`,
        );
      }
    }
    if (adminPool) {
      try {
        await adminPool.end();
      } catch {
        failure = true;
        console.error(
          "Could not close the API unit database administrator connection.",
        );
      }
    }
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    if (signalKillTimer) clearTimeout(signalKillTimer);
  }

  process.exitCode = receivedSignal === "SIGINT"
    ? 130
    : receivedSignal === "SIGTERM"
      ? 143
      : failure
        ? 1
        : 0;
}

void runIsolatedApiUnitTests().catch(() => {
  console.error("API unit database isolation failed unexpectedly.");
  process.exitCode = 1;
});