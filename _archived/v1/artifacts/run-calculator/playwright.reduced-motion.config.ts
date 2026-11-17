import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const calculatorPort = Number(process.env.REDUCED_MOTION_CALCULATOR_PORT ?? 4185);
const mockupPort = Number(process.env.REDUCED_MOTION_MOCKUP_PORT ?? 4186);
const calculatorUrl = `http://127.0.0.1:${calculatorPort}`;
const mockupUrl = `http://127.0.0.1:${mockupPort}`;
const calculatorDir = fileURLToPath(new URL(".", import.meta.url));
const mockupDir = path.resolve(calculatorDir, "../mockup-sandbox");
const serveBuiltOutput = process.env.REDUCED_MOTION_BUILT_OUTPUT === "1";

const chromiumProjects = [
  {
    name: "chromium-desktop",
    viewport: { width: 1280, height: 800 },
    device: devices["Desktop Chrome"],
  },
  {
    name: "chromium-phone",
    viewport: { width: 390, height: 844 },
    device: devices["iPhone 13"],
  },
  {
    name: "chromium-tablet-portrait",
    viewport: { width: 820, height: 1180 },
    device: devices["iPad (gen 7)"],
  },
  {
    name: "chromium-tablet-landscape",
    viewport: { width: 1180, height: 820 },
    device: devices["iPad (gen 7)"],
  },
];

const webkitProjects = [
  {
    name: "webkit-desktop",
    viewport: { width: 1280, height: 800 },
    device: devices["Desktop Safari"],
  },
  {
    name: "webkit-phone",
    viewport: { width: 390, height: 844 },
    device: devices["iPhone 13"],
  },
  {
    name: "webkit-tablet-portrait",
    viewport: { width: 820, height: 1180 },
    device: devices["iPad (gen 7)"],
  },
  {
    name: "webkit-tablet-landscape",
    viewport: { width: 1180, height: 820 },
    device: devices["iPad (gen 7)"],
  },
];

export default defineConfig({
  testDir: "./e2e",
  testMatch: "reduced-motion.spec.ts",
  timeout: 30_000,
  globalTimeout: 5 * 60_000,
  retries: 0,
  workers: 1,
  reporter: "dot",
  outputDir: "test-results/reduced-motion",
  webServer: [
    {
      command: serveBuiltOutput
        ? "pnpm exec vite preview --config vite.config.ts --host 127.0.0.1"
        : "pnpm exec vite --config vite.config.ts --host 127.0.0.1",
      cwd: calculatorDir,
      url: calculatorUrl,
      env: { PORT: String(calculatorPort), BASE_PATH: "/" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: serveBuiltOutput
        ? "pnpm exec vite preview --config vite.config.ts --host 127.0.0.1"
        : "pnpm exec vite dev --config vite.config.ts --host 127.0.0.1",
      cwd: mockupDir,
      url: mockupUrl,
      env: { PORT: String(mockupPort), BASE_PATH: "/" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  use: {
    headless: true,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  projects: [
    ...chromiumProjects.map(({ name, viewport, device }) => ({
      name,
      use: {
        ...device,
        browserName: "chromium" as const,
        viewport,
        reducedMotion: "reduce" as const,
      },
    })),
    ...webkitProjects.map(({ name, viewport, device }) => ({
      name,
      use: {
        ...device,
        browserName: "webkit" as const,
        viewport,
        reducedMotion: "reduce" as const,
        launchOptions: webkitLaunchOptions(),
      },
    })),
  ],
  metadata: {
    browserEvidence:
      "Responsive browser emulation only; not physical Android Chrome or iOS Safari/PWA evidence.",
  },
});
