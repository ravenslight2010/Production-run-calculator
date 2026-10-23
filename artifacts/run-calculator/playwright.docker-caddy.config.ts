import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const enabledEngines = new Set(
  (process.env.DOCKER_CADDY_ENABLED_ENGINES ?? "chromium,webkit")
    .split(",")
    .map((engine) => engine.trim())
    .filter(Boolean),
);

const viewports = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
  { name: "tablet-portrait", viewport: { width: 768, height: 1024 } },
  { name: "tablet-landscape", viewport: { width: 1024, height: 768 } },
] as const;

const chromiumProjects = enabledEngines.has("chromium")
  ? viewports.map(({ name, viewport }) => ({
      name: `${name}-chromium`,
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        ...(name === "phone" ? { isMobile: true, hasTouch: true } : {}),
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    }))
  : [];

const webkitProjects = enabledEngines.has("webkit")
  ? viewports.map(({ name, viewport }) => ({
      name: `${name}-webkit`,
      use: {
        ...devices["Desktop Safari"],
        viewport,
        ...(name === "phone" ? { isMobile: true, hasTouch: true } : {}),
        launchOptions: webkitLaunchOptions(),
      },
    }))
  : [];

const baseURL = process.env.DOCKER_CADDY_BASE_URL;
if (!baseURL) {
  throw new Error(
    "DOCKER_CADDY_BASE_URL must point to the isolated Docker/Caddy test stack.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "docker-caddy-browser-smoke.spec.ts",
  timeout: 30_000,
  globalTimeout: 5 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/docker-caddy",
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [...chromiumProjects, ...webkitProjects],
});
