/**
 * Run controls remain usable while optional station panels are still loading.
 *
 * Run this focused journey with the isolated database/API/web test wrapper:
 *   pnpm run test:e2e:run-startup
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
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

  const restoreNetwork = await throttleToSlow3G(page);
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

    const targetCases = page.getByTestId("input-casesNeeded");
    await expect(targetCases).toHaveValue("10");
    const startRun = page.getByTestId("button-start-run");
    await expect(startRun).toBeEnabled();
    await startRun.click();
    await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeVisible();

    const elapsed = page.getByTestId("elapsed-card-value");
    await expect(elapsed).toBeVisible();
    const elapsedBeforePanelRequests = await elapsed.innerText();
    const completedCases = page.getByTestId("tile-cases-completed");
    await expect(completedCases).toBeVisible();

    await page.getByTestId("tab-sauce").click();
    await expect(page.getByText("Loading Sauce…", { exact: true })).toBeVisible();
    await expect.poll(() => requestedChunks).toContain(optionalChunks[0]!.file);

    await page.getByTestId("tab-packaging").click();
    await expect(page.getByText("Loading Packaging…", { exact: true })).toBeVisible();
    await expect.poll(() => requestedChunks).toContain(optionalChunks[1]!.file);

    await page.getByTestId("tab-run").click();
    await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeEnabled();
    await expect(targetCases).toHaveValue("10");
    await expect(completedCases).toHaveText("0");
    await expect(elapsed).toBeVisible();
    await page.getByRole("button", { name: "PAUSE RUN", exact: true }).click();
    await expect(page.getByRole("button", { name: "RESUME RUN", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "RESUME RUN", exact: true }).click();
    await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Select run 2" })).toBeEnabled();
    await page.getByRole("button", { name: "Select run 2" }).click();
    await expect(page.getByText("Run 2 of 2", { exact: true })).toBeVisible();
    await expect(page.getByTestId("button-start-run")).toBeEnabled();
    await page.getByRole("button", { name: "Select run 1" }).click();
    await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeEnabled();
    await expect(page.getByTestId("elapsed-card-value")).toBeVisible();
    await expect(page.getByTestId("tile-cases-completed")).toHaveText("0");
    const startedAtBeforeRelease = await readRunStartedAt(page, runOne);
    expect(startedAtBeforeRelease).toEqual(expect.any(Number));

    await testInfo.attach("run-controls-before-optional-panels.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    releaseAllOptionalChunks();
    await page.getByTestId("tab-sauce").click();
    await expect(page.getByTestId("sauce-daily-needs")).toBeVisible();
    await page.getByTestId("tab-packaging").click();
    await expect(page.getByTestId("text-skidsCompleted")).toBeVisible();
    await page.getByTestId("tab-run").click();
    await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeEnabled();
    await expect(page.getByTestId("tile-cases-completed")).toHaveText("0");
    expect(await readRunStartedAt(page, runOne)).toBe(startedAtBeforeRelease);
    expect(requestedChunks.sort()).toEqual(optionalChunks.map(({ file }) => file).sort());
    expect(loadedChunks).toEqual(
      expect.arrayContaining(
        optionalChunks.map(({ file }) => ({ file, status: 200 })),
      ),
    );
    expect(pageErrors).toEqual([]);

    await testInfo.attach("run-startup-slow-network.json", {
      body: JSON.stringify({
        networkProfile: {
          latencyMs: 400,
          downloadKbps: 500,
          uploadKbps: 500,
        },
        optionalChunks: optionalChunks.map(({ file }) => file),
        requestedChunks,
        loadedChunks,
        runStateBeforeRelease: {
          selectedRun: "Run 1 of 2",
          casesNeeded: 10,
          completedCases: 0,
          startedAt: startedAtBeforeRelease,
          elapsed: elapsedBeforePanelRequests,
        },
        runStateAfterRelease: {
          casesNeeded: await targetCases.inputValue(),
          completedCases: await completedCases.innerText(),
          elapsed: await page.getByTestId("elapsed-card-value").innerText(),
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
