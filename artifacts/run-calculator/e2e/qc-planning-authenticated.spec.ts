import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  requireDedicatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const evidenceDir = resolve(process.cwd(), "../../.local/tasks/evidence/qc-slice-6-planning");

function addDays(date: string, count: number): string {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

async function openQcPlanning(page: Page, origin: string): Promise<void> {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
  await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
  const planningToggle = page.getByTestId("button-toggle-qc-planning");
  await expect(planningToggle).toHaveAccessibleName("Upcoming production");
  await expect(planningToggle).toHaveJSProperty("tabIndex", 0);
  await planningToggle.click();
  await expect(planningToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("qc-planning-view")).toBeVisible();
}

async function attachEvidenceScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = resolve(
    evidenceDir,
    `${testInfo.project.name}-qc-planning-after-refresh.jpg`,
  );
  await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 78, fullPage: false });
  await testInfo.attach("qc-planning-after-refresh", {
    path: screenshotPath,
    contentType: "image/jpeg",
  });
}

test("QC staff read the canonical upcoming schedule and refresh after an external manager edit", async ({
  browser,
  playwright,
  baseURL,
}, testInfo) => {
  test.skip(!baseURL, "The isolated browser runner must provide a local web origin.");
  const apiOrigin = requireLocalFixtureApiOrigin("QC planning synthetic verification");
  requireDedicatedTestDatabase("QC planning synthetic verification");
  const fixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    apiOrigin,
    process.env.STAFF_SIGNUP_CODE ?? "",
  );
  const manager = await fixtures.createAccount({
    username: uniqueTestId("qc-planning-manager"),
    password: "FixturePass123!",
    capabilities: ["manage-factory-settings"],
    onboardingSeen: true,
  });
  const operator = await fixtures.createAccount({
    username: uniqueTestId("qc-planning-operator"),
    password: "FixturePass123!",
    capabilities: ["record-qc"],
    onboardingSeen: true,
  });
  const context = await browser.newContext({
    viewport: testInfo.project.use.viewport as { width: number; height: number } | undefined,
  });
  await context.addCookies([{
    name: "rc_auth",
    value: operator.token,
    url: new URL(baseURL!).origin,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  const page = await context.newPage();
  const qcResponses: Array<{
    status: number;
    method: string;
    path: string;
    today: string | null;
    days: string | null;
  }> = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`.slice(0, 240)));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/qc/planning") {
      qcResponses.push({
        status: response.status(),
        method: response.request().method(),
        path: url.pathname,
        today: url.searchParams.get("today"),
        days: url.searchParams.get("days"),
      });
    }
  });

  const today = await page.evaluate(() => {
    const date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  });
  const date = addDays(today, 1);
  const initialRunId = uniqueTestId("qc-planning-initial-run");
  const updatedRunId = uniqueTestId("qc-planning-updated-run");
  const schedulePayload = (runs: Array<{ id: string; brand: string; flavor: string }>) => ({
    dayState: {
      date,
      runs,
      currentIndex: 0,
      resetAt: 0,
      substitutions: [],
      substitutionLog: [],
      stagedItems: {},
    },
    runValues: Object.fromEntries(runs.map((run) => [run.id, { casesNeeded: 12 }])),
    runValuesUpdatedAt: {},
    packagingProgress: {},
  });

  const browserRunId = uniqueTestId("qc-planning-browser-run");
  let testOutcome: "not completed" | "passed" | "failed" = "not completed";
  let testFailure: string | null = null;
  let cleanupStatus = "not completed";
  let cleanupFailure: string | null = null;
  try {
    await fixtures.seedScheduledSync({
      token: manager.token,
      date,
      today,
      payload: schedulePayload([{
        id: initialRunId,
        brand: "Synthetic Initial Brand",
        flavor: "Cheese",
      }]),
    });

    await openQcPlanning(page, baseURL!);
    const planning = page.getByTestId("qc-planning-view");
    await expect(planning.getByText("Synthetic Initial Brand")).toBeVisible();
    await expect(planning.getByTestId(`qc-planning-run-${initialRunId}`)).toContainText("Cheese");
    await expect(planning.getByText("12 cases", { exact: true })).toBeVisible();
    await expect(planning.getByTestId(`qc-planning-run-${initialRunId}`)).toContainText(initialRunId);
    await expect(planning.getByRole("button")).toHaveCount(1);
    const refreshButton = planning.getByRole("button", { name: "Refresh" });
    await expect(refreshButton).toBeVisible();
    await expect(refreshButton).toHaveAccessibleName("Refresh");
    const rangeSelect = planning.getByTestId("select-qc-planning-range");
    await expect(rangeSelect).toHaveAccessibleName("Date range");
    await expect(rangeSelect).toHaveCSS("color-scheme", "dark");

    await fixtures.seedScheduledSync({
      token: manager.token,
      date,
      today,
      payload: schedulePayload([
        { id: initialRunId, brand: "Synthetic Initial Brand", flavor: "Cheese" },
        { id: updatedRunId, brand: "Synthetic Updated Brand", flavor: "Pepperoni" },
      ]),
    });
    await planning.getByTestId("button-refresh-qc-planning").click();
    await expect(planning.getByText("Synthetic Updated Brand")).toBeVisible();
    await expect(planning.getByTestId(`qc-planning-run-${updatedRunId}`)).toContainText("Pepperoni");

    await planning.getByTestId("select-qc-planning-range").selectOption("7");
    await expect(planning.getByTestId("text-qc-planning-range")).toContainText("maximum 90 days");
    await expect.poll(async () => await planning.getByTestId("select-qc-planning-range").inputValue())
      .toBe("7");
    await expect.poll(async () => await page.evaluate(() =>
      window.localStorage.getItem("qc-planning-days-v1"),
    )).toBe("7");

    await expect.poll(async () => await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    const updatedRunCard = planning.getByTestId(`qc-planning-run-${updatedRunId}`);
    await updatedRunCard.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const [runBounds, navigationBounds] = await Promise.all([
      updatedRunCard.boundingBox(),
      page.locator(".station-nav").boundingBox(),
    ]);
    if (!runBounds || !navigationBounds) {
      throw new Error("The schedule card or fixed station navigation is not measurable.");
    }
    expect(runBounds.y + runBounds.height).toBeLessThanOrEqual(navigationBounds.y);
    await attachEvidenceScreenshot(page, testInfo);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await page.getByTitle("More").click();
    await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
    await page.getByTestId("button-toggle-qc-planning").click();
    const reloadedPlanning = page.getByTestId("qc-planning-view");
    await expect(reloadedPlanning.getByTestId("select-qc-planning-range")).toHaveValue("7");
    await expect(reloadedPlanning.getByText("Synthetic Updated Brand")).toBeVisible();
    await expect(reloadedPlanning.getByTestId(`qc-planning-run-${updatedRunId}`))
      .toContainText(updatedRunId);
    await expect.poll(async () => await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);

    expect(qcResponses.length).toBeGreaterThanOrEqual(3);
    expect(qcResponses.every((response) =>
      response.status === 200 && response.method === "GET" && response.today === today,
    ))
      .toBe(true);
    expect(qcResponses.some((response) => response.days === "7")).toBe(true);
    expect(pageErrors).toEqual([]);
    testOutcome = "passed";
  } catch (error) {
    testOutcome = "failed";
    const message = error instanceof Error ? error.message : String(error);
    testFailure = message
      .replace(/\u001B\[[0-9;]*m/g, "")
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.slice(0, 500) ?? "Unspecified browser test failure";
    throw error;
  } finally {
    await context.close().catch(() => {});
    try {
      await fixtures.cleanup({ syncDates: [date] });
      cleanupStatus = "PASS: scheduled fixture date, test accounts, and roles removed";
    } catch (error) {
      cleanupStatus = "FAIL: isolated fixture cleanup failed";
      cleanupFailure = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);
    }

    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      resolve(evidenceDir, `${testInfo.project.name}-browser-result.json`),
      JSON.stringify({
        capturedAt: new Date().toISOString(),
        browserRunId,
        outcome: testOutcome,
        failure: testFailure,
        environment: "isolated disposable test database",
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        sourceState: "verification ran against the current workspace, including uncommitted task changes",
        viewport: testInfo.project.use.viewport,
        locale: testInfo.project.use.locale ?? null,
        timezoneId: testInfo.project.use.timezoneId ?? null,
        browser: testInfo.project.name,
        data: "synthetic schedule fixture only",
        scheduleDate: date,
        rangePreferenceAfterReload: "7 days",
        qcResponses,
        pageErrors,
        cleanup: cleanupStatus,
        cleanupFailure,
      }, null, 2),
    );
    if (cleanupFailure && testOutcome === "passed") {
      throw new Error(`QC planning browser fixture cleanup failed: ${cleanupFailure}`);
    }
  }
});
