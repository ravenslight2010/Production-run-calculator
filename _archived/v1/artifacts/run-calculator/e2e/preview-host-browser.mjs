import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const webPort = Number(process.env.CLEAN_START_WEB_PORT);
const mockupPort = Number(process.env.CLEAN_START_MOCKUP_PORT);
const screenshotPath = process.env.CLEAN_START_SCREENSHOT_PATH;
const timeoutMs = Number(process.env.CLEAN_START_BROWSER_TIMEOUT_MS ?? "30000");

if (!Number.isInteger(webPort) || !Number.isInteger(mockupPort) || !screenshotPath) {
  throw new Error(
    "CLEAN_START_WEB_PORT, CLEAN_START_MOCKUP_PORT, and CLEAN_START_SCREENSHOT_PATH are required.",
  );
}

function resolveChromiumExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured) return configured;
  return execFileSync(
    "sh",
    [
      "-lc",
      "command -v chromium || command -v chromium-browser || command -v google-chrome",
    ],
    { encoding: "utf8" },
  ).trim();
}

function samePreviewOrigin(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "127.0.0.1" &&
      (parsed.port === String(webPort) || parsed.port === String(mockupPort))
    );
  } catch {
    return false;
  }
}

function isExpectedUnauthorizedText(text) {
  return /\b(?:401|403|unauthorized|forbidden)\b/i.test(text);
}

function isHmrOrRoutingText(text) {
  return /\b(?:hmr|websocket|vite client|@vite\/client|chunkloaderror|loading chunk|dynamically imported module|failed to resolve module|cannot find module)\b/i.test(
    text,
  );
}

const evidence = {
  kind: "proxied-preview-browser-result",
  generatedAt: new Date().toISOString(),
  routes: [],
  consoleMessages: [],
  expectedUnauthenticatedResponses: [],
  unexpectedConsoleErrors: [],
  hmrOrRoutingFailures: [],
  pageErrors: [],
  requestFailures: [],
  responseErrors: [],
  screenshot: null,
  passed: false,
};

let browser;

try {
  browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });

  function observe(page, label) {
    page.on("console", (message) => {
      if (!["debug", "info", "warning", "error"].includes(message.type())) return;
      evidence.consoleMessages.push({
        page: label,
        type: message.type(),
        text: message.text(),
      });
    });
    page.on("pageerror", (error) => {
      evidence.pageErrors.push({ page: label, message: error.message });
    });
    page.on("requestfailed", (request) => {
      if (!samePreviewOrigin(request.url())) return;
      evidence.requestFailures.push({
        page: label,
        url: request.url(),
        resourceType: request.resourceType(),
        error: request.failure()?.errorText ?? "request failed",
      });
    });
    page.on("response", (response) => {
      if (!samePreviewOrigin(response.url()) || response.status() < 400) return;
      const record = {
        page: label,
        url: response.url(),
        status: response.status(),
        resourceType: response.request().resourceType(),
      };
      evidence.responseErrors.push(record);
      if (
        (response.status() === 401 || response.status() === 403) &&
        new URL(response.url()).pathname.startsWith("/api/")
      ) {
        evidence.expectedUnauthenticatedResponses.push(record);
      }
    });
  }

  async function checkRoute(label, url, expectedText, screenshot = false) {
    const page = await context.newPage();
    observe(page, label);
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      await page.waitForTimeout(750);
      const html = await page.content();
      const status = response?.status() ?? 0;
      const passed =
        status === 200 &&
        /<(?:!doctype|html)\b/i.test(html) &&
        (!expectedText || html.includes(expectedText));
      evidence.routes.push({
        label,
        url,
        status,
        expectedText: expectedText ?? null,
        passed,
      });
      if (screenshot) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        evidence.screenshot = screenshotPath;
      }
    } finally {
      await page.close();
    }
  }

  await checkRoute(
    "calculator-root",
    `http://127.0.0.1:${webPort}/`,
    null,
    true,
  );

  const expectedConsole = new Set(
    evidence.consoleMessages
      .filter(
        (message) =>
          message.type === "error" &&
          isExpectedUnauthorizedText(message.text),
      )
      .map((message) => message),
  );

  const hmrConsole = new Set(
    evidence.consoleMessages
      .filter((message) => isHmrOrRoutingText(message.text))
      .map((message) => message),
  );

  evidence.hmrOrRoutingFailures.push(
    ...evidence.pageErrors.map((error) => ({
      source: "pageerror",
      ...error,
    })),
    ...evidence.requestFailures
      .filter(
        (failure) =>
          !/\bERR_ABORTED\b/.test(failure.error) &&
          (failure.resourceType === "document" ||
            failure.resourceType === "script" ||
            isHmrOrRoutingText(failure.url)),
      )
      .map((failure) => ({ source: "request", ...failure })),
    ...evidence.responseErrors
      .filter(
        (response) =>
          !evidence.expectedUnauthenticatedResponses.includes(response) &&
          (response.resourceType === "document" ||
            response.resourceType === "script" ||
            isHmrOrRoutingText(response.url)),
      )
      .map((response) => ({ source: "response", ...response })),
    ...[...hmrConsole].map((message) => ({
      source: "console",
      ...message,
    })),
  );

  evidence.unexpectedConsoleErrors.push(
    ...evidence.consoleMessages.filter(
      (message) =>
        message.type === "error" &&
        !expectedConsole.has(message) &&
        !hmrConsole.has(message),
    ),
  );

  evidence.passed =
    evidence.routes.every((route) => route.passed) &&
    evidence.hmrOrRoutingFailures.length === 0 &&
    evidence.unexpectedConsoleErrors.length === 0;
} catch (error) {
  evidence.hmrOrRoutingFailures.push({
    source: "browser-check",
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  await browser?.close();
  console.log(`CLEAN_START_BROWSER_RESULT=${JSON.stringify(evidence)}`);
}

if (!evidence.passed) process.exitCode = 1;