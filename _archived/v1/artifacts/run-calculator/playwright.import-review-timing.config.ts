import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

// Review-only browser fixture: no API server, sign-in or database writes.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "import-review-timing.browser.ts",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  outputDir: "test-results/import-review-timing",
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:18190", headless: true },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 18190 --strictPort",
    url: "http://127.0.0.1:18190/e2e/fixtures/import-review-timing.html",
    reuseExistingServer: false,
  },
  projects: ["chromium", "webkit"].flatMap((browser) =>
    [
      { name: "desktop", width: 1280, height: 800 },
      { name: "phone", width: 390, height: 844 },
      { name: "tablet-portrait", width: 768, height: 1024 },
      { name: "tablet-landscape", width: 1024, height: 768 },
    ].map(({ name, width, height }) => ({
      name: `${name}-${browser}`,
      use: {
        ...devices[browser === "chromium" ? "Desktop Chrome" : "Desktop Safari"],
        viewport: { width, height },
        launchOptions: browser === "chromium"
          ? { executablePath: resolveChromiumExecutable() }
          : webkitLaunchOptions(),
      },
    })),
  ),
});
