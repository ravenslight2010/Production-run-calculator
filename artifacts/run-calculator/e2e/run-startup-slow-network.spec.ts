/**
 * Run controls remain usable while optional station panels are still loading.
 *
 * Run this focused journey with the isolated database/API/web test wrapper:
 *   pnpm run test:e2e:run-startup
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { DEFAULT_VALUES } from "../src/types";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE =
  process.env.PLAYWRIGHT_API_BASE_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  `https://${process.env.REPLIT_DEV_DOMAIN}`;

type ChunkManifest = {
  chunks?: Record<string, { modules?: string[] }>;
};

type DeferredChunk = {
  file: string;
  gate: Promise<void>;
  release: () => void;
};

let fixtureDate: string | null = null;
let authorizedFixtures: AuthorizedBrowserFixtures;

function localDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

async function readRunStartedAt(page: Page, runId: string): Promise<number | null> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem("run-calc-day");
    if (!raw) return null;
    const state = JSON.parse(raw) as {
      runs?: Array<{ id?: string; startedAt?: number }>;
    };
    return state.runs?.find((run) => run.id === id)?.startedAt ?? null;
  }, runId);
}

async function expectReachableInViewport(
  page: Page,
  locator: Locator,
  description: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();

  expect(box, `${description} should have a rendered target`).not.toBeNull();
  expect(viewport, "the browser project should define a viewport").not.toBeNull();
  expect(box!.x, `${description} left edge should be on-screen`).toBeGreaterThanOrEqual(-1);
  expect(box!.y, `${description} top edge should be on-screen`).toBeGreaterThanOrEqual(-1);
  expect(
    box!.x + box!.width,
    `${description} right edge should be on-screen`,
  ).toBeLessThanOrEqual(viewport!.width + 1);
  expect(
    box!.y + box!.height,
    `${description} bottom edge should be on-screen`,
  ).toBeLessThanOrEqual(viewport!.height + 1);
}

function getOptionalPanelChunks(): DeferredChunk[] {
  const manifestPath = resolve(
    process.cwd(),
    "dist/public/.vite/workbook-boundary-manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ChunkManifest;
  const targets = [
    "LiveSauceTabContent.tsx",
    "LivePackagingTabContent.tsx",
  ];

  return targets.map((moduleName) => {
    const matches = Object.entries(manifest.chunks ?? {}).filter(([, chunk]) =>
      chunk.modules?.some((modulePath) => modulePath.endsWith(moduleName)),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected one built chunk for ${moduleName}; found ${matches.length}.`,
      );
    }

    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const file = matches[0]![0];

    return { file, release, gate };
  });
}

async function throttleToSlow3G(page: Page): Promise<() => Promise<void>> {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: Math.round((500 * 1024) / 8),
    uploadThroughput: Math.round((500 * 1024) / 8),
  });

  return async () => {
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await client.detach();
  };
}

test.beforeAll(async ({ playwright }) => {
  requireIsolatedTestDatabase("Run startup under slow network e2e");
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for Run startup e2e.");
  }
  authorizedFixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    SIGNUP_CODE,
  );
});

test.afterAll(async () => {
  await authorizedFixtures?.cleanup({
    syncDates: fixtureDate ? [fixtureDate] : [],
  });
});

test("Run controls work before delayed optional station panels finish loading", async ({
  page,
  browserName,
}, testInfo) => {
  const optionalChunks = getOptionalPanelChunks();
  const requestedChunks: string[] = [];
  const loadedChunks: Array<{ file: string; status: number }> = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
  page.on("response", (response) => {
    const file = optionalChunks.find((chunk) =>
      new URL(response.url()).pathname.endsWith(chunk.file),
    )?.file;
    if (file) loadedChunks.push({ file, status: response.status() });
  });

  for (const chunk of optionalChunks) {
    await page.route(`**/${chunk.file}`, async (route) => {
      requestedChunks.push(chunk.file);
      await chunk.gate;
      await route.continue();
    });
  }

  // CDP throttling is Chromium-only. The exact optional chunk routes below
  // provide the same deterministic hold point in WebKit without CDP.
  const restoreNetwork =
    browserName === "chromium"
      ? await throttleToSlow3G(page)
      : async () => {};

  const delayStrategy =
    browserName === "chromium"
      ? "Chromium CDP Slow 3G plus exact optional chunk request holds"
      : "exact optional chunk request holds";
  const releaseAllOptionalChunks = () => {
    for (const chunk of optionalChunks) chunk.release();
  };

  try {
    fixtureDate = localDate();
    const suffix = uniqueTestId("run_slow_start");
    const runOne = `startup-run-1-${suffix}`;
    const runTwo = `startup-run-2-${suffix}`;
    const brand = `Startup ${suffix}`;
    const flavor = "Test";
    const now = Date.now();
    const account = await authorizedFixtures.createAccount({
      username: `manager_${suffix}`,
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    });
    await authorizedFixtures.seedBrandProfile(account, {
      brand,
      flavor,
      values: {
        dieType: "8-Cut",
        casesNeeded: 10,
        casesPerSkid: 10,
        pizzasPerCase: 12,
      },
    });
    const values = {
      ...DEFAULT_VALUES,
      casesNeeded: 10,
      casesPerSkid: 10,
      casesOnCurrentSkid: 0,
      skidsCompleted: 0,
      pizzasPerCase: 12,
      freezerTime: 0,
      approxLineSpeed: 0,
      crustsPerCycle: 0,
      cycleSpeed: 0,
      speedAdjustment: 1,
    };
    await authorizedFixtures.seedTodaySync({
      token: account.token,
      senderId: `run-startup-${suffix}`,
      date: fixtureDate,
      payload: {
        dayState: {
          date: fixtureDate,
          runs: [
            { id: runOne, brand, flavor, metaUpdatedAt: now, seeded: false },
            {
              id: runTwo,
              brand: `${brand} Next`,
              flavor,
              metaUpdatedAt: now,
              seeded: false,
            },
          ],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
          prepPhase: {
            prepStartedAt: null,
            prepBatchesDough: 0,
            prepBatchesSauce: 0,
            prepCarriedOver: false,
          },
        },
        runValues: { [runOne]: values, [runTwo]: values },
        runValuesUpdatedAt: { [runOne]: now, [runTwo]: now },
        packagingProgress: {},
      },
    });

    await page.context().addCookies([{
      name: "rc_auth",
      value: account.token,
      url: API_BASE,
    }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const runTab = page.getByTestId("tab-run");
    await expect(runTab).toBeAttached({ timeout: 60_000 });
    await runTab.click();
    await expect(page.getByText("Run 1 of 2", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const targetCases = page.getByTestId("input-casesNeeded");
    await expect(targetCases).toHaveValue("10");
    const startRun = page.getByTestId("button-start-run");
    await expect(startRun).toBeEnabled();
    await expectReachableInViewport(page, startRun, "start control");
    await startRun.click();
    await expect.poll(() => readRunStartedAt(page, runOne)).toEqual(
      expect.any(Number),
    );
    const selectRunOne = page.getByRole("button", { name: "Select run 1" });
    await expect(selectRunOne).toBeEnabled();
    await expectReachableInViewport(page, selectRunOne, "Run 1 selection");
    await selectRunOne.click();
    await expect(page.getByText("Run 1 of 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true }))
      .toBeVisible({ timeout: 20_000 });

    const elapsed = page.getByTestId("elapsed-card-value");
    await expect(elapsed).toBeVisible();
    await expectReachableInViewport(page, elapsed, "running timer");
    const elapsedBeforePanelRequests = await elapsed.innerText();
    const completedCases = page.getByTestId("tile-cases-completed");
    await expect(completedCases).toBeVisible();
    await expectReachableInViewport(page, completedCases, "production counter");
    await testInfo.attach(`run-timer-counter-before-optional-panels-${testInfo.project.name}.png`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await page.getByTestId("tab-sauce").click();
    await expect(page.getByText("Loading Sauce…", { exact: true })).toBeVisible();
    await expect.poll(() => requestedChunks).toContain(optionalChunks[0]!.file);

    await page.getByTestId("tab-packaging").click();
    await expect(page.getByText("Loading Packaging…", { exact: true })).toBeVisible();
    await expect.poll(() => requestedChunks).toContain(optionalChunks[1]!.file);

    await page.getByTestId("tab-run").click();
    const pauseRun = page.getByRole("button", { name: "PAUSE RUN", exact: true });
    await expect(pauseRun).toBeEnabled();
    await expectReachableInViewport(page, pauseRun, "pause control");
    await expect(targetCases).toHaveValue("10");
    await expect(completedCases).toHaveText("0");
    await expect(elapsed).toBeVisible();
    await expectReachableInViewport(page, elapsed, "running timer");
    await expectReachableInViewport(page, completedCases, "production counter");
    await pauseRun.click();
    const resumeRun = page.getByRole("button", { name: "RESUME RUN", exact: true });
    await expect(resumeRun).toBeEnabled({ timeout: 20_000 });
    await expectReachableInViewport(page, resumeRun, "resume control");
    await resumeRun.click();
    await expect(pauseRun).toBeEnabled({ timeout: 20_000 });
    await expectReachableInViewport(page, pauseRun, "pause control after resume");
    const nextRun = page.getByRole("button", { name: /^Next .*Next – Test$/ });
    await expect(nextRun).toBeEnabled();
    await expectReachableInViewport(page, nextRun, "run switch");
    const selectRunTwo = page.getByRole("button", { name: "Select run 2" });
    await expect(selectRunTwo).toBeEnabled();
    await expectReachableInViewport(page, selectRunTwo, "Run 2 selection");
    await selectRunTwo.click();
    await expect(page.getByText("Run 2 of 2", { exact: true })).toBeVisible();
    await expect(startRun).toBeEnabled();
    await selectRunOne.click();
    await expect(page.getByText("Run 1 of 2", { exact: true })).toBeVisible();
    await expect(pauseRun).toBeEnabled({ timeout: 20_000 });
    await expectReachableInViewport(page, pauseRun, "pause control after run switch");
    await expect(completedCases).toHaveText("0");
    const startedAtBeforeRelease = await readRunStartedAt(page, runOne);
    expect(startedAtBeforeRelease).toEqual(expect.any(Number));
    const casesNeededBeforeRelease = await targetCases.inputValue();
    const completedCasesBeforeRelease = await completedCases.innerText();

    await testInfo.attach(`run-controls-before-optional-panels-${testInfo.project.name}.png`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    releaseAllOptionalChunks();
    await page.getByTestId("tab-sauce").click();
    await expect(page.getByTestId("sauce-daily-needs")).toBeVisible();
    await page.getByTestId("tab-packaging").click();
    await expect(page.getByTestId("text-skidsCompleted")).toBeVisible();
    await page.getByTestId("tab-run").click();
    await expect(pauseRun).toBeEnabled({ timeout: 20_000 });
    await expectReachableInViewport(page, pauseRun, "pause control after panels load");
    await expect(elapsed).toBeVisible();
    await expectReachableInViewport(page, elapsed, "running timer after panels load");
    await expectReachableInViewport(page, completedCases, "production counter after panels load");
    await expect(page.getByText("Run 1 of 2", { exact: true })).toBeVisible();
    await expect(targetCases).toHaveValue(casesNeededBeforeRelease);
    await expect(completedCases).toHaveText(completedCasesBeforeRelease);
    expect(await readRunStartedAt(page, runOne)).toBe(startedAtBeforeRelease);
    expect(requestedChunks.sort()).toEqual(optionalChunks.map(({ file }) => file).sort());
    expect(loadedChunks).toEqual(
      expect.arrayContaining(
        optionalChunks.map(({ file }) => ({ file, status: 200 })),
      ),
    );
    expect(pageErrors).toEqual([]);

    const viewport = page.viewportSize();
    const viewportEmulation = testInfo.project.name.includes("chromium-emulation");
    await testInfo.attach(`run-startup-slow-network-${testInfo.project.name}.json`, {
      body: JSON.stringify({
        browserEngine: browserName,
        project: testInfo.project.name,
        delayStrategy,
        viewportEmulation,
        physicalDeviceTested: false,
        viewport: viewport ? { width: viewport.width, height: viewport.height } : null,
        touchPoints: await page.evaluate(() => navigator.maxTouchPoints),
        networkProfile:
          browserName === "chromium"
            ? {
                latencyMs: 400,
                downloadKbps: 500,
                uploadKbps: 500,
              }
            : null,
        optionalChunks: optionalChunks.map(({ file }) => file),
        requestedChunks,
        loadedChunks,
        runStateBeforeRelease: {
          selectedRun: "Run 1 of 2",
          casesNeeded: casesNeededBeforeRelease,
          completedCases: completedCasesBeforeRelease,
          startedAt: startedAtBeforeRelease,
          elapsed: elapsedBeforePanelRequests,
          status: "running",
        },
        runStateAfterRelease: {
          selectedRun: "Run 1 of 2",
          casesNeeded: await targetCases.inputValue(),
          completedCases: await completedCases.innerText(),
          startedAt: await readRunStartedAt(page, runOne),
          elapsed: await elapsed.innerText(),
          status: "running",
        },
        controlsWhileChunksWereHeld: {
          timerAndProductionCounterReachable: true,
          pauseControlReachable: true,
          resumeControlReachable: true,
          runSwitchReachable: true,
        },
        pageErrors,
      }, null, 2),
      contentType: "application/json",
    });
  } finally {
    releaseAllOptionalChunks();
    await restoreNetwork();
  }
});
