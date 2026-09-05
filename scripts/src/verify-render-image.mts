import { execFileSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const rootDir = new URL("../../", import.meta.url).pathname;
const startupTimeoutMs = parseDuration(
  process.env.RENDER_IMAGE_SMOKE_TIMEOUT_MS ?? "180000",
  "RENDER_IMAGE_SMOKE_TIMEOUT_MS",
);
const buildNetwork =
  process.env.RENDER_IMAGE_SMOKE_BUILD_NETWORK ??
  (process.platform === "linux" ? "host" : "default");
const imageTag = `runcalc-render-smoke:${process.pid}`;
const databaseContainer = `runcalc-render-smoke-db-${process.pid}`;
const apiContainer = `runcalc-render-smoke-api-${process.pid}`;
const databaseUser = "render_smoke";
const databasePassword = "render_smoke_password";
const databaseName = "render_smoke";

let imageBuilt = false;
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

function docker(
  args: string[],
  stdio: "inherit" | "pipe" | "ignore" = "pipe",
): string {
  const output = execFileSync("docker", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio,
  });
  return typeof output === "string" ? output.trim() : "";
}

function removeContainer(name: string): void {
  try {
    docker(["rm", "--force", name], "ignore");
  } catch {
    // The container may not have been created or may already be gone.
  }
}

function removeImage(): void {
  if (!imageBuilt) return;
  try {
    docker(["image", "rm", "--force", imageTag], "ignore");
  } catch {
    // Keep the original failure if Docker cannot remove a disposable image.
  }
}

function cleanup(): void {
  if (cleaningUp) return;
  cleaningUp = true;
  removeContainer(apiContainer);
  removeContainer(databaseContainer);
  removeImage();
}

function containerLogs(name: string): string {
  try {
    return docker(["logs", "--tail", "120", name], "pipe");
  } catch {
    return "(container logs unavailable)";
  }
}

async function canConnectToPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function availablePort(exclude?: number): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not reserve an available host port"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port === exclude ? availablePort(exclude) : port;
}

async function waitForDatabase(hostPort: number): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToPort(hostPort)) {
      // A fresh Postgres briefly starts an initialization server before the
      // final listener. Require the same port to remain available after it.
      await delay(1_500);
      if (await canConnectToPort(hostPort)) return;
    }
    await delay(500);
  }
  throw new Error(
    `Temporary Postgres did not become ready within ${startupTimeoutMs}ms.\n${containerLogs(databaseContainer)}`,
  );
}

async function waitForHttp(
  url: string,
  assertion: (response: Response, body: string) => string | undefined,
): Promise<{ response: Response; body: string }> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(5_000, deadline - Date.now())),
      });
      const body = await response.text();
      const failure = assertion(response, body);
      if (!failure) return { response, body };
      lastFailure = failure;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(
    `HTTP smoke check failed for ${url}: ${lastFailure}\n${containerLogs(apiContainer)}`,
  );
}

function assertCompiledCalculator(
  response: Response,
  body: string,
): string | undefined {
  if (response.status !== 200) {
    return `expected HTTP 200, received ${response.status}: ${body.slice(0, 500)}`;
  }
  if (!response.headers.get("content-type")?.includes("text/html")) {
    return `expected an HTML content type, received ${response.headers.get("content-type") ?? "missing"}`;
  }
  if (!body.includes("<title>Production Run Calculator</title>")) {
    return "response did not contain the compiled calculator title";
  }
  if (!body.includes('<div id="root"></div>')) {
    return "response did not contain the calculator root element";
  }
  if (!/\/assets\/[^"]+\.js/.test(body)) {
    return "response did not reference a compiled JavaScript asset";
  }
  if (body.includes("@vite/client")) {
    return "response contained the Vite development client";
  }
  return undefined;
}

function assertHealthyApi(
  response: Response,
  body: string,
): string | undefined {
  if (response.status !== 200) {
    return `expected HTTP 200, received ${response.status}: ${body.slice(0, 500)}`;
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return `expected a JSON content type, received ${response.headers.get("content-type") ?? "missing"}`;
  }
  try {
    const payload = JSON.parse(body) as {
      status?: string;
      checks?: { process?: string; database?: string; dependencies?: string };
    };
    if (
      payload.status !== "ok" ||
      payload.checks?.process !== "ok" ||
      payload.checks.database !== "ok" ||
      payload.checks.dependencies !== "ok"
    ) {
      return `expected a healthy API response, received ${body.slice(0, 500)}`;
    }
  } catch {
    return `expected JSON health response, received ${body.slice(0, 500)}`;
  }
  return undefined;
}

async function main(): Promise<void> {
  console.log(`Building Render API image as ${imageTag}`);
  docker(
    [
      "build",
      "--network",
      buildNetwork,
      "--target",
      "api",
      "--tag",
      imageTag,
      ".",
    ],
    "inherit",
  );
  imageBuilt = true;

  const databasePort = await availablePort();
  const apiPort = await availablePort(databasePort);
  docker(
    [
      "run",
      "--detach",
      "--name",
      databaseContainer,
      "--network",
      "host",
      "--env",
      `POSTGRES_USER=${databaseUser}`,
      "--env",
      `POSTGRES_PASSWORD=${databasePassword}`,
      "--env",
      `POSTGRES_DB=${databaseName}`,
      "postgres:16-alpine",
      "postgres",
      "-p",
      String(databasePort),
    ],
    "inherit",
  );
  await waitForDatabase(databasePort);

  docker(
    [
      "run",
      "--detach",
      "--name",
      apiContainer,
      "--network",
      "host",
      "--env",
      "NODE_ENV=production",
      "--env",
      `PORT=${apiPort}`,
      "--env",
      `DATABASE_URL=postgres://${databaseUser}:${databasePassword}@127.0.0.1:${databasePort}/${databaseName}`,
      // The health endpoint reports dependency readiness. This sentinel only
      // enables that check; it is not a real credential or a production value.
      "--env",
      "AI_INTEGRATIONS_GEMINI_API_KEY=render-image-smoke-configured",
      imageTag,
    ],
    "inherit",
  );
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  await waitForHttp(`${baseUrl}/`, assertCompiledCalculator);
  console.log(
    "PASS Render image: / serves the compiled calculator entry point",
  );
  await waitForHttp(`${baseUrl}/api/readyz`, assertHealthyApi);
  console.log("PASS Render image: /api/readyz returns a healthy API response");
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
  await main();
} catch (error) {
  console.error(
    `FAIL Render image smoke:\n${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  cleanup();
}