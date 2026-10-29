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
test.use({ timezoneId: "America/Chicago" });

type ChunkManifest = {
  chunks?: Record<string, { modules?: string[] }>;
};

type DeferredChunk = {
  file: string;
  gate: Promise<void>;
  release: () => void;
};

let fixtureDate: string | null = null;
let authorizedFixtures: AuthorizedBrowserFixtures | undefined;
// Run's primary touch controls use a documented minimum of 44×44 CSS pixels.
const MIN_RUN_CONTROL_TARGET_CSS_PX = 44;

function localDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

async function readSelectedRunId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("run-calc-day");
    if (!raw) return null;
    const state = JSON.parse(raw) as {
      currentIndex?: number;
      runs?: Array<{ id?: string }>;
    };
    return state.runs?.[state.currentIndex ?? 0]?.id ?? null;
  });
}

async function readCanonicalRunState(
  page: Page,
  date: string,
  runId: string,
): Promise<{
  startedAt: number | null;
  casesNeeded: number | null;
  skidsCompleted: number | null;
  casesOnCurrentSkid: number | null;
} | null> {
  const response = await page.request.get(
    `${API_BASE}/api/sync/today?today=${encodeURIComponent(date)}`,
  );
  if (!response.ok()) return null;
  const payload = await response.json() as {
    dayState?: { runs?: Array<{ id?: string; startedAt?: number }> };
    runValues?: Record<string, {
      casesNeeded?: number;
      skidsCompleted?: number;
      casesOnCurrentSkid?: number;
    }>;
  };
  const run = payload.dayState?.runs?.find((candidate) => candidate.id === runId);
  const values = payload.runValues?.[runId];
  if (!run || !values) return null;
  return {
    startedAt: run.startedAt ?? null,
    casesNeeded: values.casesNeeded ?? null,
    skidsCompleted: values.skidsCompleted ?? null,
    casesOnCurrentSkid: values.casesOnCurrentSkid ?? null,
  };
}

