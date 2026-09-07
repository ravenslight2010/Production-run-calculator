import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export type IsolationEnvironment = Record<string, string | undefined>;

const DISPOSABLE_DATABASE_NAME =
  /(?:^|[-_])(e2e|test|tests|tmp|temporary)(?:[-_]|$)/i;
const PRODUCTION_ENVIRONMENT = /^(production|prod)$/i;

export function assertDisposableBrowserDatabase(
  environment: IsolationEnvironment,
): URL {
  const rawUrl = environment.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const productionMarkers = [
    environment.NODE_ENV,
    environment.APP_ENV,
  ];
  if (
    environment.REPLIT_DEPLOYMENT === "1"
    || productionMarkers.some((value) =>
      value ? PRODUCTION_ENVIRONMENT.test(value) : false
    )
  ) {
    throw new Error(
      "Refusing to prepare an isolated browser database in a production environment.",
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const disposableName = DISPOSABLE_DATABASE_NAME.test(database);
  const explicitlyApproved =
    environment.E2E_TEST_DB === "1"
    && environment.E2E_APPROVED_DESTRUCTIVE_MODE === "1";

  if (!localHost && !disposableName && !explicitlyApproved) {
    throw new Error(
      "Refusing to prepare a shared database. Use localhost, a database name " +
        "containing e2e/test/tmp, or set both E2E_TEST_DB=1 and " +
        "E2E_APPROVED_DESTRUCTIVE_MODE=1 for a verified disposable environment.",
    );
  }

  return url;
}

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
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

export async function prepareIsolatedBrowserDatabase(
  environment: IsolationEnvironment = process.env,
  runCommand: (command: string, args: string[]) => Promise<void> = run,
): Promise<void> {
  const url = assertDisposableBrowserDatabase(environment);
  console.log(
    `Disposable browser database approved (${url.hostname}/${decodeURIComponent(
      url.pathname.replace(/^\/+/, ""),
    )}).`,
  );
  console.log("Applying the canonical Drizzle schema before API startup...");
  await runCommand("pnpm", ["--filter", "@workspace/db", "run", "push-force"]);
  console.log("Schema applied. Starting the development API...");
  await runCommand("pnpm", [
    "--filter",
    "@workspace/api-server",
    "run",
    "dev:without-schema-push",
  ]);
}

const isEntrypoint =
  process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(resolve(process.argv[1])));

if (isEntrypoint) {
  prepareIsolatedBrowserDatabase().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}