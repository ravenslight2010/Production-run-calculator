import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const rootDir = new URL("../../", import.meta.url).pathname;
const apiPort = parsePort(
  process.env.CLEAN_START_API_PORT ?? "8080",
  "CLEAN_START_API_PORT",
);
const webPort = parsePort(
  process.env.CLEAN_START_WEB_PORT ?? "26038",
  "CLEAN_START_WEB_PORT",
);
const mockupPort = parsePort(
  process.env.CLEAN_START_MOCKUP_PORT ?? "8081",
  "CLEAN_START_MOCKUP_PORT",
);
const startupTimeoutMs = parseDuration(
  process.env.CLEAN_START_TIMEOUT_MS ?? "90000",
  "CLEAN_START_TIMEOUT_MS",
);
const pollIntervalMs = 250;
const outputLimit = 12_000;
const responseLimit = 20_000;
const evidenceDir = resolve(
  rootDir,
  process.env.CLEAN_START_EVIDENCE_DIR ?? "release-evidence/clean-start",
);

type HttpEvidence = {
  url: string;
  status: number;
  contentType: string | null;
  body: string;
  passed: boolean;
};

type CheckEvidence = HttpEvidence & {
  error?: string;
};

type CleanStartEvidence = {
  generatedAt: string;
  ports: {
    api: number;
    web: number;
    mockup: number;
  };
  checks: Record<string, CheckEvidence>;
  startupLogs: Record<string, string>;
  browserResult: string;
  screenshot: string | null;
};

type ManagedProcess = {
  name: string;
  child: ChildProcess;
  output: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

const processes: ManagedProcess[] = [];
const checks: Record<string, CheckEvidence> = {};
let screenshot: string | null = null;
let screenshotError: string | undefined;
let cleaningUp = false;

function parsePort(value: string, variable: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `${variable} must be an integer between 1 and 65535; received "${value}"`,
    );
  }
  return port;
}

function parseDuration(value: string, variable: string): number {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1_000) {
    throw new Error(
      `${variable} must be an integer of at least 1000ms; received "${value}"`,
    );
  }
  return duration;
}

function appendOutput(process: ManagedProcess, chunk: Buffer | string): void {
  process.output = `${process.output}${chunk.toString()}`.slice(-outputLimit);
}

function commandFor(name: "api" | "web" | "mockup"): {
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  if (name === "api") {
    return {
      args: ["--filter", "@workspace/api-server", "run", "dev"],
      env: { ...process.env, NODE_ENV: "development", PORT: String(apiPort) },
    };
  }
  if (name === "mockup") {
    return {
      args: ["--filter", "@workspace/mockup-sandbox", "run", "dev"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: String(mockupPort),
        BASE_PATH: "/__mockup",
      },
    };
  }
  return {
    args: ["--filter", "@workspace/run-calculator", "run", "dev"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(webPort),
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
    },
  };
}

function startManaged(name: "api" | "web" | "mockup"): ManagedProcess {
  const command = commandFor(name);
  const managed: ManagedProcess = {
    name,
    child: spawn("pnpm", command.args, {
      cwd: rootDir,
      env: command.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    output: "",
    exited: Promise.resolve({ code: null, signal: null }),
  };

  managed.exited = new Promise((resolve) => {
    managed.child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  managed.child.stdout?.on("data", (chunk: Buffer) =>
    appendOutput(managed, chunk),
  );
  managed.child.stderr?.on("data", (chunk: Buffer) =>
    appendOutput(managed, chunk),
  );
  managed.child.once("error", (error) =>
    appendOutput(managed, `\nprocess error: ${error.message}\n`),
  );
  processes.push(managed);
  return managed;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      server.destroy();
      resolve(available);
    };
    server.setTimeout(500, () => finish(true));
    server.once("connect", () => finish(false));
    server.once("error", () => finish(true));
  });
}

function describePortOwner(port: number): string {
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpct"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const pid = output.match(/^p(\d+)$/m)?.[1];
    const command = output.match(/^c(.+)$/m)?.[1];
    if (pid && command) return `${command} (pid ${pid})`;
  } catch {
    // Fall through to ss, which is present on most Linux hosts.
  }
  try {
    const output = execFileSync("ss", ["-ltnp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = output
      .split("\n")
      .find((candidate) => candidate.includes(`:${port} `));
    const users = line?.match(/users:\(\("([^"]+)".*?pid=(\d+)/)?.slice(1);
    if (users) return `${users[0]} (pid ${users[1]})`;
  } catch {
    // The port can still be detected even when owner inspection is unavailable.
  }
  return "owner unavailable";
}

async function waitForPort(
  process: ManagedProcess,
  port: number,
): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      managedExit(process),
      delay(pollIntervalMs).then(() => undefined),
    ]);
    if (result) {
      throw new Error(
        `${process.name} process exited before opening port ${port} (code=${result.code}, signal=${result.signal}).`,
      );
    }
    if (!(await isPortAvailable(port))) return;
  }
  throw new Error(
    `${process.name} did not open port ${port} within ${startupTimeoutMs}ms.`,
  );
}

