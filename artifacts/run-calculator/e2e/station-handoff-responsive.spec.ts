/**
 * E2E: ended-run station handoffs survive the responsive tab/reload boundaries.
 *
 * Frontline and Packaging have different drain completion points. This keeps
 * both journeys in one isolated account so the assertions cover the real
 * selected-run persistence rather than a mocked callback.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { DEFAULT_VALUES } from "../src/types";

test.use({ viewport: { width: 390, height: 844 } });

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "Welcome2Lucias!";
const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

let authorizedFixtures: AuthorizedBrowserFixtures;

type HandoffScenario = {
  endedRunId: string;
  pendingRunId: string;
  endedBrand: string;
  pendingBrand: string;
  endedAtOffsetMs: number;
};

function localDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

async function openAsManager(page: Page, token: string): Promise<void> {
  await page.goto(`/?e2e=anonymous-${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.context().addCookies([{
    name: "rc_auth",
    value: token,
    url: new URL(page.url()).origin,
  }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({
    state: "attached",
    timeout: 60_000,
  });
}

async function readCurrentRunId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("run-calc-day");
    if (!raw) return null;
    const day = JSON.parse(raw) as {
      currentIndex?: number;
      runs?: Array<{ id?: string }>;
    };
    return day.runs?.[day.currentIndex ?? 0]?.id ?? null;
  });
}

async function readSavedCasesNeeded(
  page: Page,
  runId: string,
): Promise<number | null> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem(`run-calc-run-${id}`);
    if (!raw) return null;
    return Number((JSON.parse(raw) as { casesNeeded?: number }).casesNeeded);
  }, runId);
}

async function seedScenario(
  scenario: HandoffScenario,
  token: string,
  senderId: string,
): Promise<void> {
  const now = Date.now();
  const date = localDate();
  const values = {
    ...DEFAULT_VALUES,
    casesNeeded: 37,
    casesPerSkid: 7,
    casesOnCurrentSkid: 2,
    skidsCompleted: 1,
    pizzasPerCase: 1,
    freezerTime: 1,
    approxLineSpeed: 60,
    crustsPerCycle: 1,
    cycleSpeed: 60,
    speedAdjustment: 1,
  };
  const pendingValues = {
    ...values,
    casesNeeded: 83,
    casesOnCurrentSkid: 0,
    skidsCompleted: 0,
  };

  await authorizedFixtures.seedTodaySync({
    token,
    senderId,
    date,
    payload: {
      dayState: {
        date,
        runs: [
          {
            id: scenario.endedRunId,
            brand: scenario.endedBrand,
            flavor: "Ended",
            startedAt: now - 10 * 60_000,
            endedAt: now - scenario.endedAtOffsetMs,
            metaUpdatedAt: now,
            seeded: false,
          },
          {
            id: scenario.pendingRunId,
            brand: scenario.pendingBrand,
            flavor: "Pending",
            startedAt: undefined,
            endedAt: undefined,
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
      runValues: {
        [scenario.endedRunId]: values,
        [scenario.pendingRunId]: pendingValues,
      },
      runValuesUpdatedAt: {
        [scenario.endedRunId]: now,
        [scenario.pendingRunId]: now,
      },
      packagingProgress: {},
    },
  });
}

async function clearBrowserState(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

test.beforeAll(async ({ playwright }) => {
  await requireIsolatedTestDatabase();
  authorizedFixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    SIGNUP_CODE,
  );
});

test.afterAll(async () => {
  await authorizedFixtures?.cleanup({ syncDates: [localDate()] });
});

test("keeps Frontline and Packaging handoffs selected once on a phone-sized viewport", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const suffix = uniqueTestId("station_handoff");
  const account = await authorizedFixtures.createAccount({
    username: `manager_${suffix}`,
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

  const frontline: HandoffScenario = {
    endedRunId: `frontline-ended-${suffix}`,
    pendingRunId: `frontline-pending-${suffix}`,
    endedBrand: `Frontline Ended ${suffix}`,
    pendingBrand: `Frontline Pending ${suffix}`,
    // Stage 1 completes after half of the one-minute line time. Start before
    // completion so the pending-clock tick, not initial mount, performs it.
    endedAtOffsetMs: 20_000,
  };
  await seedScenario(frontline, account.token, `frontline-${suffix}`);
  await openAsManager(page, account.token);
  await page.getByTestId("tab-frontline").click();
  // Depending on auth/sync hydration time, the short Stage 1 drain may elapse
  // before the station first mounts. Either way, the durable result must be
  // the pending run and must remain pending through the tab remount below.
  await expect.poll(() => readCurrentRunId(page), {
    timeout: 30_000,
    intervals: [500, 1_000, 2_000],
  }).toBe(frontline.pendingRunId);
  await expect(page.getByTestId("tab-run")).toBeVisible();
  await page.getByTestId("tab-run").click();
  await expect(page.getByTestId("button-start-run")).toBeVisible();
  await expect(page.getByRole("button", { name: "STOP RUN", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("input-casesNeeded")).toHaveValue("83");
  expect(await readSavedCasesNeeded(page, frontline.endedRunId)).toBe(37);
  expect(await readSavedCasesNeeded(page, frontline.pendingRunId)).toBe(83);

  // The station panel remount must not replay the already-completed handoff.
  await page.getByTestId("tab-sauce").click();
  await page.getByTestId("tab-frontline").click();
  await expect.poll(() => readCurrentRunId(page)).toBe(frontline.pendingRunId);
  await expect(page.getByTestId("button-start-run")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("frontline-handoff-after-tab-change.png"),
    fullPage: true,
  });

  const packaging: HandoffScenario = {
    endedRunId: `packaging-ended-${suffix}`,
    pendingRunId: `packaging-pending-${suffix}`,
    endedBrand: `Packaging Ended ${suffix}`,
    pendingBrand: `Packaging Pending ${suffix}`,
    // Full Packaging completion is one minute after the ended timestamp.
    endedAtOffsetMs: 50_000,
  };
  await clearBrowserState(page);
  await page.goto("about:blank");
  await authorizedFixtures.removeTodaySync([localDate()]);
  await seedScenario(packaging, account.token, `packaging-${suffix}`);
  await page.goto(`/?e2e=packaging-reload-${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 60_000 });
  await page.getByTestId("tab-packaging").click();
  // The full line drain may finish while the page is hydrating. The selected
  // run after the station mounts is the only state that may be persisted.
  await expect.poll(() => readCurrentRunId(page), {
    timeout: 30_000,
    intervals: [500, 1_000, 2_000],
  }).toBe(packaging.pendingRunId);
  await page.getByTestId("tab-run").click();
  await expect(page.getByTestId("button-start-run")).toBeVisible();
  await expect(page.getByRole("button", { name: "STOP RUN", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("input-casesNeeded")).toHaveValue("83");
  expect(await readSavedCasesNeeded(page, packaging.endedRunId)).toBe(37);
  expect(await readSavedCasesNeeded(page, packaging.pendingRunId)).toBe(83);

  // Reload after the timer elapsed: the pending run remains selected and
  // remains pending instead of being started by station startup.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 60_000 });
  await expect.poll(() => readCurrentRunId(page)).toBe(packaging.pendingRunId);
  await expect(page.getByTestId("button-start-run")).toBeVisible();
  await expect(page.getByRole("button", { name: "STOP RUN", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("input-casesNeeded")).toHaveValue("83");
  expect(await readSavedCasesNeeded(page, packaging.endedRunId)).toBe(37);
  expect(await readSavedCasesNeeded(page, packaging.pendingRunId)).toBe(83);
  await page.screenshot({
    path: testInfo.outputPath("packaging-handoff-after-reload.png"),
    fullPage: true,
  });
});