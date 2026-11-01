import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import https from "node:https";
import { dockerCaddyBuildContext } from "./docker-caddy-build-context.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const calculatorDir = path.join(repoRoot, "artifacts/run-calculator");
const overallStartedAt = performance.now();
const tempDir = mkdtempSync(path.join(tmpdir(), "docker-caddy-browser-"));
const envPath = path.join(tempDir, "compose.env");
const composePath = path.join(tempDir, "compose.yml");
const projectName = `calc-caddy-browser-${process.pid}-${Date.now().toString(36)}`;
const startupTimeoutMs = 5 * 60_000;

let composeCreated = false;
let cleanupStarted = false;

function reportTiming(label, startedAt) {
  const seconds = (performance.now() - startedAt) / 1_000;
  console.log(`TIMING ${label}: ${seconds.toFixed(1)}s`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    timeout: options.timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status ?? result.signal ?? "unknown status"}`,
    );
  }
  return result.stdout ?? "";
}

function compose(args, options = {}) {
  return run(
    "docker",
    [
      "compose",
      "--project-name",
      projectName,
      "--project-directory",
      repoRoot,
      "--env-file",
      envPath,
      "--file",
      composePath,
      ...args,
    ],
    options,
  );
}

async function availablePort() {
  const server = createServer();
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a temporary host port"));
      } else {
        resolve(address.port);
      }
    });
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function writeIsolatedCompose(httpPort, httpsPort, databasePort) {
  const source = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8");
  const replacements = [
    ["context: .", dockerCaddyBuildContext(repoRoot)],
    ["env_file: .env", `env_file: "${envPath}"`],
    [
      "    volumes:\n      - db-data:/var/lib/postgresql/data",
      `    ports:\n      - "127.0.0.1:${databasePort}:5432"\n    volumes:\n      - db-data:/var/lib/postgresql/data`,
    ],
    [
      `    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 12`,
      "    healthcheck:\n      disable: true",
    ],
    ["condition: service_healthy", "condition: service_started"],
    ["target: api-migrate", "target: api-migrate-smoke"],
    ['- "80:80"', `- "127.0.0.1:${httpPort}:80"`],
    ['- "443:443"', `- "127.0.0.1:${httpsPort}:443"`],
  ];
  let isolated = source;
  for (const [from, to] of replacements) {
    if (!isolated.includes(from)) {
      throw new Error(`docker-compose.yml no longer contains the expected entry: ${from}`);
    }
    isolated = isolated.replaceAll(from, to);
  }
  writeFileSync(composePath, isolated, { mode: 0o600 });
}

async function waitForDatabase(port) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1_000);
      socket.once("connect", () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
    if (connected) return;
    await delay(500);
  }
  throw new Error(`Disposable PostgreSQL did not accept a host TCP connection on port ${port} within ${startupTimeoutMs}ms.`);
}

function writeIsolatedEnvironment() {
  const password = randomBytes(24).toString("base64url");
  const sessionSecret = randomBytes(32).toString("base64url");
  const values = {
    POSTGRES_DB: "calculator_browser",
    POSTGRES_USER: "browser_test",
    POSTGRES_PASSWORD: password,
    NODE_ENV: "production",
    PORT: "5000",
    DATABASE_URL: `postgresql://browser_test:${password}@db:5432/calculator_browser`,
    STAFF_SIGNUP_CODE: "docker-browser-test-signup",
    INITIAL_MANAGER_USERNAME: "docker_browser_manager",
    INITIAL_MANAGER_ACCESS_CODE: "docker-browser-test-manager",
    SESSION_SECRET: sessionSecret,
    AI_INTEGRATIONS_GEMINI_API_KEY: "docker-browser-smoke-configured",
    SITE_ADDRESS: "localhost",
    REPLIT_DOMAINS: "",
  };
  writeFileSync(
    envPath,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    { mode: 0o600 },
  );
}

function requestReady(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { rejectUnauthorized: false, timeout: 5_000 },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          try {
            const json = JSON.parse(body);
            resolve(
              response.statusCode === 200 &&
                json.status === "ok" &&
                json.checks?.process === "ok" &&
                json.checks?.database === "ok" &&
                json.checks?.dependencies === "ok",
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("readiness request timed out")));
    request.on("error", () => resolve(false));
  });
}

async function waitForReady(url) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (await requestReady(url)) return;
    await delay(1_000);
  }
  throw new Error(`Docker/Caddy API did not become ready within ${startupTimeoutMs}ms.`);
}

