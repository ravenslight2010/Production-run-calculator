/**
  * E2E: the Packaging prior-run drain remains attached to the ended run after
  * the next run starts and the operator changes tabs.
 *
 * This is intentionally a single-browser journey. Cross-device convergence is
 * covered by the dedicated multi-device suites; this test only proves the
 * visible end-run → next-run → tab-switch boundary.
 */

import { expect, test, type Page } from "@playwright/test";
import { selectCanonicalFixtureRun } from "./canonical-run-selection";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { DEFAULT_VALUES } from "../src/types";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "Welcome2Lucias!";
const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

let authorizedFixtures: AuthorizedBrowserFixtures;

type RunValues = {
  casesNeeded: number;
  casesPerSkid: number;
  casesOnCurrentSkid: number;
  skidsCompleted: number;
  pizzasPerCase: number;
  freezerTime: number;
  approxLineSpeed: number;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
};

type StoredCounters = Pick<
  RunValues,
  "casesOnCurrentSkid" | "skidsCompleted"
>;

function localDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

async function openAsManager(
  page: Page,
  token: string,
  pageErrors: string[],
  consoleErrors: string[],
): Promise<void> {
  await page.context().addCookies([{
    name: "rc_auth",
    value: token,
    url: API_BASE,
  }]);
  await page.goto(`/?e2e=${Date.now()}`, { waitUntil: "domcontentloaded" });
  try {
    // Startup authenticates before the Run panel mounts. In a complete serial
    // gate that request can outlive the old 15-second field wait; navigating
    // again only destroyed the in-flight session check and restarted it.
    await page.getByTestId("tab-run").waitFor({
      state: "attached",
      timeout: 60_000,
    });
  } catch {
    const storedRunValues = await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => key.startsWith("run-calc-run-"))
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
    throw new Error([
      "Application did not render the Run tab.",
      await page.locator("body").innerText(),
      `Stored run values:\n${JSON.stringify(storedRunValues)}`,
      pageErrors.length > 0 ? `Page errors:\n${pageErrors.join("\n")}` : "",
      consoleErrors.length > 0 ? `Console errors:\n${consoleErrors.join("\n")}` : "",
    ].filter(Boolean).join("\n\n"));
  }
}

async function readStoredCounters(
  page: Page,
  runId: string,
): Promise<StoredCounters> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem(`run-calc-run-${id}`);
    const legacy = raw ? JSON.parse(raw) as Partial<RunValues> : {};
    const packaging = JSON.parse(localStorage.getItem("run-calc-packaging-progress") ?? "{}")[id];
    const values = { ...legacy, ...packaging };
    return {
      casesOnCurrentSkid: Number(values.casesOnCurrentSkid) || 0,
      skidsCompleted: Number(values.skidsCompleted) || 0,
    };
  }, runId);
}

async function readStoredCaseTotal(
  page: Page,
  runId: string,
  casesPerSkid: number,
): Promise<number> {
  const counters = await readStoredCounters(page, runId);
  return counters.skidsCompleted * casesPerSkid + counters.casesOnCurrentSkid;
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

test.beforeAll(async ({ playwright }) => {
  await requireIsolatedTestDatabase();
  authorizedFixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    SIGNUP_CODE,
  );
});

test.afterAll(async () => {
  await authorizedFixtures?.cleanup({
    syncDates: [localDate()],
  });
});

