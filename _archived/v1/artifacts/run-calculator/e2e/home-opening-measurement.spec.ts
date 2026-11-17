import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
} from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:18083";
const MANIFEST_PATH = fileURLToPath(
  new URL("../dist/public/.vite/workbook-boundary-manifest.json", import.meta.url),
);
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
  chunks: Record<string, { name?: string }>;
};
const deferredPanels = [
  {
    name: "SetupContent",
    open: async (page: Page) => {
      await openMore(page);
      await page.getByRole("menuitem", { name: "Setup", exact: true }).click();
      await expect(page.getByTestId("setup-header")).toBeVisible();
    },
  },
  {
    name: "WarehouseTabContent",
    open: async (page: Page) => {
      await page.getByTestId("tab-warehouse").click();
      await expect(page.getByTestId("warehouse-page-heading")).toBeVisible();
    },
  },
  {
    name: "MixesTabContent",
    open: async (page: Page) => {
      await openMore(page);
      await page.getByRole("menuitem", { name: "Mix Plan", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Mix Plan", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "SummaryToolsContent",
    open: async (page: Page) => {
      await openMore(page);
      await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
      await expect(page.getByTestId("summary-tools-header")).toBeVisible();
    },
  },
] as const;

let authorizedFixtures: AuthorizedBrowserFixtures | undefined;

function chunkFor(name: string): string {
  const match = Object.entries(manifest.chunks).find(([, chunk]) => chunk.name === name);
  if (!match) throw new Error(`Production build is missing deferred panel ${name}.`);
  return match[0];
}

async function openMore(page: Page): Promise<void> {
  const menu = page.getByRole("menu");
  if (await menu.isVisible().catch(() => false)) {
    await expect(menu).toBeHidden({ timeout: 5_000 });
  }
  await page.getByTitle("More").click();
  await expect(menu).toBeVisible();
}

test.beforeEach(async ({ playwright }) => {
  requireIsolatedTestDatabase("Home opening measurement");
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for Home opening measurement.");
  }
  authorizedFixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    SIGNUP_CODE,
  );
});

test.afterEach(async () => {
  const fixtures = authorizedFixtures;
  authorizedFixtures = undefined;
  await fixtures?.cleanup();
});

test("measures five cold authenticated Home openings and deferred-panel first use", async ({
  browser,
  browserName,
}, testInfo) => {
  const project = testInfo.project.name;
  const timingProject =
    browserName === "chromium" &&
    (project === "desktop-chromium" || project === "phone-chromium");
  test.skip(!timingProject, "Timing capture is limited to Chromium desktop and phone.");

  const viewport = project === "phone-chromium"
    ? { width: 390, height: 844 }
    : { width: 1280, height: 800 };

  for (let sample = 1; sample <= 5; sample += 1) {
    const account = await authorizedFixtures!.createAccount({
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    });
    const context = await browser.newContext({
      viewport,
      ...(project === "phone-chromium" ? { isMobile: true, hasTouch: true } : {}),
      serviceWorkers: "block",
    });
    const cdp = await context.newCDPSession(await context.newPage());
    const page = context.pages()[0]!;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 240)));

    try {
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 400,
        downloadThroughput: Math.round((500 * 1024) / 8),
        uploadThroughput: Math.round((500 * 1024) / 8),
        connectionType: "cellular3g",
      });
      await context.addInitScript(() => {
        const markFirstView = () => {
          const tab = document.querySelector('[data-testid="tab-run"]');
          if (
            tab?.getAttribute("data-state") === "active" &&
            performance.getEntriesByName("home-first-view").length === 0
          ) {
            performance.mark("home-first-view");
          }
        };
        const observer = new MutationObserver(markFirstView);
        observer.observe(document, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        document.addEventListener("DOMContentLoaded", markFirstView, { once: true });
      });
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await page.locator("#username").fill(account.username);
      await page.locator("#password").fill(PASSWORD);
      await page.evaluate(() => performance.mark("auth-submit"));
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("tab-run")).toHaveAttribute(
        "data-state",
        "active",
        { timeout: 45_000 },
      );
      const opening = await page.evaluate(() => {
        const firstView = performance.getEntriesByName(
          "home-first-view",
        )[0] as PerformanceMark | undefined;
        const submit = performance.getEntriesByName(
          "auth-submit",
        )[0] as PerformanceMark | undefined;
        if (!firstView || !submit) {
          throw new Error("Authentication or Home first-view timing mark was not recorded.");
        }
        const origin = location.origin;
        const resources = performance.getEntriesByType("resource")
          .filter((entry): entry is PerformanceResourceTiming =>
            entry instanceof PerformanceResourceTiming &&
            new URL(entry.name).origin === origin &&
            entry.responseEnd <= firstView.startTime,
          )
          .map((entry) => ({
            path: new URL(entry.name).pathname,
            transferSize: entry.transferSize,
          }));
        return {
          firstViewMs: firstView.startTime - submit.startTime,
          resources,
        };
      });
      const panelFiles = deferredPanels.map(({ name }) => ({
        name,
        file: chunkFor(name),
      }));
      expect(
        opening.resources.filter(({ path }) =>
          panelFiles.some(({ file }) => path.endsWith(file)),
        ),
      ).toEqual([]);

      const javascriptBytes = opening.resources
        .filter(({ path }) => /\.(?:m?js)$/.test(path))
        .reduce((total, entry) => total + entry.transferSize, 0);
      const cssBytes = opening.resources
        .filter(({ path }) => path.endsWith(".css"))
        .reduce((total, entry) => total + entry.transferSize, 0);

      const panelFirstUse: Array<{ name: string; elapsedMs: number; status: number }> = [];
      for (const panel of deferredPanels) {
        const file = chunkFor(panel.name);
        const chunkResponse = page.waitForResponse(
          (response) => new URL(response.url()).pathname.endsWith(file),
          { timeout: 45_000 },
        );
        const panelStart = performance.now();
        await panel.open(page);
        const response = await chunkResponse;
        const elapsedMs = performance.now() - panelStart;
        expect(response.status(), `${panel.name} chunk response`).toBe(200);
        panelFirstUse.push({
          name: panel.name,
          elapsedMs: Math.round(elapsedMs),
          status: response.status(),
        });
      }

      expect(pageErrors).toEqual([]);
      console.log("HOME_OPENING_MEASUREMENT", JSON.stringify({
        project,
        sample,
        homeFirstViewMs: Math.round(opening.firstViewMs),
        javascriptTransferredBytes: javascriptBytes,
        cssTransferredBytes: cssBytes,
        deferredPanelFirstUse: panelFirstUse,
      }));
    } finally {
      await cdp.detach().catch(() => {});
      await context.close();
    }
  }
});
