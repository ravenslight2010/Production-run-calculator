import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { requireLocalFixtureApiOrigin } from "./e2e/isolatedApiOrigin";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
if (!baseURL) {
  throw new Error("The isolated staging browser run requires PLAYWRIGHT_BASE_URL.");
}
const appOrigin = new URL(baseURL).origin;
const apiOrigin = requireLocalFixtureApiOrigin("isolated staging wake browser checks");
if (appOrigin !== apiOrigin) {
  throw new Error("The isolated staging browser and fixture API must use the same loopback origin.");
}
const outputDir = process.env.ISOLATED_STAGING_BROWSER_OUTPUT_DIR?.trim();
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const privateStageRoot = resolve(repositoryRoot, ".local/isolated-staging");
if (!outputDir || !resolve(outputDir).startsWith(`${privateStageRoot}${sep}`)) {
  throw new Error("Browser results must stay inside the private isolated-staging directory.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "screen-off-wake.spec.ts",
  grep: /A\. running run: counter jumps by full 50-case delta in one wake tick \(no cap\)|B\. paused run: counter stays frozen after screen-off \+ wake|wake recovery queues one (?:Stop|Resume) tap and applies it to the same run/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  globalTimeout: 240_000,
  reporter: [
    ["list"],
    ["json", { outputFile: join(resolve(outputDir), "report.json") }],
  ],
  outputDir,
  use: {
    ...devices["Pixel 5"],
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: {
      executablePath: resolveChromiumExecutable(),
    },
  },
});