function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  const cleanupStartedAt = performance.now();
  if (composeCreated) {
    try {
      compose(["down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
    } catch (error) {
      console.error(
        `BLOCKED cleanup: isolated Compose resources may remain: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode ||= 1;
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
  reportTiming("cleanup", cleanupStartedAt);
  reportTiming("total", overallStartedAt);
}

process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.once("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  const preflightStartedAt = performance.now();
  const preflight = run(
    "node",
    ["e2e/docker-caddy-browser-preflight.mjs"],
    { cwd: calculatorDir, stdio: "pipe" },
  );
  console.log(preflight.trim());
  reportTiming("browser preflight", preflightStartedAt);
  const availableMatch = preflight.match(/^AVAILABLE_ENGINES=(.*)$/m);
  const blockedMatch = preflight.match(/^BLOCKED_ENGINES=(.*)$/m);
  const availableEngines = (availableMatch?.[1] ?? "")
    .split(",")
    .filter(Boolean);
  const blockedEngines = (blockedMatch?.[1] ?? "")
    .split(",")
    .filter(Boolean);

  if (availableEngines.length === 0) {
    console.error("BLOCKED: no supported browser engine can launch in this environment.");
    process.exitCode = 2;
  } else {
    const httpPort = await availablePort();
    let httpsPort = await availablePort();
    while (httpsPort === httpPort) httpsPort = await availablePort();
    let databasePort = await availablePort();
    while (databasePort === httpPort || databasePort === httpsPort) {
      databasePort = await availablePort();
    }
    writeIsolatedEnvironment();
    writeIsolatedCompose(httpPort, httpsPort, databasePort);

    const composeConfigStartedAt = performance.now();
    compose(["config", "--quiet"], { stdio: "inherit" });
    reportTiming("isolated Compose validation", composeConfigStartedAt);
    composeCreated = true;

    const databaseStartedAt = performance.now();
    console.log("Starting isolated PostgreSQL before the Docker/Caddy application.");
    compose(["up", "--detach", "db", "caddy-storage-init"], { stdio: "inherit" });
    await waitForDatabase(databasePort);
    console.log("PASS isolated PostgreSQL accepts a host TCP connection.");
    reportTiming("database and storage-helper startup", databaseStartedAt);

    const buildStartedAt = performance.now();
    console.log("Building the isolated migration, API, and Docker/Caddy images.");
    if (process.env.DOCKER_CADDY_NO_CACHE === "1") {
      console.log(
        "Cold migration-image measurement: rebuild the test-only migration image without cache; API and web builds use normal caching and still build on cache misses.",
      );
      compose(["build", "--no-cache", "migrate"], { stdio: "inherit" });
      compose(["build", "api", "web"], { stdio: "inherit" });
    } else {
      compose(["build"], { stdio: "inherit" });
    }
    reportTiming("Docker image build and export", buildStartedAt);

    const migrationStartedAt = performance.now();
    console.log("Applying the real database migrations to the disposable PostgreSQL database.");
    compose(
      ["up", "--exit-code-from", "migrate", "migrate"],
      { stdio: "inherit" },
    );
    console.log("PASS disposable PostgreSQL migrations completed successfully.");
    reportTiming("database migration", migrationStartedAt);

    const serviceStartupStartedAt = performance.now();
    console.log("Starting the isolated API and Docker/Caddy services.");
    compose(["up", "--detach", "--no-deps", "api", "web"], {
      stdio: "inherit",
    });
    reportTiming("API and Docker/Caddy service startup", serviceStartupStartedAt);

    const baseURL = `https://localhost:${httpsPort}`;
    const readinessStartedAt = performance.now();
    await waitForReady(`${baseURL}/api/readyz`);
    console.log(`PASS Docker/Caddy HTTPS readiness: ${baseURL}/api/readyz`);
    reportTiming("HTTPS/API readiness", readinessStartedAt);

    const testEnv = {
      ...process.env,
      DOCKER_CADDY_BASE_URL: baseURL,
      DOCKER_CADDY_ENABLED_ENGINES: availableEngines.join(","),
    };
    const selected = blockedEngines.length
      ? `Available browser engines: ${availableEngines.join(", ")}.`
      : "Both supported browser engines are available.";
    console.log(selected);
    const browserStartedAt = performance.now();
    run(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config=playwright.docker-caddy.config.ts",
      ],
      { cwd: calculatorDir, env: testEnv, stdio: "inherit" },
    );
    reportTiming("Chromium/WebKit browser matrix", browserStartedAt);

    if (blockedEngines.length > 0) {
      for (const engine of blockedEngines) {
        console.error(
          `BLOCKED browser/layouts: ${engine} at desktop, phone, tablet portrait, and tablet landscape (engine launch preflight failed).`,
        );
      }
      process.exitCode = 2;
    }
  }
} catch (error) {
  console.error(
    `FAIL Docker/Caddy browser smoke: ${error instanceof Error ? error.message : String(error)}`,
  );
  if (composeCreated) {
    try {
      console.error("Recent isolated container logs:");
      compose(["logs", "--no-color", "--tail=80"], { stdio: "inherit" });
    } catch {
      console.error("(Container logs unavailable.)");
    }
  }
  process.exitCode ||= 1;
} finally {
  cleanup();
}
