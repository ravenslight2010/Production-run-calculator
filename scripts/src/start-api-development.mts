import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isConfirmedProductionRuntime,
  type RuntimeEnvironment,
} from "./production-runtime.mts";

type RunCommand = (command: string, args: string[]) => Promise<void>;

export function assertDevelopmentStartupAllowed(
  environment: RuntimeEnvironment,
): void {
  if (isConfirmedProductionRuntime(environment)) {
    throw new Error(
      "Refusing API development startup in a confirmed production deployment; "
        + "schema push was not invoked.",
    );
  }
}

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed ${
            signal ? `with signal ${signal}` : `with exit code ${code}`
          }.`,
        ),
      );
    });
  });
}

export async function startApiDevelopment(
  environment: RuntimeEnvironment = process.env,
  runCommand: RunCommand = run,
): Promise<void> {
  assertDevelopmentStartupAllowed(environment);
  await runCommand("pnpm", ["--filter", "@workspace/db", "run", "push-force"]);
  await runCommand("pnpm", [
    "--filter",
    "@workspace/api-server",
    "run",
    "dev:without-schema-push",
  ]);
}

const isEntrypoint =
  process.argv[1] !== undefined
  && fileURLToPath(import.meta.url)
    === fileURLToPath(pathToFileURL(resolve(process.argv[1])));

if (isEntrypoint) {
  startApiDevelopment().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}