async function createStartupFixture(options: {
  casesNeeded?: number;
  skidsCompleted?: number;
  casesOnCurrentSkid?: number;
} = {}): Promise<{ runOne: string; token: string }> {
  const fixtures = authorizedFixtures;
  if (!fixtures) throw new Error("Authorized browser fixtures are not initialized.");
  fixtureDate = localDate();
  const suffix = uniqueTestId("run_slow_start");
  const runOne = `startup-run-1-${suffix}`;
  const runTwo = `startup-run-2-${suffix}`;
  const brand = `Startup ${suffix}`;
  const flavor = "Test";
  const now = Date.now();
  const casesNeeded = options.casesNeeded ?? 10;
  const account = await fixtures.createAccount({
    username: `manager_${suffix}`,
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });
  await fixtures.seedBrandProfile(account, {
    brand,
    flavor,
    values: {
      dieType: "8-Cut",
      casesNeeded,
      casesPerSkid: 10,
      pizzasPerCase: 12,
    },
  });
  const values = {
    ...DEFAULT_VALUES,
    casesNeeded,
    casesPerSkid: 10,
    casesOnCurrentSkid: options.casesOnCurrentSkid ?? 0,
    skidsCompleted: options.skidsCompleted ?? 0,
    pizzasPerCase: 12,
    freezerTime: 0,
    approxLineSpeed: 0,
    crustsPerCycle: 0,
    cycleSpeed: 0,
    speedAdjustment: 1,
  };
  await fixtures.seedTodaySync({
    token: account.token,
    senderId: `run-startup-${suffix}`,
    date: fixtureDate,
    payload: {
      syncVersion: 1,
      completeness: "complete",
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
        currentRunId: runOne,
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

  return { runOne, token: account.token };
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

async function expectRunControlTarget(
  page: Page,
  locator: Locator,
  description: string,
): Promise<{ width: number; height: number }> {
  await expectReachableInViewport(page, locator, description);
  const box = await locator.boundingBox();

  expect(box, `${description} should have a rendered touch target`).not.toBeNull();
  expect(
    box!.width,
    `${description} touch-target width should be at least ${MIN_RUN_CONTROL_TARGET_CSS_PX} CSS pixels (rendered ${box!.width}px)`,
  ).toBeGreaterThanOrEqual(MIN_RUN_CONTROL_TARGET_CSS_PX);
  expect(
    box!.height,
    `${description} touch-target height should be at least ${MIN_RUN_CONTROL_TARGET_CSS_PX} CSS pixels (rendered ${box!.height}px)`,
  ).toBeGreaterThanOrEqual(MIN_RUN_CONTROL_TARGET_CSS_PX);

  return { width: box!.width, height: box!.height };
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

test.beforeEach(async ({ playwright }) => {
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

test.afterEach(async () => {
  const fixtures = authorizedFixtures;
  authorizedFixtures = undefined;
  try {
    await fixtures?.cleanup({
      syncDates: fixtureDate ? [fixtureDate] : [],
    });
  } finally {
    fixtureDate = null;
  }
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
    const { runOne, token } = await createStartupFixture();

    await page.context().addCookies([{
      name: "rc_auth",
      value: token,
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
    const pauseTarget = await expectRunControlTarget(page, pauseRun, "pause control");
    const nextRun = page.getByRole("button", { name: /^Next .*Next – Test$/ });

    await expect(nextRun).toBeEnabled();
    const nextRunTarget = await expectRunControlTarget(page, nextRun, "next-run control");
    await expectReachableInViewport(page, nextRun, "run switch");
    await expect(completedCases).toHaveText("0");
    await expect.poll(
      async () => {
        const localStartedAt = await readRunStartedAt(page, runOne);
        const canonical = await readCanonicalRunState(page, fixtureDate!, runOne);
        return typeof localStartedAt === "number" && canonical?.startedAt === localStartedAt
          ? localStartedAt
          : null;
      },
      { timeout: 20_000, intervals: [250, 500, 1_000] },
    ).toEqual(expect.any(Number));
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

    // Pause after recording the running-state startup assertions, then measure
    // Resume without changing the selection or swipe behavior under test.
    await pauseRun.click();
    const resumeRun = page.getByRole("button", { name: "RESUME RUN", exact: true });
    await expect(resumeRun).toBeEnabled({ timeout: 20_000 });
    const resumeTarget = await expectRunControlTarget(page, resumeRun, "resume control");
    await expectReachableInViewport(page, resumeRun, "resume control");

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
          timerVisible: true,
          status: "running",
        },
        controlsWhileChunksWereHeld: {
          timerAndProductionCounterReachable: true,
          pauseControlReachable: true,
          runSwitchReachable: true,
          touchTargetMinimumCssPixels: MIN_RUN_CONTROL_TARGET_CSS_PX,
          measuredTouchTargetsCssPixels: {
            pause: pauseTarget,
            nextRun: nextRunTarget,
          },
        },
        controlsAfterOptionalPanelsLoaded: {
          resumeControlReachable: true,
          measuredTouchTargetsCssPixels: { resume: resumeTarget },
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

test.describe("started Run reload during delayed optional panel startup", () => {
test.use({ serviceWorkers: "block" });

test("reload preserves a started Run while its Sauce chunk is held in desktop WebKit", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "webkit" || testInfo.project.name !== "desktop-webkit",
    "Reload coverage is isolated to the desktop WebKit project.",
  );

  requireIsolatedTestDatabase("Run startup reload e2e");
  const sauceChunk = getOptionalPanelChunks()[0]!;
  const requestedChunks: string[] = [];
  const loadedChunks: Array<{ file: string; status: number }> = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(sauceChunk.file)) {
      loadedChunks.push({ file: sauceChunk.file, status: response.status() });
    }
  });

  let releaseChunk!: () => void;
  const chunkGate = new Promise<void>((resolveGate) => {
    releaseChunk = resolveGate;
  });
  await page.route(`**/${sauceChunk.file}`, async (route) => {
    requestedChunks.push(sauceChunk.file);
    await chunkGate;
    // Reloading is expected to abort the request held before reload. Do not
    // try to continue that canceled request after the gate is released.
    if (route.request().failure()) return;
    await route.continue();
  });

  try {
    const { runOne, token } = await createStartupFixture({
      casesNeeded: 30,
    });
    await page.context().addCookies([{
      name: "rc_auth",
      value: token,
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
    const completedCases = page.getByTestId("tile-cases-completed");
    await expect(targetCases).toHaveValue("30");
    await expect(completedCases).toHaveText("0");
    await page.getByTestId("button-start-run").click();
    await expect.poll(() => readRunStartedAt(page, runOne)).toEqual(
      expect.any(Number),
    );

    // Create a nonzero, realistic completed count through the production
    // Packaging controls: one full skid plus two cases on the next skid.
    await page.getByTestId("tab-packaging").click();
    const incrementCases = page.getByTestId("btn-inc-casesOnCurrentSkid");
    await expect(incrementCases).toBeVisible({ timeout: 30_000 });
    for (let count = 0; count < 10; count += 1) {
      await incrementCases.click();
    }
    await expect(page.getByTestId("text-casesOnCurrentSkid")).toHaveText("10");
    await page.getByTestId("btn-skid-done").click();
    await expect(page.getByTestId("text-skidsCompleted")).toHaveText("1/3");
    for (let count = 0; count < 2; count += 1) {
      await incrementCases.click();
    }
    await expect(page.getByTestId("text-casesOnCurrentSkid")).toHaveText("2");
    await page.getByTestId("tab-run").click();
    await expect(completedCases).toHaveText("12");

    const startedAtBeforeReload = await readRunStartedAt(page, runOne);
    expect(startedAtBeforeReload).toEqual(expect.any(Number));
    const startedRunCanonicalState = {
      startedAt: startedAtBeforeReload,
      casesNeeded: 30,
      skidsCompleted: 1,
      casesOnCurrentSkid: 2,
    };
    await expect.poll(
      () => readCanonicalRunState(page, fixtureDate!, runOne),
      { timeout: 20_000, intervals: [250, 500, 1_000] },
    ).toEqual(startedRunCanonicalState);

    await page.getByTestId("tab-sauce").click();
    await expect(page.getByText("Loading Sauce…", { exact: true })).toBeVisible();
    await expect.poll(() => requestedChunks).toContain(sauceChunk.file);
    expect(loadedChunks).toEqual([]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tab-run")).toBeAttached({ timeout: 60_000 });
    await page.getByTestId("tab-run").click();
    await expect(page.getByText("Run 1 of 2", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(targetCases).toHaveValue("30");
    await expect(completedCases).toHaveText("12");
    await expect.poll(() => readSelectedRunId(page)).toBe(runOne);
    expect(await readRunStartedAt(page, runOne)).toBe(startedAtBeforeReload);
    await expect.poll(
      () => readCanonicalRunState(page, fixtureDate!, runOne),
      { timeout: 20_000, intervals: [250, 500, 1_000] },
    ).toEqual(startedRunCanonicalState);
    expect(loadedChunks).toEqual([]);

    const pauseRun = page.getByRole("button", { name: "PAUSE RUN", exact: true });
    await expect(pauseRun).toBeEnabled({ timeout: 20_000 });
    await pauseRun.click();
    const resumeRun = page.getByRole("button", { name: "RESUME RUN", exact: true });
    await expect(resumeRun).toBeEnabled({ timeout: 20_000 });
    await resumeRun.click();
    await expect(pauseRun).toBeEnabled({ timeout: 20_000 });
    await expect(targetCases).toHaveValue("30");
    await expect(completedCases).toHaveText("12");
    const startedAtBeforeRelease = await readRunStartedAt(page, runOne);
    expect(startedAtBeforeRelease).toEqual(expect.any(Number));
    const runStateBeforeRelease = {
      ...startedRunCanonicalState,
      startedAt: startedAtBeforeRelease,
    };
    await expect.poll(
      () => readCanonicalRunState(page, fixtureDate!, runOne),
      { timeout: 20_000, intervals: [250, 500, 1_000] },
    ).toEqual(runStateBeforeRelease);

    releaseChunk();
    await page.getByTestId("tab-sauce").click();
    await expect(page.getByTestId("sauce-daily-needs")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("tab-run").click();
    await expect(pauseRun).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByText("Run 1 of 2", { exact: true })).toBeVisible();
    await expect(targetCases).toHaveValue("30");
    await expect(completedCases).toHaveText("12");
    expect(await readSelectedRunId(page)).toBe(runOne);
    expect(await readRunStartedAt(page, runOne)).toBe(startedAtBeforeRelease);
    await expect.poll(
      () => readCanonicalRunState(page, fixtureDate!, runOne),
      { timeout: 20_000, intervals: [250, 500, 1_000] },
    ).toEqual(runStateBeforeRelease);
    expect(requestedChunks).toContain(sauceChunk.file);
    expect(loadedChunks).toEqual([{ file: sauceChunk.file, status: 200 }]);
    expect(pageErrors).toEqual([]);

    await testInfo.attach("run-startup-reload-desktop-webkit.json", {
      body: JSON.stringify({
        browserEngine: browserName,
        project: testInfo.project.name,
        viewport: page.viewportSize(),
        physicalDeviceTested: false,
        heldOptionalChunk: sauceChunk.file,
        requestsWhileHeld: requestedChunks.length,
        loadedChunks,
        beforeReload: {
          selectedRunId: runOne,
          startedAt: startedAtBeforeReload,
          casesNeeded: "30",
          casesCompleted: "12",
        },
        afterReloadAndRelease: {
          selectedRunId: await readSelectedRunId(page),
          startedAt: await readRunStartedAt(page, runOne),
          casesNeeded: await targetCases.inputValue(),
          casesCompleted: await completedCases.innerText(),
        },
        beforeOptionalPanelRelease: {
          selectedRunId: runOne,
          startedAt: startedAtBeforeRelease,
          casesNeeded: 30,
          casesCompleted: 12,
        },
        pauseResumeUsable: true,
        pageErrors,
      }, null, 2),
      contentType: "application/json",
    });
  } finally {
    releaseChunk();
  }
});
});