test("keeps the prior-run drain selected through next-run and tab changes", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const suffix = uniqueTestId("prior_drain");
  const username = `manager_${suffix}`;
  const runA = `drain-a-${suffix}`;
  const runB = `drain-b-${suffix}`;
  const date = localDate();
  const now = Date.now();

  const account = await authorizedFixtures.createAccount({
    username,
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });

  const runAValues = {
    ...DEFAULT_VALUES,
    casesNeeded: 2_000,
    casesPerSkid: 10,
    casesOnCurrentSkid: 0,
    skidsCompleted: 0,
    pizzasPerCase: 1,
    freezerTime: 20,
    approxLineSpeed: 60,
    crustsPerCycle: 1,
    cycleSpeed: 60,
    speedAdjustment: 1,
  };
  const runBValues = {
    ...runAValues,
    casesNeeded: 100,
    // Keep the active successor's tracker valid, but its 20-minute tunnel
    // prevents it from producing packaged cases during this short journey.
    freezerTime: 20,
    approxLineSpeed: 60,
    crustsPerCycle: 1,
    cycleSpeed: 60,
  };

  await authorizedFixtures.seedCanonicalTodaySnapshot({
    token: account.token,
    senderId: `prior-drain-${suffix}`,
    date,
    payload: {
      dayState: {
        date,
        runs: [
          {
            id: runA,
            brand: `Prior Run ${suffix}`,
            flavor: "Ended",
            // Keep a wide active drain window after the browser has loaded.
            // The 60 PPM fixture then produces observable per-second exits
            // without racing the 20-minute eligibility cutoff.
            startedAt: now - 40 * 60_000,
            endedAt: now - (20 * 60_000 - 90_000),
            metaUpdatedAt: now,
            seeded: false,
          },
          {
            id: runB,
            brand: `Next Run ${suffix}`,
            flavor: "Active",
            startedAt: undefined,
            endedAt: undefined,
            metaUpdatedAt: now,
            seeded: false,
          },
        ],
        currentIndex: 1,
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
        [runA]: runAValues,
        [runB]: runBValues,
      },
      runValuesUpdatedAt: {
        [runA]: now,
        [runB]: now,
      },
      packagingProgress: {},
    },
  });

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const manualSectionRequestBodies: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== "/api/sync/manual-section") return;
    manualSectionRequestBodies.push(request.postData() ?? "");
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    void response.text().then((body) => {
      failedResponses.push(`${response.status()} ${response.url()}: ${body}`);
    }).catch(() => {
      failedResponses.push(`${response.status()} ${response.url()}: <body unavailable>`);
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await openAsManager(page, account.token, pageErrors, consoleErrors);
  await selectCanonicalFixtureRun(page, runB);
  await page.getByTestId("tab-run").click();
  await expect(page.getByTestId("input-casesNeeded")).toBeVisible();
  await expect(page.getByTestId("button-start-run")).toBeVisible();

  // The previous run is already ended and selected run B is pending. Start B
  // through the same control an operator uses, then verify A drains separately.
  await expect(page.getByTestId("button-start-run")).toBeVisible();
  await expect.poll(() => readCurrentRunId(page)).toBe(runB);

  await page.getByTestId("button-start-run").click();
  await expect(
    page.getByRole("button", { name: /PAUSE RUN/i }),
  ).toBeVisible();
  await expect.poll(() => readCurrentRunId(page)).toBe(runB);

  await page.getByTestId("tab-packaging").click();
  const drainHeading = page.getByText(
    "Freeze Tunnel Draining · Prior Run",
    { exact: true },
  );
  await expect(drainHeading).toBeVisible();
  await expect(drainHeading.locator("xpath=../../..").getByText(
    `Prior Run ${suffix} – Ended`,
    { exact: true },
  )).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("prior-run-drain-before-tab-change.png"),
    fullPage: true,
  });

  // The drain effect is automatic and writes the ended run's local values.
  // With A's 60 PPM fixture, cases exit during this bounded real-time wait.
  try {
    await expect
      .poll(() => readStoredCaseTotal(page, runA, runAValues.casesPerSkid), {
        timeout: 15_000,
        intervals: [250, 500, 1_000],
      })
      .toBeGreaterThan(0);
  } catch (error) {
    const diagnostic = await page.evaluate((id) => {
      const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
        currentIndex?: number;
        runs?: Array<{ id?: string; startedAt?: number; endedAt?: number }>;
      };
      const values = JSON.parse(
        localStorage.getItem(`run-calc-run-${id}`) ?? "null",
      );
      const progress = JSON.parse(
        localStorage.getItem("run-calc-packaging-progress") ?? "{}",
      )[id] ?? null;
      return {
        now: Date.now(),
        hidden: document.hidden,
        currentRun: day.runs?.[day.currentIndex ?? 0]?.id,
        priorRun: day.runs?.find((run) => run.id === id) ?? null,
        values,
        progress,
      };
    }, runA);
    const drainPanel = await drainHeading.locator("xpath=../../..").innerText();
    throw new Error([
      `Prior-run automatic drain stayed at zero: ${String(error)}`,
      `Diagnostic: ${JSON.stringify(diagnostic)}`,
      `Drain panel: ${drainPanel}`,
      `Page errors: ${pageErrors.join("\n")}`,
    ].join("\n"));
  }
  const automaticCounters = await readStoredCounters(page, runA);
  const automaticTotal =
    automaticCounters.skidsCompleted * runAValues.casesPerSkid
      + automaticCounters.casesOnCurrentSkid;

  // A manual prior-run update must use A's ID, not the currently active B.
  await page.getByTestId("btn-draining-skid-done").click();
  await expect
    .poll(() => readStoredCaseTotal(page, runA, runAValues.casesPerSkid))
    .toBeGreaterThanOrEqual(automaticTotal + runAValues.casesPerSkid);
  const manualCounters = await readStoredCounters(page, runA);
  expect(await readStoredCounters(page, runB)).toEqual({
    casesOnCurrentSkid: 0,
    skidsCompleted: 0,
  });

  // TabsContent unmounts Packaging. Returning must recompute the same eligible
  // ended run rather than losing the drain baseline or binding to B.
  await page.getByTestId("tab-sauce").click();
  await expect(drainHeading).toHaveCount(0);
  await expect(page.getByTestId("compact-run-strip")).toContainText(
    `Next Run ${suffix}`,
  );
  await page.getByTestId("tab-packaging").click();
  await expect(drainHeading).toBeVisible();
  await expect(drainHeading.locator("xpath=../../..").getByText(
    `Prior Run ${suffix} – Ended`,
    { exact: true },
  )).toBeVisible();
  await expect.poll(() => readStoredCounters(page, runA)).toEqual(manualCounters);
  await expect
    .poll(() => readStoredCounters(page, runB))
    .toEqual({ casesOnCurrentSkid: 0, skidsCompleted: 0 });
  await page.screenshot({
    path: testInfo.outputPath("prior-run-drain-after-tab-change.png"),
    fullPage: true,
  });

  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors,
    [
      `HTTP error responses: ${failedResponses.join("\n")}`,
      `Manual-section requests: ${manualSectionRequestBodies.join("\n")}`,
    ].join("\n"),
  ).toEqual([]);
});