async function managedExit(
  process: ManagedProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | undefined> {
  const result = await Promise.race([
    process.exited,
    delay(0).then(() => undefined),
  ]);
  return result;
}

async function fetchExpect(
  checkName: string,
  process: ManagedProcess,
  url: string,
  assertion: (response: Response, body: string) => string | undefined,
): Promise<HttpEvidence> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(5_000, remainingMs)),
      });
      const body = await response.text();
      const failure = assertion(response, body);
      const evidence: CheckEvidence = {
        url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: body.slice(0, responseLimit),
        passed: !failure,
        ...(failure ? { error: failure } : {}),
      };
      checks[checkName] = evidence;
      if (!failure) return evidence;
      lastError = failure;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      checks[checkName] = {
        url,
        status: 0,
        contentType: null,
        body: "",
        passed: false,
        error: lastError,
      };
    }
    const result = await managedExit(process);
    if (result) {
      throw new Error(
        `${process.name} exited while checking ${url} (code=${result.code}, signal=${result.signal}).`,
      );
    }
    await delay(pollIntervalMs);
  }
  throw new Error(
    `${process.name} health check failed for ${url}: ${lastError}`,
  );
}

function evidencePath(fileName: string): string {
  return relative(rootDir, resolve(evidenceDir, fileName)) || fileName;
}

async function writeEvidence(): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  const startupLogs: Record<string, string> = {};
  for (const name of ["api", "web", "mockup"] as const) {
    const process = processes.find((candidate) => candidate.name === name);
    const fileName = `startup-${name}.log`;
    await writeFile(
      resolve(evidenceDir, fileName),
      process?.output ?? `${name} process was not started.\n`,
      "utf8",
    );
    startupLogs[name] = evidencePath(fileName);
  }

  const browserResult = evidencePath("browser-result.json");
  const evidence: CleanStartEvidence = {
    generatedAt: new Date().toISOString(),
    ports: { api: apiPort, web: webPort, mockup: mockupPort },
    checks,
    startupLogs,
    browserResult,
    screenshot,
  };
  await writeFile(
    resolve(evidenceDir, "clean-start-evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(evidenceDir, "browser-result.json"),
    `${JSON.stringify(
      {
        kind: "proxied-preview-browser-result",
        generatedAt: evidence.generatedAt,
        screenshot,
        screenshotError,
        web: checks.webHtml ?? null,
        api: checks.apiHealthViaWebProxy ?? null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(
    `Evidence retained: ${evidencePath("clean-start-evidence.json")}, ${browserResult}, ${Object.values(startupLogs).join(", ")}`,
  );
}

function chromiumExecutable(): string | undefined {
  for (const executable of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      execFileSync(executable, ["--version"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      return executable;
    } catch {
      // Check the next known browser binary.
    }
  }
  return undefined;
}

async function capturePreviewScreenshot(): Promise<void> {
  const executable = chromiumExecutable();
  if (!executable) {
    screenshotError =
      "Chromium was not available; retained HTTP browser result instead.";
    return;
  }
  await mkdir(evidenceDir, { recursive: true });
  const fileName = "preview-home.png";
  const outputPath = resolve(evidenceDir, fileName);
  const result = await new Promise<{ code: number | null; output: string }>(
    (resolveResult) => {
      const browser = spawn(
        executable,
        [
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--window-size=1280,900",
          `--screenshot=${outputPath}`,
          `http://127.0.0.1:${webPort}/`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      browser.stdout?.on("data", (chunk: Buffer) => {
        output = `${output}${chunk.toString()}`.slice(-2_000);
      });
      browser.stderr?.on("data", (chunk: Buffer) => {
        output = `${output}${chunk.toString()}`.slice(-2_000);
      });
      const timeout = setTimeout(() => {
        browser.kill("SIGTERM");
      }, 30_000);
      browser.once("close", (code) => {
        clearTimeout(timeout);
        resolveResult({ code, output });
      });
      browser.once("error", (error) => {
        clearTimeout(timeout);
        resolveResult({ code: null, output: error.message });
      });
    },
  );
  if (result.code === 0) {
    screenshot = evidencePath(fileName);
    return;
  }
  screenshotError = `Chromium screenshot failed (code=${result.code}): ${result.output}`;
}

async function stopManaged(managed: ManagedProcess): Promise<void> {
  const pid = managed.child.pid;
  if (!pid || managed.child.exitCode !== null) return;
  try {
    globalThis.process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  await Promise.race([managed.exited, delay(5_000)]);
  if (managed.child.exitCode === null) {
    try {
      globalThis.process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

async function cleanup(): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  await Promise.all(processes.slice().reverse().map(stopManaged));
}

function formatFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const logs = processes
    .filter((process) => process.output.trim())
    .map(
      (process) =>
        `\n--- ${process.name} startup output ---\n${process.output.trim()}`,
    )
    .join("\n");
  return `${message}${logs}`;
}

async function main(): Promise<void> {
  console.log(
    `Clean-start smoke: API 127.0.0.1:${apiPort}, web 127.0.0.1:${webPort}, mockup 127.0.0.1:${mockupPort}, timeout ${startupTimeoutMs}ms`,
  );

  for (const [name, port] of [
    ["api", apiPort],
    ["web", webPort],
    ["mockup", mockupPort],
  ] as const) {
    if (!(await isPortAvailable(port))) {
      throw new Error(
        `${name} port ${port} is already in use by ${describePortOwner(port)}. This is a preflight conflict, not a startup failure. Stop that process or set CLEAN_START_${name.toUpperCase()}_PORT to an unused port; clean-start will not kill unrelated processes.`,
      );
    }
  }

  const api = startManaged("api");
  await waitForPort(api, apiPort);
  await fetchExpect(
    "apiHealthDirect",
    api,
    `http://127.0.0.1:${apiPort}/api/healthz`,
    (response, body) => {
      if (response.status !== 200)
        return `expected HTTP 200, received ${response.status}: ${body.slice(0, 500)}`;
      try {
        const payload = JSON.parse(body) as {
          status?: string;
          checks?: { database?: string };
        };
        if (payload.status !== "ok" || payload.checks?.database !== "ok") {
          return `expected status=ok and checks.database=ok, received ${body.slice(0, 500)}`;
        }
      } catch {
        return `expected JSON health response, received ${body.slice(0, 500)}`;
      }
      return undefined;
    },
  );
  console.log(`PASS API: port ${apiPort} open and /api/healthz is healthy`);

  const web = startManaged("web");
  await waitForPort(web, webPort);
  await fetchExpect(
    "webHtml",
    web,
    `http://127.0.0.1:${webPort}/`,
    (response, body) => {
      if (response.status !== 200)
        return `expected HTTP 200, received ${response.status}`;
      if (!body.includes("<html") && !body.includes("<!doctype")) {
        return "response did not contain an HTML document";
      }
      return undefined;
    },
  );
  console.log(
    `PASS web: port ${webPort} open and / returns the initial HTML document`,
  );
  await fetchExpect(
    "apiHealthViaWebProxy",
    web,
    `http://127.0.0.1:${webPort}/api/healthz`,
    (response, body) => {
      if (response.status !== 200)
        return `expected HTTP 200, received ${response.status}: ${body.slice(0, 500)}`;
      try {
        const payload = JSON.parse(body) as {
          status?: string;
          checks?: { database?: string };
        };
        if (payload.status !== "ok" || payload.checks?.database !== "ok") {
          return `expected status=ok and checks.database=ok, received ${body.slice(0, 500)}`;
        }
      } catch {
        return `expected JSON health response, received ${body.slice(0, 500)}`;
      }
      return undefined;
    },
  );
  console.log(
    `PASS web proxy: /api/healthz forwards a healthy API response on port ${webPort}`,
  );
  await capturePreviewScreenshot();
  if (screenshot) {
    console.log(`PASS browser: retained preview screenshot at ${screenshot}`);
  } else {
    console.log(`Browser screenshot unavailable: ${screenshotError}`);
  }

  const mockup = startManaged("mockup");
  await waitForPort(mockup, mockupPort);
  await fetchExpect(
    "mockupHtml",
    mockup,
    `http://127.0.0.1:${mockupPort}/__mockup/`,
    (response, body) => {
      if (response.status !== 200)
        return `expected HTTP 200, received ${response.status}`;
      if (!body.includes("<html") && !body.includes("<!doctype")) {
        return "response did not contain an HTML document";
      }
      return undefined;
    },
  );
  console.log(
    `PASS mockup: port ${mockupPort} open and /__mockup/ returns the initial HTML document`,
  );
}

process.once("SIGINT", () => void cleanup().finally(() => process.exit(130)));
process.once("SIGTERM", () => void cleanup().finally(() => process.exit(143)));

try {
  await main();
} catch (error) {
  console.error(`FAIL clean-start smoke:\n${formatFailure(error)}`);
  process.exitCode = 1;
} finally {
  try {
    await writeEvidence();
  } catch (error) {
    console.error(
      `FAIL clean-start evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
  await cleanup();
}
